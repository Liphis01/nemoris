"""Automatic new-question intake.

Replaces the old manual "bonus questions" picker. New questions are drawn from
one global pool in creation order and mixed into the normal review queue; how
many enter per day is decided here rather than by the user.

Two responsibilities, deliberately split:

- ``compute_intake_quota`` is a **pure read**. It runs inside ``GET /review``,
  which must stay free of side effects (see
  ``test_review_route_does_not_rebalance_calendar``).
- ``tune_intake_rate`` is the **only writer** in this module, guarded to run at
  most once per day and touching exactly one ``AppSetting`` row.

Keeping them here rather than in ``review.py`` is what makes that read/write
boundary visible; ``review.py`` stays a pure-read module.
"""

from datetime import date, timedelta
from math import ceil

from sqlalchemy import case, distinct, func, not_, or_

from ..models import Progress, Question, ReviewLog
from .map_eligibility import reviewable_question_filter
from .progress import in_flight_progress_filter, started_progress_filter
from .settings import (
    TUNE_CEILING_RATIO,
    TUNE_FLOOR_RATIO,
    clear_pace_pressure_notice,
    get_review_settings,
    load_intake_settings,
    new_question_bounds,
    save_intake_settings,
    save_pace_pressure_notice,
    suggested_lighter_tier
)


# The tier is a request for more work than the schedule alone produces, so new
# questions FILL THE DAY UP toward it: what is already owed in reviews is
# counted first, and new questions take the remainder.
#
# The per-tier floor is what stops this becoming the old "leftovers" rule, where
# a busy day left nothing and the user could never get through their backlog. A
# day already at or past its target still brings the floor's worth of new
# material, so the total deliberately goes ABOVE the target -- the tier says how
# much the user wants, not how little they will be allowed.
#
# It is self-regulating: cards introduced today come back due within days, which
# raises tomorrow's review load, which shrinks tomorrow's fill. Intake tapers on
# its own without any extra machinery.
#
# Emergency stop only. Returning to 300 due cards after a fortnight away is not
# a heavy day, it is a backlog, and adding new material on top of it helps
# nobody. Deliberately a cliff: a taper would re-couple new questions to review
# load, which is exactly what this design removes.
NEW_INTAKE_SATURATION_STOP = 1.5

# A card introduced today does not cost one review slot. It also generates
# follow-up reviews within days (first intervals are 1-3 days), and it takes
# longer to work through than a card being recalled. So the day is filled in
# review-equivalents: 80 means 80 reviews' worth of effort, not 80 items.
NEW_QUESTION_WEIGHT = 1.75

# The fill reacts to today's review load, but the cards it introduces come back
# 1-3 days later -- a feedback loop with a lag and, without this, no brake.
# Left alone it sawtooths: measured swings of 5..40 with day-to-day jumps of 35.
#
# Growth only. A lower bound would be actively harmful: the fill pins to the
# tier floor once review_load passes seed - WEIGHT*new_min (71 at intensif)
# while the saturation breaker does not fire until 1.5x the seed (120), so
# across that whole window a lower band would FORCE unneeded new cards onto a
# day already over its target -- the opposite of what damping is for. Capping
# growth alone is enough, because the sawtooth's crash edge only exists as the
# echo of an earlier spike. Same asymmetry the tuner already uses.
INTAKE_RAMP_UP_RATIO = 0.25

# Runway estimate for the unstarted pool. Deliberately coarse: the intake rate
# self-regulates, so a trailing mean taken early overstates the drain rate.
RUNWAY_WINDOW_DAYS = 14
RUNWAY_MIN_PER_DAY = 1.0

# Under FSRS with no learning steps a Good-rated card walks roughly
# 1d -> 3d -> 8d -> 20d -> 50d, so it clears the WIP release bar (21 days /
# 2 reps) after about a month. The honest steady-state population in flight is
# therefore ~30x the daily rate; a smaller multiple would bind permanently and
# freeze intake forever, which is the failure mode to avoid.
WIP_LOAD_DAYS = 30
WIP_CAP_MIN = 120
WIP_CAP_MAX = 2000
# Taper instead of a cliff: a hard cutoff at the cap would oscillate (block ->
# cards settle -> release a full batch -> block).
WIP_SOFT_START = 0.80

# Tuning window. Deliberately shorter than stats' RETENTION_WINDOW_DAYS (90):
# the tuner has to notice a change in the user's life within weeks, and 90 days
# makes it inert.
TUNE_WINDOW_DAYS = 30
MIN_TUNE_REVIEWS = 60
RETENTION_LOW = 80.0
RETENTION_HIGH = 90.0

