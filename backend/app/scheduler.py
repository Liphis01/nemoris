from datetime import date, timedelta
import math


DESIRED_RETENTION = 0.9


def next_interval(stability):
    """
    Convert stability to interval using FSRS forgetting curve
    """
    return max(
        1,
        round(stability * math.log(DESIRED_RETENTION) / math.log(0.9))
    )


def progress_value(progress, field, default):
    # Existing rows may have NULLs after schema upgrades; scheduling should
    # continue from defaults instead of failing or producing None math.
    if not progress:
        return default

    return getattr(progress, field) or default


def smoothing_radius_days(interval):
    if interval <= 1:
        return 0
    if interval <= 3:
        return 1
    if interval <= 13:
        return 2
    return 3


def candidate_review_dates(today, ideal_next_review, interval):
    if interval == 0:
        return [today]

    radius = smoothing_radius_days(interval)
    first_date = max(
        today + timedelta(days=1),
        ideal_next_review - timedelta(days=radius)
    )
    last_date = ideal_next_review + timedelta(days=radius)
    days = (last_date - first_date).days

    return [
        first_date + timedelta(days=offset)
        for offset in range(days + 1)
    ]


def choose_smoothed_review_date(today, ideal_next_review, interval, daily_loads):
    candidates = candidate_review_dates(today, ideal_next_review, interval)

    def candidate_key(candidate):
        offset = (candidate - ideal_next_review).days

        return (
            daily_loads.get(candidate, 0),
            abs(offset),
            0 if offset >= 0 else 1,
            candidate
        )

    return min(candidates, key=candidate_key)


def smooth_scheduling(scheduling, daily_loads):
    today = scheduling["last_review"]
    ideal_interval = scheduling["interval"]
    ideal_next_review = scheduling["next_review"]
    next_review = choose_smoothed_review_date(
        today,
        ideal_next_review,
        ideal_interval,
        daily_loads
    )

    if next_review == ideal_next_review:
        return scheduling

    return {
        **scheduling,
        "ideal_interval": ideal_interval,
        "ideal_next_review": ideal_next_review,
        "interval": max(0, (next_review - today).days),
        "next_review": next_review
    }


def assign_smoothed_schedules(schedulings, daily_loads):
    projected_loads = dict(daily_loads or {})
    assigned = [None] * len(schedulings)
    ordered = sorted(
        enumerate(schedulings),
        key=lambda item: -item[1]["interval"]
    )

    for index, scheduling in ordered:
        smoothed = smooth_scheduling(scheduling, projected_loads)
        assigned[index] = smoothed

        next_review = smoothed["next_review"]
        projected_loads[next_review] = projected_loads.get(next_review, 0) + 1

    return assigned


def update_progress(progress, quality, today=None):
    """
    Apply a compact FSRS-inspired scheduling step.

    quality: 0 = fail, 1 = hard, 2 = easy. The returned dict is written back to
    Progress by services/progress.py so scheduling stays isolated from database
    mutation.
    """

    today = today or date.today()

    stability = progress_value(progress, "stability", 1.0)
    difficulty = progress_value(progress, "difficulty", 5.0)
    reps = progress_value(progress, "reps", 0)
    lapses = progress_value(progress, "lapses", 0)

    # ============================================
    # FAIL
    # ============================================

    if quality == 0:

        difficulty = min(10, difficulty + 0.4)

        stability = max(
            0.5,
            stability * 0.45
        )

        lapses += 1

    # ============================================
    # HARD
    # ============================================

    elif quality == 1:

        difficulty = min(10, difficulty + 0.1)

        stability = stability * (
            1.2 + (10 - difficulty) * 0.03
        )

    # ============================================
    # EASY
    # ============================================

    else:

        difficulty = max(1, difficulty - 0.08)

        stability = stability * (
            1.8 + (10 - difficulty) * 0.05
        )

    reps += 1

    interval = 0 if quality == 0 else next_interval(stability)

    next_review = today + timedelta(days=interval)

    return {
        "stability": stability,
        "difficulty": difficulty,
        "reps": reps,
        "lapses": lapses,
        "interval": interval,
        "next_review": next_review,
        "last_review": today
    }


def preview_intervals(progress):
    # The map recap can show what each button would schedule before the user
    # commits a quality choice.
    return {
        quality: update_progress(progress, quality)["interval"]
        for quality in (0, 1, 2)
    }
