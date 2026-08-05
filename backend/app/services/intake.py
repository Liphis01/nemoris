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

from sqlalchemy import case, distinct, func, or_

from ..models import Progress, Question, ReviewLog
from .map_eligibility import reviewable_question_filter
from .progress import in_flight_progress_filter, started_progress_filter
from .settings import (
    get_review_settings,
    load_intake_settings,
    save_intake_settings
)


# A card introduced today does not cost one review slot: it also generates
# follow-up reviews within days (first intervals are 1-3 days), which no other
# guard can see yet because they are not scheduled at introduction time.
NEW_QUESTION_WEIGHT = 1.75

# Hard ceiling on introductions, as a share of the daily rate and in absolute
# terms. This is the guard that stops a brand-new 200-question library with
# nothing due from being dumped on the user on day one.
NEW_SHARE_CEILING = 0.35
ABSOLUTE_DAILY_CEILING = 20

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

UP_STREAK_REQUIRED = 3
TUNE_FLOOR_RATIO = 0.50
# Unreachable in practice, and deliberately so: the calendar smooths against the
# tier seed and starts displacing cards at ~1.10x of it, so that is the real
# stable maximum. The tier is meant to be the ceiling; do not raise this to
# compensate.
TUNE_CEILING_RATIO = 1.25
TUNE_STEP_RATIO = 0.10


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


def count_introduced_today(db, today):
    # Progress rows are created lazily on first answer, so there is no
    # "introduced_at" to read. MIN(review_log.reviewed_on) per question is the
    # true introduction date, and the review_log migration backfills it from
    # legacy Progress.history, so this also works on old databases.
    #
    # superseded_by is deliberately NOT filtered here: a re-grade appends a
    # replacement row, but the original still proves the question was touched
    # that day, which is all this counts.
    seen_before = (
        db.query(ReviewLog.question_id)
        .filter(ReviewLog.reviewed_on < today)
        .distinct()
    )

    return (
        db.query(func.count(distinct(ReviewLog.question_id)))
        .filter(
            ReviewLog.reviewed_on == today,
            ReviewLog.question_id.notin_(seen_before)
        )
        .scalar()
    ) or 0


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


def daily_ceiling_for(daily_rate):
    return max(1, min(ceil(daily_rate * NEW_SHARE_CEILING), ABSOLUTE_DAILY_CEILING))


def compute_intake_quota(db, today=None, daily_rate=None, due_count=None):
    """How many new questions to introduce today. Pure read: never writes.

    Every intermediate is returned, so the UI can explain a zero quota and the
    tests can assert on the reasoning rather than only the result.
    """
    today = today or date.today()

    if daily_rate is None:
        seed = get_review_settings(db)["catchup_daily_target"]
        daily_rate = load_intake_settings(db, seed)["effective_daily_target"]

    if due_count is None:
        due_count = due_question_count(db, today)

    reviews_done_today = count_reviews_done_today(db, today)
    introduced_today = count_introduced_today(db, today)

    # Introductions are billed once, at NEW_QUESTION_WEIGHT, so they are
    # subtracted out of the plain review count first. This is also what keeps
    # the quota stable across repeated loads on the same day: after a finished
    # session the load stays non-zero, so no second batch is handed out.
    weighted_load = (
        max(0, reviews_done_today - introduced_today) +
        due_count +
        NEW_QUESTION_WEIGHT * introduced_today
    )

    slack = max(0.0, daily_rate - weighted_load)
    slack_allowance = int(slack // NEW_QUESTION_WEIGHT)

    ceiling = daily_ceiling_for(daily_rate)
    ceiling_remaining = max(0, ceiling - introduced_today)

    wip_count = count_in_flight(db)
    wip_cap = wip_cap_for(daily_rate)
    soft_start = wip_cap * WIP_SOFT_START

    if wip_count >= wip_cap:
        wip_factor = 0.0
    elif wip_count <= soft_start:
        wip_factor = 1.0
    else:
        wip_factor = (wip_cap - wip_count) / (wip_cap - soft_start)

    quota = max(0, int(min(slack_allowance, ceiling_remaining) * wip_factor))

    return {
        "daily_rate": daily_rate,
        "due_count": due_count,
        "reviews_done_today": reviews_done_today,
        "introduced_today": introduced_today,
        "weighted_load": weighted_load,
        "slack_allowance": slack_allowance,
        "ceiling": ceiling,
        "ceiling_remaining": ceiling_remaining,
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
        return {"changed": False, **state}

    floor = max(1, round(seed * TUNE_FLOOR_RATIO))
    ceiling = max(floor, round(seed * TUNE_CEILING_RATIO))
    step = max(1, round(seed * TUNE_STEP_RATIO))

    effective = _clamp(state["effective_daily_target"], floor, ceiling)
    retention, reviews_in_window = rolling_retention(db, today)
    # Deliberately takes no rate argument: the signal is measured against the
    # tier the calendar is smoothed with, not against the number being tuned.
    pressure, _ = schedule_pressure(db, today)
    signal = _tune_signal(retention, pressure, reviews_in_window)
    up_streak = state["up_streak"]

    if signal == "up":
        # Down applies at once but up has to earn it: a drowning user should
        # not wait three days for relief, while a good week should not
        # immediately raise the workload the user asked for.
        up_streak += 1

        if up_streak >= UP_STREAK_REQUIRED:
            effective = min(ceiling, effective + step)
            up_streak = 0
    elif signal == "down":
        effective = max(floor, effective - step)
        up_streak = 0
    else:
        up_streak = 0

    tuned = save_intake_settings(
        db,
        {
            "effective_daily_target": effective,
            "tuned_on": today.isoformat(),
            "up_streak": up_streak,
            "last_retention": retention,
            "last_schedule_pressure": pressure,
            "last_reviews_in_window": reviews_in_window
        },
        seed
    )

    return {"changed": True, **tuned}
