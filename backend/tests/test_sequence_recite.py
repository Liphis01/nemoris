"""
M1 1.3 / 1.4: recitation, the two-phase submit, and rail-driven ordering.

The negative assertions here are the load-bearing ones. Recitation is the first
path that grades a question the client never submitted, so it is also the first
that could schedule a card the learner has never seen.
"""

import unittest
from copy import deepcopy
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup, ReviewLog
from app.routers.review import answer_sequence
from app.schemas import (
    SequenceAnswerItem,
    SequenceAnswerRequest,
    SequenceRailSlot,
    SequenceRunItem
)
from app.services.sequence_modes import (
    SEQUENCE_MODE_RECITE,
    SEQUENCE_MODE_REORDER
)


class ReciteTestCase(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.group = QuestionGroup(type_group="sequence", name="Alphabet grec")
        self.db.add(self.group)
        self.db.flush()

    def tearDown(self):
        self.db.close()

    def add(self, question_id, answer, position, started=True):
        question = Question(
            id=question_id,
            type_q="sequence",
            question=answer,
            answer=answer,
            tags=[],
            data={"position": position},
            group=self.group
        )

        if started:
            question.progress = Progress(
                question_id=question_id,
                stability=1.0,
                difficulty=5.0,
                reps=2,
                lapses=0,
                interval=1,
                next_review=date.today(),
                history=[]
            )

        self.db.add(question)
        self.db.flush()

        return question

    def progress_for(self, question_id):
        return (
            self.db.query(Progress)
            .filter(Progress.question_id == question_id)
            .first()
        )

    def recite(
        self,
        run,
        run_start=0,
        commit=True,
        target_ids=None,
        scheduled_ids=None,
        stop_reason=None
    ):
        target_ids = target_ids or [
            question.id
            for question in sorted(
                self.group.questions,
                key=lambda question: question.data["position"]
            )
            if question.data["position"] > run_start
        ]
        run_items = [
            SequenceRunItem(text=str(question_id), question_id=question_id)
            for question_id in run
        ]

        if stop_reason is None:
            mismatch = any(
                item.question_id != target_ids[index]
                for index, item in enumerate(run_items)
            )
            stop_reason = (
                "wrong_answer"
                if mismatch
                else "completed"
                if len(run_items) == len(target_ids)
                else "declared_stall"
            )

        return answer_sequence(
            SequenceAnswerRequest(
                run=run_items,
                run_start=run_start,
                target_ids=target_ids,
                scheduled_ids=scheduled_ids or target_ids,
                stop_reason=stop_reason,
                group_id=self.group.id,
                mode=SEQUENCE_MODE_RECITE,
                commit=commit
            ),
            db=self.db
        )


class RecitationGradingTests(ReciteTestCase):
    def setUp(self):
        super().setUp()

        for index, label in enumerate(["Alpha", "Beta", "Gamma", "Delta"]):
            self.add(index + 1, label, index + 1)

        self.db.commit()

    def test_everything_before_the_stall_is_good_and_the_stall_is_a_miss(self):
        response = self.recite([1, 2, 4])
        by_id = {row["question_id"]: row for row in response["results"]}

        self.assertEqual(by_id[1]["quality"], 2)
        self.assertEqual(by_id[2]["quality"], 2)
        self.assertEqual(by_id[3]["quality"], 0)
        self.assertTrue(by_id[3]["stall"])

    def test_the_tail_after_a_stall_is_returned_unattempted_and_not_scheduled(self):
        # The whole point of the mode: failing to recall item 3 says nothing
        # about item 4, and marking it wrong is the "one gap becomes ten
        # lapses" defect this milestone removes.
        response = self.recite([1, 2, 4])
        by_id = {row["question_id"]: row for row in response["results"]}

        self.assertEqual(by_id[4]["status"], "unattempted")
        self.assertIsNone(by_id[4]["quality"])
        self.assertIsNone(self.progress_for(4).last_review)

    def test_a_clean_run_grades_everything_and_stalls_on_nothing(self):
        response = self.recite([1, 2, 3, 4])

        self.assertEqual(
            [row["quality"] for row in response["results"]],
            [2, 2, 2, 2]
        )
        self.assertFalse(any(row["stall"] for row in response["results"]))

    def test_reciting_from_a_start_point_skips_what_came_before(self):
        response = self.recite([3, 4], run_start=2)

        self.assertEqual(
            {row["question_id"] for row in response["results"]},
            {3, 4}
        )

    def test_an_empty_run_fails_only_the_first_item(self):
        response = self.recite([])

        self.assertEqual(len(response["results"]), 4)
        self.assertEqual(response["results"][0]["question_id"], 1)
        self.assertEqual(response["results"][0]["quality"], 0)
        self.assertTrue(all(
            row["status"] == "unattempted"
            for row in response["results"][1:]
        ))

    def test_non_due_context_is_graded_but_its_progress_is_untouched(self):
        future = self.progress_for(2)
        future.next_review = date.today() + timedelta(days=30)
        before = (future.reps, list(future.history), future.next_review)

        response = self.recite(
            [1, 2],
            target_ids=[1, 2],
            scheduled_ids=[1],
            stop_reason="completed"
        )
        by_id = {row["question_id"]: row for row in response["results"]}

        self.assertTrue(by_id[1]["scheduled"])
        self.assertFalse(by_id[2]["scheduled"])
        self.assertEqual(
            (future.reps, list(future.history), future.next_review),
            before
        )


class RecitationSafetyTests(ReciteTestCase):
    def assert_bad_request(self, **kwargs):
        with self.assertRaises(HTTPException) as caught:
            self.recite([], **kwargs)

        self.assertEqual(caught.exception.status_code, 400)

    def test_a_stall_on_an_unseen_item_schedules_nothing(self):
        # The negative of test_a_failed_new_card_is_scheduled_and_stays_due.
        # Recitation adds a question the client never submitted, so without
        # this rule it would create a Progress row -- and a lapse -- for a card
        # that has never been shown. That is the one thing the entire
        # withholding mechanism exists to prevent.
        self.add(1, "Alpha", 1)
        self.add(2, "Beta", 2, started=False)
        self.db.commit()

        response = self.recite(
            [1],
            target_ids=[1],
            scheduled_ids=[1],
            stop_reason="completed"
        )

        self.assertEqual(
            [row["question_id"] for row in response["results"]],
            [1]
        )
        self.assertIsNone(self.progress_for(2))

    def test_reciting_past_the_due_set_earns_nothing_for_unseen_items(self):
        self.add(1, "Alpha", 1)
        self.add(2, "Beta", 2, started=False)
        self.db.commit()

        response = self.recite(
            [1],
            target_ids=[1],
            scheduled_ids=[1],
            stop_reason="completed"
        )
        graded = {row["question_id"] for row in response["results"]}

        self.assertNotIn(2, graded)
        self.assertIsNone(self.progress_for(2))

    def test_targets_from_another_group_are_rejected(self):
        self.add(1, "Alpha", 1)
        other = QuestionGroup(type_group="sequence", name="Other")
        self.db.add(other)
        self.db.flush()
        self.db.add(Question(
            id=9,
            type_q="sequence",
            question="Other",
            answer="Other",
            tags=[],
            data={"position": 2},
            group=other
        ))
        self.db.commit()

        self.assert_bad_request(
            target_ids=[1, 9],
            scheduled_ids=[1, 9],
            stop_reason="declared_stall"
        )

    def test_duplicate_reordered_and_non_contiguous_targets_are_rejected(self):
        for index, label in enumerate(["Alpha", "Beta", "Gamma"]):
            self.add(index + 1, label, index + 1)
        self.db.commit()

        for target_ids in ([1, 1], [2, 1], [1, 3]):
            with self.subTest(target_ids=target_ids):
                self.assert_bad_request(
                    target_ids=target_ids,
                    scheduled_ids=target_ids,
                    stop_reason="declared_stall"
                )

    def test_scheduled_targets_must_preserve_presentation_order(self):
        for index, label in enumerate(["Alpha", "Beta", "Gamma"]):
            self.add(index + 1, label, index + 1)
        self.db.commit()

        self.assert_bad_request(
            target_ids=[1, 2, 3],
            scheduled_ids=[3, 1],
            stop_reason="declared_stall"
        )


class RecitationHistoryTests(ReciteTestCase):
    def setUp(self):
        super().setUp()
        for index, label in enumerate(["Alpha", "Beta", "Gamma"]):
            self.add(index + 1, label, index + 1)
        self.db.commit()

    def progress_snapshot(self, question_id):
        progress = self.progress_for(question_id)

        return {
            column.name: deepcopy(getattr(progress, column.name))
            for column in Progress.__table__.columns
        }

    def test_history_and_revlog_keep_the_complete_presentation_and_raw_run(self):
        self.progress_for(2).next_review = date.today() + timedelta(days=30)
        self.db.commit()
        untouched_before = self.progress_snapshot(2)
        tail_before = self.progress_snapshot(3)

        response = answer_sequence(
            SequenceAnswerRequest(
                group_id=self.group.id,
                mode=SEQUENCE_MODE_RECITE,
                run=[
                    SequenceRunItem(text="Alpha", question_id=1),
                    SequenceRunItem(text="mauvaise réponse", question_id=3)
                ],
                run_start=0,
                target_ids=[1, 2, 3],
                scheduled_ids=[1, 3],
                stop_reason="wrong_answer",
                commit=True
            ),
            db=self.db
        )

        by_id = {row["question_id"]: row for row in response["results"]}
        self.assertFalse(by_id[2]["scheduled"])
        self.assertEqual(by_id[3]["status"], "unattempted")
        self.assertEqual(self.progress_snapshot(2), untouched_before)
        self.assertEqual(self.progress_snapshot(3), tail_before)

        entry = self.progress_for(1).history[-1]
        self.assertEqual(entry["answer"], "Alpha")
        self.assertEqual(entry["sequence_resolved_answer_id"], 1)
        self.assertEqual(entry["sequence_target_ids"], [1, 2, 3])
        self.assertEqual(entry["sequence_run_start"], 0)
        self.assertEqual(entry["sequence_stop_reason"], "wrong_answer")
        self.assertEqual(entry["sequence_stall_question_id"], 2)
        self.assertEqual(entry["sequence_stall_position"], 2)
        self.assertEqual(entry["sequence_goal"], "recitation")
        self.assertEqual(entry["sequence_target_count"], 3)
        self.assertEqual(entry["sequence_scheduled_count"], 2)
        self.assertEqual(entry["sequence_run_count"], 2)
        self.assertEqual(entry["sequence_run"], [
            {"text": "Alpha", "question_id": 1},
            {"text": "mauvaise réponse", "question_id": 3}
        ])

        revlog = (
            self.db.query(ReviewLog)
            .filter(ReviewLog.question_id == 1)
            .order_by(ReviewLog.seq.desc())
            .first()
        )
        self.assertEqual(revlog.data, entry)


class TwoPhaseSubmitTests(ReciteTestCase):
    def setUp(self):
        super().setUp()
        self.add(1, "Alpha", 1)
        self.add(2, "Beta", 2)
        self.db.commit()

    def test_a_preview_grades_without_scheduling(self):
        before = self.progress_for(1).reps

        response = self.recite([1, 2], commit=False)

        self.assertFalse(response["committed"])
        self.assertEqual(len(response["results"]), 2)
        self.assertEqual(self.progress_for(1).reps, before)

    def test_the_commit_schedules(self):
        before = self.progress_for(1).reps

        self.recite([1, 2], commit=True)

        self.assertEqual(self.progress_for(1).reps, before + 1)

    def test_a_presentation_whose_due_set_changed_is_rejected_as_stale(self):
        self.recite([1, 2], commit=False)
        self.progress_for(2).next_review = date.today() + timedelta(days=30)
        self.db.commit()

        with self.assertRaises(HTTPException) as caught:
            self.recite([1, 2], commit=True)

        self.assertEqual(caught.exception.status_code, 400)

    def test_the_learner_can_refine_a_hit_to_easy(self):
        # Easy was unreachable before M1: SEQUENCE_QUALITY_EXACT was the
        # ceiling, so a sequence item could never earn accelerated growth.
        answer_sequence(
            SequenceAnswerRequest(
                group_id=self.group.id,
                items={1: SequenceAnswerItem(position=1, quality=3)},
                mode="type_position",
                commit=True
            ),
            db=self.db
        )
        entry = self.progress_for(1).history[-1]

        self.assertEqual(entry["raw_quality"], 2)
        self.assertEqual(entry["effective_quality"], 3)

    def test_a_miss_cannot_be_talked_up(self):
        # An unresolved answer is always a miss, and the learner's refinement
        # must not touch it -- otherwise a tampered client could inflate a
        # wrong answer's interval at will.
        response = answer_sequence(
            SequenceAnswerRequest(
                group_id=self.group.id,
                items={1: SequenceAnswerItem(position=None, quality=3)},
                mode="type_position",
                commit=True
            ),
            db=self.db
        )

        self.assertEqual(response["results"][0]["auto_quality"], 0)
        self.assertEqual(response["results"][0]["quality"], 0)


class ReorderOrderingTests(ReciteTestCase):
    def test_stale_reordered_and_mixed_rails_are_rejected(self):
        for index, label in enumerate(["Alpha", "Beta"]):
            self.add(index + 1, label, index + 1)
        self.db.commit()

        invalid_rails = [
            [
                SequenceRailSlot(question_id=2, position=1, kind="blank"),
                SequenceRailSlot(question_id=1, position=2, kind="blank")
            ],
            [
                SequenceRailSlot(question_id=2, position=2, kind="blank"),
                SequenceRailSlot(question_id=1, position=1, kind="blank")
            ],
            [
                SequenceRailSlot(question_id=99, position=1, kind="blank"),
                SequenceRailSlot(question_id=2, position=2, kind="blank")
            ]
        ]

        for rail in invalid_rails:
            with self.subTest(rail=rail):
                with self.assertRaises(HTTPException) as caught:
                    answer_sequence(
                        SequenceAnswerRequest(
                            group_id=self.group.id,
                            items={
                                1: SequenceAnswerItem(position=1),
                                2: SequenceAnswerItem(position=2)
                            },
                            rail=rail,
                            mode=SEQUENCE_MODE_REORDER,
                            commit=False
                        ),
                        db=self.db
                    )

                self.assertEqual(caught.exception.status_code, 400)

    def test_a_shifted_block_is_no_longer_a_lapse_for_every_item(self):
        # The headline defect: under absolute-rank grading, placing three
        # correctly-ordered items one slot late graded all three Again.
        for index, label in enumerate(["Alpha", "Beta", "Gamma", "Delta"]):
            self.add(index + 1, label, index + 1)

        self.db.commit()

        rail = [
            SequenceRailSlot(
                question_id=position,
                position=position,
                kind="blank"
            )
            for position in range(1, 5)
        ]
        response = answer_sequence(
            SequenceAnswerRequest(
                group_id=self.group.id,
                items={
                    1: SequenceAnswerItem(position=1),
                    2: SequenceAnswerItem(position=2),
                    3: SequenceAnswerItem(position=3),
                    4: SequenceAnswerItem(position=4)
                },
                rail=rail,
                mode=SEQUENCE_MODE_REORDER,
                commit=False
            ),
            db=self.db
        )

        self.assertEqual(
            [row["quality"] for row in response["results"]],
            [2, 2, 2, 2]
        )

    def test_a_transposition_costs_only_the_swapped_pair(self):
        for index, label in enumerate(["Alpha", "Beta", "Gamma", "Delta"]):
            self.add(index + 1, label, index + 1)

        self.db.commit()

        rail = [
            SequenceRailSlot(
                question_id=position,
                position=position,
                kind="blank"
            )
            for position in range(1, 5)
        ]
        response = answer_sequence(
            SequenceAnswerRequest(
                group_id=self.group.id,
                items={
                    1: SequenceAnswerItem(position=1),
                    2: SequenceAnswerItem(position=3),
                    3: SequenceAnswerItem(position=2),
                    4: SequenceAnswerItem(position=4)
                },
                rail=rail,
                mode=SEQUENCE_MODE_REORDER,
                commit=False
            ),
            db=self.db
        )
        by_id = {row["question_id"]: row["quality"] for row in response["results"]}

        self.assertEqual(by_id[1], 2)
        self.assertEqual(by_id[4], 2)
        self.assertEqual(by_id[2], 1)
        self.assertEqual(by_id[3], 1)


if __name__ == "__main__":
    unittest.main()
