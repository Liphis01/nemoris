import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question
from app.routers.review import answer_map, answer_question, answer_timeline
from app.scheduler import (
    assign_smoothed_schedules,
    choose_smoothed_review_date,
    smoothing_radius_days
)
from app.schemas import (
    AnswerRequest,
    MapAnswerRequest,
    TimelineAnswerItem,
    TimelineAnswerRequest,
    TimelineDateValue
)


def scheduling(today, interval):
    return {
        "stability": 1.0,
        "difficulty": 5.0,
        "reps": 1,
        "lapses": 0,
        "interval": interval,
        "next_review": today + timedelta(days=interval),
        "last_review": today
    }


class SchedulerSmoothingTests(unittest.TestCase):
    def test_smoothing_radius_depends_on_interval(self):
        self.assertEqual(smoothing_radius_days(0), 0)
        self.assertEqual(smoothing_radius_days(1), 0)
        self.assertEqual(smoothing_radius_days(2), 1)
        self.assertEqual(smoothing_radius_days(3), 1)
        self.assertEqual(smoothing_radius_days(4), 2)
        self.assertEqual(smoothing_radius_days(13), 2)
        self.assertEqual(smoothing_radius_days(14), 3)

    def test_interval_zero_and_one_do_not_move(self):
        today = date(2026, 1, 1)

        self.assertEqual(
            choose_smoothed_review_date(today, today, 0, {today: 100}),
            today
        )
        self.assertEqual(
            choose_smoothed_review_date(
                today,
                today + timedelta(days=1),
                1,
                {today + timedelta(days=1): 100}
            ),
            today + timedelta(days=1)
        )

    def test_overloaded_ideal_day_shifts_to_later_tie(self):
        today = date(2026, 1, 1)
        ideal = today + timedelta(days=4)

        self.assertEqual(
            choose_smoothed_review_date(today, ideal, 4, {ideal: 10}),
            ideal + timedelta(days=1)
        )

    def test_equal_loads_keep_ideal_day(self):
        today = date(2026, 1, 1)
        ideal = today + timedelta(days=4)

        self.assertEqual(
            choose_smoothed_review_date(today, ideal, 4, {}),
            ideal
        )

    def test_high_intervals_do_not_move_past_their_window(self):
        today = date(2026, 1, 1)
        ideal = today + timedelta(days=14)
        loads = {
            ideal + timedelta(days=offset): 10
            for offset in range(-3, 3)
        }

        self.assertEqual(
            choose_smoothed_review_date(today, ideal, 14, loads),
            ideal + timedelta(days=3)
        )

    def test_batch_assigns_high_interval_items_first(self):
        today = date(2026, 1, 1)
        low = scheduling(today, 3)
        high = scheduling(today, 4)
        loads = {
            today + timedelta(days=4): 5,
            today + timedelta(days=5): 5,
            today + timedelta(days=6): 5
        }

        assigned_low, assigned_high = assign_smoothed_schedules(
            [low, high],
            loads
        )

        self.assertEqual(assigned_high["next_review"], today + timedelta(days=3))
        self.assertEqual(assigned_low["next_review"], today + timedelta(days=2))


class ReviewRouteSmoothingTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_progress(
        self,
        question_id,
        next_review,
        stability=1.0,
        difficulty=5.0,
        reps=0
    ):
        progress = Progress(
            question_id=question_id,
            stability=stability,
            difficulty=difficulty,
            reps=reps,
            lapses=0,
            interval=0,
            next_review=next_review,
            history=[]
        )
        self.db.add(progress)
        return progress

    def seed_load(self, day, count, start_id=1000):
        for offset in range(count):
            self.add_progress(start_id + offset, day, reps=1)

    def test_text_answer_uses_smoothed_date(self):
        today = date.today()
        question = Question(
            id=1,
            type_q="text",
            question="Question",
            answer="Answer",
            tags=[],
            data={}
        )
        self.db.add(question)
        progress = self.add_progress(1, today)
        self.seed_load(today + timedelta(days=2), 3)
        self.db.commit()

        response = answer_question(
            AnswerRequest(question_id=1, quality=2),
            db=self.db
        )

        self.assertEqual(response["next_review"], today + timedelta(days=3))
        self.assertEqual(response["interval"], 3)
        self.assertEqual(progress.history[-1]["ideal_interval"], 2)
        self.assertEqual(
            progress.history[-1]["ideal_next_review"],
            (today + timedelta(days=2)).isoformat()
        )

    def test_map_answer_smooths_batch_by_highest_interval_first(self):
        today = date.today()
        low = self.add_progress(1, today, stability=1.5)
        high = self.add_progress(2, today, stability=2.0)
        self.seed_load(today + timedelta(days=4), 5)
        self.seed_load(today + timedelta(days=5), 5, start_id=2000)
        self.seed_load(today + timedelta(days=6), 5, start_id=3000)
        self.db.commit()

        answer_map(
            MapAnswerRequest(items={low.question_id: 2, high.question_id: 2}),
            db=self.db
        )

        self.assertEqual(high.next_review, today + timedelta(days=3))
        self.assertEqual(low.next_review, today + timedelta(days=2))

    def test_timeline_answer_uses_smoothed_date(self):
        today = date.today()
        question = Question(
            id=1,
            type_q="timeline",
            question="Event",
            answer="2000",
            tags=[],
            data={
                "timeline": {
                    "kind": "point",
                    "start": {
                        "year": 2000,
                        "precision": "year"
                    }
                }
            }
        )
        self.db.add(question)
        progress = self.add_progress(1, today)
        self.seed_load(today + timedelta(days=2), 3)
        self.db.commit()

        response = answer_timeline(
            TimelineAnswerRequest(
                items={
                    1: TimelineAnswerItem(
                        start=TimelineDateValue(
                            year=2000,
                            precision="year"
                        )
                    )
                }
            ),
            db=self.db
        )

        self.assertEqual(progress.next_review, today + timedelta(days=3))
        self.assertEqual(
            response["results"][0]["progress"]["next_review"],
            (today + timedelta(days=3)).isoformat()
        )


if __name__ == "__main__":
    unittest.main()
