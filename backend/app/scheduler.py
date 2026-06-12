from datetime import date, datetime, timedelta, timezone
import math

from fsrs import Card, Rating, Scheduler, State


DESIRED_RETENTION = 0.9
DEFAULT_CATCHUP_DAILY_TARGET = 50
CATCHUP_REBALANCE_TOLERANCE = 1.25
FSRS_VERSION = "6.3.1"
FSRS_MAXIMUM_INTERVAL = 36500
APP_QUALITY_AGAIN = 0
APP_QUALITY_HARD = 1
APP_QUALITY_GOOD = 2
APP_QUALITY_EASY = 3
FAVORITE_INTERVAL_MULTIPLIER = 0.7
MODE_REFERENCE_DIFFICULTY = 1.0
MIN_STABILITY = 0.1
MIN_DIFFICULTY = 1.0
MAX_DIFFICULTY = 10.0
MIN_FAILURE_PENALTY_FACTOR = 0.5
MAX_FAILURE_PENALTY_FACTOR = 2.5
MAX_SUCCESS_REWARD_FACTOR = 1.5
DEFAULT_EASY_REWARD_FLOOR = 0.5
MIN_EASY_REWARD_FLOOR = 0.35
MAX_EASY_REWARD_FLOOR = 0.70
DEFAULT_FAILURE_PENALTY_POWER = 1.0
MIN_FAILURE_PENALTY_POWER = 0.70
MAX_FAILURE_PENALTY_POWER = 1.40


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def normalize_mode_difficulty(mode_difficulty=None):
    try:
        difficulty = float(mode_difficulty)
    except (TypeError, ValueError):
        return MODE_REFERENCE_DIFFICULTY

    if not math.isfinite(difficulty) or difficulty <= 0:
        return MODE_REFERENCE_DIFFICULTY

    return difficulty


def normalize_easy_reward_floor(value=None):
    try:
        reward_floor = float(value)
    except (TypeError, ValueError):
        return DEFAULT_EASY_REWARD_FLOOR

    if not math.isfinite(reward_floor):
        return DEFAULT_EASY_REWARD_FLOOR

    return clamp(
        reward_floor,
        MIN_EASY_REWARD_FLOOR,
        MAX_EASY_REWARD_FLOOR
    )


def normalize_failure_penalty_power(value=None):
    try:
        penalty_power = float(value)
    except (TypeError, ValueError):
        return DEFAULT_FAILURE_PENALTY_POWER

    if not math.isfinite(penalty_power):
        return DEFAULT_FAILURE_PENALTY_POWER

    return clamp(
        penalty_power,
        MIN_FAILURE_PENALTY_POWER,
        MAX_FAILURE_PENALTY_POWER
    )


def _tuning_value(scheduler_tuning, key, explicit_value=None):
    if explicit_value is not None:
        return explicit_value

    if isinstance(scheduler_tuning, dict):
        return scheduler_tuning.get(key)

    return None


def failure_penalty_factor(mode_difficulty=None, failure_penalty_power=None):
    penalty_power = normalize_failure_penalty_power(failure_penalty_power)

    return clamp(
        (1 / normalize_mode_difficulty(mode_difficulty)) ** penalty_power,
        MIN_FAILURE_PENALTY_FACTOR,
        MAX_FAILURE_PENALTY_FACTOR
    )


def success_reward_factor(mode_difficulty=None, easy_reward_floor=None):
    difficulty = normalize_mode_difficulty(mode_difficulty)
    reward_floor = normalize_easy_reward_floor(easy_reward_floor)

    if difficulty <= MODE_REFERENCE_DIFFICULTY:
        return reward_floor + ((1 - reward_floor) * difficulty)

    return clamp(
        difficulty,
        MODE_REFERENCE_DIFFICULTY,
        MAX_SUCCESS_REWARD_FACTOR
    )


