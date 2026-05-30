from datetime import date, timedelta
import math


DESIRED_RETENTION = 0.9
DEFAULT_CATCHUP_DAILY_TARGET = 50
CATCHUP_REBALANCE_TOLERANCE = 1.25


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


def type_key(type_q):
    return type_q or "unknown"


def nested_daily_type_loads(daily_type_loads):
    return {
        day: dict(type_counts)
        for day, type_counts in (daily_type_loads or {}).items()
    }


def count_other_loaded_types(type_counts, current_type):
    return sum(
        1
        for candidate_type, count in type_counts.items()
        if candidate_type != current_type and count > 0
    )


def increment_type_load(daily_type_loads, day, type_q):
    if not type_q:
        return

    current_type = type_key(type_q)
    type_counts = daily_type_loads.setdefault(day, {})
    type_counts[current_type] = type_counts.get(current_type, 0) + 1


def choose_smoothed_review_date(
    today,
    ideal_next_review,
    interval,
    daily_loads,
    daily_type_loads=None,
    type_q=None
):
    candidates = candidate_review_dates(today, ideal_next_review, interval)
    current_type = type_key(type_q) if type_q else None

    def candidate_key(candidate):
        offset = (candidate - ideal_next_review).days
        type_counts = (daily_type_loads or {}).get(candidate, {})
        same_type_load = (
            type_counts.get(current_type, 0)
            if current_type
            else 0
        )
        other_type_count = (
            count_other_loaded_types(type_counts, current_type)
            if current_type
            else 0
        )

        return (
            daily_loads.get(candidate, 0),
            same_type_load,
            -other_type_count,
            abs(offset),
            0 if offset >= 0 else 1,
            candidate
        )

    return min(candidates, key=candidate_key)


def smooth_scheduling(scheduling, daily_loads, daily_type_loads=None):
    today = scheduling["last_review"]
    ideal_interval = scheduling["interval"]
    ideal_next_review = scheduling["next_review"]
    next_review = choose_smoothed_review_date(
        today,
        ideal_next_review,
        ideal_interval,
        daily_loads,
        daily_type_loads=daily_type_loads,
        type_q=scheduling.get("type_q")
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


def assign_smoothed_schedules(schedulings, daily_loads, daily_type_loads=None):
    projected_loads = dict(daily_loads or {})
    projected_type_loads = nested_daily_type_loads(daily_type_loads)
    assigned = [None] * len(schedulings)
    ordered = sorted(
        enumerate(schedulings),
        key=lambda item: -item[1]["interval"]
    )

    for index, scheduling in ordered:
        smoothed = smooth_scheduling(
            scheduling,
            projected_loads,
            daily_type_loads=projected_type_loads
        )
        assigned[index] = smoothed

        next_review = smoothed["next_review"]
        projected_loads[next_review] = projected_loads.get(next_review, 0) + 1
        increment_type_load(
            projected_type_loads,
            next_review,
            smoothed.get("type_q")
        )

    return assigned


def normalize_daily_target(daily_target):
    try:
        target = int(daily_target)
    except (TypeError, ValueError):
        target = DEFAULT_CATCHUP_DAILY_TARGET

    return max(1, target)


def soft_rebalance_daily_limit(daily_target):
    return math.ceil(
        normalize_daily_target(daily_target) * CATCHUP_REBALANCE_TOLERANCE
    )


def rebalance_review_calendar(entries, daily_target, today=None):
    """
    Spread existing scheduled review dates from today onward.

    Entries are plain dicts so this function stays independent from SQLAlchemy.
    Each entry should include question_id, next_review, last_review, interval,
    and difficulty. The returned list keeps the input order and replaces only
    next_review/interval scheduling fields.
    """
    today = today or date.today()
    daily_limit = soft_rebalance_daily_limit(daily_target)
    assigned_loads = {}
    assigned = [None] * len(entries)

    def normalized_entry(index, entry):
        original_next_review = entry.get("next_review") or today
        effective_due_date = max(today, original_next_review)
        difficulty = entry.get("difficulty") or 5.0
        question_id = entry.get("question_id")
        current_type = type_key(entry.get("type_q"))

        return {
            "index": index,
            "entry": entry,
            "original_next_review": original_next_review,
            "effective_due_date": effective_due_date,
            "difficulty": difficulty,
            "question_id": question_id if question_id is not None else 0,
            "type_q": current_type
        }

    def type_mixed_order(items):
        by_due_date = {}

        for item in items:
            by_due_date.setdefault(item["effective_due_date"], []).append(item)

        ordered_items = []

        for due_date in sorted(by_due_date):
            by_type = {}

            for item in by_due_date[due_date]:
                by_type.setdefault(item["type_q"], []).append(item)

            for type_items in by_type.values():
                type_items.sort(
                    key=lambda item: (
                        item["original_next_review"],
                        -item["difficulty"],
                        item["question_id"]
                    )
                )

            type_order = sorted(
                by_type,
                key=lambda current_type: (
                    by_type[current_type][0]["original_next_review"],
                    current_type
                )
            )

            while any(by_type[current_type] for current_type in type_order):
                for current_type in type_order:
                    if by_type[current_type]:
                        ordered_items.append(by_type[current_type].pop(0))

        return ordered_items

    ordered = type_mixed_order(
        normalized_entry(index, entry)
        for index, entry in enumerate(entries)
    )

    for item in ordered:
        next_review = item["effective_due_date"]

        while assigned_loads.get(next_review, 0) >= daily_limit:
            next_review += timedelta(days=1)

        assigned_loads[next_review] = assigned_loads.get(next_review, 0) + 1

        entry = item["entry"]
        last_review = entry.get("last_review")

        if last_review:
            interval = max(0, (next_review - last_review).days)
        else:
            interval = max(0, (next_review - today).days)

        assigned[item["index"]] = {
            **entry,
            "original_next_review": item["original_next_review"],
            "effective_due_date": item["effective_due_date"],
            "interval": interval,
            "next_review": next_review
        }

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
