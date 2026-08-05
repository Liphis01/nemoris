import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from fastapi import HTTPException

from app.models import AppSetting, Progress, Question, QuestionGroup, ReviewLog
from app.routers.groups import suspend_group
from app.routers.review import get_review, get_settings, update_settings
from app.schemas import GroupSuspend, ReviewSettings
from app.services.intake import (
    MIN_PRESSURE_CARDS,
    NEW_QUESTION_WEIGHT,
    PRESSURE_DOWN_MIN,
    PRESSURE_UP_MAX,
    PRESSURE_WINDOW_DAYS,
    due_question_count,
    UP_STREAK_REQUIRED,
    compute_intake_quota,
    count_in_flight,
    count_introduced_today,
    count_reviews_done_today,
    daily_ceiling_for,
    schedule_pressure,
    tune_intake_rate,
    wip_cap_for
)
from app.services.progress import (
    in_flight_progress_filter,
    progress_in_flight
)
from app.services.review import (
    _new_question_ids,
    defer_relearning_items,
    spread_new_items
)
from app.services.settings import (
    INTAKE_SETTINGS_KEY,
    load_intake_settings,
    resolve_pace_tier,
    sync_settings_payload
)
from app.services.stats import _is_mastered


class IntakeTestCase(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self):
        self.db.close()

    def add_question(self, question_id, group=None, suspended=False):
        question = Question(
            id=question_id,
            type_q="text",
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=[],
            data={},
            group=group,
            suspended=suspended
        )
        self.db.add(question)
        return question

    def add_progress(
        self,
        question_id,
        next_review=None,
        reps=1,
        interval=0,
        last_review=None,
        stability=1.0,
        ideal_next_review=None
    ):
        progress = Progress(
            question_id=question_id,
            stability=stability,
            difficulty=5.0,
            reps=reps,
            lapses=0,
            interval=interval,
            next_review=next_review,
            # Mirrors write_scheduling: a card the smoother never displaced
            # stores its ideal date equal to its actual one.
            ideal_next_review=ideal_next_review or next_review,
            last_review=last_review or date.today(),
            history=[]
        )
        self.db.add(progress)
        return progress

    def add_review_log(self, question_id, reviewed_on, seq=1, quality=2):
        entry = ReviewLog(
            question_id=question_id,
            seq=seq,
            reviewed_on=reviewed_on,
            quality=quality,
            data={}
        )
        self.db.add(entry)
        return entry