# Schedule pressure: the share of scheduled cards the load smoother had to push
# off their FSRS-ideal date. Measured over a shorter horizon than retention
# because saturation propagates forward from today, so a 30-day window dilutes a
# real front-of-calendar jam with a quiet tail.
PRESSURE_WINDOW_DAYS = 14
# Calibrated by replaying rebalance_review_calendar: the smoother only displaces
# a card once a day exceeds the target by about sqrt(target) (~9 at target 80),
# so healthy calendars with normal day-to-day jitter read <= 0.03 and genuinely
# saturated ones read >= 0.18. These two sit inside that empty band, and the gap
# between them is the hysteresis that mirrors the 80-90 retention dead zone.
PRESSURE_UP_MAX = 0.05
PRESSURE_DOWN_MIN = 0.15
# Below this the ratio is quantisation noise, not a measurement. Chosen so that
# at the smallest measurable population one displaced card still permits "up"
# but two do not.
MIN_PRESSURE_CARDS = 20

# The rate moves toward its target by at most one step per day. This is a rate
# limiter, not an accumulator: it converges to the same value regardless of the
# path taken, which is what makes a tier round trip cost nothing, while still
# damping a signal that is inherently steppy (schedule_pressure jumps ~0.00 to
# ~0.18 at the smoother's knee, and a tier change rebalances the calendar and
# zeroes pressure outright). Without the limiter the day after any tier change
# would grant the ceiling.
#
# Asymmetric on purpose, preserving "down applies at once but up has to be
# earned" in a form that carries no hidden state: floor to ceiling takes 10 days
# upward, 4 days downward.
TUNE_UP_STEP_RATIO = 0.05
TUNE_DOWN_STEP_RATIO = 0.15
# How long the rate has to sit pinned at the floor on a saturated calendar
# before the user is told their tier is too heavy. One full PRESSURE_WINDOW_DAYS,
# so the prompt can never fire on a signal shorter than the measurement itself.
FLOOR_PROMPT_DAYS = 14


def _clamp(value, lower, upper):
    return max(lower, min(upper, value))


def due_question_count(db, today):
    # SQL twin of review._due_question_count. It omits that one's
    # `len(history) > 0` clause (JSON length is dialect-specific), which only
    # differs for a pathological row holding history with reps=0 and no
    # last_review.
    return (
        db.query(func.count(Progress.question_id))
        .join(Question, Question.id == Progress.question_id)
        .filter(
            reviewable_question_filter(),
            started_progress_filter(),
            or_(
                Progress.next_review.is_(None),
                Progress.next_review <= today
            )
        )
        .scalar()
    ) or 0


def count_reviews_done_today(db, today):
    # DISTINCT question_id collapses in-session relearning retries, which each
    # append their own revlog row, into the one review they really are.
    return (
        db.query(func.count(distinct(ReviewLog.question_id)))
        .filter(ReviewLog.reviewed_on == today)
        .scalar()
    ) or 0


def count_introduced_on(db, day):
    """Questions whose first ever review falls on `day`.

    Progress rows are created lazily on first answer, so there is no
    "introduced_at" to read. MIN(review_log.reviewed_on) per question is the
    true introduction date, and the review_log migration backfills it from
    legacy Progress.history, so this also works on old databases.

    superseded_by is deliberately NOT filtered here: a re-grade appends a
    replacement row, but the original still proves the question was touched
    that day, which is all this counts.
    """
    seen_before = (
        db.query(ReviewLog.question_id)
        .filter(ReviewLog.reviewed_on < day)
        .distinct()
    )

    return (
        db.query(func.count(distinct(ReviewLog.question_id)))
        .filter(
            ReviewLog.reviewed_on == day,
            ReviewLog.question_id.notin_(seen_before)
        )
        .scalar()
    ) or 0


def count_introduced_today(db, today):
    return count_introduced_on(db, today)


def unstarted_question_count(db):
    """Questions the intake pool can still draw on: reviewable, never started.

    No `Progress.question_id IS NULL` clause is needed, and adding one would be
    misleading: both arms of started_progress_filter are total functions, so a
    missing progress row makes them FALSE rather than NULL and NOT(...) is
    correctly TRUE. There is no three-valued-logic trap here.
    """
    return (
        db.query(func.count(Question.id))
        .outerjoin(Progress, Progress.question_id == Question.id)
        .filter(
            reviewable_question_filter(),
            not_(started_progress_filter())
        )
        .scalar()
    ) or 0


