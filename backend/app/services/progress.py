from datetime import date, timedelta

from ..models import Progress, Question
from ..scheduler import (
    FSRS_VERSION,
    MIN_STABILITY,
    assign_smoothed_schedules,
    apply_favorite_review_frequency,
    candidate_review_dates,
    create_fsrs_scheduler,
    new_fsrs_card_data,
    parse_history_date,
    progress_in_relearning,
    rebalance_review_calendar,
    set_fsrs_card_due_date,
    update_progress
)
from .settings import get_review_settings, load_scheduler_tuning_settings


def create_initial_progress(question_id: int, today=None):
    # Progress is created lazily on the first answer. At that point the card
    # should schedule from the review session day just like a first FSRS review.
    today = today or date.today()

    return Progress(
        question_id=question_id,
        stability=1.0,
        difficulty=5.0,
        reps=0,
        lapses=0,
        interval=0,
        ideal_interval=None,
        next_review=today,
        ideal_next_review=None,
        fsrs_card=new_fsrs_card_data(question_id, due=today),
        fsrs_version=FSRS_VERSION,
        history=[]
    )


def progress_has_started(progress: Progress | None):
    if not progress:
        return False

    return (
        (progress.reps or 0) > 0 or
        bool(progress.last_review) or
        len(progress.history or []) > 0
    )


def progress_is_new(progress: Progress | None):
    return not progress_has_started(progress)


def count_reviews_on_day(progresses, day):
    count = 0

    for progress in progresses:
        for entry in progress.history or []:
            if not isinstance(entry, dict):
                continue

            if parse_history_date(entry.get("reviewed_on")) == day:
                count += 1

    return count


def record_answer_history(
    progress: Progress,
    quality: int,
    scheduling: dict,
    metadata=None
):
    # SQLAlchemy may not detect in-place mutation on JSON columns reliably, so
    # build a fresh list before assigning it back.
    history = list(progress.history or [])
    ideal_interval = scheduling.get("ideal_interval", scheduling["interval"])
    ideal_next_review = scheduling.get(
        "ideal_next_review",
        scheduling["next_review"]
    )

    entry = {
        "reviewed_on": scheduling["last_review"].isoformat(),
        "quality": quality,
        "stability": scheduling["stability"],
        "difficulty": scheduling["difficulty"],
        "reps": scheduling["reps"],
        "lapses": scheduling["lapses"],
        "interval": scheduling["interval"],
        "next_review": scheduling["next_review"].isoformat(),
        "ideal_interval": ideal_interval,
        "ideal_next_review": ideal_next_review.isoformat()
    }

    if scheduling.get("favorite_boost"):
        entry["favorite_boost"] = True
        entry["favorite_base_interval"] = scheduling["favorite_base_interval"]
        entry["favorite_base_next_review"] = (
            scheduling["favorite_base_next_review"].isoformat()
        )

    if "fsrs_rating" in scheduling:
        entry["fsrs_rating"] = scheduling["fsrs_rating"]
        entry["fsrs_state"] = scheduling["fsrs_state"]
        entry["fsrs_version"] = scheduling["fsrs_version"]

    for key in (
        "mode_adjusted",
        "mode_difficulty",
        "mode_penalty_factor",
        "mode_reward_factor"
    ):
        if key in scheduling:
            entry[key] = scheduling[key]

    if scheduling.get("repeat_lapse"):
        # Marks the retries that deliberately did not move stability, difficulty
        # or the lapse count, so replayed history matches what was scheduled.
        entry["repeat_lapse"] = True

    if metadata:
        entry.update(metadata)

    history.append(entry)

    progress.history = history


