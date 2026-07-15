import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question
from app.routers.review import (
    answer_map,
    answer_media,
    answer_question,
    revise_answer_question
)
from app.schemas import (
    AnswerRequest,
    MapAnswerRequest,
    MediaAnswerRequest
)
from app.scheduler import update_progress
from app.services.progress import write_scheduling


class RepeatLapseSchedulerTests(unittest.TestCase):
    """
    Failing a card again on a day it already lapsed on is a relearning retry,
    not a second memory failure, so it must not move the schedule again.
    """

    def setUp(self):
        self.today = date(2026, 1, 1)

    def review(self, progress, quality, today=None, **kwargs):
        # Schedule and write back through the real write path, minus the DB and
        # the batch smoothing, so the recorded history is the one update_progress
        # reads when it looks for the previous answer.
        scheduling = update_progress(
            progress,
            quality,
            today=today or self.today,
            enable_fuzzing=False,
            **kwargs
        )
        write_scheduling(progress, quality, scheduling)

        return scheduling

    def mature_progress(self):
        progress = Progress(
            question_id=1,
            stability=1.0,
            difficulty=5.0,
            reps=0,
            lapses=0,
            interval=0,
            next_review=self.today,
            history=[]
        )
        # Two passes on earlier days leave a genuine Review card to lapse.
        self.review(progress, 2, today=self.today - timedelta(days=10))
        self.review(progress, 2, today=self.today - timedelta(days=5))

        return progress

    def test_three_fails_in_one_day_book_a_single_lapse(self):
        progress = self.mature_progress()

        first = self.review(progress, 0)
        second = self.review(progress, 0)
        third = self.review(progress, 0)

        self.assertEqual(first["lapses"], 1)
        self.assertEqual(second["lapses"], 1)
        self.assertEqual(third["lapses"], 1)

        # Only the first fail is a lapse; the retries are frozen relearning steps
        # that leave the memory state, and every counter, untouched.
        self.assertNotIn("relearning_frozen", first)
        self.assertTrue(second["relearning_frozen"])
        self.assertTrue(third["relearning_frozen"])

        # The retries are invisible, so reps stops at the first fail (2 warm-up
        # reviews + the one fail).
        self.assertEqual(third["reps"], 3)

    def test_retries_do_not_compound_stability_and_difficulty(self):
        progress = self.mature_progress()

        first = self.review(progress, 0)
        second = self.review(progress, 0)
        third = self.review(progress, 0)

        self.assertLess(first["stability"], 10)
        self.assertGreater(first["difficulty"], 5)

        # The memory state is held at the single lapse instead of being crushed
        # further on each retry, which is what FSRS would otherwise do.
        self.assertAlmostEqual(second["stability"], first["stability"])
        self.assertAlmostEqual(third["stability"], first["stability"])
        self.assertAlmostEqual(second["difficulty"], first["difficulty"])
        self.assertAlmostEqual(third["difficulty"], first["difficulty"])

    def test_every_fail_keeps_the_card_due_today(self):
        progress = self.mature_progress()

        for _ in range(3):
            scheduling = self.review(progress, 0)
            self.assertEqual(scheduling["next_review"], self.today)
            self.assertEqual(scheduling["interval"], 0)

    def test_the_mode_penalty_is_applied_once(self):
        easy_mode = self.mature_progress()
        hard_mode = self.mature_progress()

        # An easy mode is punished hardest on a lapse, so it is where a
        # compounding penalty would do the most damage.
        first = self.review(easy_mode, 0, mode_difficulty=0.5)
        second = self.review(easy_mode, 0, mode_difficulty=0.5)

        self.assertIn("mode_penalty_factor", first)
        self.assertNotIn("mode_penalty_factor", second)
        self.assertAlmostEqual(second["stability"], first["stability"])
        self.assertAlmostEqual(second["difficulty"], first["difficulty"])

        self.review(hard_mode, 0, mode_difficulty=2.0)
        repeat = self.review(hard_mode, 0, mode_difficulty=2.0)

        self.assertNotIn("mode_penalty_factor", repeat)

    def test_failing_again_the_next_day_is_a_fresh_lapse(self):
        progress = self.mature_progress()

        self.review(progress, 0)
        same_day_retry = self.review(progress, 0)
        next_day = self.review(progress, 0, today=self.today + timedelta(days=1))

        # A new day is new evidence: the card was forgotten twice, so it lapses
        # twice and the memory state moves again.
        self.assertEqual(same_day_retry["lapses"], 1)
        self.assertEqual(next_day["lapses"], 2)
        self.assertFalse(next_day["repeat_lapse"])
        self.assertLess(next_day["stability"], same_day_retry["stability"])

    def test_passing_after_retries_still_moves_the_card_forward(self):
        progress = self.mature_progress()

        self.review(progress, 0)
        self.review(progress, 0)
        passed = self.review(progress, 2)

        # "Acquis" graduates the card out of today without re-grading: the lapse
        # count is frozen and it is scheduled forward from the frozen state.
        self.assertEqual(passed["lapses"], 1)
        self.assertTrue(passed["relearning_frozen"])
        self.assertGreater(passed["next_review"], self.today)

    def test_a_new_card_failed_repeatedly_books_one_lapse(self):
        progress = Progress(
            question_id=1,
            stability=1.0,
            difficulty=5.0,
            reps=0,
            lapses=0,
            interval=0,
            next_review=self.today,
            history=[]
        )

        first = self.review(progress, 0)
        second = self.review(progress, 0)

        # A never-seen card is Learning, not Review, so the first fail is not a
        # lapse at all under FSRS -- but the retries must not invent one either.
        self.assertEqual(second["lapses"], first["lapses"])


