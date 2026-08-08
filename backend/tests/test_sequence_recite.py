"""
M1 1.3 / 1.4: recitation, the two-phase submit, and rail-driven ordering.

The negative assertions here are the load-bearing ones. Recitation is the first
path that grades a question the client never submitted, so it is also the first
that could schedule a card the learner has never seen.
"""

import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup
from app.routers.review import answer_sequence
from app.schemas import (
    SequenceAnswerItem,
    SequenceAnswerRequest,
    SequenceRailSlot
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

    def recite(self, run, run_start=0, commit=True):
        return answer_sequence(
            SequenceAnswerRequest(
                run=run,
                run_start=run_start,
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

    def test_the_tail_after_a_stall_is_not_graded_at_all(self):
        # The whole point of the mode: failing to recall item 3 says nothing
        # about item 4, and marking it wrong is the "one gap becomes ten
        # lapses" defect this milestone removes.
        response = self.recite([1, 2, 4])
        graded = {row["question_id"] for row in response["results"]}

        self.assertNotIn(4, graded)
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

        self.assertEqual(len(response["results"]), 1)
        self.assertEqual(response["results"][0]["question_id"], 1)
        self.assertEqual(response["results"][0]["quality"], 0)


class RecitationSafetyTests(ReciteTestCase):
    def test_a_stall_on_an_unseen_item_schedules_nothing(self):
        # The negative of test_a_failed_new_card_is_scheduled_and_stays_due.
        # Recitation adds a question the client never submitted, so without
        # this rule it would create a Progress row -- and a lapse -- for a card
        # that has never been shown. That is the one thing the entire
        # withholding mechanism exists to prevent.
        self.add(1, "Alpha", 1)
        self.add(2, "Beta", 2, started=False)
        self.db.commit()

        response = self.recite([1])

        self.assertEqual(
            [row["question_id"] for row in response["results"]],
            [1]
        )
        self.assertIsNone(self.progress_for(2))

    def test_reciting_past_the_due_set_earns_nothing_for_unseen_items(self):
        self.add(1, "Alpha", 1)
        self.add(2, "Beta", 2, started=False)
        self.db.commit()

        response = self.recite([1, 2])
        graded = {row["question_id"] for row in response["results"]}

        self.assertNotIn(2, graded)
        self.assertIsNone(self.progress_for(2))


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

    def test_the_learner_can_refine_a_hit_to_easy(self):
        # Easy was unreachable before M1: SEQUENCE_QUALITY_EXACT was the
        # ceiling, so a sequence item could never earn accelerated growth.
        answer_sequence(
            SequenceAnswerRequest(
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
                items={1: SequenceAnswerItem(position=None, quality=3)},
                mode="type_position",
                commit=True
            ),
            db=self.db
        )

        self.assertEqual(response["results"][0]["auto_quality"], 0)
        self.assertEqual(response["results"][0]["quality"], 0)


class ReorderOrderingTests(ReciteTestCase):
    def test_a_shifted_block_is_no_longer_a_lapse_for_every_item(self):
        # The headline defect: under absolute-rank grading, placing three
        # correctly-ordered items one slot late graded all three Again.
        for index, label in enumerate(["Alpha", "Beta", "Gamma", "Delta"]):
            self.add(index + 1, label, index + 1)

        self.db.commit()

        rail = [
            SequenceRailSlot(position=position, kind="blank")
            for position in range(1, 5)
        ]
        response = answer_sequence(
            SequenceAnswerRequest(
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
            SequenceRailSlot(position=position, kind="blank")
            for position in range(1, 5)
        ]
        response = answer_sequence(
            SequenceAnswerRequest(
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
