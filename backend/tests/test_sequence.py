import random
import unittest
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup, ReviewLog
from app.routers.review import answer_sequence
from app.schemas import (
    QuestionCreate,
    SequenceAnswerItem,
    SequenceAnswerRequest,
    SequenceGroupItemBulkItem,
    SequenceGroupItemsBulkUpdate,
    TrainingAttemptRecordRequest
)
from app.services.mode_difficulty import click_prompt_base_difficulty
from app.services.mode_selection import CHOICE_MODE_MIN_CONTEXT
from app.services.questions import create_question
from app.services.review import serialize_review_items
from app.services.sequence import (
    dense_positions,
    grade_sequence_position,
    validate_question_sequence
)
from app.services.sequence_groups import (
    list_sequence_group_items,
    save_sequence_group_items
)
from app.services.sequence_modes import (
    SEQUENCE_MODE_MULTIPLE_CHOICE,
    SEQUENCE_MODE_NEXT_IN_SEQUENCE,
    SEQUENCE_MODE_REORDER,
    SEQUENCE_MODE_TYPE_POSITION,
    choose_sequence_review_mode,
    sequence_mode_difficulty
)
from app.services.training import (
    grade_training_sequence,
    group_training_fingerprint,
    record_training_attempt,
    serialize_previous_training_record
)


class FixedRandom:
    def __init__(self, value):
        self.value = value

    def random(self):
        return self.value