class IntakeQuotaTests(IntakeTestCase):
    def test_a_full_day_of_due_work_leaves_no_room(self):
        today = date.today()

        for question_id in range(1, 25):
            self.add_question(question_id)
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_rate=20)

        self.assertEqual(quota["due_count"], 24)
        self.assertEqual(quota["quota"], 0)

    def test_slack_is_charged_at_the_new_question_weight(self):
        today = date.today()

        for question_id in range(1, 11):
            self.add_question(question_id)
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_rate=20)

        # 20 - 10 due = 10 slack, and each new card costs 1.75 slots.
        self.assertEqual(quota["slack_allowance"], int(10 // NEW_QUESTION_WEIGHT))
        self.assertEqual(quota["quota"], 5)

    def test_idle_day_is_bound_by_the_ceiling_not_the_slack(self):
        for question_id in range(1, 200):
            self.add_question(question_id)

        self.db.commit()

        quota = compute_intake_quota(self.db, daily_rate=20)

        self.assertEqual(quota["due_count"], 0)
        self.assertEqual(quota["ceiling"], 7)
        self.assertLess(quota["ceiling"], quota["slack_allowance"])
        self.assertEqual(quota["quota"], 7)

    def test_ceilings_scale_with_the_tier_and_stop_at_the_absolute_cap(self):
        self.assertEqual(daily_ceiling_for(10), 4)
        self.assertEqual(daily_ceiling_for(20), 7)
        self.assertEqual(daily_ceiling_for(40), 14)
        # ceil(80 * 0.35) = 28, clamped by the absolute backstop.
        self.assertEqual(daily_ceiling_for(80), 20)

    def test_questions_already_introduced_today_consume_the_ceiling(self):
        today = date.today()

        for question_id in range(1, 30):
            self.add_question(question_id)

        for question_id in range(1, 8):
            self.add_progress(question_id, next_review=today + timedelta(days=1))
            self.add_review_log(question_id, today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_rate=20)

        self.assertEqual(quota["introduced_today"], 7)
        self.assertEqual(quota["ceiling_remaining"], 0)
        self.assertEqual(quota["quota"], 0)

    def test_finished_session_does_not_hand_out_a_second_batch(self):
        # The regression that matters most: reopening the review screen after
        # clearing the day's work must not introduce another round.
        today = date.today()

        for question_id in range(1, 40):
            self.add_question(question_id)

        # 5 ordinary reviews done today.
        for question_id in range(1, 6):
            self.add_progress(
                question_id,
                next_review=today + timedelta(days=4),
                reps=3
            )
            self.add_review_log(question_id, today - timedelta(days=4), seq=1)
            self.add_review_log(question_id, today, seq=2)

        # 7 questions introduced today, all answered.
        for question_id in range(10, 17):
            self.add_progress(question_id, next_review=today + timedelta(days=1))
            self.add_review_log(question_id, today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_rate=20)

        self.assertEqual(quota["reviews_done_today"], 12)
        self.assertEqual(quota["introduced_today"], 7)
        self.assertEqual(quota["weighted_load"], 5 + 0 + NEW_QUESTION_WEIGHT * 7)
        self.assertEqual(quota["quota"], 0)

    def test_same_day_retries_count_as_one_review(self):
        today = date.today()
        self.add_question(1)
        self.add_progress(1, next_review=today + timedelta(days=1))
        self.add_review_log(1, today, seq=1, quality=0)
        self.add_review_log(1, today, seq=2, quality=2)
        self.db.commit()

        self.assertEqual(count_reviews_done_today(self.db, today), 1)

    def test_a_question_first_seen_yesterday_is_not_introduced_today(self):
        today = date.today()
        self.add_question(1)
        self.add_progress(1, next_review=today + timedelta(days=1))
        self.add_review_log(1, today - timedelta(days=1), seq=1)
        self.add_review_log(1, today, seq=2)
        self.db.commit()

        self.assertEqual(count_reviews_done_today(self.db, today), 1)
        self.assertEqual(count_introduced_today(self.db, today), 0)


class IntakeWipTests(IntakeTestCase):
    def _fill_in_flight(self, count, start=1000):
        today = date.today()

        for offset in range(count):
            question_id = start + offset
            self.add_question(question_id)
            self.add_progress(
                question_id,
                next_review=today + timedelta(days=2),
                reps=1,
                stability=2.0
            )

    def test_a_full_pipeline_blocks_intake_entirely(self):
        for question_id in range(1, 40):
            self.add_question(question_id)

        self._fill_in_flight(wip_cap_for(10))
        self.db.commit()

        quota = compute_intake_quota(self.db, daily_rate=10)

        self.assertGreaterEqual(quota["wip_count"], quota["wip_cap"])
        self.assertEqual(quota["wip_factor"], 0.0)
        self.assertEqual(quota["quota"], 0)

    def test_the_taper_band_shrinks_intake_progressively(self):
        for question_id in range(1, 40):
            self.add_question(question_id)

        cap = wip_cap_for(40)
        self._fill_in_flight(int(cap * 0.9))
        self.db.commit()

        quota = compute_intake_quota(self.db, daily_rate=40)

        self.assertGreater(quota["wip_factor"], 0.0)
        self.assertLess(quota["wip_factor"], 1.0)
        self.assertLess(quota["quota"], quota["ceiling"])

    def test_python_and_sql_in_flight_predicates_agree(self):
        cases = [
            (0.0, 0),
            (5.0, 1),
            (21.0, 1),
            (20.0, 2),
            (21.0, 2),
            (60.0, 3)
        ]

        for index, (stability, reps) in enumerate(cases, start=1):
            self.add_question(index)
            self.add_progress(
                index,
                next_review=date.today(),
                reps=reps,
                stability=stability,
                last_review=date.today() if reps else None
            )

        self.db.commit()

        sql_ids = {
            row.question_id
            for row in (
                self.db.query(Progress)
                .filter(in_flight_progress_filter())
                .all()
            )
        }
        python_ids = {
            progress.question_id
            for progress in self.db.query(Progress).all()
            if progress_in_flight(progress)
        }

        self.assertEqual(sql_ids, python_ids)
        # (21, 2) and (60, 3) are settled; everything else is still carried.
        self.assertEqual(sql_ids, {1, 2, 3, 4})
        self.assertEqual(count_in_flight(self.db), 4)

    def test_calendar_smoothing_cannot_move_a_card_across_the_threshold(self):
        # The point of keying off stability: `interval` is the smoothed value,
        # shifted by up to +/-3 days to level daily calendar load. Two equally
        # retained cards must land on the same side of the bar even when
        # smoothing moved their intervals in opposite directions.
        for index, interval in enumerate((18, 24), start=1):
            self.add_question(index)
            self.add_progress(
                index,
                next_review=date.today(),
                reps=2,
                interval=interval,
                stability=21.0
            )

        self.db.commit()

        settled = [
            not progress_in_flight(progress)
            for progress in self.db.query(Progress).order_by(Progress.question_id)
        ]

        self.assertEqual(settled, [True, True])
        self.assertEqual(count_in_flight(self.db), 0)

    def test_released_from_the_pipeline_is_not_the_same_as_mastered(self):
        # A card at 21 days of stability / 2 reps frees an intake slot but must
        # not be reported as mastered in the stats screen, which keeps its 60/3
        # bar.
        self.add_question(1)
        progress = self.add_progress(
            1,
            next_review=date.today(),
            reps=2,
            stability=21.0
        )
        self.db.commit()

        self.assertFalse(progress_in_flight(progress))
        self.assertFalse(_is_mastered(progress))


class IntakeTuningTests(IntakeTestCase):
    def seed_reviews(
        self,
        count,
        quality,
        days_back=10,
        drift=0.0,
        scheduled=None
    ):
        """Seed a review history and the scheduled calendar that goes with it.

        A pressure-derived signal needs a calendar to read, so every seeded
        question also gets a Progress row. ``drift`` is the share of them the
        load smoother is pretended to have pushed past their ideal date;
        ``scheduled`` caps how many get a Progress row at all, for exercising
        the thin-population branch.
        """
        today = date.today()
        scheduled = count if scheduled is None else scheduled
        displaced = int(round(scheduled * drift))

        for index in range(count):
            question_id = 500 + index
            self.add_question(question_id)
            reviewed_on = today - timedelta(days=index % days_back)
            self.add_review_log(question_id, reviewed_on, quality=quality)

            if index >= scheduled:
                continue

            ideal = today + timedelta(days=index % PRESSURE_WINDOW_DAYS)
            self.add_progress(
                question_id,
                next_review=ideal + timedelta(days=3 if index < displaced else 0),
                last_review=reviewed_on,
                ideal_next_review=ideal
            )

    def test_low_retention_walks_the_rate_down_to_the_floor(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=0)
        self.db.commit()

        today = date.today()
        rates = []

        for offset in range(8):
            tuned = tune_intake_rate(self.db, today=today + timedelta(days=offset))
            rates.append(tuned["effective_daily_target"])

        self.assertLess(rates[0], 20)
        # Floor is half the tier seed and the walk stops there.
        self.assertEqual(min(rates), 10)
        self.assertEqual(rates[-1], 10)

    def test_strong_retention_needs_a_streak_before_raising_the_rate(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1)
        self.db.commit()

        today = date.today()
        rates = []

        for offset in range(UP_STREAK_REQUIRED):
            tuned = tune_intake_rate(self.db, today=today + timedelta(days=offset))
            rates.append(tuned["effective_daily_target"])

        self.assertEqual(rates[0], 20)
        self.assertEqual(rates[1], 20)
        self.assertEqual(rates[2], 22)

    def test_a_thin_window_holds_the_rate(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(10, quality=0)
        self.db.commit()

        today = date.today()
        tuned = tune_intake_rate(self.db, today=today)

        self.assertEqual(tuned["effective_daily_target"], 20)
        self.assertEqual(tuned["tuned_on"], today.isoformat())

    def test_the_day_guard_makes_the_second_call_a_no_op(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=0)
        self.db.commit()

        today = date.today()
        first = tune_intake_rate(self.db, today=today)
        second = tune_intake_rate(self.db, today=today)

        self.assertTrue(first["changed"])
        self.assertFalse(second["changed"])
        self.assertEqual(
            first["effective_daily_target"],
            second["effective_daily_target"]
        )

    def test_choosing_a_tier_resets_the_tuner(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=0)
        self.db.commit()

        tune_intake_rate(self.db, today=date.today())
        self.assertLess(
            load_intake_settings(self.db, 20)["effective_daily_target"],
            20
        )

        update_settings(ReviewSettings(pace_tier="soutenu"), db=self.db)
        state = load_intake_settings(self.db, 40)

        self.assertEqual(state["effective_daily_target"], 40)
        self.assertEqual(state["up_streak"], 0)
        self.assertIsNone(state["tuned_on"])

    def test_a_saturated_calendar_walks_the_rate_down_despite_perfect_retention(self):
        # The regression test for the whole bug class: answering everything
        # correctly must no longer buy an increase on a jammed calendar.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, drift=0.30)
        self.db.commit()

        tuned = tune_intake_rate(self.db, today=date.today())

        self.assertEqual(tuned["last_retention"], 100.0)
        self.assertEqual(tuned["last_schedule_pressure"], 0.30)
        self.assertEqual(tuned["effective_daily_target"], 18)

    def test_a_clear_calendar_and_strong_retention_earn_a_raise(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, drift=0.0)
        self.db.commit()

        today = date.today()
        rates = [
            tune_intake_rate(self.db, today=today + timedelta(days=offset))[
                "effective_daily_target"
            ]
            for offset in range(UP_STREAK_REQUIRED)
        ]

        self.assertEqual(rates, [20, 20, 22])

    def test_a_calendar_with_no_scheduled_cards_holds_the_rate(self):
        # An empty population means "no data", never "clear": a user with
        # nothing scheduled must not be handed an increase.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, scheduled=0)
        self.db.commit()

        today = date.today()
        rates = [
            tune_intake_rate(self.db, today=today + timedelta(days=offset))[
                "effective_daily_target"
            ]
            for offset in range(UP_STREAK_REQUIRED + 1)
        ]

        self.assertEqual(set(rates), {20})

    def test_a_population_below_the_measurement_floor_holds_the_rate(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(
            120,
            quality=3,
            days_back=1,
            scheduled=MIN_PRESSURE_CARDS - 1
        )
        self.db.commit()

        today = date.today()
        rates = [
            tune_intake_rate(self.db, today=today + timedelta(days=offset))[
                "effective_daily_target"
            ]
            for offset in range(UP_STREAK_REQUIRED + 1)
        ]

        self.assertEqual(set(rates), {20})

    def test_the_pressure_dead_zone_holds_the_rate(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, drift=0.10)
        self.db.commit()

        today = date.today()
        rates = [
            tune_intake_rate(self.db, today=today + timedelta(days=offset))[
                "effective_daily_target"
            ]
            for offset in range(UP_STREAK_REQUIRED + 1)
        ]

        self.assertEqual(set(rates), {20})

    def test_a_backlog_pulled_forward_reads_as_pressure(self):
        # The shape rebalance_review_calendar produces when a user falls behind:
        # an overdue card is pulled to max(today, ideal), so it sits later than
        # its ideal date. This is what replaces the old completion ratio.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, scheduled=0)
        today = date.today()

        for index in range(120):
            if index < 60:
                self.add_progress(
                    500 + index,
                    next_review=today,
                    ideal_next_review=today - timedelta(days=5)
                )
            else:
                ideal = today + timedelta(days=index % PRESSURE_WINDOW_DAYS)
                self.add_progress(
                    500 + index,
                    next_review=ideal,
                    ideal_next_review=ideal
                )

        self.db.commit()
        tuned = tune_intake_rate(self.db, today=today)

        self.assertEqual(tuned["last_retention"], 100.0)
        self.assertEqual(tuned["last_schedule_pressure"], 0.5)
        self.assertEqual(tuned["effective_daily_target"], 18)

    def test_cards_beyond_the_pressure_window_are_not_measured(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, scheduled=0)
        today = date.today()
        far = today + timedelta(days=PRESSURE_WINDOW_DAYS + 5)

        for index in range(120):
            if index < 80:
                self.add_progress(
                    500 + index,
                    next_review=far + timedelta(days=3),
                    ideal_next_review=far
                )
            else:
                ideal = today + timedelta(days=index % PRESSURE_WINDOW_DAYS)
                self.add_progress(
                    500 + index,
                    next_review=ideal,
                    ideal_next_review=ideal
                )

        self.db.commit()
        pressure, measured = schedule_pressure(self.db, today)

        self.assertEqual(measured, 40)
        self.assertEqual(pressure, 0.0)

    def test_suspended_and_unstarted_cards_do_not_create_pressure(self):
        today = date.today()

        for index in range(40):
            self.add_question(700 + index)
            ideal = today + timedelta(days=index % PRESSURE_WINDOW_DAYS)
            self.add_progress(
                700 + index,
                next_review=ideal,
                ideal_next_review=ideal
            )

        for index in range(60):
            question_id = 800 + index
            self.add_question(question_id, suspended=index % 2 == 0)
            drifted = today + timedelta(days=index % PRESSURE_WINDOW_DAYS)

            if index % 2 == 0:
                self.add_progress(
                    question_id,
                    next_review=drifted + timedelta(days=4),
                    ideal_next_review=drifted
                )
            else:
                # Never answered: no reps and no last_review at all.
                self.db.add(
                    Progress(
                        question_id=question_id,
                        stability=0.0,
                        difficulty=5.0,
                        reps=0,
                        lapses=0,
                        interval=0,
                        next_review=drifted + timedelta(days=4),
                        ideal_next_review=drifted,
                        last_review=None,
                        history=[]
                    )
                )

        self.db.commit()
        pressure, measured = schedule_pressure(self.db, today)

        self.assertEqual(measured, 40)
        self.assertEqual(pressure, 0.0)


class SchedulePressureTests(IntakeTestCase):
    def build_calendar(self, count, displaced):
        today = date.today()

        for index in range(count):
            self.add_question(900 + index)
            ideal = today + timedelta(days=index % PRESSURE_WINDOW_DAYS)
            self.add_progress(
                900 + index,
                next_review=ideal + timedelta(days=2 if index < displaced else 0),
                ideal_next_review=ideal
            )

        self.db.commit()

    def test_an_empty_calendar_is_not_measurable(self):
        self.assertEqual(schedule_pressure(self.db, date.today()), (None, 0))

    def test_a_population_below_the_floor_is_not_measurable(self):
        self.build_calendar(MIN_PRESSURE_CARDS - 1, displaced=0)
        pressure, measured = schedule_pressure(self.db, date.today())

        self.assertIsNone(pressure)
        self.assertEqual(measured, MIN_PRESSURE_CARDS - 1)

    def test_the_ratio_is_displaced_over_measured(self):
        self.build_calendar(40, displaced=10)
        pressure, measured = schedule_pressure(self.db, date.today())

        self.assertEqual(measured, 40)
        self.assertEqual(pressure, 0.25)

    def test_a_fully_clear_calendar_reads_zero_not_none(self):
        self.build_calendar(MIN_PRESSURE_CARDS, displaced=0)
        pressure, _ = schedule_pressure(self.db, date.today())

        self.assertEqual(pressure, 0.0)
        self.assertLessEqual(pressure, PRESSURE_UP_MAX)

    def test_a_jammed_calendar_clears_the_down_threshold(self):
        self.build_calendar(40, displaced=20)
        pressure, _ = schedule_pressure(self.db, date.today())

        self.assertGreaterEqual(pressure, PRESSURE_DOWN_MIN)


class IntakeSettingsTests(IntakeTestCase):
    def test_a_tier_sets_the_daily_target(self):
        settings = update_settings(
            ReviewSettings(pace_tier="soutenu"),
            db=self.db
        )

        self.assertEqual(settings["catchup_daily_target"], 40)
        self.assertEqual(settings["pace_tier"], "soutenu")

    def test_a_raw_target_clears_the_tier_and_is_preserved(self):
        update_settings(ReviewSettings(pace_tier="soutenu"), db=self.db)
        settings = update_settings(
            ReviewSettings(catchup_daily_target=33),
            db=self.db
        )

        self.assertEqual(settings["catchup_daily_target"], 33)
        self.assertIsNone(settings["pace_tier"])

    def test_a_legacy_target_keeps_working_and_resolves_a_tier(self):
        # The pre-tier default: the number is left alone so the user's review
        # calendar is not reshuffled, but the picker still highlights a chip.
        settings = get_settings(db=self.db)

        self.assertEqual(settings["catchup_daily_target"], 50)
        self.assertIsNone(settings["pace_tier"])
        self.assertEqual(resolve_pace_tier(50, None), "soutenu")
        self.assertEqual(
            compute_intake_quota(self.db, daily_rate=50)["ceiling"],
            18
        )

    def test_the_tuned_rate_never_syncs(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        tune_intake_rate(self.db, today=date.today())
        self.db.commit()

        self.assertIsNotNone(
            self.db.query(AppSetting)
            .filter(AppSetting.key == INTAKE_SETTINGS_KEY)
            .first()
        )
        self.assertNotIn(INTAKE_SETTINGS_KEY, sync_settings_payload(self.db))


class SuspendedQuestionTests(IntakeTestCase):
    def test_suspended_questions_never_enter_the_intake_pool(self):
        self.add_question(1, suspended=True)
        self.add_question(2)
        self.add_question(3, suspended=True)
        self.add_question(4)
        self.db.commit()

        self.assertEqual(_new_question_ids(self.db), [2, 4])

    def test_suspending_a_started_question_pulls_it_out_of_due_work(self):
        # Suspension means "out of reviews", not merely "no longer introduced":
        # a card already in rotation stops coming up.
        today = date.today()
        question = self.add_question(1)
        self.add_progress(1, next_review=today, reps=3)
        self.db.commit()

        self.assertEqual(due_question_count(self.db, today), 1)

        question.suspended = True
        self.db.commit()

        self.assertEqual(due_question_count(self.db, today), 0)
        self.assertEqual(get_review(db=self.db), [])

    def test_suspended_questions_do_not_occupy_the_pipeline(self):
        # A set-aside card is not work the user is carrying, so it must not eat
        # into the WIP budget either.
        today = date.today()
        question = self.add_question(1)
        self.add_progress(1, next_review=today, reps=1, stability=2.0)
        self.db.commit()

        self.assertEqual(count_in_flight(self.db), 1)

        question.suspended = True
        self.db.commit()

        self.assertEqual(count_in_flight(self.db), 0)

    def test_unsuspending_restores_the_question_untouched(self):
        today = date.today()
        question = self.add_question(1, suspended=True)
        self.add_progress(1, next_review=today, reps=3, stability=5.0)
        self.db.commit()

        self.assertEqual(due_question_count(self.db, today), 0)

        question.suspended = False
        self.db.commit()

        # Progress was never altered, so the card resumes exactly where it was.
        progress = self.db.query(Progress).filter(
            Progress.question_id == 1
        ).one()

        self.assertEqual(due_question_count(self.db, today), 1)
        self.assertEqual(progress.reps, 3)
        self.assertEqual(progress.stability, 5.0)

    def test_a_fully_suspended_library_yields_an_empty_session(self):
        for question_id in range(1, 20):
            self.add_question(question_id, suspended=True)

        self.db.commit()

        quota = compute_intake_quota(self.db, daily_rate=20)

        self.assertEqual(get_review(db=self.db), [])
        # The allowance still exists; there is simply nothing eligible to fill it.
        self.assertEqual(quota["quota"], 7)
        self.assertEqual(_new_question_ids(self.db), [])


class GroupSuspensionTests(IntakeTestCase):
    def add_group(self, group_id, name="Group"):
        group = QuestionGroup(
            id=group_id,
            type_group="text",
            name=name,
            media=None,
            data={}
        )
        self.db.add(group)
        return group

    def test_suspending_a_group_takes_every_question_out_at_once(self):
        group = self.add_group(1)

        for question_id in range(1, 6):
            self.add_question(question_id, group=group)

        self.add_question(99)
        self.db.commit()

        response = suspend_group(1, GroupSuspend(suspended=True), db=self.db)

        self.assertEqual(response["updated_count"], 5)
        self.assertTrue(response["suspended"])
        # Only the group's questions moved; the loose one is untouched.
        self.assertEqual(_new_question_ids(self.db), [99])

    def test_resuming_a_group_brings_every_question_back(self):
        group = self.add_group(1)

        for question_id in range(1, 6):
            self.add_question(question_id, group=group, suspended=True)

        self.db.commit()
        self.assertEqual(_new_question_ids(self.db), [])

        suspend_group(1, GroupSuspend(suspended=False), db=self.db)

        self.assertEqual(_new_question_ids(self.db), [1, 2, 3, 4, 5])

    def test_suspending_a_group_covers_partly_suspended_members(self):
        # The header offers "suspend all" for a mixed group, so the bulk update
        # has to be idempotent over questions that are already suspended.
        group = self.add_group(1)
        self.add_question(1, group=group, suspended=True)
        self.add_question(2, group=group)
        self.add_question(3, group=group)
        self.db.commit()

        suspend_group(1, GroupSuspend(suspended=True), db=self.db)

        self.assertEqual(_new_question_ids(self.db), [])

    def test_suspending_an_unknown_group_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            suspend_group(404, GroupSuspend(suspended=True), db=self.db)

        self.assertEqual(caught.exception.status_code, 404)


class IntakeSessionTests(IntakeTestCase):
    def test_the_pool_is_global_and_ordered_by_creation(self):
        for question_id in (9, 3, 5):
            self.add_question(question_id)

        self.db.commit()

        self.assertEqual(_new_question_ids(self.db, limit=2), [3, 5])

    def test_review_writes_the_intake_row_once_a_day(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)

        for question_id in range(1, 10):
            self.add_question(question_id)

        self.db.commit()

        get_review(db=self.db)
        get_review(db=self.db)

        self.assertFalse(self.db.new)
        self.assertFalse(self.db.dirty)
        self.assertEqual(
            self.db.query(AppSetting)
            .filter(AppSetting.key == INTAKE_SETTINGS_KEY)
            .count(),
            1
        )

    def test_review_introduces_no_progress_rows_by_itself(self):
        # Serving a new question is a pure read: its progress row is only
        # created when the user actually answers it.
        for question_id in range(1, 10):
            self.add_question(question_id)

        self.db.commit()

        response = get_review(db=self.db)

        self.assertTrue(response)
        self.assertEqual(self.db.query(Progress).count(), 0)

    def test_new_items_are_spread_through_the_session(self):
        items = [{"question_id": index} for index in range(1, 7)]
        items += [{"question_id": 90}, {"question_id": 91}]

        spread = spread_new_items(items, {90, 91})
        positions = [
            index
            for index, item in enumerate(spread)
            if item["question_id"] in (90, 91)
        ]

        self.assertEqual(len(spread), len(items))
        self.assertEqual(
            sorted(item["question_id"] for item in spread),
            sorted(item["question_id"] for item in items)
        )
        # Interior placement: neither new card is parked at the tail.
        self.assertTrue(all(position < len(spread) - 1 for position in positions))

    def test_relearning_items_are_deferred_to_the_end(self):
        items = [
            {"question_id": 1, "progress": {"relearning": True}},
            {"question_id": 2, "progress": {"relearning": False}},
            {"question_id": 3, "progress": {"relearning": True}},
            {"question_id": 4, "progress": {"relearning": False}}
        ]

        deferred = defer_relearning_items(items)

        self.assertEqual(
            [item["question_id"] for item in deferred],
            [2, 4, 1, 3]
        )

    def test_relearning_group_items_are_deferred_to_the_end(self):
        # A group is relearning if any of its items is, mirroring
        # isRelearningQuestion() on the frontend.
        items = [
            {
                "question_id": None,
                "items": [{"progress": {"relearning": True}}]
            },
            {"question_id": 2, "progress": {"relearning": False}}
        ]

        deferred = defer_relearning_items(items)

        self.assertEqual(
            [item["question_id"] for item in deferred],
            [2, None]
        )


if __name__ == "__main__":
    unittest.main()
