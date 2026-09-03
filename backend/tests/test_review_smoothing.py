import random
import unittest
from collections import Counter
from datetime import date, timedelta

from fsrs import Rating
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import AppSetting, Progress, Question, QuestionGroup
from app.routers.review import (
    answer_media,
    answer_map,
    answer_question,
    answer_timeline,
    get_review,
    get_summary,
    get_settings,
    get_startup_notice,
    rebalance_review,
    revise_answer_question,
    update_settings
)
from app.routers.groups import suspend_group
from app.services.intake import PRESSURE_DOWN_MIN, schedule_pressure
from app.services.questions import update_question as update_question_service
from app.services.review import _new_question_ids
from app.services.startup import run_startup_rebalance
from app.services.settings import REVIEW_MAINTENANCE_KEY
from app.services.fsrs_migration import migrate_progress_to_fsrs_v6
from app.scheduler import (
    FSRS_VERSION,
    MAX_DIFFICULTY,
    MIN_STABILITY,
    app_quality_to_fsrs_rating,
    assign_smoothed_schedules,
    choose_smoothed_review_date,
    favorite_interval,
    legacy_quality_to_fsrs_rating,
    preview_intervals,
    rebalance_review_calendar,
    smoothing_radius_days,
    update_progress
)
from app.services.map_modes import (
    choose_map_review_mode,
    map_mode_difficulty
)
from app.services.image_modes import (
    choose_image_review_mode,
    image_mode_difficulty
)
from app.schemas import (
    AnswerRequest,
    MediaAnswerRequest,
    MapAnswerRequest,
    GroupSuspend,
    QuestionUpdate,
    ReviewSettings,
    TimelineAnswerItem,
    TimelineAnswerRequest,
    TimelineDateValue
)


