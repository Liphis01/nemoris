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
    PRESSURE_DOWN_MIN,
    PRESSURE_UP_MAX,
    PRESSURE_WINDOW_DAYS,
    due_question_count,
    compute_intake_quota,
    count_in_flight,
    count_introduced_today,
    count_reviews_done_today,
    NEW_QUESTION_WEIGHT,
    count_introduced_on,
    fill_to_target_budget,
    intake_runway_days,
    recent_intake_per_day,
    schedule_pressure,
    unstarted_question_count,
    tune_intake_rate,
    wip_cap_for
)
from app.services.intake_queue import (
    get_intake_queue,
    set_intake_order,
    set_intake_suspension
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

    def add_question(
        self,
        question_id,
        group=None,
        suspended=False,
        intake_order=None
    ):
        question = Question(
            id=question_id,
            type_q="text",
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=[],
            data={},
            group=group,
            suspended=suspended,
            intake_order=intake_order
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
    def test_a_full_day_of_due_work_still_funds_new_questions(self):
        # Previously a day merely at its target blocked intake entirely. New
        # questions now have their own budget, and only a genuinely overloaded
        # day (past the saturation breaker) stops them.
        today = date.today()

        for question_id in range(1, 25):
            self.add_question(question_id)
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_target=20)

        self.assertEqual(quota["due_count"], 24)
        self.assertLess(quota["saturation"], 1.5)
        self.assertEqual(quota["quota"], quota["new_budget"])

    def test_new_intake_does_not_compete_with_review_slack(self):
        # The regression that motivates the whole decoupling: a day already
        # carrying reviews must still fund its full new-question budget.
        today = date.today()

        for question_id in range(1, 11):
            self.add_question(question_id)
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_target=20)

        self.assertEqual(quota["due_count"], 10)
        self.assertEqual(quota["quota"], quota["new_budget"])

    def test_idle_day_is_bound_by_the_new_budget(self):
        for question_id in range(1, 200):
            self.add_question(question_id)

        self.db.commit()

        quota = compute_intake_quota(self.db, daily_target=20)

        self.assertEqual(quota["due_count"], 0)
        self.assertEqual(quota["new_budget"], 10)
        self.assertEqual(quota["quota"], 10)

    def test_new_intake_survives_a_full_day_of_reviews(self):
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        # 60 due against a rate of 20: three times the target, which under the
        # old slack arithmetic left nothing at all for new questions.
        for question_id in range(1, 61):
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_target=20)

        self.assertEqual(quota["due_count"], 60)
        self.assertEqual(quota["quota"], 0)  # breaker: 60/20 = 3.0 >= 1.5

    def test_the_fill_shrinks_as_the_schedule_fills_the_day(self):
        # Scheduled questions come first: the busier the day already is, the
        # less room is left to top up -- down to the floor, never below it.
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        self.db.commit()
        quotas = []

        for due in (0, 7, 14, 21):
            for question_id in range(1, due + 1):
                progress = (
                    self.db.query(Progress)
                    .filter(Progress.question_id == question_id)
                    .first()
                )

                if not progress:
                    self.add_progress(question_id, next_review=today)

            self.db.commit()
            quota = compute_intake_quota(
                self.db,
                today=today,
                daily_target=20,
                pace_tier="regulier"
            )
            quotas.append(quota["quota"])

        # The whole curve is pinned, not just its ends: asserting monotonicity
        # alone let the middle move silently when the weight was introduced.
        self.assertEqual(quotas, [10, 7, 3, 2])

    def test_new_intake_stops_at_the_saturation_breaker(self):
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        for question_id in range(1, 30):
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        # 29 due against a rate of 20 is 1.45x: just under the stop.
        just_under = compute_intake_quota(self.db, today=today, daily_target=20)
        self.assertLess(just_under["saturation"], 1.5)
        self.assertEqual(just_under["quota"], just_under["new_budget"])

        self.add_question(500)
        self.add_progress(500, next_review=today)
        self.db.commit()

        over = compute_intake_quota(self.db, today=today, daily_target=20)
        self.assertGreaterEqual(over["saturation"], 1.5)
        self.assertEqual(over["quota"], 0)
        # Saturation is measured against the tier seed, so the breaker fires on
        # the same load no matter what the tuner currently thinks.
        self.assertEqual(over["daily_target"], 20)

    def test_the_budget_fills_the_day_up_toward_the_target(self):
        # A quiet day is topped up to the tier's ceiling; a day already at its
        # target still brings the floor's worth of new material.
        # New questions are priced at NEW_QUESTION_WEIGHT reviews each, so the
        # target is filled in review-equivalents rather than in items.
        self.assertEqual(fill_to_target_budget(80, 0, 5, 40), 40)
        self.assertEqual(
            fill_to_target_budget(80, 50, 5, 40, weight=NEW_QUESTION_WEIGHT),
            17
        )
        self.assertEqual(fill_to_target_budget(80, 80, 5, 40), 5)
        # Past the target the floor still holds: the total goes ABOVE the tier,
        # because the tier says how much the user wants, not how little.
        self.assertEqual(fill_to_target_budget(80, 120, 5, 40), 5)

    def test_a_new_question_costs_more_than_a_review(self):
        # 44 reviews owed, so the day has 36 review-equivalents of room left;
        # at 1.75 each that buys 20 new questions, landing back on the target.
        budget = fill_to_target_budget(80, 44, 5, 40)

        self.assertEqual(budget, 20)
        self.assertAlmostEqual(44 + budget * NEW_QUESTION_WEIGHT, 80, delta=1)

    def test_scheduled_questions_are_counted_first(self):
        # Priority to the schedule: reviews consume the day, new questions take
        # only what is left.
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        for question_id in range(1, 61):
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        quota = compute_intake_quota(
            self.db,
            today=today,
            daily_target=80,
            pace_tier="intensif"
        )

        self.assertEqual(quota["due_count"], 60)
        # 80 - 60 = 20 review-equivalents of room, at 1.75 each.
        self.assertEqual(quota["quota"], 11)

    def test_the_floor_survives_the_tuner(self):
        # The ratio scales the headroom above the floor, never the floor: a
        # tuned-down user must still get the tier's guaranteed minimum.
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        for question_id in range(1, 80):
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        quota = compute_intake_quota(
            self.db,
            today=today,
            daily_target=80,
            rate_ratio=0.75,
            pace_tier="intensif"
        )

        self.assertEqual(quota["new_min"], 5)
        self.assertEqual(quota["quota"], 5)

    def test_the_tuner_scales_the_headroom_bidirectionally(self):
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        for question_id in range(1, 41):
            self.add_progress(question_id, next_review=today)

        self.db.commit()
        budgets = {}

        for ratio in (0.75, 1.0, 1.25):
            budgets[ratio] = compute_intake_quota(
                self.db,
                today=today,
                daily_target=80,
                rate_ratio=ratio,
                pace_tier="intensif"
            )["quota"]

        self.assertLess(budgets[0.75], budgets[1.0])
        self.assertLess(budgets[1.0], budgets[1.25])

    def test_the_ceiling_still_caps_a_generous_tuner(self):
        for question_id in range(1, 200):
            self.add_question(question_id)

        self.db.commit()

        quota = compute_intake_quota(
            self.db,
            daily_target=80,
            rate_ratio=1.25,
            pace_tier="intensif"
        )

        self.assertEqual(quota["quota"], quota["new_max"])

    def test_the_budget_cannot_grow_more_than_a_quarter_in_a_day(self):
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        # 8 questions first seen yesterday, nothing scheduled today.
        for question_id in range(1, 9):
            self.add_review_log(question_id, today - timedelta(days=1))

        self.db.commit()

        quota = compute_intake_quota(
            self.db,
            today=today,
            daily_target=80,
            rate_ratio=1.0,
            pace_tier="intensif"
        )

        self.assertEqual(quota["introduced_yesterday"], 8)
        self.assertEqual(quota["ramp_ceiling"], 10)
        self.assertEqual(quota["quota"], 10)

    def test_a_skipped_day_does_not_pin_the_budget(self):
        # A zero yesterday is absence of data, not a measurement of zero. The
        # reason is asserted, not just the number, so the escape hatch itself
        # is pinned.
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        for question_id in range(1, 9):
            self.add_review_log(question_id, today - timedelta(days=4))

        self.db.commit()

        quota = compute_intake_quota(
            self.db,
            today=today,
            daily_target=80,
            rate_ratio=1.0,
            pace_tier="intensif"
        )

        self.assertEqual(quota["introduced_yesterday"], 0)
        self.assertIsNone(quota["ramp_ceiling"])
        self.assertEqual(quota["quota"], 40)

    def test_a_brand_new_install_gets_the_full_tier_on_day_one(self):
        for question_id in range(1, 200):
            self.add_question(question_id)

        self.db.commit()

        quota = compute_intake_quota(
            self.db,
            daily_target=80,
            rate_ratio=1.0,
            pace_tier="intensif"
        )

        self.assertIsNone(quota["ramp_ceiling"])
        self.assertEqual(quota["quota"], 40)

    def test_damping_never_cuts_below_the_tier_floor(self):
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        self.add_review_log(1, today - timedelta(days=1))
        self.db.commit()

        quota = compute_intake_quota(
            self.db,
            today=today,
            daily_target=80,
            rate_ratio=1.0,
            pace_tier="intensif"
        )

        # 1 * 1.25 rounds to 2, but the tier floor outranks the ramp.
        self.assertEqual(quota["introduced_yesterday"], 1)
        self.assertEqual(quota["quota"], 5)

    def test_a_damped_budget_is_not_reinflated_on_reload(self):
        # Damping applies to the day's total allowance and the already-served
        # part is subtracted afterwards, so reloading redistributes what is
        # left rather than starting the ramp again.
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        for question_id in range(1, 21):
            self.add_review_log(question_id, today - timedelta(days=1))

        for question_id in range(100, 112):
            self.add_review_log(question_id, today)

        self.db.commit()

        first = compute_intake_quota(
            self.db,
            today=today,
            daily_target=80,
            rate_ratio=1.0,
            pace_tier="intensif"
        )
        second = compute_intake_quota(
            self.db,
            today=today,
            daily_target=80,
            rate_ratio=1.0,
            pace_tier="intensif"
        )

        self.assertEqual(first["ramp_ceiling"], 25)
        self.assertEqual(first["introduced_today"], 12)
        self.assertEqual(first["quota"], 13)
        self.assertEqual(second["quota"], first["quota"])

    def test_count_introduced_on_reads_any_day(self):
        today = date.today()
        self.add_question(1)
        self.add_review_log(1, today - timedelta(days=1))
        self.db.commit()

        self.assertEqual(count_introduced_on(self.db, today - timedelta(days=1)), 1)
        self.assertEqual(count_introduced_on(self.db, today), 0)

    def test_the_unstarted_pool_is_counted_without_loading_it(self):
        today = date.today()

        for question_id in range(1, 11):
            self.add_question(question_id)

        for question_id in range(1, 5):
            self.add_progress(question_id, next_review=today)

        self.add_question(11, suspended=True)
        self.db.commit()

        # 10 questions, 4 started, plus a suspended one that is not eligible.
        self.assertEqual(unstarted_question_count(self.db), 6)

    def test_python_and_sql_unstarted_predicates_agree(self):
        today = date.today()

        for question_id in range(1, 11):
            self.add_question(question_id)

        for question_id in range(1, 5):
            self.add_progress(question_id, next_review=today)

        self.db.commit()

        self.assertEqual(
            unstarted_question_count(self.db),
            len(_new_question_ids(self.db))
        )

        # Known and accepted divergence: started_progress_filter omits the
        # `len(history) > 0` clause its Python twin applies, because JSON length
        # is dialect-specific. Only a legacy import can produce such a row.
        self.add_question(50)
        self.db.add(
            Progress(
                question_id=50,
                stability=1.0,
                difficulty=5.0,
                reps=0,
                lapses=0,
                interval=0,
                next_review=None,
                last_review=None,
                history=[{"quality": 2}]
            )
        )
        self.db.commit()

        self.assertEqual(
            unstarted_question_count(self.db) - len(_new_question_ids(self.db)),
            1
        )

    def test_the_runway_is_the_pool_over_recent_intake(self):
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        # 28 introductions over the 14-day window: 2 per day.
        for offset in range(1, 15):
            for slot in range(2):
                self.add_review_log(
                    offset * 10 + slot,
                    today - timedelta(days=offset)
                )

        self.db.commit()

        self.assertAlmostEqual(
            recent_intake_per_day(self.db, today),
            2.0,
            delta=0.01
        )
        self.assertEqual(intake_runway_days(self.db, today, pool=100), 50)

    def test_no_runway_without_a_measurable_rate(self):
        for question_id in range(1, 20):
            self.add_question(question_id)

        self.db.commit()

        self.assertIsNone(intake_runway_days(self.db, date.today()))

    def test_questions_already_introduced_today_consume_the_budget(self):
        today = date.today()

        for question_id in range(1, 30):
            self.add_question(question_id)

        for question_id in range(1, 8):
            self.add_progress(question_id, next_review=today + timedelta(days=1))
            self.add_review_log(question_id, today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_target=20)

        self.assertEqual(quota["introduced_today"], 7)
        self.assertEqual(quota["new_budget_remaining"], 3)

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

        quota = compute_intake_quota(self.db, today=today, daily_target=20)

        self.assertEqual(quota["reviews_done_today"], 12)
        self.assertEqual(quota["introduced_today"], 7)
        # Reviews already done still count toward the day, so reopening the
        # screen does not restart the fill from scratch.
        self.assertEqual(quota["review_load"], 5)
        self.assertLess(quota["quota"], quota["new_budget"])

    def test_a_partly_used_budget_is_handed_out_on_reload(self):
        # Introductions already made are subtracted from the day's fill, so a
        # reload hands out only what is still owed rather than a fresh batch.
        today = date.today()

        for question_id in range(1, 40):
            self.add_question(question_id)

        for question_id in range(1, 6):
            self.add_progress(
                question_id,
                next_review=today + timedelta(days=4),
                reps=3
            )
            self.add_review_log(question_id, today - timedelta(days=4), seq=1)
            self.add_review_log(question_id, today, seq=2)

        for question_id in range(10, 13):
            self.add_progress(question_id, next_review=today + timedelta(days=1))
            self.add_review_log(question_id, today)

        self.db.commit()

        quota = compute_intake_quota(self.db, today=today, daily_target=20)

        self.assertEqual(quota["introduced_today"], 3)
        self.assertEqual(quota["quota"], quota["new_budget"] - 3)

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

        quota = compute_intake_quota(self.db, daily_target=10)

        self.assertGreaterEqual(quota["wip_count"], quota["wip_cap"])
        self.assertEqual(quota["wip_factor"], 0.0)
        self.assertEqual(quota["quota"], 0)

    def test_the_taper_band_shrinks_intake_progressively(self):
        for question_id in range(1, 40):
            self.add_question(question_id)

        cap = wip_cap_for(40)
        self._fill_in_flight(int(cap * 0.9))
        self.db.commit()

        quota = compute_intake_quota(self.db, daily_target=40)

        self.assertGreater(quota["wip_factor"], 0.0)
        self.assertLess(quota["wip_factor"], 1.0)
        self.assertLess(quota["quota"], quota["new_budget"])

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
        # Floor is 0.75 of the tier seed and the walk stops there.
        self.assertEqual(min(rates), 15)
        self.assertEqual(rates[-1], 15)

    def test_a_raise_is_rate_limited_not_streak_gated(self):
        # No streak counter any more: the rate simply moves one small step per
        # day toward its target, which is what makes it path-independent.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1)
        self.db.commit()

        today = date.today()
        rates = [
            tune_intake_rate(self.db, today=today + timedelta(days=offset))[
                "effective_daily_target"
            ]
            for offset in range(3)
        ]

        self.assertEqual(rates, [21, 22, 23])

    def test_the_rate_falls_faster_than_it_rises(self):
        # "Down applies at once, up has to be earned", preserved without any
        # stored streak: the down step is three times the up step.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=0)
        self.db.commit()

        today = date.today()
        first = tune_intake_rate(self.db, today=today)["effective_daily_target"]

        self.assertEqual(20 - first, 3)

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

    def test_choosing_a_tier_rescales_the_tuner_without_losing_it(self):
        # The tuner's judgement is stored as a ratio of the tier, so changing
        # tier re-anchors it instead of discarding it.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=0)
        self.db.commit()

        tune_intake_rate(self.db, today=date.today())
        ratio = load_intake_settings(self.db, 20)["rate_ratio"]

        self.assertLess(ratio, 1.0)

        update_settings(ReviewSettings(pace_tier="soutenu"), db=self.db)
        state = load_intake_settings(self.db, 40)

        self.assertEqual(state["rate_ratio"], ratio)
        self.assertEqual(state["effective_daily_target"], round(40 * ratio))
        self.assertIsNone(state["tuned_on"])

    def test_a_tier_round_trip_preserves_the_tuned_rate(self):
        # Leaving a tier and coming back must cost nothing: the whole point of
        # storing a ratio rather than an absolute number.
        update_settings(ReviewSettings(pace_tier="intensif"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, drift=0.0)
        self.db.commit()

        tune_intake_rate(self.db, today=date.today())
        before = load_intake_settings(self.db, 80)["effective_daily_target"]

        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        update_settings(ReviewSettings(pace_tier="intensif"), db=self.db)

        after = load_intake_settings(self.db, 80)["effective_daily_target"]

        self.assertEqual(after, before)

    def test_a_tier_round_trip_does_not_round_trip_the_quota(self):
        # Deliberate, documented consequence of the ramp limit. The STORED
        # control variable (rate_ratio) round-trips exactly -- that is what
        # test_a_tier_round_trip_preserves_the_tuned_rate asserts, and it still
        # passes. The observable quota does not: the ramp anchors on yesterday's
        # actual introductions, which a detour through a lighter tier really did
        # reduce. Green on the other test is NOT evidence the behaviour
        # round-trips; this test exists so the next reader is not misled.
        today = date.today()

        for question_id in range(1, 200):
            self.add_question(question_id)

        for question_id in range(1, 7):
            self.add_review_log(question_id, today - timedelta(days=1))

        self.db.commit()

        quota = compute_intake_quota(
            self.db,
            today=today,
            daily_target=80,
            rate_ratio=1.0,
            pace_tier="intensif"
        )

        # A quiet yesterday caps today well below the tier ceiling of 40.
        self.assertEqual(quota["ramp_ceiling"], 8)
        self.assertEqual(quota["quota"], 8)

    def test_a_saturated_calendar_walks_the_rate_down_despite_perfect_retention(self):
        # The regression test for the whole bug class: answering everything
        # correctly must no longer buy an increase on a jammed calendar.
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, drift=0.30)
        self.db.commit()

        tuned = tune_intake_rate(self.db, today=date.today())

        self.assertEqual(tuned["last_retention"], 100.0)
        self.assertEqual(tuned["last_schedule_pressure"], 0.30)
        self.assertEqual(tuned["effective_daily_target"], 17)

    def test_a_clear_calendar_and_strong_retention_earn_a_raise(self):
        update_settings(ReviewSettings(pace_tier="regulier"), db=self.db)
        self.seed_reviews(120, quality=3, days_back=1, drift=0.0)
        self.db.commit()

        today = date.today()
        rates = [
            tune_intake_rate(self.db, today=today + timedelta(days=offset))[
                "effective_daily_target"
            ]
            for offset in range(3)
        ]

        self.assertEqual(rates, [21, 22, 23])

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
            for offset in range(4)
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
            for offset in range(4)
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
            for offset in range(4)
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
        self.assertEqual(tuned["effective_daily_target"], 17)

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
            compute_intake_quota(self.db, daily_target=50)["new_budget"],
            25
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

        quota = compute_intake_quota(self.db, daily_target=20)

        self.assertEqual(get_review(db=self.db), [])
        # The allowance still exists; there is simply nothing eligible to fill it.
        self.assertEqual(quota["quota"], 10)
        self.assertEqual(_new_question_ids(self.db), [])


