import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question
from app.routers.review import (
    answer_question,
    graduate_relearning_cards,
    get_review
)
from app.schemas import AnswerRequest, RelearningGraduateRequest
from app.serializers import serialize_progress


class RelearningFlagTests(unittest.TestCase):
    """
    A card is 'in relearning' iff it lapsed today and is still due today. The
    flag is derived, so it survives a refresh (a fresh read of the same row).
    """

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.today = date(2026, 1, 1)

    def tearDown(self):
        self.db.close()

    def add_question(self, question_id, type_q="text"):
        self.db.add(Question(
            id=question_id,
            type_q=type_q,
            question=f"Q{question_id}",
            answer=f"A{question_id}",
            tags=[],
            data={}
        ))

    def progress_for(self, question_id):
        return (
            self.db.query(Progress)
            .filter(Progress.question_id == question_id)
            .first()
        )

    def test_a_freshly_failed_card_reads_as_relearning(self):
        self.add_question(1)
        self.db.commit()

        response = answer_question(
            AnswerRequest(question_id=1, quality=0, review_date=self.today),
            db=self.db
        )

        self.assertTrue(response["relearning"])
        self.assertTrue(
            serialize_progress(self.progress_for(1), today=self.today)["relearning"]
        )

    def test_a_passed_card_is_not_relearning(self):
        self.add_question(1)
        self.db.commit()

        response = answer_question(
            AnswerRequest(question_id=1, quality=2, review_date=self.today),
            db=self.db
        )

        self.assertFalse(response["relearning"])

    def test_the_flag_clears_the_next_day(self):
        # The lapse still stands; the card is just no longer 'in relearning'
        # once its fail is no longer today, so it returns as an ordinary review.
        self.add_question(1)
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=0, review_date=self.today),
            db=self.db
        )
        progress = self.progress_for(1)
        tomorrow = self.today + timedelta(days=1)

        self.assertTrue(serialize_progress(progress, today=self.today)["relearning"])
        self.assertFalse(serialize_progress(progress, today=tomorrow)["relearning"])
        # The fail is never softened.
        self.assertEqual(progress.lapses, 1)

    def test_the_flag_survives_a_refresh(self):
        # A refresh is just a fresh read of the same persisted row.
        self.add_question(1)
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=0, review_date=self.today),
            db=self.db
        )

        reread = self.progress_for(1)
        self.assertTrue(serialize_progress(reread, today=self.today)["relearning"])


class RelearningGraduateTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.today = date(2026, 1, 1)

    def tearDown(self):
        self.db.close()

    def add_question(self, question_id, type_q="text"):
        self.db.add(Question(
            id=question_id,
            type_q=type_q,
            question=f"Q{question_id}",
            answer=f"A{question_id}",
            tags=[],
            data={}
        ))

    def progress_for(self, question_id):
        return (
            self.db.query(Progress)
            .filter(Progress.question_id == question_id)
            .first()
        )

    def fail_today(self, question_id):
        answer_question(
            AnswerRequest(
                question_id=question_id,
                quality=0,
                review_date=self.today
            ),
            db=self.db
        )

    def test_graduating_reschedules_forward_without_regrading(self):
        self.add_question(1)
        self.db.commit()
        self.fail_today(1)

        before = self.progress_for(1)
        frozen = (
            before.stability,
            before.difficulty,
            before.lapses,
            before.reps,
            len(before.history or [])
        )

        result = graduate_relearning_cards(
            RelearningGraduateRequest(question_ids=[1], review_date=self.today),
            db=self.db
        )
        after = self.progress_for(1)

        self.assertEqual(result["graduated"], [1])
        # Left today's queue for a real future review.
        self.assertGreater(after.next_review, self.today)
        # But FSRS memory state is frozen at the first fail.
        self.assertEqual(
            (
                after.stability,
                after.difficulty,
                after.lapses,
                after.reps,
                len(after.history or [])
            ),
            frozen
        )

    def test_graduated_card_leaves_the_relearning_state(self):
        self.add_question(1)
        self.db.commit()
        self.fail_today(1)

        graduate_relearning_cards(
            RelearningGraduateRequest(question_ids=[1], review_date=self.today),
            db=self.db
        )

        self.assertFalse(
            serialize_progress(self.progress_for(1), today=self.today)["relearning"]
        )

    def test_graduating_a_non_relearning_card_is_a_no_op(self):
        # A passed card is not in relearning, so it must not be rescheduled.
        self.add_question(1)
        self.db.commit()
        answer_question(
            AnswerRequest(question_id=1, quality=2, review_date=self.today),
            db=self.db
        )
        before_next_review = self.progress_for(1).next_review

        result = graduate_relearning_cards(
            RelearningGraduateRequest(question_ids=[1], review_date=self.today),
            db=self.db
        )

        self.assertEqual(result["graduated"], [])
        self.assertEqual(self.progress_for(1).next_review, before_next_review)

    def test_graduating_handles_a_batch(self):
        for question_id in (1, 2, 3):
            self.add_question(question_id)
        self.db.commit()
        self.fail_today(1)
        self.fail_today(3)  # 2 is never answered -> not in relearning

        result = graduate_relearning_cards(
            RelearningGraduateRequest(
                question_ids=[1, 2, 3],
                review_date=self.today
            ),
            db=self.db
        )

        self.assertEqual(sorted(result["graduated"]), [1, 3])

    def test_never_graduated_card_stays_due_and_counts_as_failed(self):
        # If the user never presses Acquis, the card keeps its fail and stays due
        # today, so it resurfaces the next day as an ordinary review.
        self.add_question(1)
        self.db.commit()
        self.fail_today(1)

        progress = self.progress_for(1)
        self.assertEqual(progress.next_review, self.today)
        self.assertEqual(progress.lapses, 1)

        # Still due today -> present in the review queue.
        due_ids = [item["question_id"] for item in get_review(db=self.db)]
        self.assertIn(1, due_ids)


if __name__ == "__main__":
    unittest.main()