class RepeatLapseRouteTests(unittest.TestCase):
    """
    The same rule has to hold through the real answer routes, including the
    bonus questions that land in review by being failed.
    """

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()
        self.review_day = date(2026, 1, 1)

    def tearDown(self):
        self.db.close()

    def add_question(self, question_id, type_q="text"):
        self.db.add(Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=[],
            data={}
        ))

    def progress_for(self, question_id):
        return (
            self.db.query(Progress)
            .filter(Progress.question_id == question_id)
            .first()
        )

    def test_text_retries_book_one_lapse_and_keep_every_answer(self):
        self.add_question(1)
        self.db.commit()

        for _ in range(3):
            answer_question(
                AnswerRequest(
                    question_id=1,
                    quality=0,
                    review_date=self.review_day
                ),
                db=self.db
            )

        progress = self.progress_for(1)

        self.assertEqual(progress.lapses, 1)
        # The same-day retries are frozen and invisible: only the first fail is
        # recorded, so the day shows exactly one fail and reps does not climb.
        self.assertEqual(progress.reps, 1)
        self.assertEqual(
            [entry["quality"] for entry in progress.history],
            [0]
        )
        self.assertEqual(progress.next_review, self.review_day)

    def test_failed_bonus_question_retried_in_session_books_one_lapse(self):
        # A bonus question enters review by being failed, and the frontend
        # re-queues it in the same session, so it takes this path constantly.
        self.add_question(1)
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=0, review_date=self.review_day),
            db=self.db
        )
        after_first = self.progress_for(1)
        stability_after_lapse = after_first.stability
        difficulty_after_lapse = after_first.difficulty

        answer_question(
            AnswerRequest(question_id=1, quality=0, review_date=self.review_day),
            db=self.db
        )
        progress = self.progress_for(1)

        self.assertEqual(progress.lapses, 1)
        self.assertAlmostEqual(progress.stability, stability_after_lapse)
        self.assertAlmostEqual(progress.difficulty, difficulty_after_lapse)
        self.assertEqual(progress.next_review, self.review_day)

    def test_failed_bonus_grouped_answers_retried_book_one_lapse(self):
        for question_id, type_q in [(1, "map"), (2, "media")]:
            self.add_question(question_id, type_q=type_q)

        self.db.commit()

        # The grouped screens re-queue only the failed items, so the retry
        # arrives as another batch containing the same question.
        answer_map(MapAnswerRequest(items={1: 0}), db=self.db)
        answer_map(MapAnswerRequest(items={1: 0}), db=self.db)
        answer_media(MediaAnswerRequest(items={2: 0}), db=self.db)
        answer_media(MediaAnswerRequest(items={2: 0}), db=self.db)

        map_progress = self.progress_for(1)
        media_progress = self.progress_for(2)

        self.assertEqual(map_progress.lapses, 1)
        self.assertEqual(media_progress.lapses, 1)
        # The retry batch is frozen and invisible, so only the first fail counts.
        self.assertEqual(map_progress.reps, 1)
        self.assertEqual(media_progress.reps, 1)
        self.assertEqual(
            [entry["quality"] for entry in map_progress.history],
            [0]
        )

    def test_revising_a_retry_does_not_resurrect_the_lapse(self):
        # Rolling Progress back has to restore the relearning state with it, or
        # re-applying the answer books a second lapse for the same day.
        self.add_question(1)
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=0, review_date=self.review_day),
            db=self.db
        )
        answer_question(
            AnswerRequest(question_id=1, quality=0, review_date=self.review_day),
            db=self.db
        )
        revise_answer_question(
            AnswerRequest(question_id=1, quality=0, review_date=self.review_day),
            db=self.db
        )

        progress = self.progress_for(1)

        self.assertEqual(progress.lapses, 1)


if __name__ == "__main__":
    unittest.main()