class SequenceTestCase(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_group(self, name="Alphabet grec"):
        group = QuestionGroup(type_group="sequence", name=name)
        self.db.add(group)
        self.db.flush()

        return group

    def add_item(
        self,
        group,
        answer,
        position,
        question_id=None,
        reps=None,
        next_review=None,
        history=None,
        difficulty=5.0
    ):
        item = Question(
            id=question_id,
            type_q="sequence",
            question=answer,
            answer=answer,
            tags=[],
            data={"position": position},
            group=group
        )
        self.db.add(item)

        if reps is not None or next_review is not None or history is not None:
            item.progress = Progress(
                stability=1.0,
                difficulty=difficulty,
                reps=0 if reps is None else reps,
                lapses=0,
                interval=0,
                next_review=next_review,
                history=history or []
            )

        self.db.flush()

        return item

    def bulk_payload(self, labels, deleted_item_ids=None, ids=None):
        ids = ids or [None] * len(labels)

        return SequenceGroupItemsBulkUpdate(
            items=[
                SequenceGroupItemBulkItem(id=item_id, answer=label)
                for item_id, label in zip(ids, labels)
            ],
            deleted_item_ids=deleted_item_ids or []
        )


class SequenceRankTests(SequenceTestCase):
    def test_bulk_save_assigns_dense_ranks_from_array_order(self):
        group = self.add_group()

        save_sequence_group_items(
            self.db,
            group.id,
            self.bulk_payload(["Alpha", "Beta", "Gamma"])
        )

        items = list_sequence_group_items(self.db, group.id)

        self.assertEqual(
            [(item["label"], item["position"]) for item in items],
            [("Alpha", 1), ("Beta", 2), ("Gamma", 3)]
        )

    def test_reordering_the_array_renumbers_the_ranks(self):
        group = self.add_group()
        saved = save_sequence_group_items(
            self.db,
            group.id,
            self.bulk_payload(["Alpha", "Beta", "Gamma"])
        )
        by_label = {
            item["answer"]: item["id"]
            for item in saved["items"]
        }

        save_sequence_group_items(
            self.db,
            group.id,
            self.bulk_payload(
                ["Gamma", "Alpha", "Beta"],
                ids=[
                    by_label["Gamma"],
                    by_label["Alpha"],
                    by_label["Beta"]
                ]
            )
        )

        items = list_sequence_group_items(self.db, group.id)

        self.assertEqual(
            [(item["label"], item["position"]) for item in items],
            [("Gamma", 1), ("Alpha", 2), ("Beta", 3)]
        )

    def test_deleting_a_middle_item_leaves_no_gap(self):
        group = self.add_group()
        saved = save_sequence_group_items(
            self.db,
            group.id,
            self.bulk_payload(["Alpha", "Beta", "Gamma"])
        )
        by_label = {
            item["answer"]: item["id"]
            for item in saved["items"]
        }

        save_sequence_group_items(
            self.db,
            group.id,
            self.bulk_payload(
                ["Alpha", "Gamma"],
                ids=[by_label["Alpha"], by_label["Gamma"]],
                deleted_item_ids=[by_label["Beta"]]
            )
        )

        items = list_sequence_group_items(self.db, group.id)

        self.assertEqual(
            [(item["label"], item["position"]) for item in items],
            [("Alpha", 1), ("Gamma", 2)]
        )

    def test_dense_positions_repairs_duplicate_and_missing_ranks(self):
        # PATCH /questions/{id} can write any data blob, so the ranks the
        # serializer shows and the grader uses must be derived, not trusted.
        group = self.add_group()
        first = self.add_item(group, "Alpha", 1, question_id=1)
        second = self.add_item(group, "Beta", 1, question_id=2)
        third = self.add_item(group, "Gamma", None, question_id=3)

        positions = dense_positions([third, second, first])

        self.assertEqual(positions[first.id], 1)
        self.assertEqual(positions[second.id], 2)
        self.assertEqual(positions[third.id], 3)


class SequenceValidationTests(SequenceTestCase):
    def test_sequence_item_requires_a_group(self):
        with self.assertRaises(HTTPException) as caught:
            validate_question_sequence("sequence", None, {"position": 1})

        self.assertEqual(caught.exception.status_code, 400)

    def test_sequence_item_requires_a_valid_position(self):
        group = self.add_group()

        for data in [{}, {"position": 0}, {"position": "alpha"}]:
            with self.assertRaises(HTTPException):
                validate_question_sequence("sequence", group.id, data)

    def test_sequence_group_rejects_a_text_question(self):
        group = self.add_group()

        with self.assertRaises(HTTPException) as caught:
            create_question(
                self.db,
                QuestionCreate(
                    question="Nope",
                    answer="Nope",
                    type_q="text",
                    group_id=group.id
                )
            )

        self.assertEqual(caught.exception.status_code, 400)


class SequenceGradingTests(SequenceTestCase):
    def test_distance_maps_to_quality(self):
        self.assertEqual(grade_sequence_position(4, 4)["quality"], 2)
        self.assertEqual(grade_sequence_position(4, 3)["quality"], 1)
        self.assertEqual(grade_sequence_position(4, 5)["quality"], 1)
        self.assertEqual(grade_sequence_position(4, 6)["quality"], 0)

    def test_an_unresolved_answer_is_a_miss(self):
        grading = grade_sequence_position(4, None)

        self.assertEqual(grading["quality"], 0)
        self.assertIsNone(grading["distance"])


class SequenceModeTests(SequenceTestCase):
    def test_type_position_is_the_reference_difficulty(self):
        self.assertEqual(
            sequence_mode_difficulty(SEQUENCE_MODE_TYPE_POSITION),
            1.0
        )

    def test_reorder_reuses_the_click_prompt_curve(self):
        for count in [5, 10, 24, 30]:
            self.assertAlmostEqual(
                sequence_mode_difficulty(
                    SEQUENCE_MODE_REORDER,
                    context_count=count
                ),
                click_prompt_base_difficulty(count),
                places=6
            )

    def test_recall_modes_outrank_recognition_modes(self):
        self.assertGreater(
            sequence_mode_difficulty(SEQUENCE_MODE_NEXT_IN_SEQUENCE),
            sequence_mode_difficulty(SEQUENCE_MODE_MULTIPLE_CHOICE)
        )
        self.assertGreater(
            sequence_mode_difficulty(SEQUENCE_MODE_TYPE_POSITION),
            sequence_mode_difficulty(SEQUENCE_MODE_NEXT_IN_SEQUENCE)
        )

    def test_choice_modes_are_withheld_below_the_shared_minimum(self):
        group = self.add_group()
        due = [
            self.add_item(group, f"Item {index}", index, reps=1)
            for index in range(1, CHOICE_MODE_MIN_CONTEXT)
        ]

        for value in [0.0, 0.4, 0.9]:
            mode = choose_sequence_review_mode(
                due,
                due,
                multiple_choice_context_count=len(due),
                rng=FixedRandom(value)
            )

            self.assertNotIn(
                mode,
                [SEQUENCE_MODE_MULTIPLE_CHOICE, SEQUENCE_MODE_REORDER]
            )

    def test_struggling_sets_favour_recognition(self):
        group = self.add_group()
        due = [
            # difficulty >= 6.7 buckets a card as "support" affinity.
            self.add_item(group, f"Item {index}", index, reps=1, difficulty=8.0)
            for index in range(1, 11)
        ]

        mode = choose_sequence_review_mode(
            due,
            due,
            multiple_choice_context_count=len(due),
            rng=FixedRandom(0)
        )

        self.assertEqual(mode, SEQUENCE_MODE_MULTIPLE_CHOICE)

    def test_recency_penalty_stays_proportionate_on_a_large_due_set(self):
        # Every one of 30 support-affinity items shares a history spread
        # evenly across three modes. Unnormalized, the accumulated counts
        # (30 questions x 2 entries x three modes) would drive every
        # penalized mode's score far below next_in_sequence's untouched 2.0,
        # locking selection onto it regardless of the support bucket's
        # actual preference for multiple_choice/reorder. Normalized, the
        # affinity table's preference survives.
        group = self.add_group()
        history = (
            [{"sequence_mode": SEQUENCE_MODE_MULTIPLE_CHOICE}] * 2
            + [{"sequence_mode": SEQUENCE_MODE_REORDER}] * 2
            + [{"sequence_mode": SEQUENCE_MODE_TYPE_POSITION}] * 2
        )
        due = [
            self.add_item(
                group,
                f"Item {index}",
                index,
                reps=1,
                difficulty=8.0,
                history=list(history)
            )
            for index in range(1, 31)
        ]

        mode = choose_sequence_review_mode(
            due,
            due,
            multiple_choice_context_count=len(due),
            rng=FixedRandom(0)
        )

        self.assertEqual(mode, SEQUENCE_MODE_MULTIPLE_CHOICE)

    def test_next_in_sequence_is_withheld_when_due_positions_are_adjacent(self):
        group = self.add_group()
        due = [
            self.add_item(group, f"Item {index}", index, reps=1)
            for index in range(1, CHOICE_MODE_MIN_CONTEXT + 1)
        ]

        for value in [0.0, 0.4, 0.9]:
            mode = choose_sequence_review_mode(
                due,
                due,
                multiple_choice_context_count=len(due),
                has_adjacent_due_positions=True,
                rng=FixedRandom(value)
            )

            self.assertNotEqual(mode, SEQUENCE_MODE_NEXT_IN_SEQUENCE)


class SequenceReviewSerializationTests(SequenceTestCase):
    def test_anchors_are_started_peers_only_and_hide_new_items(self):
        group = self.add_group()
        due = [
            self.add_item(
                group,
                f"Due {index}",
                index,
                reps=2,
                next_review=date.today()
            )
            for index in range(1, 4)
        ]

        for index in range(4, 8):
            self.add_item(
                group,
                f"Known {index}",
                index,
                reps=4,
                next_review=date.today() + timedelta(days=30)
            )

        for index in range(8, 11):
            self.add_item(group, f"New {index}", index)

        self.db.commit()

        items = serialize_review_items(due, scheduled_review=True)
        sequence_group = next(
            item for item in items if item["type_q"] == "sequence"
        )
        anchor_labels = [
            anchor["label"]
            for anchor in sequence_group["anchors"]
        ]

        self.assertEqual(len(anchor_labels), 4)
        self.assertTrue(
            all(label.startswith("Known") for label in anchor_labels)
        )
        # An unstarted item must never be revealed before its first review.
        self.assertFalse(
            any(label.startswith("New") for label in anchor_labels)
        )
        self.assertEqual(sequence_group["length"], 10)

    def test_chunked_lists_do_not_leak_the_other_chunks_due_items(self):
        # _visual_review_contexts hands back every started peer, which for a
        # chunked list includes the other chunk's still-due items. On a reorder
        # rail that is literally showing the answers.
        group = self.add_group()
        due = [
            self.add_item(
                group,
                f"Item {index}",
                index,
                reps=2,
                next_review=date.today()
            )
            for index in range(1, 41)
        ]
        self.db.commit()

        items = serialize_review_items(due, scheduled_review=True)
        sequence_groups = [
            item for item in items if item["type_q"] == "sequence"
        ]

        self.assertGreater(len(sequence_groups), 1)

        for sequence_group in sequence_groups:
            self.assertEqual(sequence_group["anchors"], [])

    def test_items_carry_their_rank_and_predecessor(self):
        group = self.add_group()
        due = [
            self.add_item(
                group,
                label,
                index + 1,
                reps=2,
                next_review=date.today()
            )
            for index, label in enumerate(["Alpha", "Beta", "Gamma"])
        ]
        self.db.commit()

        items = serialize_review_items(due, scheduled_review=True)
        sequence_group = next(
            item for item in items if item["type_q"] == "sequence"
        )
        by_label = {
            item["label"]: item
            for item in sequence_group["items"]
        }

        self.assertEqual(by_label["Alpha"]["position"], 1)
        self.assertIsNone(by_label["Alpha"]["previous_label"])
        self.assertEqual(by_label["Gamma"]["position"], 3)
        # Beta (position 2) is itself due and unrevealed in this same set, so
        # its label must be withheld rather than leaked onto Gamma's row.
        self.assertIsNone(by_label["Gamma"]["previous_label"])

    def test_previous_label_is_shown_for_a_started_non_due_predecessor(self):
        group = self.add_group()
        self.add_item(
            group,
            "Alpha",
            1,
            reps=4,
            next_review=date.today() + timedelta(days=30)
        )
        due = [
            self.add_item(
                group,
                "Beta",
                2,
                reps=2,
                next_review=date.today()
            )
        ]
        self.db.commit()

        items = serialize_review_items(due, scheduled_review=True)
        sequence_group = next(
            item for item in items if item["type_q"] == "sequence"
        )
        by_label = {
            item["label"]: item
            for item in sequence_group["items"]
        }

        self.assertEqual(by_label["Beta"]["previous_label"], "Alpha")

    def test_previous_label_is_withheld_for_an_unstarted_predecessor(self):
        group = self.add_group()
        self.add_item(group, "Alpha", 1)
        due = [
            self.add_item(
                group,
                "Beta",
                2,
                reps=2,
                next_review=date.today()
            )
        ]
        self.db.commit()

        items = serialize_review_items(due, scheduled_review=True)
        sequence_group = next(
            item for item in items if item["type_q"] == "sequence"
        )
        by_label = {
            item["label"]: item
            for item in sequence_group["items"]
        }

        self.assertIsNone(by_label["Beta"]["previous_label"])


class AnswerSequenceEndpointTests(SequenceTestCase):
    def test_grades_each_item_and_records_the_mode_metadata(self):
        group = self.add_group()
        items = [
            self.add_item(
                group,
                f"Item {index}",
                index,
                question_id=index,
                reps=2,
                next_review=date.today()
            )
            for index in range(1, 7)
        ]
        self.db.commit()

        response = answer_sequence(
            SequenceAnswerRequest(
                items={
                    1: SequenceAnswerItem(position=1),
                    2: SequenceAnswerItem(position=3),
                    3: SequenceAnswerItem(position=6)
                },
                mode=SEQUENCE_MODE_MULTIPLE_CHOICE,
                context_count=6
            ),
            db=self.db
        )
        by_id = {
            result["question_id"]: result
            for result in response["results"]
        }

        self.assertEqual(response["mode"], SEQUENCE_MODE_MULTIPLE_CHOICE)
        self.assertEqual(by_id[1]["quality"], 2)
        self.assertEqual(by_id[2]["quality"], 1)
        self.assertEqual(by_id[3]["quality"], 0)
        self.assertEqual(by_id[2]["expected_position"], 2)
        self.assertEqual(by_id[2]["distance"], 1)

        entry = items[0].progress.history[-1]

        self.assertEqual(entry["sequence_mode"], SEQUENCE_MODE_MULTIPLE_CHOICE)
        self.assertEqual(entry["sequence_context_count"], 6)
        self.assertEqual(entry["raw_quality"], 2)
        self.assertEqual(entry["effective_quality"], 2)
        self.assertTrue(entry["mode_adjusted"])
        self.assertAlmostEqual(entry["mode_difficulty"], 0.55, places=6)

    def test_records_the_submitted_position_as_the_given_answer(self):
        group = self.add_group()
        items = [
            self.add_item(
                group,
                f"Item {index}",
                index,
                question_id=index,
                reps=2,
                next_review=date.today()
            )
            for index in range(1, 4)
        ]
        self.db.commit()

        answer_sequence(
            SequenceAnswerRequest(
                items={
                    1: SequenceAnswerItem(position=1),
                    2: SequenceAnswerItem(position=3)
                },
                mode=SEQUENCE_MODE_TYPE_POSITION,
                context_count=3
            ),
            db=self.db
        )

        self.assertEqual(items[0].progress.history[-1]["answer"], 1)
        # A miss must record what was actually placed, not the expected rank.
        self.assertEqual(items[1].progress.history[-1]["answer"], 3)

        # The revlog mirrors the entry verbatim, so the answer rides along.
        row = (
            self.db.query(ReviewLog)
            .filter(ReviewLog.question_id == 2)
            .order_by(ReviewLog.seq.desc())
            .first()
        )

        self.assertEqual(row.data["answer"], 3)

    def test_reorder_difficulty_tracks_the_submitted_pool(self):
        group = self.add_group()
        self.add_item(
            group,
            "Alpha",
            1,
            question_id=1,
            reps=2,
            next_review=date.today()
        )
        self.db.commit()

        answer_sequence(
            SequenceAnswerRequest(
                items={1: SequenceAnswerItem(position=1)},
                mode=SEQUENCE_MODE_REORDER,
                context_count=10
            ),
            db=self.db
        )

        entry = (
            self.db.query(Question)
            .filter(Question.id == 1)
            .first()
            .progress
            .history[-1]
        )

        self.assertAlmostEqual(
            entry["mode_difficulty"],
            click_prompt_base_difficulty(10),
            places=6
        )

    def test_a_failed_new_card_is_scheduled_and_stays_due(self):
        group = self.add_group()
        self.add_item(group, "Alpha", 1, question_id=1)
        self.db.commit()

        response = answer_sequence(
            SequenceAnswerRequest(
                items={1: SequenceAnswerItem(position=5)},
                mode=SEQUENCE_MODE_TYPE_POSITION
            ),
            db=self.db
        )

        progress = (
            self.db.query(Progress).filter(Progress.question_id == 1).first()
        )

        self.assertEqual(len(response["results"]), 1)
        self.assertEqual(response["results"][0]["quality"], 0)
        self.assertIsNotNone(progress)
        self.assertEqual(progress.reps, 1)
        self.assertEqual(progress.history[-1]["quality"], 0)
        self.assertEqual(progress.next_review, date.today())

    def test_rejects_a_non_sequence_question(self):
        item = Question(
            id=1,
            type_q="text",
            question="Nope",
            answer="Nope",
            tags=[],
            data={}
        )
        self.db.add(item)
        self.db.commit()

        with self.assertRaises(HTTPException) as caught:
            answer_sequence(
                SequenceAnswerRequest(
                    items={1: SequenceAnswerItem(position=1)}
                ),
                db=self.db
            )

        self.assertEqual(caught.exception.status_code, 400)


class SequenceTrainingTests(SequenceTestCase):
    def test_reordering_the_list_retires_the_training_record(self):
        # Every other type keys its record on the SET of items, but for a
        # sequence the order IS the challenge -- a permutation of the same ids
        # must not keep the old best time.
        group = self.add_group()
        saved = save_sequence_group_items(
            self.db,
            group.id,
            self.bulk_payload(["Alpha", "Beta", "Gamma"])
        )
        by_label = {
            item["answer"]: item["id"]
            for item in saved["items"]
        }
        before = group_training_fingerprint(self.db, group.id)
        record_training_attempt(
            self.db,
            group.id,
            TrainingAttemptRecordRequest(
                elapsed_ms=5000,
                question_count=3,
                found_count=3,
                content_fingerprint=before,
                mode=SEQUENCE_MODE_TYPE_POSITION
            )
        )

        save_sequence_group_items(
            self.db,
            group.id,
            self.bulk_payload(
                ["Gamma", "Beta", "Alpha"],
                ids=[
                    by_label["Gamma"],
                    by_label["Beta"],
                    by_label["Alpha"]
                ]
            )
        )

        after = group_training_fingerprint(self.db, group.id)
        self.assertNotEqual(before, after)
        self.assertEqual(
            serialize_previous_training_record(group.data, after)[
                "best_time_ms"
            ],
            5000
        )

    def test_training_grading_never_schedules(self):
        group = self.add_group()
        self.add_item(group, "Alpha", 1, question_id=1)
        self.add_item(
            group,
            "Beta",
            2,
            question_id=2,
            reps=2,
            next_review=date.today()
        )
        self.db.commit()

        before = self.db.query(Question).filter(Question.id == 2).first()
        before_next_review = before.progress.next_review
        before_reps = before.progress.reps

        response = grade_training_sequence(
            self.db,
            {
                1: SequenceAnswerItem(position=1),
                2: SequenceAnswerItem(position=9)
            }
        )
        by_id = {
            result["question_id"]: result
            for result in response["results"]
        }

        self.assertEqual(by_id[1]["quality"], 2)
        self.assertEqual(by_id[2]["quality"], 0)

        # No new Progress row for the unstarted card, and the started card's
        # schedule is untouched.
        self.assertIsNone(
            self.db.query(Progress).filter(Progress.question_id == 1).first()
        )

        after = self.db.query(Question).filter(Question.id == 2).first()

        self.assertEqual(after.progress.next_review, before_next_review)
        self.assertEqual(after.progress.reps, before_reps)
        self.assertEqual(after.progress.history, [])


if __name__ == "__main__":
    unittest.main()
