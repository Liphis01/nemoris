import unittest
from datetime import date, timedelta

from fsrs import Rating
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import AppSetting, Progress, Question
from app.routers.review import (
    answer_map,
    answer_question,
    answer_timeline,
    get_review,
    get_settings,
    get_startup_notice,
    rebalance_review,
    revise_answer_question,
    update_settings
)
from app.services.startup import run_startup_rebalance
from app.services.fsrs_migration import migrate_progress_to_fsrs_v6
from app.scheduler import (
    FSRS_VERSION,
    app_quality_to_fsrs_rating,
    assign_smoothed_schedules,
    choose_smoothed_review_date,
    favorite_interval,
    legacy_quality_to_fsrs_rating,
    preview_intervals,
    rebalance_review_calendar,
    smoothing_radius_days
)
from app.schemas import (
    AnswerRequest,
    MapAnswerRequest,
    ReviewSettings,
    TimelineAnswerItem,
    TimelineAnswerRequest,
    TimelineDateValue
)


def scheduling(today, interval, type_q=None):
    return {
        "stability": 1.0,
        "difficulty": 5.0,
        "reps": 1,
        "lapses": 0,
        "interval": interval,
        "next_review": today + timedelta(days=interval),
        "last_review": today,
        "type_q": type_q
    }


def rebalance_entry(
    question_id,
    next_review,
    difficulty=5.0,
    last_review=None,
    type_q=None,
    ideal_next_review=None,
    ideal_interval=None
):
    return {
        "question_id": question_id,
        "next_review": next_review,
        "ideal_next_review": ideal_next_review,
        "last_review": last_review,
        "interval": 0,
        "ideal_interval": ideal_interval,
        "difficulty": difficulty,
        "type_q": type_q
    }