def recent_intake_per_day(db, today, window_days=RUNWAY_WINDOW_DAYS):
    """Mean introductions per day over the window ending yesterday.

    One grouped pass rather than a query per day: MIN(reviewed_on) per question
    is the introduction date, which is the same definition count_introduced_on
    uses. Days with no activity are included on purpose -- they are real usage,
    and excluding them would flatter the estimate.
    """
    first_seen = (
        db.query(
            ReviewLog.question_id,
            func.min(ReviewLog.reviewed_on).label("first_day")
        )
        .group_by(ReviewLog.question_id)
        .subquery()
    )
    introduced = (
        db.query(func.count())
        .select_from(first_seen)
        .filter(
            first_seen.c.first_day >= today - timedelta(days=window_days),
            first_seen.c.first_day <= today - timedelta(days=1)
        )
        .scalar()
    ) or 0

    return introduced / float(window_days)


def intake_runway_days(db, today, pool=None):
    """Roughly how long the unstarted pool lasts at the recent intake rate.

    Coarse by nature: the intake rate self-regulates downward as the in-flight
    population grows, so a trailing mean overstates the drain rate, and any pack
    import invalidates the figure outright. Callers must bucket it rather than
    print a day count. None when intake is too slow to extrapolate from.
    """
    per_day = recent_intake_per_day(db, today)

    if per_day < RUNWAY_MIN_PER_DAY:
        return None

    pool = unstarted_question_count(db) if pool is None else pool

    return int(pool / per_day)


def count_in_flight(db):
    """Started questions the user is still actively carrying."""
    return (
        db.query(func.count(Progress.question_id))
        .join(Question, Question.id == Progress.question_id)
        .filter(
            reviewable_question_filter(),
            in_flight_progress_filter()
        )
        .scalar()
    ) or 0


def wip_cap_for(daily_rate):
    return int(_clamp(round(daily_rate * WIP_LOAD_DAYS), WIP_CAP_MIN, WIP_CAP_MAX))


def fill_to_target_budget(
    daily_target,
    review_load,
    new_min,
    new_max,
    weight=NEW_QUESTION_WEIGHT
):
    """New questions needed to top the day up toward the tier's target.

    Scheduled reviews are counted first -- they are what the user already owes
    -- and new questions take the remainder, priced at `weight` reviews each.
    The clamp runs AFTER the division so the tier's floor and ceiling stay
    expressed in cards, which is what the picker promises the user.
    """
    return int(_clamp(
        (daily_target - review_load) / weight,
        new_min,
        new_max
    ))