class FixedRandom:
    def __init__(self, value):
        self.value = value

    def random(self):
        return self.value


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

    def test_map_mode_difficulty_uses_type_all_as_reference(self):
        self.assertEqual(map_mode_difficulty("type_all", 2), 1.0)
        self.assertEqual(map_mode_difficulty("type_prompt", 20), 1.05)
        self.assertEqual(map_mode_difficulty("multiple_choice", 20), 0.55)
        self.assertAlmostEqual(map_mode_difficulty("click_prompt", 1), 0.4)
        self.assertAlmostEqual(map_mode_difficulty("click_prompt", 4), 0.505)
        self.assertAlmostEqual(map_mode_difficulty("click_prompt", 16), 0.7225)
        self.assertLess(map_mode_difficulty("click_prompt", 1000), 0.95)

    def test_map_review_mode_selector_uses_difficulty_size_and_variety(self):
        hard = Question(type_q="map", answer="Hard", data={"code": "hard"})
        hard.progress = Progress(reps=0, difficulty=5.0, history=[])
        strong = Question(type_q="map", answer="Strong", data={"code": "strong"})
        strong.progress = Progress(
            reps=4,
            difficulty=3.0,
            history=[
                {"map_mode": "type_prompt", "quality": 2}
                for _ in range(4)
            ]
        )
        extras = [
            Question(type_q="map", answer=f"Extra {index}", data={"code": f"e{index}"})
            for index in range(3)
        ]

        for extra in extras:
            extra.progress = Progress(reps=1, difficulty=5.0, history=[])

        context = [hard, strong, *extras]

        self.assertEqual(
            choose_map_review_mode([hard], context, rng=FixedRandom(0)),
            "multiple_choice"
        )
        self.assertEqual(
            choose_map_review_mode([strong], context, rng=FixedRandom(0)),
            "type_all"
        )
        self.assertNotEqual(
            choose_map_review_mode([hard], context[:4], rng=FixedRandom(0)),
            "multiple_choice"
        )
        self.assertEqual(
            choose_map_review_mode(
                [hard],
                [hard],
                multiple_choice_context_count=5,
                rng=FixedRandom(0)
            ),
            "multiple_choice"
        )

    def test_map_random_selector_biases_support_and_strong_modes(self):
        support_items = []
        strong_items = []

        for index in range(12):
            support = Question(type_q="map", answer=f"Support {index}")
            support.progress = Progress(reps=1, difficulty=3.0, history=[])
            support_items.append(support)

            strong = Question(type_q="map", answer=f"Strong {index}")
            strong.progress = Progress(
                reps=4,
                difficulty=3.0,
                history=[{"map_mode": "type_prompt", "quality": 2}]
            )
            strong_items.append(strong)

        support_rng = random.Random(1)
        support_modes = Counter(
            choose_map_review_mode(support_items, support_items, rng=support_rng)
            for _ in range(300)
        )
        strong_rng = random.Random(2)
        strong_modes = Counter(
            choose_map_review_mode(strong_items, strong_items, rng=strong_rng)
            for _ in range(300)
        )

        self.assertGreater(
            support_modes["multiple_choice"] + support_modes["click_prompt"],
            260
        )
        self.assertGreaterEqual(
            strong_modes["type_prompt"] + strong_modes["type_all"],
            240
        )

    def test_map_random_selector_keeps_mixed_chunks_varied(self):
        # click_prompt requires at least CHOICE_MODE_MIN_CONTEXT (5) elements, so
        # exercise the variety guarantee with a valid-size mixed chunk.
        items = []

        for _ in range(2):
            support = Question(type_q="map", answer="Support")
            support.progress = Progress(reps=1, difficulty=3.0, history=[])
            items.append(support)

        for _ in range(2):
            strong = Question(type_q="map", answer="Strong")
            strong.progress = Progress(
                reps=4,
                difficulty=3.0,
                history=[{"map_mode": "type_prompt", "quality": 2}]
            )
            items.append(strong)

        medium = Question(type_q="map", answer="Medium")
        medium.progress = Progress(reps=4, difficulty=5.0, history=[])
        items.append(medium)

        rng = random.Random(3)
        modes = Counter(
            choose_map_review_mode(items, items, rng=rng)
            for _ in range(300)
        )

        self.assertGreaterEqual(len(modes), 3)
        self.assertGreater(modes["click_prompt"], 0)
        self.assertGreater(modes["type_prompt"], 0)

    def test_map_recall_probe_favours_unsupported_recall(self):
        due = []

        for index in range(5):
            question = Question(type_q="map", answer=f"Probe {index}")
            question.progress = Progress(
                reps=4,
                difficulty=3.0,
                history=[{"map_mode": "multiple_choice", "quality": 2}]
            )
            due.append(question)

        self.assertEqual(
            choose_map_review_mode(due, due, rng=FixedRandom(0)),
            "type_prompt"
        )

    def test_map_recall_proof_removes_easy_modes_even_for_fragile_cards(self):
        due = []

        for index in range(5):
            question = Question(type_q="map", answer=f"Proven {index}")
            question.progress = Progress(
                reps=1,
                difficulty=8.0,
                history=[{"map_mode": "type_prompt", "quality": 2}]
            )
            due.append(question)

        modes = {
            choose_map_review_mode(due, due, rng=FixedRandom(value))
            for value in (0, 0.25, 0.5, 0.75, 0.999)
        }

        self.assertLessEqual(modes, {"type_all", "type_prompt"})

    def test_brand_new_map_uses_supported_modes_when_available(self):
        due = [
            Question(type_q="map", answer=f"New {index}")
            for index in range(5)
        ]

        modes = {
            choose_map_review_mode(due, due, rng=FixedRandom(value))
            for value in (0, 0.25, 0.5, 0.75, 0.999)
        }

        self.assertLessEqual(modes, {"multiple_choice", "click_prompt"})

    def test_map_click_prompt_requires_minimum_review_context(self):
        context = [
            Question(id=index, type_q="map", answer=f"Zone {index}")
            for index in range(1, 6)
        ]

        for question in context:
            question.progress = Progress(reps=3, difficulty=5.0, history=[])

        for size in range(1, 5):
            modes = {
                choose_map_review_mode(
                    [context[0]],
                    context[:size],
                    rng=random.Random(seed)
                )
                for seed in range(50)
            }
            self.assertNotIn("click_prompt", modes)

        self.assertEqual(
            choose_map_review_mode(
                [context[0]],
                context,
                rng=FixedRandom(0)
            ),
            "click_prompt"
        )

    def test_image_mode_difficulty_uses_type_all_as_reference(self):
        self.assertEqual(image_mode_difficulty("type_all", 2), 1.0)
        self.assertEqual(image_mode_difficulty("type_prompt", 20), 1.05)
        self.assertEqual(
            image_mode_difficulty("multiple_choice_label", 20),
            0.55
        )
        self.assertEqual(
            image_mode_difficulty("multiple_choice_media", 20),
            0.55
        )

    def test_image_review_mode_selector_uses_difficulty_size_and_variety(self):
        hard = Question(type_q="media", answer="Hard")
        hard.progress = Progress(reps=0, difficulty=5.0, history=[])
        strong = Question(type_q="media", answer="Strong")
        strong.progress = Progress(
            reps=4,
            difficulty=3.0,
            history=[
                {"image_mode": "type_prompt", "quality": 2}
                for _ in range(4)
            ]
        )
        extras = [
            Question(type_q="media", answer=f"Extra {index}")
            for index in range(3)
        ]

        for extra in extras:
            extra.progress = Progress(reps=1, difficulty=5.0, history=[])

        context = [hard, strong, *extras]

        self.assertEqual(
            choose_image_review_mode([hard], context, rng=FixedRandom(0)),
            "multiple_choice_label"
        )
        self.assertEqual(
            choose_image_review_mode([strong], context, rng=FixedRandom(0)),
            "type_prompt"
        )
        self.assertNotIn(
            choose_image_review_mode([hard], context[:4], rng=FixedRandom(0)),
            {"multiple_choice_label", "multiple_choice_media"}
        )
        self.assertEqual(
            choose_image_review_mode(
                [hard],
                [hard],
                multiple_choice_context_count=5,
                rng=FixedRandom(0)
            ),
            "multiple_choice_label"
        )

    def test_image_random_selector_biases_support_and_strong_modes(self):
        support_items = []
        strong_items = []

        for index in range(12):
            support = Question(type_q="media", answer=f"Support {index}")
            support.progress = Progress(reps=1, difficulty=3.0, history=[])
            support_items.append(support)

            strong = Question(type_q="media", answer=f"Strong {index}")
            strong.progress = Progress(
                reps=4,
                difficulty=3.0,
                history=[{"image_mode": "type_prompt", "quality": 2}]
            )
            strong_items.append(strong)

        support_rng = random.Random(4)
        support_modes = Counter(
            choose_image_review_mode(support_items, support_items, rng=support_rng)
            for _ in range(300)
        )
        strong_rng = random.Random(5)
        strong_modes = Counter(
            choose_image_review_mode(strong_items, strong_items, rng=strong_rng)
            for _ in range(300)
        )

        self.assertGreater(
            support_modes["multiple_choice_label"] +
            support_modes["multiple_choice_media"] +
            support_modes["click_prompt"],
            260
        )
        self.assertGreater(
            strong_modes["type_prompt"] + strong_modes["type_all"],
            240
        )

    def test_image_recall_probe_favours_unsupported_recall(self):
        due = []

        for index in range(5):
            question = Question(type_q="media", answer=f"Probe {index}")
            question.progress = Progress(
                reps=4,
                difficulty=3.0,
                history=[{"image_mode": "multiple_choice_media", "quality": 2}]
            )
            due.append(question)

        self.assertEqual(
            choose_image_review_mode(due, due, rng=FixedRandom(0)),
            "type_prompt"
        )

    def test_image_recall_proof_removes_easy_modes_even_for_fragile_cards(self):
        due = []

        for index in range(5):
            question = Question(type_q="media", answer=f"Proven {index}")
            question.progress = Progress(
                reps=1,
                difficulty=8.0,
                history=[{"image_mode": "type_prompt", "quality": 2}]
            )
            due.append(question)

        modes = {
            choose_image_review_mode(due, due, rng=FixedRandom(value))
            for value in (0, 0.25, 0.5, 0.75, 0.999)
        }

        self.assertLessEqual(modes, {"type_all", "type_prompt"})

    def test_brand_new_images_use_supported_modes_when_available(self):
        due = [
            Question(type_q="media", answer=f"New {index}")
            for index in range(5)
        ]

        modes = {
            choose_image_review_mode(due, due, rng=FixedRandom(value))
            for value in (0, 0.25, 0.5, 0.75, 0.999)
        }

        self.assertLessEqual(
            modes,
            {"multiple_choice_label", "multiple_choice_media"}
        )

    def test_single_image_review_mode_does_not_pick_type_all(self):
        support = Question(type_q="media", answer="Support")
        support.progress = Progress(reps=1, difficulty=3.0, history=[])

        self.assertEqual(
            choose_image_review_mode(
                [support],
                [support],
                rng=FixedRandom(0.999999)
            ),
            "type_prompt"
        )

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

    def review_progress(self):
        today = date(2026, 1, 10)
        return Progress(
            question_id=1,
            stability=5.0,
            difficulty=5.0,
            reps=4,
            lapses=0,
            interval=5,
            last_review=today - timedelta(days=5),
            next_review=today,
            history=[]
        )

    def test_type_all_mode_matches_reference_fsrs_scheduling(self):
        today = date(2026, 1, 10)
        progress = self.review_progress()

        reference = update_progress(
            progress,
            2,
            today=today,
            enable_fuzzing=False
        )
        type_all = update_progress(
            progress,
            2,
            today=today,
            mode_difficulty=1.0,
            enable_fuzzing=False
        )

        self.assertEqual(type_all["stability"], reference["stability"])
        self.assertEqual(type_all["difficulty"], reference["difficulty"])
        self.assertEqual(type_all["interval"], reference["interval"])
        self.assertEqual(type_all["next_review"], reference["next_review"])

    def test_easier_mode_penalizes_misses_more_than_type_all(self):
        today = date(2026, 1, 10)
        progress = self.review_progress()

        reference = update_progress(
            progress,
            0,
            today=today,
            mode_difficulty=1.0,
            enable_fuzzing=False
        )
        easier = update_progress(
            progress,
            0,
            today=today,
            mode_difficulty=0.5,
            enable_fuzzing=False
        )

        self.assertLess(easier["stability"], reference["stability"])
        self.assertGreater(easier["difficulty"], reference["difficulty"])
        self.assertEqual(easier["interval"], 0)
        self.assertEqual(easier["next_review"], today)

    def test_easier_mode_miss_keeps_penalty_gradient(self):
        today = date(2026, 1, 10)
        progress = self.review_progress()

        reference = update_progress(
            progress,
            0,
            today=today,
            mode_difficulty=1.0,
            enable_fuzzing=False
        )
        easier = update_progress(
            progress,
            0,
            today=today,
            mode_difficulty=0.5,
            enable_fuzzing=False
        )

        self.assertLess(easier["stability"], reference["stability"])
        self.assertGreater(easier["stability"], MIN_STABILITY)
        self.assertGreater(easier["difficulty"], reference["difficulty"])
        self.assertLess(easier["difficulty"], MAX_DIFFICULTY)

    def test_miss_penalty_is_monotonic_in_mode_difficulty(self):
        # click_prompt difficulty slides continuously with the zone count, so
        # neighbouring session sizes must not swap the penalty ordering.
        today = date(2026, 1, 10)
        progress = self.review_progress()
        misses = [
            (
                mode_difficulty,
                update_progress(
                    progress,
                    0,
                    today=today,
                    mode_difficulty=mode_difficulty,
                    enable_fuzzing=False
                )
            )
            for mode_difficulty in (
                0.40, 0.50, 0.55, 0.60, 0.65, 0.70,
                0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05
            )
        ]

        for (_, easier), (mode_difficulty, harder) in zip(misses, misses[1:]):
            self.assertLessEqual(
                harder["difficulty"],
                easier["difficulty"],
                f"difficulty penalty grew at mode_difficulty={mode_difficulty}"
            )
            self.assertGreaterEqual(
                harder["stability"],
                easier["stability"],
                f"stability penalty grew at mode_difficulty={mode_difficulty}"
            )

        for mode_difficulty, miss in misses:
            self.assertGreater(miss["stability"], MIN_STABILITY)
            self.assertLess(miss["difficulty"], MAX_DIFFICULTY)

    def test_easier_mode_rewards_correct_answers_less_than_type_all(self):
        today = date(2026, 1, 10)
        progress = self.review_progress()

        reference = update_progress(
            progress,
            3,
            today=today,
            mode_difficulty=1.0,
            enable_fuzzing=False
        )
        easier = update_progress(
            progress,
            3,
            today=today,
            mode_difficulty=0.5,
            enable_fuzzing=False
        )

        self.assertLess(easier["stability"], reference["stability"])
        self.assertGreater(easier["difficulty"], reference["difficulty"])
        self.assertLessEqual(easier["interval"], reference["interval"])

    def test_type_prompt_rewards_hits_and_forgives_misses(self):
        today = date(2026, 1, 10)
        progress = self.review_progress()

        reference_miss = update_progress(
            progress,
            0,
            today=today,
            mode_difficulty=1.0,
            enable_fuzzing=False
        )
        type_prompt_miss = update_progress(
            progress,
            0,
            today=today,
            mode_difficulty=1.15,
            enable_fuzzing=False
        )
        reference_hit = update_progress(
            progress,
            3,
            today=today,
            mode_difficulty=1.0,
            enable_fuzzing=False
        )
        type_prompt_hit = update_progress(
            progress,
            3,
            today=today,
            mode_difficulty=1.15,
            enable_fuzzing=False
        )

        self.assertGreater(
            type_prompt_miss["stability"],
            reference_miss["stability"]
        )
        self.assertLess(
            type_prompt_miss["difficulty"],
            reference_miss["difficulty"]
        )
        self.assertGreater(
            type_prompt_hit["stability"],
            reference_hit["stability"]
        )
        self.assertLess(
            type_prompt_hit["difficulty"],
            reference_hit["difficulty"]
        )
        self.assertGreaterEqual(
            type_prompt_hit["interval"],
            reference_hit["interval"]
        )

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

    def test_under_target_load_keeps_ideal_day(self):
        today = date(2026, 1, 1)
        ideal = today + timedelta(days=4)

        self.assertEqual(
            choose_smoothed_review_date(today, ideal, 4, {ideal: 10}),
            ideal
        )

    def test_over_target_ideal_day_shifts_to_later_tie(self):
        today = date(2026, 1, 1)
        ideal = today + timedelta(days=4)

        self.assertEqual(
            choose_smoothed_review_date(
                today,
                ideal,
                4,
                {ideal: 10},
                daily_target=4
            ),
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
            choose_smoothed_review_date(
                today,
                ideal,
                14,
                loads,
                daily_target=4
            ),
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
            loads,
            daily_target=1
        )

        self.assertEqual(assigned_high["next_review"], today + timedelta(days=3))
        self.assertEqual(assigned_low["next_review"], today + timedelta(days=2))

    def test_regular_smoothing_prefers_type_mix_when_loads_are_equal(self):
        today = date(2026, 1, 1)
        ideal = today + timedelta(days=2)
        mixed_day = today + timedelta(days=3)
        daily_loads = {
            today + timedelta(days=1): 1,
            ideal: 2,
            mixed_day: 1
        }
        daily_type_loads = {
            today + timedelta(days=1): {"text": 1},
            ideal: {"text": 2},
            mixed_day: {"map": 1}
        }

        self.assertEqual(
            choose_smoothed_review_date(
                today,
                ideal,
                2,
                daily_loads,
                daily_type_loads=daily_type_loads,
                type_q="text",
                daily_target=1
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

        self.assertEqual(counts[today], 61)
        self.assertEqual(counts[today + timedelta(days=1)], 59)
        self.assertNotIn(today + timedelta(days=2), counts)

    def test_rebalance_allows_small_target_overage_smoothly(self):
        today = date(2026, 1, 10)
        entries = [
            rebalance_entry(index, today - timedelta(days=3))
            for index in range(5)
        ]

        assigned = rebalance_review_calendar(entries, 2, today=today)
        counts = {}

        for scheduling_result in assigned:
            day = scheduling_result["next_review"]
            counts[day] = counts.get(day, 0) + 1

        self.assertEqual(counts[today], 3)
        self.assertEqual(counts[today + timedelta(days=1)], 2)

    def test_rebalance_initial_daily_loads_consume_today_capacity(self):
        today = date(2026, 1, 10)
        entries = [
            rebalance_entry(index, today - timedelta(days=3))
            for index in range(4)
        ]

        assigned = rebalance_review_calendar(
            entries,
            2,
            today=today,
            initial_daily_loads={today: 2}
        )
        counts = {}

        for scheduling_result in assigned:
            day = scheduling_result["next_review"]
            counts[day] = counts.get(day, 0) + 1

        self.assertEqual(counts[today], 1)
        self.assertEqual(counts[today + timedelta(days=1)], 3)

    def test_rebalance_allows_mild_future_over_target(self):
        today = date(2026, 1, 10)
        future_day = today + timedelta(days=3)
        entries = [
            rebalance_entry(index, future_day)
            for index in range(57)
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

        self.assertEqual(counts[future_day], 57)
        self.assertEqual(counts[future_day + timedelta(days=1)], 8)

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

    def test_rebalance_materializes_missing_ideal_anchor_for_idempotence(self):
        today = date(2026, 1, 10)
        entries = [
            rebalance_entry(
                1,
                today - timedelta(days=9),
                difficulty=8.0,
                last_review=today - timedelta(days=8),
                type_q="media",
                ideal_next_review=today - timedelta(days=5),
                ideal_interval=0
            ),
            rebalance_entry(
                2,
                today - timedelta(days=7),
                difficulty=9.0,
                last_review=today - timedelta(days=13),
                type_q="media"
            )
        ]
        entries[1]["interval"] = 6

        first = rebalance_review_calendar(
            entries,
            1,
            today=today,
            initial_daily_loads={today: 1}
        )
        second = rebalance_review_calendar(
            first,
            1,
            today=today,
            initial_daily_loads={today: 1}
        )

        self.assertEqual(first, second)
        self.assertEqual(first[1]["ideal_next_review"], today - timedelta(days=7))
        self.assertEqual(first[1]["ideal_interval"], 6)

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
        self.assertEqual(assignment_by_id[4], today)
        self.assertEqual(assignment_by_id[3], today + timedelta(days=1))
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

        self.assertEqual(counts[today], {"map": 3, "text": 3})
        self.assertEqual(
            counts[today + timedelta(days=1)],
            {"map": 3, "text": 3}
        )


class ReviewRouteSmoothingTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_question(
        self,
        question_id,
        type_q="text",
        group=None,
        suspended=False
    ):
        question = Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=[],
            data={},
            group=group,
            suspended=suspended
        )
        self.db.add(question)
        return question

    def add_group(self, group_id, type_group="media"):
        group = QuestionGroup(
            id=group_id,
            type_group=type_group,
            name=f"Group {group_id}",
            media=None,
            data={}
        )
        self.db.add(group)
        return group

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

    def test_text_answer_keeps_ideal_date_when_load_is_under_target(self):
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

        self.assertEqual(response["next_review"], today + timedelta(days=2))
        self.assertEqual(response["interval"], 2)
        self.assertEqual(response["ideal_next_review"], today + timedelta(days=2))
        self.assertEqual(response["ideal_interval"], 2)
        self.assertEqual(progress.ideal_next_review, today + timedelta(days=2))
        self.assertEqual(progress.ideal_interval, 2)
        self.assertEqual(progress.history[-1]["ideal_interval"], 2)
        self.assertEqual(
            progress.history[-1]["ideal_next_review"],
            (today + timedelta(days=2)).isoformat()
        )

    def test_text_answer_uses_smoothed_date_when_ideal_is_over_target(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)
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
        update_settings(ReviewSettings(catchup_daily_target=1), db=self.db)
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
        progress = self.add_progress(1, today, reps=1)
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

    def test_bonus_text_retry_is_frozen_and_graduates_the_card(self):
        # The failed first answer is the only recorded review of the day. A
        # same-day pass is a relearning "Acquis": it is frozen (no new history,
        # no extra rep) and graduates the card forward from the frozen state.
        review_day = date(2026, 1, 1)
        self.add_question(1, type_q="text")
        self.db.commit()

        answer_question(
            AnswerRequest(
                question_id=1,
                quality=0,
                review_date=review_day
            ),
            db=self.db
        )
        answer_question(
            AnswerRequest(
                question_id=1,
                quality=2,
                review_date=review_day
            ),
            db=self.db
        )

        progress = (
            self.db.query(Progress)
            .filter(Progress.question_id == 1)
            .first()
        )

        self.assertEqual(progress.last_review, review_day)
        self.assertEqual(
            [entry["quality"] for entry in progress.history],
            [0]
        )
        self.assertEqual(progress.reps, 1)
        self.assertEqual(progress.lapses, 1)
        self.assertGreater(progress.next_review, review_day)

    def test_revise_single_answer_uses_supplied_review_date(self):
        review_day = date(2026, 1, 1)
        self.add_question(1, type_q="text")
        self.db.commit()

        answer_question(
            AnswerRequest(
                question_id=1,
                quality=0,
                review_date=review_day
            ),
            db=self.db
        )
        response = revise_answer_question(
            AnswerRequest(
                question_id=1,
                quality=3,
                review_date=review_day
            ),
            db=self.db
        )

        progress = (
            self.db.query(Progress)
            .filter(Progress.question_id == 1)
            .first()
        )

        self.assertEqual(len(response["history"]), 1)
        self.assertEqual(progress.last_review, review_day)
        self.assertEqual(progress.history[-1]["reviewed_on"], review_day.isoformat())

    def test_revise_bonus_text_to_again_keeps_the_card_scheduled(self):
        # Re-grading a bonus answer down to Again corrects the grade, it does not
        # send the card back to the bonus pool: one review, due today.
        today = date.today()
        self.add_question(1, type_q="text")
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=2),
            db=self.db
        )
        response = revise_answer_question(
            AnswerRequest(question_id=1, quality=0),
            db=self.db
        )

        progress = (
            self.db.query(Progress)
            .filter(Progress.question_id == 1)
            .first()
        )

        self.assertEqual(len(response["history"]), 1)
        self.assertEqual(response["history"][-1]["quality"], 0)
        self.assertEqual(response["reps"], 1)
        self.assertIsNotNone(progress)
        self.assertEqual(progress.reps, 1)
        self.assertEqual(progress.lapses, 1)
        self.assertEqual(progress.next_review, today)

    def test_revise_bonus_text_to_again_keeps_unstarted_progress_row(self):
        today = date.today()
        self.add_question(1, type_q="text")
        progress = self.add_progress(1, today, reps=0)
        self.db.commit()

        answer_question(
            AnswerRequest(question_id=1, quality=2),
            db=self.db
        )
        response = revise_answer_question(
            AnswerRequest(question_id=1, quality=0),
            db=self.db
        )

        self.assertEqual(len(response["history"]), 1)
        self.assertEqual(response["history"][-1]["quality"], 0)
        self.assertEqual(progress.reps, 1)
        self.assertEqual(progress.last_review, today)
        self.assertEqual(progress.next_review, today)

    def test_grouped_answers_use_supplied_review_date(self):
        review_day = date(2026, 1, 1)

        for question_id, type_q in [
            (1, "map"),
            (2, "map"),
            (3, "media"),
            (4, "media")
        ]:
            self.add_question(question_id, type_q=type_q)

        self.add_progress(1, review_day, reps=1)
        self.add_progress(3, review_day, reps=1)
        timeline_question = self.add_question(5, type_q="timeline")
        timeline_question.data = {
            "timeline": {
                "kind": "point",
                "start": {
                    "year": 2000,
                    "precision": "year"
                }
            }
        }
        self.db.commit()

        answer_map(
            MapAnswerRequest(
                items={1: 0, 2: 2},
                review_date=review_day
            ),
            db=self.db
        )
        answer_media(
            MediaAnswerRequest(
                items={3: 0, 4: 2},
                review_date=review_day
            ),
            db=self.db
        )
        answer_timeline(
            TimelineAnswerRequest(
                items={
                    5: TimelineAnswerItem(
                        start=TimelineDateValue(
                            year=2000,
                            precision="year"
                        )
                    )
                },
                review_date=review_day
            ),
            db=self.db
        )

        reviewed_on = {
            progress.question_id: progress.history[-1]["reviewed_on"]
            for progress in self.db.query(Progress).all()
        }

        self.assertEqual(reviewed_on, {
            1: review_day.isoformat(),
            2: review_day.isoformat(),
            3: review_day.isoformat(),
            4: review_day.isoformat(),
            5: review_day.isoformat()
        })

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
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)
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
        update_settings(ReviewSettings(catchup_daily_target=1), db=self.db)
        question = self.add_question(1, type_q="text")
        question.question = "Question"
        question.answer = "Answer"
        progress = self.add_progress(1, today)

        for question_id, type_q, next_review in [
            (101, "text", today + timedelta(days=1)),
            (102, "text", today + timedelta(days=2)),
            (103, "map", today + timedelta(days=3)),
            (104, "text", today + timedelta(days=2))
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

    def test_review_mixes_due_and_new_questions(self):
        # New questions no longer wait for an empty queue: intake tops the
        # session up alongside whatever is due.
        today = date.today()
        self.add_question(1)
        self.add_progress(1, today, reps=1)
        self.add_question(2)
        self.add_question(3)
        self.add_progress(3, today, reps=0)
        self.db.commit()

        response = get_review(db=self.db)

        self.assertEqual(
            sorted(item["question_id"] for item in response),
            [1, 2, 3]
        )

    def test_review_serves_new_questions_when_nothing_is_due(self):
        today = date.today()
        self.add_question(1)
        self.add_question(2)
        self.add_progress(2, today, reps=0)
        self.add_question(3)
        self.add_progress(3, today + timedelta(days=3), reps=1)
        self.db.commit()

        response = get_review(db=self.db)

        self.assertEqual(
            sorted(item["question_id"] for item in response),
            [1, 2]
        )

    def test_review_summary_counts_started_due_questions_only(self):
        today = date.today()
        self.add_question(1)
        self.add_progress(1, today, reps=1)
        self.add_question(2)
        self.add_progress(2, today + timedelta(days=1), reps=1)
        self.add_question(3)
        self.add_progress(3, today, reps=0)
        self.add_question(4)
        self.add_progress(4, today - timedelta(days=2), reps=1)
        self.db.commit()

        summary = get_summary(db=self.db)

        self.assertEqual(summary["due_count"], 2)
        self.assertTrue(summary["has_due"])
        # Question 3 is unstarted, so it is intake's to introduce, not due.
        self.assertEqual(summary["new_count"], 1)
        self.assertEqual(summary["session_count"], 3)

    def test_review_caps_new_questions_at_the_tier_ceiling(self):
        # Nothing scheduled, so the day fills up toward the target and stops at
        # régulier's ceiling of 10 new questions.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)

        for question_id in range(1, 31):
            self.add_question(question_id)

        self.db.commit()

        response = get_review(db=self.db)

        self.assertEqual(len(response), 10)
        self.assertEqual(
            sorted(item["question_id"] for item in response),
            list(range(1, 11))
        )

    def test_review_serves_a_small_pool_entirely(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)

        for question_id in range(1, 5):
            self.add_question(question_id)

        self.db.commit()

        response = get_review(db=self.db)

        self.assertEqual(
            sorted(item["question_id"] for item in response),
            [1, 2, 3, 4]
        )

    def test_failed_new_question_enters_the_normal_review(self):
        today = date.today()
        self.add_question(1)
        self.add_question(2)
        self.db.commit()

        failed_response = answer_question(
            AnswerRequest(question_id=1, quality=0),
            db=self.db
        )

        self.assertEqual(failed_response["reps"], 1)
        self.assertEqual(len(failed_response["history"]), 1)
        self.assertEqual(failed_response["history"][-1]["quality"], 0)

        progress = (
            self.db.query(Progress)
            .filter(Progress.question_id == 1)
            .first()
        )

        self.assertIsNotNone(progress)
        self.assertEqual(progress.reps, 1)
        self.assertEqual(progress.lapses, 1)
        self.assertEqual(progress.next_review, today)

        # The failed question is now due work and has left the new pool; the
        # session still carries it, alongside whatever intake introduces.
        due_response = get_review(db=self.db)
        self.assertIn(1, [item["question_id"] for item in due_response])
        self.assertNotIn(1, _new_question_ids(self.db))
        self.assertIn(2, _new_question_ids(self.db))

    def test_relearning_retries_are_shown_after_the_rest_of_the_queue(self):
        # Question 1's lower id would otherwise sort it first; failing it must
        # not let the same-day retry jump ahead of ordinary due work when the
        # session is resumed (get_review is a fresh fetch, same as reopening
        # the review after leaving it).
        today = date.today()
        self.add_question(1)
        self.add_progress(1, today, reps=1)
        self.add_question(2)
        self.add_progress(2, today, reps=1)
        self.db.commit()

        answer_question(AnswerRequest(question_id=1, quality=0), db=self.db)

        response = get_review(db=self.db)

        self.assertEqual([item["question_id"] for item in response], [2, 1])

    def test_failed_bonus_grouped_answers_enter_the_normal_review(self):
        today = date.today()

        for question_id, type_q in [
            (1, "map"),
            (2, "map"),
            (3, "media"),
            (4, "media")
        ]:
            self.add_question(question_id, type_q=type_q)

        self.db.commit()

        answer_map(
            MapAnswerRequest(items={1: 0, 2: 2}),
            db=self.db
        )
        answer_media(
            MediaAnswerRequest(items={3: 0, 4: 3}),
            db=self.db
        )

        progress_by_question_id = {
            progress.question_id: progress
            for progress in self.db.query(Progress).all()
        }

        self.assertEqual(progress_by_question_id[1].history[-1]["quality"], 0)
        self.assertEqual(progress_by_question_id[1].next_review, today)
        self.assertEqual(progress_by_question_id[3].history[-1]["quality"], 0)
        self.assertEqual(progress_by_question_id[3].next_review, today)
        self.assertEqual(progress_by_question_id[2].history[-1]["quality"], 2)
        self.assertEqual(progress_by_question_id[4].history[-1]["quality"], 3)

    def test_failed_bonus_timeline_answer_enters_the_normal_review(self):
        question = self.add_question(1, type_q="timeline")
        question.data = {
            "timeline": {
                "kind": "point",
                "start": {
                    "year": 2000,
                    "precision": "year"
                }
            }
        }
        self.db.commit()

        failed_response = answer_timeline(
            TimelineAnswerRequest(items={
                1: TimelineAnswerItem(
                    start=TimelineDateValue(
                        year=1900,
                        precision="year"
                    )
                )
            }),
            db=self.db
        )

        failed_result = failed_response["results"][0]
        self.assertEqual(failed_result["quality"], 0)
        self.assertEqual(failed_result["progress"]["reps"], 1)
        self.assertEqual(
            failed_result["progress"]["next_review"],
            date.today().isoformat()
        )

        progress = (
            self.db.query(Progress)
            .filter(Progress.question_id == 1)
            .first()
        )

        self.assertIsNotNone(progress)
        self.assertEqual(progress.reps, 1)
        self.assertEqual(progress.lapses, 1)
        self.assertEqual(progress.history[-1]["quality"], 0)
        self.assertEqual(progress.next_review, date.today())

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

    def test_rebalance_route_ignores_suspended_progress_rows(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=1), db=self.db)

        self.add_question(1, suspended=True)
        suspended_progress = self.add_progress(
            1,
            today - timedelta(days=3),
            reps=1
        )

        for question_id in range(2, 4):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=3), reps=1)

        self.db.commit()

        response = rebalance_review(db=self.db)
        scheduled = {
            progress.question_id: progress.next_review
            for progress in self.db.query(Progress).all()
        }

        self.assertEqual(response["total"], 2)
        self.assertEqual(scheduled[1], today - timedelta(days=3))
        self.assertEqual(scheduled[2], today)
        self.assertEqual(scheduled[3], today + timedelta(days=1))
        self.assertEqual(
            suspended_progress.next_review,
            today - timedelta(days=3)
        )

    def test_question_suspension_rebalances_calendar_after_flag_change(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=1), db=self.db)
        self.add_question(1)
        self.add_progress(
            1,
            today,
            reps=1,
            ideal_interval=0,
            ideal_next_review=today
        )
        self.add_question(2)
        delayed = self.add_progress(
            2,
            today + timedelta(days=1),
            reps=1,
            ideal_interval=0,
            ideal_next_review=today
        )
        self.db.commit()

        update_question_service(
            self.db,
            1,
            QuestionUpdate(suspended=True)
        )

        self.assertEqual(delayed.next_review, today)
        self.assertTrue(
            self.db.query(Question)
            .filter(Question.id == 1)
            .one()
            .suspended
        )

    def test_group_suspension_rebalances_calendar_after_bulk_update(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=1), db=self.db)
        group = self.add_group(20)
        self.add_question(1, group=group)
        self.add_progress(
            1,
            today,
            reps=1,
            ideal_interval=0,
            ideal_next_review=today
        )
        self.add_question(2)
        delayed = self.add_progress(
            2,
            today + timedelta(days=1),
            reps=1,
            ideal_interval=0,
            ideal_next_review=today
        )
        self.db.commit()

        response = suspend_group(
            group.id,
            GroupSuspend(suspended=True),
            db=self.db
        )

        self.assertEqual(response["updated_count"], 1)
        self.assertEqual(response["rebalance"]["total"], 1)
        self.assertEqual(delayed.next_review, today)
        self.assertTrue(
            self.db.query(Question)
            .filter(Question.id == 1)
            .one()
            .suspended
        )

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

    def test_rebalance_route_backfills_missing_ideal_anchor_once(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=1), db=self.db)

        self.add_question(1, type_q="media")
        first_progress = self.add_progress(
            1,
            today - timedelta(days=9),
            difficulty=8.0,
            reps=1,
            ideal_interval=0,
            ideal_next_review=today - timedelta(days=5)
        )
        first_progress.last_review = today - timedelta(days=8)

        self.add_question(2, type_q="media")
        missing_anchor = self.add_progress(
            2,
            today - timedelta(days=7),
            difficulty=9.0,
            reps=1
        )
        missing_anchor.last_review = today - timedelta(days=13)
        missing_anchor.interval = 6

        self.add_question(99)
        completed_today = self.add_progress(
            99,
            today + timedelta(days=10),
            reps=1,
            ideal_interval=10,
            ideal_next_review=today + timedelta(days=10)
        )
        completed_today.history = [{"reviewed_on": today.isoformat()}]

        self.db.commit()

        first_response = rebalance_review(db=self.db)
        first_schedule = {
            progress.question_id: (
                progress.next_review,
                progress.interval,
                progress.ideal_next_review,
                progress.ideal_interval
            )
            for progress in self.db.query(Progress).all()
        }
        second_response = rebalance_review(db=self.db)
        second_schedule = {
            progress.question_id: (
                progress.next_review,
                progress.interval,
                progress.ideal_next_review,
                progress.ideal_interval
            )
            for progress in self.db.query(Progress).all()
        }

        self.assertEqual(first_response["moved"], 2)
        self.assertEqual(second_response["moved"], 0)
        self.assertEqual(first_schedule, second_schedule)
        self.assertEqual(
            missing_anchor.ideal_next_review,
            today - timedelta(days=7)
        )
        self.assertEqual(missing_anchor.ideal_interval, 6)

    def test_rebalance_route_counts_reviews_already_completed_today(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=4), db=self.db)

        for question_id in range(1, 4):
            self.add_question(question_id)
            progress = self.add_progress(
                question_id,
                today + timedelta(days=10),
                reps=1,
                ideal_interval=10,
                ideal_next_review=today + timedelta(days=10)
            )
            progress.history = [
                {
                    "reviewed_on": today.isoformat(),
                    "quality": 2
                }
            ]

        for question_id in range(101, 106):
            self.add_question(question_id)
            self.add_progress(
                question_id,
                today + timedelta(days=6),
                reps=1,
                ideal_interval=0,
                ideal_next_review=today - timedelta(days=1)
            )

        self.db.commit()

        response = rebalance_review(db=self.db)
        scheduled_today = (
            self.db.query(Progress)
            .filter(Progress.next_review == today)
            .count()
        )

        self.assertEqual(response["daily_target"], 4)
        self.assertEqual(scheduled_today, 2)
        self.assertEqual(scheduled_today + 3, 5)

    def test_rebalance_route_prioritizes_earlier_ideal_dates(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=1), db=self.db)

        for question_id, ideal_next_review in [
            (1, today + timedelta(days=1)),
            (2, today - timedelta(days=2)),
            (3, today)
        ]:
            self.add_question(question_id)
            self.add_progress(
                question_id,
                today + timedelta(days=6),
                reps=1,
                ideal_interval=max(0, (ideal_next_review - today).days),
                ideal_next_review=ideal_next_review
            )

        self.db.commit()

        rebalance_review(db=self.db)
        scheduled = {
            progress.question_id: progress.next_review
            for progress in self.db.query(Progress).all()
        }

        self.assertEqual(scheduled[2], today)
        self.assertEqual(scheduled[3], today + timedelta(days=1))
        self.assertEqual(scheduled[1], today + timedelta(days=2))

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

        self.assertEqual(counts[today], {"map": 3, "text": 3})
        self.assertEqual(
            counts[today + timedelta(days=1)],
            {"map": 3, "text": 3}
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

    def test_review_route_returns_current_due_questions_without_cap(self):
        self.db.add(AppSetting(
            key=REVIEW_MAINTENANCE_KEY,
            value={"rebalanced_on": date.today().isoformat()}
        ))

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

    def test_review_route_rebalances_once_after_date_rollover(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)

        for question_id in range(1, 6):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        self.db.commit()

        response = get_review(db=self.db)
        overdue_count = (
            self.db.query(Progress)
            .filter(Progress.next_review == today - timedelta(days=1))
            .count()
        )
        today_count = (
            self.db.query(Progress)
            .filter(Progress.next_review == today)
            .count()
        )
        tomorrow_count = (
            self.db.query(Progress)
            .filter(Progress.next_review == today + timedelta(days=1))
            .count()
        )
        marker = (
            self.db.query(AppSetting)
            .filter(AppSetting.key == REVIEW_MAINTENANCE_KEY)
            .first()
        )

        self.assertEqual(len(response), 3)
        self.assertEqual(overdue_count, 0)
        self.assertEqual(today_count, 3)
        self.assertEqual(tomorrow_count, 2)
        self.assertEqual(marker.value["rebalanced_on"], today.isoformat())

    def test_review_route_does_not_rebalance_twice_on_the_same_day(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)
        self.db.add(AppSetting(
            key=REVIEW_MAINTENANCE_KEY,
            value={"rebalanced_on": today.isoformat()}
        ))

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

    def test_review_summary_rebalances_before_counting_due_cards(self):
        today = date.today()
        update_settings(ReviewSettings(catchup_daily_target=2), db=self.db)

        for question_id in range(1, 6):
            self.add_question(question_id)
            self.add_progress(question_id, today - timedelta(days=1), reps=1)

        self.db.commit()

        response = get_summary(db=self.db)

        self.assertEqual(response["due_count"], 3)
        self.assertEqual(response["session_count"], 3)

    def test_a_saturated_rebalance_is_visible_as_intake_pressure(self):
        # The intake tuner reads saturation off the calendar the smoother
        # produces, so the two subsystems have to agree. Without this the
        # pressure metric is only ever exercised against hand-built drift, and
        # a change to daily_load_score or choose_soft_rebalance_date that
        # stopped displacing cards would silently remove the tuner's down
        # signal instead of failing a test.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        today = date.today()

        for offset in range(120):
            question_id = 2000 + offset
            self.add_question(question_id)
            self.add_progress(
                question_id,
                today,
                reps=1,
                ideal_next_review=today
            )

        self.db.commit()

        cleared, _ = schedule_pressure(self.db, today)
        self.assertEqual(cleared, 0.0)

        run_startup_rebalance(self.db)
        self.db.commit()

        pressure, measured = schedule_pressure(self.db, today)

        self.assertEqual(measured, 120)
        self.assertGreaterEqual(pressure, PRESSURE_DOWN_MIN)


if __name__ == "__main__":
    unittest.main()