def write_scheduling(
    progress: Progress,
    quality: int,
    scheduling: dict,
    metadata=None
):
    ideal_interval = scheduling.get("ideal_interval", scheduling["interval"])
    ideal_next_review = scheduling.get(
        "ideal_next_review",
        scheduling["next_review"]
    )

    progress.stability = scheduling["stability"]
    progress.difficulty = scheduling["difficulty"]
    progress.reps = scheduling["reps"]
    progress.lapses = scheduling["lapses"]
    progress.interval = scheduling["interval"]
    progress.ideal_interval = ideal_interval
    progress.last_review = scheduling["last_review"]
    progress.next_review = scheduling["next_review"]
    progress.ideal_next_review = ideal_next_review
    progress.fsrs_card = scheduling.get("fsrs_card")
    progress.fsrs_version = scheduling.get("fsrs_version", FSRS_VERSION)

    # A frozen relearning retry leaves no trace in history, so the day keeps
    # showing exactly one fail and stats stay honest.
    if not scheduling.get("skip_history"):
        record_answer_history(progress, quality, scheduling, metadata=metadata)

    return scheduling


def _number_from_history(entry, field, default, caster=float):
    try:
        return caster(entry.get(field))
    except (TypeError, ValueError):
        return default


def restore_progress_from_history(progress: Progress, history, today=None):
    history = list(history or [])
    progress.history = history
    today = today or date.today()

    if not history:
        progress.stability = 1.0
        progress.difficulty = 5.0
        progress.reps = 0
        progress.lapses = 0
        progress.interval = 0
        progress.ideal_interval = None
        progress.last_review = None
        progress.next_review = today
        progress.ideal_next_review = None
        progress.fsrs_card = new_fsrs_card_data(progress.question_id, due=today)
        progress.fsrs_version = FSRS_VERSION
        return

    latest = history[-1]
    last_review = parse_history_date(latest.get("reviewed_on"))
    next_review = parse_history_date(latest.get("next_review"))
    ideal_next_review = (
        parse_history_date(latest.get("ideal_next_review")) or next_review
    )

    progress.stability = _number_from_history(latest, "stability", 1.0)
    progress.difficulty = _number_from_history(latest, "difficulty", 5.0)
    progress.reps = _number_from_history(
        latest,
        "reps",
        len(history),
        caster=int
    )
    progress.lapses = _number_from_history(
        latest,
        "lapses",
        sum(
            1
            for entry in history
            if entry.get("quality") == 0 and not entry.get("repeat_lapse")
        ),
        caster=int
    )
    progress.interval = _number_from_history(latest, "interval", 0, caster=int)
    progress.ideal_interval = _number_from_history(
        latest,
        "ideal_interval",
        progress.interval,
        caster=int
    )
    progress.last_review = last_review
    progress.next_review = next_review or today
    progress.ideal_next_review = ideal_next_review
    progress.fsrs_card = None
    progress.fsrs_version = FSRS_VERSION


def replace_latest_scheduling(
    db,
    progress: Progress,
    quality: int,
    today=None,
    metadata=None
):
    # Reopening the last review screen should correct the previous grade, not
    # count as another repetition. Roll progress back to the state represented
    # by the penultimate history item, then schedule once with the new quality.
    history = list(progress.history or [])

    if not history:
        return apply_scheduling(
            db,
            progress,
            quality,
            today=today,
            metadata=metadata
        )

    restore_progress_from_history(progress, history[:-1], today=today)

    return apply_scheduling(
        db,
        progress,
        quality,
        today=today,
        metadata=metadata
    )


def load_daily_review_counts(db, dates, exclude_question_ids=None):
    dates = set(dates)

    if not dates:
        return {}

    query = (
        db.query(Progress)
        .filter(Progress.next_review.in_(dates))
    )

    if exclude_question_ids:
        query = query.filter(~Progress.question_id.in_(exclude_question_ids))

    counts = {}

    for progress in query.all():
        if progress_is_new(progress):
            continue

        counts[progress.next_review] = counts.get(progress.next_review, 0) + 1

    return counts