def compute_intake_quota(
    db,
    today=None,
    daily_target=None,
    rate_ratio=None,
    due_count=None,
    pace_tier=None
):
    """How many new questions to introduce today. Pure read: never writes.

    Every intermediate is returned, so the UI can explain a zero quota and the
    tests can assert on the reasoning rather than only the result.

    `daily_target` is the tier seed -- the same number the calendar smoother
    spreads reviews toward. The tuner's opinion arrives separately as
    `rate_ratio` and scales only the new-question count, which is the only
    thing it can actually control.
    """
    today = today or date.today()
    settings = None
    intake = None

    if daily_target is None or pace_tier is None:
        settings = get_review_settings(db)

    if daily_target is None:
        daily_target = settings["catchup_daily_target"]

    if pace_tier is None:
        pace_tier = settings["pace_tier"]

    if rate_ratio is None:
        intake = load_intake_settings(db, daily_target)
        rate_ratio = intake["rate_ratio"]

    if due_count is None:
        due_count = due_question_count(db, today)

    reviews_done_today = count_reviews_done_today(db, today)
    introduced_today = count_introduced_today(db, today)
    introduced_yesterday = count_introduced_on(db, today - timedelta(days=1))

    # What the day owes in reviews. Introductions are subtracted out so a new
    # card is not counted twice. Reviews already done still count, which is what
    # keeps the quota stable as the user works through the session instead of
    # handing out a fresh batch every time the screen is reopened.
    #
    # Deliberately NOT weighted: charging introductions at NEW_QUESTION_WEIGHT
    # here would let the breaker trip mid-session on the very cards the session
    # just handed out.
    review_load = max(0, reviews_done_today - introduced_today) + due_count
    saturation = review_load / max(1, daily_target)
    breaker = 0.0 if saturation >= NEW_INTAKE_SATURATION_STOP else 1.0

    new_min, new_max = new_question_bounds(daily_target, pace_tier)
    new_fill = fill_to_target_budget(
        daily_target,
        review_load,
        new_min,
        new_max
    )

    # The tuner scales the headroom ABOVE the floor, never the floor itself:
    # scaling the whole budget would let it silently void the tier's guarantee.
    new_budget_tuned = int(_clamp(
        new_min + (new_fill - new_min) * rate_ratio + 0.5,
        new_min,
        new_max
    ))

    # Growth limit, applied to the day's total allowance and BEFORE the
    # introduced_today subtraction: damping the remainder instead would make the
    # ramp a no-op on reload and re-inflate a partly used budget.
    #
    # A yesterday of zero means "no data", not "zero" -- a brand-new install, a
    # skipped day, or a day the breaker zeroed must not be pinned near nothing.
    # Same convention schedule_pressure uses for a thin population.
    if introduced_yesterday > 0:
        ramp_ceiling = max(
            new_min,
            ceil(introduced_yesterday * (1 + INTAKE_RAMP_UP_RATIO))
        )
        new_budget = min(new_budget_tuned, ramp_ceiling)
    else:
        ramp_ceiling = None
        new_budget = new_budget_tuned

    new_budget_remaining = max(0, new_budget - introduced_today)

    wip_count = count_in_flight(db)
    wip_cap = wip_cap_for(daily_target)
    soft_start = wip_cap * WIP_SOFT_START

    if wip_count >= wip_cap:
        wip_factor = 0.0
    elif wip_count <= soft_start:
        wip_factor = 1.0
    else:
        wip_factor = (wip_cap - wip_count) / (wip_cap - soft_start)

    quota = max(0, int(new_budget_remaining * wip_factor * breaker))

    return {
        "daily_target": daily_target,
        "rate_ratio": rate_ratio,
        "pace_tier": pace_tier,
        "new_min": new_min,
        "new_max": new_max,
        "due_count": due_count,
        "reviews_done_today": reviews_done_today,
        "introduced_today": introduced_today,
        "introduced_yesterday": introduced_yesterday,
        "review_load": review_load,
        "saturation": saturation,
        "new_fill": new_fill,
        "new_budget_tuned": new_budget_tuned,
        "ramp_ceiling": ramp_ceiling,
        "new_budget": new_budget,
        "new_budget_remaining": new_budget_remaining,
        "wip_count": wip_count,
        "wip_cap": wip_cap,
        "wip_factor": wip_factor,
        "quota": quota
    }


def rolling_retention(db, today, window_days=TUNE_WINDOW_DAYS):
    """Success rate over the tuning window, as a percentage.

    Unlike the intake counters, superseded rows ARE excluded here: a corrected
    grade must not be counted twice. Retries are intentionally kept — a card
    failed then retried is genuinely two data points about retention.
    """
    start = today - timedelta(days=window_days)
    reviews, success = (
        db.query(
            func.count(ReviewLog.id),
            func.sum(case((ReviewLog.quality > 0, 1), else_=0))
        )
        .filter(
            ReviewLog.superseded_by.is_(None),
            ReviewLog.quality.isnot(None),
            ReviewLog.reviewed_on >= start,
            ReviewLog.reviewed_on <= today
        )
        .one()
    )

    if not reviews:
        return None, 0

    return (success or 0) * 100.0 / reviews, reviews