class IntakeQueueControlTests(IntakeTestCase):
    def test_queue_splits_active_suspended_and_today_slice(self):
        self.add_question(1, intake_order=2)
        self.add_question(2, intake_order=1)
        self.add_question(3, suspended=True)
        self.add_question(4)
        self.add_progress(4, next_review=date.today(), reps=1)
        map_question = self.add_question(5)
        map_question.type_q = "map"
        map_question.answer = ""
        self.db.commit()

        queue = get_intake_queue(self.db)

        self.assertEqual(queue["active_ids"], [2, 1])
        self.assertEqual(queue["suspended_ids"], [3])
        self.assertEqual(queue["today_ids"], [2, 1])
        self.assertEqual(queue["counts"]["active"], 2)
        self.assertEqual(queue["counts"]["suspended"], 1)

    def test_reordering_writes_dense_order_and_drives_new_selection(self):
        for question_id in range(1, 5):
            self.add_question(question_id)

        self.db.commit()

        queue = set_intake_order(self.db, [4, 2, 1, 3])
        self.db.commit()

        stored = {
            question.id: question.intake_order
            for question in self.db.query(Question).all()
        }

        self.assertEqual(queue["active_ids"], [4, 2, 1, 3])
        self.assertEqual(stored, {1: 3, 2: 2, 3: 4, 4: 1})
        self.assertEqual(_new_question_ids(self.db), [4, 2, 1, 3])

    def test_manual_order_falls_back_to_id_after_ordered_questions(self):
        self.add_question(1)
        self.add_question(2, intake_order=20)
        self.add_question(3, intake_order=10)
        self.add_question(4)
        self.db.commit()

        self.assertEqual(_new_question_ids(self.db), [3, 2, 1, 4])

    def test_reorder_rejects_partial_stale_and_duplicate_payloads(self):
        for question_id in range(1, 4):
            self.add_question(question_id)

        self.db.commit()

        with self.assertRaises(HTTPException) as partial:
            set_intake_order(self.db, [2, 1])

        with self.assertRaises(HTTPException) as duplicate:
            set_intake_order(self.db, [2, 2, 1])

        stored_orders = [
            question.intake_order
            for question in self.db.query(Question).order_by(Question.id)
        ]

        self.assertEqual(partial.exception.status_code, 409)
        self.assertEqual(duplicate.exception.status_code, 400)
        self.assertEqual(stored_orders, [None, None, None])

    def test_suspension_endpoint_changes_only_unseen_questions(self):
        question = self.add_question(1, intake_order=5)
        self.add_question(2)
        self.add_progress(2, next_review=date.today(), reps=2, stability=6.0)
        self.add_question(3, suspended=True, intake_order=7)
        self.db.commit()
        progress_count = self.db.query(Progress).count()

        with self.assertRaises(HTTPException) as started:
            set_intake_suspension(self.db, [1, 2], True)

        self.assertEqual(started.exception.status_code, 400)
        self.assertFalse(question.suspended)

        queue = set_intake_suspension(self.db, [1], True)
        self.db.commit()

        self.assertEqual(queue["active_ids"], [])
        self.assertEqual(queue["suspended_ids"], [1, 3])
        self.assertEqual(self.db.query(Progress).count(), progress_count)
        self.assertTrue(question.suspended)
        self.assertEqual(question.intake_order, 5)

        set_intake_suspension(self.db, [1], False)
        self.db.commit()

        progress = self.db.query(Progress).filter(
            Progress.question_id == 2
        ).one()

        self.assertFalse(question.suspended)
        self.assertEqual(question.intake_order, 5)
        self.assertEqual(progress.reps, 2)
        self.assertEqual(progress.stability, 6.0)


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