class SchedulerSmoothingTests(unittest.TestCase):
    def test_app_quality_maps_to_fsrs_ratings(self):
        self.assertEqual(app_quality_to_fsrs_rating(0), Rating.Again)
        self.assertEqual(app_quality_to_fsrs_rating(1), Rating.Hard)
        self.assertEqual(app_quality_to_fsrs_rating(2), Rating.Good)
        self.assertEqual(app_quality_to_fsrs_rating(3), Rating.Easy)

    def test_legacy_success_mapping_is_type_aware(self):
        self.assertEqual(legacy_quality_to_fsrs_rating(2, "text"), Rating.Easy)
        self.assertEqual(legacy_quality_to_fsrs_rating(2, "map"), Rating.Good)
        self.assertEqual(legacy_quality_to_fsrs_rating(2, "timeline"), Rating.Good)
        self.assertEqual(legacy_quality_to_fsrs_rating(2, None), Rating.Good)

    def test_smoothing_radius_depends_on_interval(self):
        self.assertEqual(smoothing_radius_days(0), 0)
        self.assertEqual(smoothing_radius_days(1), 0)
        self.assertEqual(smoothing_radius_days(2), 1)
        self.assertEqual(smoothing_radius_days(3), 1)
        self.assertEqual(smoothing_radius_days(4), 2)
        self.assertEqual(smoothing_radius_days(13), 2)
        self.assertEqual(smoothing_radius_days(14), 3)

    def test_favorite_interval_shortens_review_intervals(self):
        self.assertEqual(favorite_interval(0), 0)
        self.assertEqual(favorite_interval(1), 1)
        self.assertEqual(favorite_interval(2), 1)
        self.assertEqual(favorite_interval(3), 2)
        self.assertEqual(favorite_interval(10), 7)

    def test_again_projected_interval_is_immediate_retry(self):
        progress = Progress(
            question_id=1,
            stability=1.0,
            difficulty=5.0,
            reps=0,
            lapses=0,
            interval=0,
            next_review=date.today(),
            history=[]
        )

        self.assertEqual(preview_intervals(progress)[0], 0)

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

    def test_regular_smoothing_prefers_type_mix_when_loads_are_equal(self):
        today = date(2026, 1, 1)
        ideal = today + timedelta(days=2)
        mixed_day = today + timedelta(days=3)
        daily_loads = {
            today + timedelta(days=1): 1,
            ideal: 1,
            mixed_day: 1
        }
        daily_type_loads = {
            today + timedelta(days=1): {"text": 1},
            ideal: {"text": 1},
            mixed_day: {"map": 1}
        }

        self.assertEqual(
            choose_smoothed_review_date(
                today,
                ideal,
                2,
                daily_loads,
                daily_type_loads=daily_type_loads,
                type_q="text"
            ),
            mixed_day
        )

    def test_rebalance_spreads_overdue_backlog_by_soft_target(self):
        today = date(2026, 1, 10)
        entries = [
            rebalance_entry(index, today - timedelta(days=3))
            for index in range(120)
        ]

        assigned = rebalance_review_calendar(entries, 50, today=today)
        counts = {}

        for scheduling_result in assigned:
            day = scheduling_result["next_review"]
            counts[day] = counts.get(day, 0) + 1

        self.assertEqual(counts[today], 63)
        self.assertEqual(counts[today + timedelta(days=1)], 57)
        self.assertNotIn(today + timedelta(days=2), counts)

    def test_rebalance_leaves_future_days_inside_soft_target(self):
        today = date(2026, 1, 10)
        future_day = today + timedelta(days=3)
        entries = [
            rebalance_entry(index, future_day)
            for index in range(60)
        ]

        assigned = rebalance_review_calendar(entries, 50, today=today)

        self.assertTrue(
            all(item["next_review"] == future_day for item in assigned)
        )

    def test_rebalance_pushes_future_days_over_soft_target(self):
        today = date(2026, 1, 10)
        future_day = today + timedelta(days=3)
        entries = [
            rebalance_entry(index, future_day)
            for index in range(65)
        ]

        assigned = rebalance_review_calendar(entries, 50, today=today)
        counts = {}

        for scheduling_result in assigned:
            day = scheduling_result["next_review"]
            counts[day] = counts.get(day, 0) + 1

        self.assertEqual(counts[future_day], 63)
        self.assertEqual(counts[future_day + timedelta(days=1)], 2)

    def test_rebalance_never_pulls_future_items_earlier(self):
        today = date(2026, 1, 10)
        future_day = today + timedelta(days=4)
        entries = [
            rebalance_entry(1, today - timedelta(days=1)),
            rebalance_entry(2, future_day)
        ]

        assigned = rebalance_review_calendar(entries, 50, today=today)

        self.assertEqual(assigned[1]["next_review"], future_day)

    def test_rebalance_can_pull_future_items_back_toward_ideal(self):
        today = date(2026, 1, 10)
        ideal_day = today + timedelta(days=2)
        active_day = today + timedelta(days=6)
        entries = [
            rebalance_entry(
                1,
                active_day,
                ideal_next_review=ideal_day,
                ideal_interval=2
            )
        ]

        assigned = rebalance_review_calendar(entries, 50, today=today)

        self.assertEqual(assigned[0]["next_review"], ideal_day)
        self.assertEqual(assigned[0]["ideal_next_review"], ideal_day)
        self.assertEqual(assigned[0]["ideal_interval"], 2)

    def test_rebalance_never_moves_before_today_when_ideal_is_overdue(self):
        today = date(2026, 1, 10)
        entries = [
            rebalance_entry(
                1,
                today + timedelta(days=6),
                ideal_next_review=today - timedelta(days=3),
                ideal_interval=3
            )
        ]

        assigned = rebalance_review_calendar(entries, 50, today=today)

        self.assertEqual(assigned[0]["next_review"], today)
        self.assertEqual(
            assigned[0]["ideal_next_review"],
            today - timedelta(days=3)
        )

    def test_rebalance_reuses_ideal_anchor_across_successive_runs(self):
        today = date(2026, 1, 10)
        ideal_day = today + timedelta(days=1)
        entries = [
            rebalance_entry(
                index,
                ideal_day + timedelta(days=5),
                ideal_next_review=ideal_day,
                ideal_interval=1
            )
            for index in range(3)
        ]

        first = rebalance_review_calendar(entries, 1, today=today)
        second = rebalance_review_calendar(first, 1, today=today)

        self.assertEqual(
            [item["next_review"] for item in first],
            [item["next_review"] for item in second]
        )
        self.assertTrue(
            all(item["ideal_next_review"] == ideal_day for item in second)
        )

    def test_rebalance_orders_overdue_by_age_difficulty_and_id(self):
        today = date(2026, 1, 10)
        entries = [
            rebalance_entry(3, today - timedelta(days=1), difficulty=9.0),
            rebalance_entry(1, today - timedelta(days=5), difficulty=1.0),
            rebalance_entry(2, today - timedelta(days=1), difficulty=5.0),
            rebalance_entry(4, today - timedelta(days=1), difficulty=9.0)
        ]

        assigned = rebalance_review_calendar(entries, 1, today=today)
        assignment_by_id = {
            item["question_id"]: item["next_review"]
            for item in assigned
        }

        self.assertEqual(assignment_by_id[1], today)
        self.assertEqual(assignment_by_id[3], today)
        self.assertEqual(assignment_by_id[4], today + timedelta(days=1))
        self.assertEqual(assignment_by_id[2], today + timedelta(days=1))

    def test_rebalance_interleaves_types_across_daily_buckets(self):
        today = date(2026, 1, 10)
        entries = [
            rebalance_entry(index, today - timedelta(days=1), type_q="text")
            for index in range(1, 7)
        ] + [
            rebalance_entry(index, today - timedelta(days=1), type_q="map")
            for index in range(101, 107)
        ]

        assigned = rebalance_review_calendar(entries, 4, today=today)
        counts = {}

        for scheduling_result in assigned:
            day = scheduling_result["next_review"]
            type_q = scheduling_result["type_q"]
            counts.setdefault(day, {})
            counts[day][type_q] = counts[day].get(type_q, 0) + 1

        self.assertEqual(counts[today], {"map": 3, "text": 2})
        self.assertEqual(
            counts[today + timedelta(days=1)],
            {"map": 2, "text": 3}
        )
        self.assertEqual(
            counts[today + timedelta(days=2)],
            {"map": 1, "text": 1}
        )


class ReviewRouteSmoothingTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_question(self, question_id, type_q="text"):
        question = Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=[],
            data={}
        )
        self.db.add(question)
        return question

    def add_progress(
        self,
        question_id,
        next_review,
        stability=1.0,
        difficulty=5.0,
        reps=0,
        ideal_interval=None,
        ideal_next_review=None
    ):
        progress = Progress(
            question_id=question_id,
            stability=stability,
            difficulty=difficulty,
            reps=reps,
            lapses=0,
            interval=0,
            ideal_interval=ideal_interval,
            next_review=next_review,
            ideal_next_review=ideal_next_review,
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
        self.assertEqual(response["ideal_next_review"], today + timedelta(days=2))
        self.assertEqual(response["ideal_interval"], 2)
        self.assertEqual(progress.ideal_next_review, today + timedelta(days=2))
        self.assertEqual(progress.ideal_interval, 2)
        self.assertEqual(progress.history[-1]["ideal_interval"], 2)
        self.assertEqual(
            progress.history[-1]["ideal_next_review"],
            (today + timedelta(days=2)).isoformat()
        )

    def test_favorite_answer_schedules_earlier_than_fsrs_interval(self):
        today = date.today()
        question = self.add_question(1, type_q="text")
        question.data = {"favorite": True}
        progress = self.add_progress(1, today)
        self.db.commit()

        response = answer_question(
            AnswerRequest(question_id=1, quality=2),
            db=self.db
        )
        history = progress.history[-1]

        self.assertTrue(history["favorite_boost"])
        self.assertGreater(history["favorite_base_interval"], response["interval"])
        self.assertEqual(
            history["favorite_base_next_review"],
            (today + timedelta(days=history["favorite_base_interval"])).isoformat()
        )
        self.assertEqual(
            response["next_review"],
            today + timedelta(days=response["interval"])
        )
        self.assertEqual(response["ideal_interval"], response["interval"])
        self.assertEqual(response["ideal_next_review"], response["next_review"])
        self.assertEqual(progress.ideal_interval, response["interval"])
        self.assertEqual(progress.ideal_next_review, response["next_review"])

    def test_map_answer_smooths_batch_against_existing_load(self):
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

    def test_text_answer_accepts_easy_quality_and_records_fsrs_metadata(self):
        today = date.today()
        self.add_question(1, type_q="text")
        progress = self.add_progress(1, today)
        self.db.commit()

        response = answer_question(
            AnswerRequest(question_id=1, quality=3),
            db=self.db
        )

        self.assertGreater(response["interval"], 2)
        self.assertEqual(progress.fsrs_version, FSRS_VERSION)
        self.assertEqual(progress.fsrs_card["state"], 2)
        self.assertEqual(progress.history[-1]["quality"], 3)
        self.assertEqual(progress.history[-1]["fsrs_rating"], 4)
        self.assertEqual(progress.history[-1]["fsrs_state"], 2)

    def test_again_answer_stays_due_today_for_retry(self):
        today = date.today()
        self.add_question(1, type_q="text")
        progress = self.add_progress(1, today)
        self.db.commit()

        response = answer_question(
            AnswerRequest(question_id=1, quality=0),
            db=self.db
        )

        self.assertEqual(response["next_review"], today)
        self.assertEqual(response["interval"], 0)
        self.assertEqual(response["ideal_next_review"], today)
        self.assertEqual(response["ideal_interval"], 0)
        self.assertEqual(progress.next_review, today)
        self.assertEqual(progress.interval, 0)
        self.assertEqual(progress.ideal_next_review, today)
        self.assertEqual(progress.ideal_interval, 0)
        self.assertTrue(progress.fsrs_card["due"].startswith(today.isoformat()))
        self.assertEqual(progress.history[-1]["next_review"], today.isoformat())

    def test_revise_answer_replaces_latest_history_entry(self):
        today = date.today()
        self.add_question(1, type_q="text")
        progress = self.add_progress(1, today)
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=0),
            db=self.db
        )
        response = revise_answer_question(
            AnswerRequest(question_id=1, quality=3),
            db=self.db
        )

        self.assertEqual(len(response["history"]), 1)
        self.assertEqual(progress.history[-1]["quality"], 3)
        self.assertEqual(progress.reps, 1)
        self.assertEqual(progress.lapses, 0)

    def test_revise_answer_preserves_earlier_history(self):
        today = date.today()
        self.add_question(1, type_q="text")
        progress = self.add_progress(1, today)
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=2),
            db=self.db
        )
        first_history_entry = progress.history[0]
        answer_question(
            AnswerRequest(question_id=1, quality=0),
            db=self.db
        )

        response = revise_answer_question(
            AnswerRequest(question_id=1, quality=3),
            db=self.db
        )

        self.assertEqual(len(response["history"]), 2)
        self.assertEqual(progress.history[0], first_history_entry)
        self.assertEqual(progress.history[-1]["quality"], 3)
        self.assertEqual(progress.reps, 2)

    def test_answer_quality_validation_accepts_four_ratings(self):
        self.assertEqual(
            AnswerRequest(question_id=1, quality=3).quality,
            3
        )
        self.assertEqual(
            MapAnswerRequest(items={1: 3}).items[1],
            3
        )

        with self.assertRaises(ValidationError):
            AnswerRequest(question_id=1, quality=4)

        with self.assertRaises(ValidationError):
            MapAnswerRequest(items={1: 4})

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

    def test_text_answer_uses_type_mix_when_candidate_loads_match(self):
        today = date.today()
        question = self.add_question(1, type_q="text")
        question.question = "Question"
        question.answer = "Answer"
        progress = self.add_progress(1, today)

        for question_id, type_q, next_review in [
            (101, "text", today + timedelta(days=1)),
            (102, "text", today + timedelta(days=2)),
            (103, "map", today + timedelta(days=3))
        ]:
            self.add_question(question_id, type_q=type_q)
            self.add_progress(question_id, next_review, reps=1)

        self.db.commit()

        response = answer_question(
            AnswerRequest(question_id=1, quality=2),
            db=self.db
        )

        self.assertEqual(response["next_review"], today + timedelta(days=3))
        self.assertEqual(progress.next_review, today + timedelta(days=3))

    def test_default_review_settings_target_is_persisted(self):
        settings = get_settings(db=self.db)
        setting_row = (
            self.db.query(AppSetting)
            .filter(AppSetting.key == "review")
            .first()
        )

        self.assertEqual(settings["catchup_daily_target"], 50)
        self.assertEqual(
            setting_row.value["catchup_daily_target"],
            50
        )

    def test_review_settings_target_can_be_updated(self):
        settings = update_settings(
            ReviewSettings(catchup_daily_target=35),
            db=self.db
        )

        self.assertEqual(settings["catchup_daily_target"], 35)
        self.assertEqual(
            get_settings(db=self.db)["catchup_daily_target"],
            35
        )

    def test_review_defaults_to_started_due_and_blocks_new_until_clear(self):
        today = date.today()
        self.add_question(1)
        self.add_progress(1, today, reps=1)
        self.add_question(2)
        self.add_question(3)
        self.add_progress(3, today, reps=0)
        self.db.commit()

        response = get_review(db=self.db)
        bonus_response = get_review(include_new=True, db=self.db)

        self.assertEqual(
            [item["question_id"] for item in response],
            [1]
        )
        self.assertEqual(
            [item["question_id"] for item in bonus_response],
            [1]
        )

    def test_bonus_review_returns_new_questions_when_due_work_is_clear(self):
        today = date.today()
        self.add_question(1)
        self.add_question(2)
        self.add_progress(2, today, reps=0)
        self.add_question(3)
        self.add_progress(3, today + timedelta(days=3), reps=1)
        self.db.commit()

        response = get_review(db=self.db)
        bonus_response = get_review(include_new=True, db=self.db)

        self.assertEqual(response, [])
        self.assertEqual(
            [item["question_id"] for item in bonus_response],
            [1, 2]
        )

    def test_failed_first_answer_becomes_scheduled_before_more_bonus(self):
        today = date.today()
        self.add_question(1)
        self.add_question(2)
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=0),
            db=self.db
        )

        response = get_review(include_new=True, db=self.db)

        self.assertEqual(
            [item["question_id"] for item in response],
            [1]
        )
        progress = (
            self.db.query(Progress)
            .filter(Progress.question_id == 1)
            .first()
        )
        self.assertEqual(progress.next_review, today)
        self.assertEqual(progress.reps, 1)

    def test_rebalance_route_ignores_unstarted_progress_rows(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=1), db=self.db)

        for question_id in range(1, 3):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=2), reps=1)

        self.add_question(3)
        new_progress = self.add_progress(3, today - timedelta(days=2), reps=0)
        self.db.commit()

        response = rebalance_review(db=self.db)

        self.assertEqual(response["total"], 2)
        self.assertEqual(response["moved"], 2)
        self.assertEqual(new_progress.next_review, today - timedelta(days=2))

    def test_rebalance_route_moves_progress_and_soft_limits_daily_load(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)

        for question_id in range(1, 6):
            self.add_question(question_id)
            progress = self.add_progress(
                question_id,
                today - timedelta(days=3),
                difficulty=5.0 + question_id,
                reps=1
            )

            if question_id == 1:
                progress.stability = 2.5
                progress.reps = 4
                progress.lapses = 1
                progress.history = [{"reviewed_on": "2026-01-01"}]

        self.db.commit()

        response = rebalance_review(db=self.db)
        counts = {}

        for progress in self.db.query(Progress).all():
            counts[progress.next_review] = counts.get(progress.next_review, 0) + 1

        self.assertEqual(response["daily_target"], 2)
        self.assertEqual(response["moved"], 5)
        self.assertEqual(counts[today], 3)
        self.assertEqual(counts[today + timedelta(days=1)], 2)
        self.assertNotIn(today + timedelta(days=2), counts)

        unchanged = (
            self.db.query(Progress)
            .filter(Progress.question_id == 1)
            .first()
        )
        self.assertEqual(unchanged.stability, 2.5)
        self.assertEqual(unchanged.reps, 4)
        self.assertEqual(unchanged.lapses, 1)
        self.assertEqual(unchanged.history, [{"reviewed_on": "2026-01-01"}])

    def test_rebalance_route_uses_ideal_anchor_without_mutating_it(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=50), db=self.db)
        self.add_question(1)
        progress = self.add_progress(
            1,
            today + timedelta(days=6),
            reps=1,
            ideal_interval=2,
            ideal_next_review=today + timedelta(days=2)
        )
        progress.last_review = today
        progress.interval = 6
        self.db.commit()

        response = rebalance_review(db=self.db)

        self.assertEqual(response["moved"], 1)
        self.assertEqual(progress.next_review, today + timedelta(days=2))
        self.assertEqual(progress.interval, 2)
        self.assertEqual(progress.ideal_next_review, today + timedelta(days=2))
        self.assertEqual(progress.ideal_interval, 2)

    def test_rebalance_route_mixes_question_types_per_day(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=4), db=self.db)

        for question_id in range(1, 7):
            self.add_question(question_id, type_q="text")
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        for question_id in range(101, 107):
            self.add_question(question_id, type_q="map")
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        self.db.commit()

        rebalance_review(db=self.db)
        rows = (
            self.db.query(Progress.next_review, Question.type_q, Progress.question_id)
            .join(Question, Question.id == Progress.question_id)
            .all()
        )
        counts = {}

        for next_review, type_q, _ in rows:
            counts.setdefault(next_review, {})
            counts[next_review][type_q] = counts[next_review].get(type_q, 0) + 1

        self.assertEqual(counts[today], {"map": 3, "text": 2})
        self.assertEqual(
            counts[today + timedelta(days=1)],
            {"map": 2, "text": 3}
        )
        self.assertEqual(
            counts[today + timedelta(days=2)],
            {"map": 1, "text": 1}
        )

    def test_review_after_rebalance_returns_manageable_due_set(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)

        for question_id in range(1, 6):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        self.db.commit()
        rebalance_review(db=self.db)

        response = get_review(db=self.db)

        self.assertEqual(len(response), 3)
        self.assertEqual(
            sorted(item["question_id"] for item in response),
            [1, 2, 3]
        )

    def test_review_route_returns_all_due_questions_without_cap(self):
        for question_id in range(1, 206):
            self.add_question(question_id)
            self.add_progress(question_id, date.today(), reps=1)

        self.db.commit()

        response = get_review(db=self.db)

        self.assertEqual(len(response), 205)

    def test_startup_rebalance_records_notice_when_items_move(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)

        for question_id in range(1, 4):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        self.db.commit()

        outcome = run_startup_rebalance(self.db)
        notice = outcome["notice"]

        self.assertIsNotNone(notice)
        self.assertTrue(notice["id"])
        self.assertTrue(notice["ran_at"])
        self.assertEqual(notice["moved"], 3)
        self.assertEqual(notice["daily_target"], 2)

    def test_startup_rebalance_clears_old_notice_when_nothing_moves(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)

        for question_id in range(1, 4):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        self.db.commit()
        first_outcome = run_startup_rebalance(self.db)

        self.assertIsNotNone(first_outcome["notice"])

        second_outcome = run_startup_rebalance(self.db)

        self.assertEqual(second_outcome["rebalance"]["moved"], 0)
        self.assertIsNone(second_outcome["notice"])
        self.assertIsNone(get_startup_notice(db=self.db))

    def test_startup_notice_endpoint_returns_persisted_notice(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)

        for question_id in range(1, 4):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        self.db.commit()
        run_startup_rebalance(self.db)

        response = get_startup_notice(db=self.db)

        self.assertEqual(response["moved"], 3)
        self.assertEqual(response["daily_target"], 2)

    def test_fsrs_migration_replays_history_with_type_aware_success(self):
        today = date(2026, 1, 10)
        text = self.add_question(1, type_q="text")
        map_question = self.add_question(2, type_q="map")
        text_progress = self.add_progress(text.id, today)
        map_progress = self.add_progress(map_question.id, today)
        text_progress.history = [
            {"reviewed_on": "2026-01-01", "quality": 2}
        ]
        map_progress.history = [
            {"reviewed_on": "2026-01-01", "quality": 2}
        ]
        self.db.commit()

        result = migrate_progress_to_fsrs_v6(self.db)

        self.assertEqual(result["migrated"], 2)
        self.assertEqual(result["from_history"], 2)
        self.assertEqual(text_progress.fsrs_version, FSRS_VERSION)
        self.assertEqual(map_progress.fsrs_version, FSRS_VERSION)
        self.assertGreater(text_progress.stability, map_progress.stability)
        self.assertEqual(text_progress.fsrs_card["state"], 2)
        self.assertEqual(map_progress.fsrs_card["state"], 2)
        self.assertEqual(text_progress.ideal_next_review, text_progress.next_review)
        self.assertEqual(map_progress.ideal_next_review, map_progress.next_review)

    def test_fsrs_migration_backfills_scalar_rows_without_history(self):
        today = date(2026, 1, 10)
        due = today + timedelta(days=12)
        self.add_question(1, type_q="text")
        progress = self.add_progress(
            1,
            due,
            stability=2.5,
            difficulty=6.0,
            reps=3
        )
        progress.last_review = today
        progress.interval = 12
        self.db.commit()

        result = migrate_progress_to_fsrs_v6(self.db)

        self.assertEqual(result["migrated"], 1)
        self.assertEqual(result["from_scalars"], 1)
        self.assertEqual(progress.fsrs_version, FSRS_VERSION)
        self.assertEqual(progress.fsrs_card["stability"], 2.5)
        self.assertEqual(progress.fsrs_card["difficulty"], 6.0)
        self.assertTrue(progress.fsrs_card["due"].startswith(due.isoformat()))
        self.assertEqual(progress.next_review, due)
        self.assertEqual(progress.ideal_next_review, due)
        self.assertEqual(progress.ideal_interval, 12)

    def test_review_route_does_not_rebalance_calendar(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)

        for question_id in range(1, 4):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        self.db.commit()

        response = get_review(db=self.db)
        overdue_count = (
            self.db.query(Progress)
            .filter(Progress.next_review == today - timedelta(days=1))
            .count()
        )

        self.assertEqual(len(response), 3)
        self.assertEqual(overdue_count, 3)


if __name__ == "__main__":
    unittest.main()