def _apply_failure_stability_penalty(previous, current, penalty_factor):
    adjusted = previous + ((current - previous) * penalty_factor)

    if adjusted >= MIN_STABILITY:
        return adjusted

    if penalty_factor <= MODE_REFERENCE_DIFFICULTY:
        return adjusted

    extra_penalty = 1 - (1 / penalty_factor)
    return current - ((current - MIN_STABILITY) * extra_penalty)


def _apply_failure_difficulty_penalty(previous, current, penalty_factor):
    adjusted = previous + ((current - previous) * penalty_factor)

    if adjusted <= MAX_DIFFICULTY:
        return adjusted

    if penalty_factor <= MODE_REFERENCE_DIFFICULTY:
        return adjusted

    extra_penalty = 1 - (1 / penalty_factor)
    return current + ((MAX_DIFFICULTY - current) * extra_penalty)


def review_datetime_for_date(day):
    day = day or date.today()
    return datetime(
        day.year,
        day.month,
        day.day,
        12,
        0,
        0,
        tzinfo=timezone.utc
    )


def date_from_review_datetime(value):
    if not value:
        return None

    return value.astimezone(timezone.utc).date()


def parse_history_date(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None


def create_fsrs_scheduler(enable_fuzzing=True):
    return Scheduler(
        desired_retention=DESIRED_RETENTION,
        learning_steps=(),
        relearning_steps=(),
        maximum_interval=FSRS_MAXIMUM_INTERVAL,
        enable_fuzzing=enable_fuzzing
    )


def app_quality_to_fsrs_rating(quality):
    try:
        quality = int(quality)
    except (TypeError, ValueError):
        raise ValueError("Review quality must be between 0 and 3")

    if quality not in {
        APP_QUALITY_AGAIN,
        APP_QUALITY_HARD,
        APP_QUALITY_GOOD,
        APP_QUALITY_EASY
    }:
        raise ValueError("Review quality must be between 0 and 3")

    return Rating(quality + 1)


def legacy_quality_to_fsrs_rating(quality, type_q=None):
    try:
        quality = int(quality)
    except (TypeError, ValueError):
        return None

    if quality == APP_QUALITY_AGAIN:
        return Rating.Again
    if quality == APP_QUALITY_HARD:
        return Rating.Hard
    if quality == APP_QUALITY_GOOD:
        return Rating.Easy if type_q == "text" else Rating.Good
    if quality == APP_QUALITY_EASY:
        return Rating.Easy

    return None


def fsrs_card_to_dict(card):
    return card.to_dict()


def new_fsrs_card_data(question_id, due=None):
    return fsrs_card_to_dict(
        Card(
            card_id=question_id or 0,
            due=review_datetime_for_date(due or date.today())
        )
    )


def fsrs_card_from_data(data):
    if not data:
        return None

    if isinstance(data, str):
        return Card.from_json(data)

    return Card.from_dict(data)


def set_fsrs_card_due_date(card_data, next_review):
    if not card_data or not next_review:
        return card_data

    try:
        card = fsrs_card_from_data(card_data)
    except (TypeError, ValueError, KeyError):
        return card_data

    card.due = review_datetime_for_date(next_review)

    return fsrs_card_to_dict(card)


def _scalar_review_card(progress, today=None):
    due_date = getattr(progress, "next_review", None) or today or date.today()
    last_review = getattr(progress, "last_review", None)
    interval = getattr(progress, "interval", None) or 0
    reps = getattr(progress, "reps", None) or 0
    stability = progress_value(progress, "stability", None)
    difficulty = progress_value(progress, "difficulty", None)

    if not last_review and reps > 0 and interval > 0:
        last_review = due_date - timedelta(days=interval)

    if (
        reps > 0 and
        last_review and
        stability is not None and
        difficulty is not None
    ):
        return Card(
            card_id=getattr(progress, "question_id", None) or 0,
            state=State.Review,
            step=None,
            stability=float(stability),
            difficulty=float(difficulty),
            due=review_datetime_for_date(due_date),
            last_review=review_datetime_for_date(last_review)
        )

    return Card(
        card_id=getattr(progress, "question_id", None) or 0,
        due=review_datetime_for_date(due_date)
    )


def fsrs_card_for_progress(progress, today=None):
    if progress and getattr(progress, "fsrs_card", None):
        try:
            return fsrs_card_from_data(progress.fsrs_card)
        except (TypeError, ValueError, KeyError):
            pass

    return _scalar_review_card(progress, today=today)


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


def favorite_interval(interval):
    if interval <= 1:
        return interval

    boosted = max(1, math.floor(interval * FAVORITE_INTERVAL_MULTIPLIER))
    return min(interval - 1, boosted)


def apply_favorite_review_frequency(scheduling, favorite=False):
    if not favorite:
        return scheduling

    interval = scheduling["interval"]
    boosted_interval = favorite_interval(interval)

    if boosted_interval == interval:
        return scheduling

    last_review = scheduling["last_review"]
    next_review = last_review + timedelta(days=boosted_interval)

    return {
        **scheduling,
        "favorite_boost": True,
        "favorite_base_interval": interval,
        "favorite_base_next_review": scheduling["next_review"],
        "interval": boosted_interval,
        "next_review": next_review,
        "fsrs_card": set_fsrs_card_due_date(
            scheduling.get("fsrs_card"),
            next_review
        )
    }


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

    smoothed = {
        **scheduling,
        "ideal_interval": ideal_interval,
        "ideal_next_review": ideal_next_review,
        "interval": max(0, (next_review - today).days),
        "next_review": next_review
    }

    if smoothed.get("fsrs_card"):
        smoothed["fsrs_card"] = set_fsrs_card_due_date(
            smoothed["fsrs_card"],
            next_review
        )

    return smoothed


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


def rebalance_review_calendar(
    entries,
    daily_target,
    today=None,
    initial_daily_loads=None
):
    """
    Spread existing scheduled review dates from today onward.

    Entries are plain dicts so this function stays independent from SQLAlchemy.
    Each entry should include question_id, next_review, ideal_next_review,
    last_review, interval, ideal_interval, and difficulty. The returned list
    keeps the input order and replaces only next_review/interval scheduling
    fields; ideal_* is copied through unchanged. initial_daily_loads can seed
    capacity already consumed by reviews completed earlier in the day.
    """
    today = today or date.today()
    daily_limit = soft_rebalance_daily_limit(daily_target)
    assigned_loads = {}
    assigned = [None] * len(entries)

    for day, count in (initial_daily_loads or {}).items():
        try:
            normalized_count = int(count)
        except (TypeError, ValueError):
            continue

        if normalized_count > 0:
            assigned_loads[day] = normalized_count

    def normalized_entry(index, entry):
        original_next_review = entry.get("next_review") or today
        ideal_next_review = (
            entry.get("ideal_next_review") or original_next_review
        )
        effective_due_date = max(today, ideal_next_review)
        difficulty = entry.get("difficulty") or 5.0
        question_id = entry.get("question_id")
        current_type = type_key(entry.get("type_q"))

        return {
            "index": index,
            "entry": entry,
            "original_next_review": original_next_review,
            "ideal_next_review": ideal_next_review,
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
                        item["ideal_next_review"],
                        -item["difficulty"],
                        item["question_id"]
                    )
                )

            type_order = sorted(
                by_type,
                key=lambda current_type: (
                    by_type[current_type][0]["ideal_next_review"],
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
            "ideal_next_review": entry.get("ideal_next_review"),
            "effective_due_date": item["effective_due_date"],
            "interval": interval,
            "ideal_interval": entry.get("ideal_interval"),
            "next_review": next_review,
            "fsrs_card": set_fsrs_card_due_date(
                entry.get("fsrs_card"),
                next_review
            )
        }

    return assigned


def _mode_adjustment_anchor(progress, card, field, default):
    value = getattr(card, field, None)

    if value is not None:
        return float(value)

    return float(progress_value(progress, field, default))


def _adjust_interval_for_success(
    previous_interval,
    base_interval,
    reward_factor
):
    if base_interval <= previous_interval:
        return base_interval

    adjusted = previous_interval + (
        (base_interval - previous_interval) * reward_factor
    )

    if reward_factor < MODE_REFERENCE_DIFFICULTY:
        interval = math.floor(adjusted)
    elif reward_factor > MODE_REFERENCE_DIFFICULTY:
        interval = math.ceil(adjusted)
    else:
        interval = base_interval

    return clamp(max(1, interval), 0, FSRS_MAXIMUM_INTERVAL)


def apply_mode_difficulty_to_review(
    progress,
    rating,
    card,
    reviewed_card,
    last_review,
    next_review,
    review_datetime,
    mode_difficulty=None,
    easy_reward_floor=None,
    failure_penalty_power=None
):
    mode_difficulty = normalize_mode_difficulty(mode_difficulty)
    base_interval = max(0, (next_review - last_review).days)

    if mode_difficulty == MODE_REFERENCE_DIFFICULTY:
        return {
            "card": reviewed_card,
            "interval": base_interval,
            "next_review": next_review,
            "mode_difficulty": mode_difficulty
        }

    previous_stability = _mode_adjustment_anchor(
        progress,
        card,
        "stability",
        1.0
    )
    previous_difficulty = _mode_adjustment_anchor(
        progress,
        card,
        "difficulty",
        5.0
    )
    previous_interval = int(progress_value(progress, "interval", 0))
    stability = reviewed_card.stability
    difficulty = reviewed_card.difficulty
    result = {
        "card": reviewed_card,
        "interval": base_interval,
        "next_review": next_review,
        "mode_difficulty": mode_difficulty,
        "mode_adjusted": True
    }

    if rating == Rating.Again:
        penalty_factor = failure_penalty_factor(
            mode_difficulty,
            failure_penalty_power=failure_penalty_power
        )

        if stability is not None and stability < previous_stability:
            stability = _apply_failure_stability_penalty(
                previous_stability,
                stability,
                penalty_factor
            )

        if difficulty is not None and difficulty > previous_difficulty:
            difficulty = _apply_failure_difficulty_penalty(
                previous_difficulty,
                difficulty,
                penalty_factor
            )

        reviewed_card.due = review_datetime
        result.update({
            "interval": 0,
            "next_review": date_from_review_datetime(reviewed_card.due),
            "mode_penalty_factor": penalty_factor
        })
    else:
        reward_factor = success_reward_factor(
            mode_difficulty,
            easy_reward_floor=easy_reward_floor
        )

        if stability is not None and stability > previous_stability:
            stability = previous_stability + (
                (stability - previous_stability) * reward_factor
            )

        if difficulty is not None and difficulty < previous_difficulty:
            difficulty = previous_difficulty + (
                (difficulty - previous_difficulty) * reward_factor
            )

        interval = _adjust_interval_for_success(
            previous_interval,
            base_interval,
            reward_factor
        )

        if interval != base_interval:
            next_review = last_review + timedelta(days=interval)
            reviewed_card.due = review_datetime_for_date(next_review)

        result.update({
            "interval": interval,
            "next_review": next_review,
            "mode_reward_factor": reward_factor
        })

    if stability is not None:
        reviewed_card.stability = max(MIN_STABILITY, stability)

    if difficulty is not None:
        reviewed_card.difficulty = clamp(
            difficulty,
            MIN_DIFFICULTY,
            MAX_DIFFICULTY
        )

    result["card"] = reviewed_card

    return result


def update_progress(
    progress,
    quality,
    today=None,
    mode_difficulty=None,
    enable_fuzzing=True,
    scheduler_tuning=None,
    easy_reward_floor=None,
    failure_penalty_power=None
):
    """
    Apply an FSRS v6 scheduling step.

    quality: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy. The returned dict is
    written back to Progress by services/progress.py so scheduling stays
    isolated from database mutation.
    """
    today = today or date.today()
    easy_reward_floor = _tuning_value(
        scheduler_tuning,
        "easy_reward_floor",
        easy_reward_floor
    )
    failure_penalty_power = _tuning_value(
        scheduler_tuning,
        "failure_penalty_power",
        failure_penalty_power
    )
    rating = app_quality_to_fsrs_rating(quality)
    scheduler = create_fsrs_scheduler(enable_fuzzing=enable_fuzzing)
    review_datetime = review_datetime_for_date(today)
    card = fsrs_card_for_progress(progress, today=today)
    reviewed_card, review_log = scheduler.review_card(
        card,
        rating,
        review_datetime=review_datetime
    )
    next_review = date_from_review_datetime(reviewed_card.due)
    last_review = date_from_review_datetime(reviewed_card.last_review) or today
    reps = progress_value(progress, "reps", 0) + 1
    lapses = progress_value(progress, "lapses", 0)

    if rating == Rating.Again:
        lapses += 1
        # A failed card stays due immediately so leaving and reopening review
        # does not drop the retry that the frontend would have queued in memory.
        reviewed_card.due = review_datetime
        next_review = today

    mode_adjustment = apply_mode_difficulty_to_review(
        progress,
        rating,
        card,
        reviewed_card,
        last_review,
        next_review,
        review_datetime,
        mode_difficulty=mode_difficulty,
        easy_reward_floor=easy_reward_floor,
        failure_penalty_power=failure_penalty_power
    )
    reviewed_card = mode_adjustment["card"]
    next_review = mode_adjustment["next_review"]

    scheduling = {
        "stability": reviewed_card.stability,
        "difficulty": reviewed_card.difficulty,
        "reps": reps,
        "lapses": lapses,
        "interval": mode_adjustment["interval"],
        "next_review": next_review,
        "last_review": last_review,
        "fsrs_card": fsrs_card_to_dict(reviewed_card),
        "fsrs_version": FSRS_VERSION,
        "fsrs_rating": int(rating),
        "fsrs_state": int(reviewed_card.state),
        "fsrs_review_log": review_log.to_dict()
    }

    for key in (
        "mode_difficulty",
        "mode_adjusted",
        "mode_penalty_factor",
        "mode_reward_factor"
    ):
        if key in mode_adjustment:
            if key == "mode_difficulty" and mode_difficulty is None:
                continue
            scheduling[key] = mode_adjustment[key]

    return scheduling


def preview_intervals(
    progress,
    favorite=False,
    mode_difficulty=None,
    scheduler_tuning=None,
    easy_reward_floor=None,
    failure_penalty_power=None
):
    # The map recap can show what each button would schedule before the user
    # commits a quality choice.
    today = date.today()
    easy_reward_floor = _tuning_value(
        scheduler_tuning,
        "easy_reward_floor",
        easy_reward_floor
    )
    failure_penalty_power = _tuning_value(
        scheduler_tuning,
        "failure_penalty_power",
        failure_penalty_power
    )
    scheduler = create_fsrs_scheduler(enable_fuzzing=False)
    card = fsrs_card_for_progress(progress, today=today)
    review_datetime = review_datetime_for_date(today)
    intervals = {}

    for quality in (
        APP_QUALITY_AGAIN,
        APP_QUALITY_HARD,
        APP_QUALITY_GOOD,
        APP_QUALITY_EASY
    ):
        rating = app_quality_to_fsrs_rating(quality)
        reviewed_card, _ = scheduler.review_card(
            card,
            rating,
            review_datetime=review_datetime
        )
        next_review = date_from_review_datetime(reviewed_card.due)
        last_review = date_from_review_datetime(reviewed_card.last_review)
        if rating == Rating.Again:
            reviewed_card.due = review_datetime
            next_review = today
        mode_adjustment = apply_mode_difficulty_to_review(
            progress,
            rating,
            card,
            reviewed_card,
            last_review,
            next_review,
            review_datetime,
            mode_difficulty=mode_difficulty,
            easy_reward_floor=easy_reward_floor,
            failure_penalty_power=failure_penalty_power
        )
        interval = mode_adjustment["interval"]
        intervals[quality] = favorite_interval(interval) if favorite else interval

    return intervals