def load_daily_review_type_counts(db, dates, exclude_question_ids=None):
    dates = set(dates)

    if not dates:
        return {}

    query = (
        db.query(Progress, Question.type_q)
        .join(Question, Question.id == Progress.question_id)
        .filter(Progress.next_review.in_(dates))
    )

    if exclude_question_ids:
        query = query.filter(~Progress.question_id.in_(exclude_question_ids))

    result = {}

    for progress, type_q in query.all():
        if progress_is_new(progress):
            continue

        type_counts = result.setdefault(progress.next_review, {})
        current_type = type_q or "unknown"
        type_counts[current_type] = type_counts.get(current_type, 0) + 1

    return result


def load_question_review_metadata(db, question_ids):
    question_ids = set(question_ids)

    if not question_ids:
        return {}

    return {
        question_id: {
            "type_q": type_q,
            "favorite": bool((data or {}).get("favorite"))
        }
        for question_id, type_q, data in (
            db.query(Question.id, Question.type_q, Question.data)
            .filter(Question.id.in_(question_ids))
            .all()
        )
    }


def _normalize_progress_quality_pair(pair):
    if len(pair) == 2:
        progress, quality = pair
        return progress, quality, None

    progress, quality, metadata = pair
    return progress, quality, metadata


def apply_scheduling_batch(
    db,
    progress_quality_pairs,
    today=None,
    scheduler_tuning=None
):
    # Central write path for review answers. It computes raw scheduling first,
    # then smooths the whole batch so longer intervals claim flexible slots
    # before shorter intervals.
    items = []
    scheduler_tuning = (
        scheduler_tuning
        if scheduler_tuning is not None
        else load_scheduler_tuning_settings(db)
    )
    daily_target = get_review_settings(db)["catchup_daily_target"]
    exclude_question_ids = set()
    candidate_dates = set()
    question_ids = {
        progress.question_id
        for progress, _, _ in [
            _normalize_progress_quality_pair(pair)
            for pair in progress_quality_pairs
        ]
        if progress.question_id is not None
    }
    question_metadata = load_question_review_metadata(db, question_ids)

    for pair in progress_quality_pairs:
        progress, quality, history_metadata = _normalize_progress_quality_pair(pair)
        metadata = question_metadata.get(progress.question_id, {})
        mode_difficulty = (
            history_metadata.get("mode_difficulty")
            if isinstance(history_metadata, dict)
            else None
        )
        scheduling = update_progress(
            progress,
            quality,
            today=today,
            mode_difficulty=mode_difficulty,
            scheduler_tuning=scheduler_tuning
        )
        scheduling["type_q"] = metadata.get("type_q")
        scheduling = apply_favorite_review_frequency(
            scheduling,
            favorite=metadata.get("favorite", False)
        )
        scheduling["ideal_interval"] = scheduling["interval"]
        scheduling["ideal_next_review"] = scheduling["next_review"]
        items.append((progress, quality, scheduling, history_metadata))

        if progress.question_id is not None:
            exclude_question_ids.add(progress.question_id)

        candidate_dates.update(
            candidate_review_dates(
                scheduling["last_review"],
                scheduling["next_review"],
                scheduling["interval"]
            )
        )

    daily_loads = load_daily_review_counts(
        db,
        candidate_dates,
        exclude_question_ids=exclude_question_ids
    )
    daily_type_loads = load_daily_review_type_counts(
        db,
        candidate_dates,
        exclude_question_ids=exclude_question_ids
    )
    smoothed_schedules = assign_smoothed_schedules(
        [scheduling for _, _, scheduling, _ in items],
        daily_loads,
        daily_type_loads=daily_type_loads,
        daily_target=daily_target
    )

    for (progress, quality, _, history_metadata), scheduling in zip(
        items,
        smoothed_schedules
    ):
        write_scheduling(
            progress,
            quality,
            scheduling,
            metadata=history_metadata
        )

    return smoothed_schedules


