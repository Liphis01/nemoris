import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import AppSetting, Progress, Question
from app.services.daily_grove import (
    DAILY_GROVE_KEY,
    complete_daily_grove,
    get_daily_grove_state
)


class DailyGroveTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()

    def set_grove_state(self, **overrides):
        state = {
            "current_streak": 0,
            "longest_streak": 0,
            "last_completed_on": None,
            "rest_leaves": 0,
            "protected_dates": [],
            "seen_milestones": []
        }
        state.update(overrides)
        self.db.add(AppSetting(key=DAILY_GROVE_KEY, value=state))
        self.db.commit()

        return state

    def add_started_due_question(self, question_id=1, next_review=None):
        today = date(2026, 6, 2)
        question = Question(
            id=question_id,
            type_q="text",
            question="Question",
            answer="Answer"
        )
        progress = Progress(
            question_id=question_id,
            reps=1,
            last_review=today - timedelta(days=1),
            next_review=next_review or today,
            history=[
                {
                    "reviewed_on": (today - timedelta(days=1)).isoformat(),
                    "quality": 2
                }
            ]
        )
        self.db.add(question)
        self.db.add(progress)
        self.db.commit()

        return question, progress

    def test_no_due_checkin_completes_first_day(self):
        today = date(2026, 6, 2)

        result = complete_daily_grove(self.db, today=today)

        self.assertTrue(result["completed"])
        self.assertTrue(result["today_complete"])
        self.assertEqual(result["current_streak"], 1)
        self.assertEqual(result["longest_streak"], 1)
        self.assertEqual(result["last_completed_on"], today.isoformat())

    def test_same_day_completion_is_idempotent(self):
        today = date(2026, 6, 2)

        first = complete_daily_grove(self.db, today=today)
        second = complete_daily_grove(self.db, today=today)

        self.assertTrue(first["completed"])
        self.assertFalse(second["completed"])
        self.assertTrue(second["already_complete"])
        self.assertEqual(second["current_streak"], 1)
        self.assertEqual(second["last_completed_on"], today.isoformat())

    def test_due_started_reviews_block_completion(self):
        today = date(2026, 6, 2)
        self.add_started_due_question(next_review=today)

        result = complete_daily_grove(self.db, today=today)
        state = get_daily_grove_state(self.db)

        self.assertFalse(result["completed"])
        self.assertTrue(result["blocked"])
        self.assertEqual(result["due_count"], 1)
        self.assertIsNone(state["last_completed_on"])

    def test_completion_increments_yesterday_streak(self):
        today = date(2026, 6, 2)
        self.set_grove_state(
            current_streak=4,
            longest_streak=4,
            last_completed_on=(today - timedelta(days=1)).isoformat()
        )

        result = complete_daily_grove(self.db, today=today)

        self.assertTrue(result["completed"])
        self.assertEqual(result["current_streak"], 5)
        self.assertEqual(result["longest_streak"], 5)

    def test_rest_leaf_protects_one_missed_day(self):
        today = date(2026, 6, 2)
        missed = today - timedelta(days=1)
        self.set_grove_state(
            current_streak=5,
            longest_streak=5,
            last_completed_on=(today - timedelta(days=2)).isoformat(),
            rest_leaves=1
        )

        result = complete_daily_grove(self.db, today=today)

        self.assertEqual(result["current_streak"], 6)
        self.assertEqual(result["rest_leaves"], 0)
        self.assertEqual(result["protected_dates_used"], [missed.isoformat()])
        self.assertEqual(result["protected_dates"], [missed.isoformat()])

    def test_uncovered_gap_resets_streak_after_consuming_available_leaf(self):
        today = date(2026, 6, 2)
        protected = today - timedelta(days=2)
        self.set_grove_state(
            current_streak=5,
            longest_streak=5,
            last_completed_on=(today - timedelta(days=3)).isoformat(),
            rest_leaves=1
        )

        result = complete_daily_grove(self.db, today=today)

        self.assertEqual(result["current_streak"], 1)
        self.assertEqual(result["longest_streak"], 5)
        self.assertEqual(result["rest_leaves"], 0)
        self.assertEqual(
            result["protected_dates_used"],
            [protected.isoformat()]
        )

    def test_milestone_is_reported_once(self):
        today = date(2026, 6, 2)
        self.set_grove_state(
            current_streak=2,
            longest_streak=2,
            last_completed_on=(today - timedelta(days=1)).isoformat()
        )

        first = complete_daily_grove(self.db, today=today)
        second = complete_daily_grove(self.db, today=today)

        self.assertEqual(first["milestone_reached"], 3)
        self.assertEqual(first["seen_milestones"], [3])
        self.assertIsNone(second["milestone_reached"])

    def test_seven_day_milestones_award_rest_leaf_up_to_cap(self):
        today = date(2026, 6, 2)
        self.set_grove_state(
            current_streak=6,
            longest_streak=6,
            last_completed_on=(today - timedelta(days=1)).isoformat(),
            rest_leaves=2
        )

        capped = complete_daily_grove(self.db, today=today)
        self.assertEqual(capped["current_streak"], 7)
        self.assertEqual(capped["rest_leaves"], 2)
        self.assertEqual(capped["milestone_reached"], 7)

        next_day = today + timedelta(days=1)
        self.db.query(AppSetting).delete()
        self.db.commit()
        self.set_grove_state(
            current_streak=13,
            longest_streak=13,
            last_completed_on=today.isoformat(),
            rest_leaves=1,
            seen_milestones=[7]
        )

        awarded = complete_daily_grove(self.db, today=next_day)

        self.assertEqual(awarded["current_streak"], 14)
        self.assertEqual(awarded["rest_leaves"], 2)
        self.assertEqual(awarded["milestone_reached"], 14)


if __name__ == "__main__":
    unittest.main()