def schedule_pressure(db, today, window_days=PRESSURE_WINDOW_DAYS):
    """How saturated the review calendar is, as the share of scheduled cards the
    load smoother had to push past their FSRS-ideal date.

    ``next_review > ideal_next_review`` is only ever produced by load smoothing:
    ``smooth_scheduling`` returns the scheduling untouched when the ideal date
    was free (scheduler.py), and ``rebalance_review_calendar`` re-derives every
    date from the stored ideal on each run, so this measures *today's* calendar
    rather than accumulated history. The rebalancer runs on every launch, so the
    reading is always the smoother's own verdict on the current calendar.

    Unlike the review-volume ratio it replaces, it is supply-independent: the
    calendar is smoothed against ``catchup_daily_target`` -- the tier the user
    picked -- and not against the tuned rate, so the tuner cannot move its own
    reference and trap itself between two thresholds it can never clear.

    Cards whose ideal date has already passed count too: the rebalancer pulls
    them forward to ``max(today, ideal)``, which overloads today and displaces
    other cards, so a user falling behind still shows up here. A raw overdue
    count could not be used -- the rebalancer erases the backlog on every run.

    The window is anchored on ``ideal_next_review`` rather than ``next_review``
    so displacing a card can never push it out of its own denominator.

    Returns ``(pressure, measured)``. ``pressure`` is None on a population too
    thin to measure, which the caller must read as "no data", never as "clear".
    """
    horizon = today + timedelta(days=window_days)
    displaced, measured = (
        db.query(
            func.sum(
                case(
                    (Progress.next_review > Progress.ideal_next_review, 1),
                    else_=0
                )
            ),
            func.count(Progress.question_id)
        )
        .join(Question, Question.id == Progress.question_id)
        .filter(
            reviewable_question_filter(),
            started_progress_filter(),
            Progress.next_review.isnot(None),
            Progress.ideal_next_review.isnot(None),
            Progress.ideal_next_review <= horizon
        )
        .one()
    )

    if not measured or measured < MIN_PRESSURE_CARDS:
        return None, measured or 0

    return (displaced or 0) / float(measured), measured


def _tune_signal(retention, pressure, reviews_in_window):
    if reviews_in_window < MIN_TUNE_REVIEWS:
        return "hold"

    # The two arms are independent on the way down: either a user who is failing
    # cards or a user whose calendar is jammed needs relief now, and neither has
    # to wait for the other arm to have data.
    if retention is not None and retention < RETENTION_LOW:
        return "down"

    if pressure is not None and pressure >= PRESSURE_DOWN_MIN:
        return "down"

    # Up is the opposite: it has to be earned, so it needs both measurements.
    # This guard sits between the arms so a missing reading can never
    # manufacture an increase.
    if retention is None or pressure is None:
        return "hold"

    if retention >= RETENTION_HIGH and pressure <= PRESSURE_UP_MAX:
        return "up"

    # Two dead zones, 80-90% retention and 0.05-0.15 pressure: a user hovering
    # around 85% retention on a calendar that is merely busy never moves.
    return "hold"


def tune_intake_rate(db, today=None):
    """Nudge the effective daily rate from the tier seed. Writes at most once
    per day, and only to the intake settings row."""
    today = today or date.today()
    seed = get_review_settings(db)["catchup_daily_target"]
    state = load_intake_settings(db, seed)

    # Read the guard first: every call after the first of the day is one
    # indexed SELECT and no write at all.
    if state["tuned_on"] == today.isoformat():
        return {"changed": False, "daily_target": seed, **state}

    ratio = state["rate_ratio"]
    retention, reviews_in_window = rolling_retention(db, today)
    # Deliberately takes no rate argument: the signal is measured against the
    # tier the calendar is smoothed with, not against the number being tuned.
    pressure, _ = schedule_pressure(db, today)
    signal = _tune_signal(retention, pressure, reviews_in_window)

    # One step toward the target, never a jump. The result depends only on the
    # current ratio and today's measurements, so no history is accumulated and
    # a tier round trip converges back to where it started.
    if signal == "up":
        ratio = min(TUNE_CEILING_RATIO, ratio + TUNE_UP_STEP_RATIO)
    elif signal == "down":
        ratio = max(TUNE_FLOOR_RATIO, ratio - TUNE_DOWN_STEP_RATIO)

    # Pinned at the floor on a calendar that is still jammed means the tier
    # itself is too heavy -- the tuner has run out of room to help. Counted so
    # the user can be told, rather than being walked silently down a tier.
    at_floor = (
        ratio <= TUNE_FLOOR_RATIO and
        pressure is not None and
        pressure >= PRESSURE_DOWN_MIN
    )
    floor_days = state["floor_days"] + 1 if at_floor else 0

    if floor_days >= FLOOR_PROMPT_DAYS:
        tier = get_review_settings(db).get("pace_tier")
        save_pace_pressure_notice(db, {
            "tier": tier,
            "suggested_tier": suggested_lighter_tier(tier),
            "pressure": pressure,
            "daily_target": seed,
            "floor_days": floor_days
        })
    elif floor_days == 0:
        clear_pace_pressure_notice(db)

    tuned = save_intake_settings(
        db,
        {
            "rate_ratio": ratio,
            "tuned_on": today.isoformat(),
            "floor_days": floor_days,
            "last_retention": retention,
            "last_schedule_pressure": pressure,
            "last_reviews_in_window": reviews_in_window
        },
        seed
    )

    return {"changed": True, "daily_target": seed, **tuned}