def apply_scheduling(
    db,
    progress: Progress,
    quality: int,
    today=None,
    metadata=None
):
    return apply_scheduling_batch(
        db,
        [(progress, quality, metadata)] if metadata else [(progress, quality)],
        today=today
    )[0]


def graduate_relearning(db, question_ids, today=None):
    """
    Finish the in-session relearning loop for the given cards ("Acquis").

    This carries no grade: the first fail already recorded the lapse and froze the
    memory state, and the user's directive is that FSRS ignores everything after
    it. So this only moves the card out of today's queue, to the interval its
    frozen stability already implies (~1-2 days) -- stability, difficulty, lapses,
    reps and history are left untouched. Cards that are not actually in relearning
    are skipped, so the call is safe and idempotent.
    """
    today = today or date.today()
    scheduler = create_fsrs_scheduler(enable_fuzzing=False)
    graduated = []

    for question_id in question_ids:
        progress = (
            db.query(Progress)
            .filter(Progress.question_id == question_id)
            .first()
        )

        if not progress or not progress_in_relearning(progress, today):
            continue

        interval = scheduler._next_interval(
            stability=progress.stability or MIN_STABILITY
        )
        next_review = today + timedelta(days=interval)

        progress.interval = interval
        progress.ideal_interval = interval
        progress.next_review = next_review
        progress.ideal_next_review = next_review
        progress.fsrs_card = set_fsrs_card_due_date(
            progress.fsrs_card,
            next_review
        )
        graduated.append(progress)

    return graduated


def rebalance_progress_calendar(db, today=None):
    today = today or date.today()
    settings = get_review_settings(db)
    daily_target = settings["catchup_daily_target"]
    progress_rows = [
        (progress, type_q)
        for progress, type_q in (
            db.query(Progress, Question.type_q)
            .join(Question, Question.id == Progress.question_id)
            .all()
        )
        if progress_has_started(progress)
    ]
    progresses = [progress for progress, _ in progress_rows]
    entries = [
        {
            "progress_id": progress.id,
            "question_id": progress.question_id,
            "next_review": progress.next_review,
            "ideal_next_review": progress.ideal_next_review,
            "last_review": progress.last_review,
            "interval": progress.interval or 0,
            "ideal_interval": progress.ideal_interval,
            "difficulty": progress.difficulty,
            "type_q": type_q,
            "fsrs_card": progress.fsrs_card
        }
        for progress, type_q in progress_rows
    ]
    rebalanced = rebalance_review_calendar(
        entries,
        daily_target,
        today=today,
        initial_daily_loads={
            today: count_reviews_on_day(progresses, today)
        }
    )
    updated_count = 0
    moved_count = 0

    for progress, scheduling in zip(progresses, rebalanced):
        next_review_changed = progress.next_review != scheduling["next_review"]
        interval_changed = (progress.interval or 0) != scheduling["interval"]
        ideal_next_review_changed = (
            progress.ideal_next_review is None
            and scheduling.get("ideal_next_review") is not None
        )
        ideal_interval_changed = (
            progress.ideal_interval is None
            and scheduling.get("ideal_interval") is not None
        )

        if next_review_changed:
            moved_count += 1

        if (
            next_review_changed
            or interval_changed
            or ideal_next_review_changed
            or ideal_interval_changed
        ):
            updated_count += 1
            progress.next_review = scheduling["next_review"]
            progress.interval = scheduling["interval"]
            if ideal_next_review_changed:
                progress.ideal_next_review = scheduling["ideal_next_review"]
            if ideal_interval_changed:
                progress.ideal_interval = scheduling["ideal_interval"]
            if scheduling.get("fsrs_card"):
                progress.fsrs_card = scheduling["fsrs_card"]
                progress.fsrs_version = FSRS_VERSION

    return {
        "daily_target": daily_target,
        "updated": updated_count,
        "moved": moved_count,
        "total": len(progresses)
    }
