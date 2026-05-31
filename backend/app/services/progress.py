from datetime import date

from sqlalchemy import func

from ..models import Progress, Question
from ..scheduler import (
    FSRS_VERSION,
    assign_smoothed_schedules,
    apply_favorite_review_frequency,
    candidate_review_dates,
    new_fsrs_card_data,
    parse_history_date,
    rebalance_review_calendar,
    update_progress
)
from .settings import get_review_settings


def create_initial_progress(question_id: int):
    # New questions are due immediately so they appear in review without a
    # separate scheduling initialization step.
    return Progress(
        question_id=question_id,
        stability=1.0,
        difficulty=5.0,
        reps=0,
        lapses=0,
        interval=0,
        next_review=date.today(),
        fsrs_card=new_fsrs_card_data(question_id),
        fsrs_version=FSRS_VERSION,
        history=[]
    )


def record_answer_history(progress: Progress, quality: int, scheduling: dict):
    # SQLAlchemy may not detect in-place mutation on JSON columns reliably, so
    # build a fresh list before assigning it back.
    history = list(progress.history or [])

    entry = {
        "reviewed_on": scheduling["last_review"].isoformat(),
        "quality": quality,
        "stability": scheduling["stability"],
        "difficulty": scheduling["difficulty"],
        "reps": scheduling["reps"],
        "lapses": scheduling["lapses"],
        "interval": scheduling["interval"],
        "next_review": scheduling["next_review"].isoformat()
    }

    if "ideal_interval" in scheduling:
        entry["ideal_interval"] = scheduling["ideal_interval"]
        entry["ideal_next_review"] = scheduling["ideal_next_review"].isoformat()

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

    history.append(entry)

    progress.history = history


def write_scheduling(progress: Progress, quality: int, scheduling: dict):
    progress.stability = scheduling["stability"]
    progress.difficulty = scheduling["difficulty"]
    progress.reps = scheduling["reps"]
    progress.lapses = scheduling["lapses"]
    progress.interval = scheduling["interval"]
    progress.last_review = scheduling["last_review"]
    progress.next_review = scheduling["next_review"]
    progress.fsrs_card = scheduling.get("fsrs_card")
    progress.fsrs_version = scheduling.get("fsrs_version", FSRS_VERSION)

    record_answer_history(progress, quality, scheduling)

    return scheduling


def _number_from_history(entry, field, default, caster=float):
    try:
        return caster(entry.get(field))
    except (TypeError, ValueError):
        return default


def restore_progress_from_history(progress: Progress, history):
    history = list(history or [])
    progress.history = history

    if not history:
        progress.stability = 1.0
        progress.difficulty = 5.0
        progress.reps = 0
        progress.lapses = 0
        progress.interval = 0
        progress.last_review = None
        progress.next_review = date.today()
        progress.fsrs_card = new_fsrs_card_data(progress.question_id)
        progress.fsrs_version = FSRS_VERSION
        return

    latest = history[-1]
    last_review = parse_history_date(latest.get("reviewed_on"))
    next_review = parse_history_date(latest.get("next_review"))

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
        sum(1 for entry in history if entry.get("quality") == 0),
        caster=int
    )
    progress.interval = _number_from_history(latest, "interval", 0, caster=int)
    progress.last_review = last_review
    progress.next_review = next_review or date.today()
    progress.fsrs_card = None
    progress.fsrs_version = FSRS_VERSION


def replace_latest_scheduling(db, progress: Progress, quality: int):
    # Reopening the last review screen should correct the previous grade, not
    # count as another repetition. Roll progress back to the state represented
    # by the penultimate history item, then schedule once with the new quality.
    history = list(progress.history or [])

    if not history:
        return apply_scheduling(db, progress, quality)

    restore_progress_from_history(progress, history[:-1])

    return apply_scheduling(db, progress, quality)


def load_daily_review_counts(db, dates, exclude_question_ids=None):
    dates = set(dates)

    if not dates:
        return {}

    query = (
        db.query(Progress.next_review, func.count(Progress.id))
        .filter(Progress.next_review.in_(dates))
    )

    if exclude_question_ids:
        query = query.filter(~Progress.question_id.in_(exclude_question_ids))

    return {
        next_review: count
        for next_review, count in query.group_by(Progress.next_review).all()
    }


def load_daily_review_type_counts(db, dates, exclude_question_ids=None):
    dates = set(dates)

    if not dates:
        return {}

    query = (
        db.query(Progress.next_review, Question.type_q, func.count(Progress.id))
        .join(Question, Question.id == Progress.question_id)
        .filter(Progress.next_review.in_(dates))
    )

    if exclude_question_ids:
        query = query.filter(~Progress.question_id.in_(exclude_question_ids))

    result = {}

    for next_review, type_q, count in (
        query
        .group_by(Progress.next_review, Question.type_q)
        .all()
    ):
        result.setdefault(next_review, {})[type_q or "unknown"] = count

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


def apply_scheduling_batch(db, progress_quality_pairs, today=None):
    # Central write path for review answers. It computes raw scheduling first,
    # then smooths the whole batch so longer intervals claim flexible slots
    # before shorter intervals.
    items = []
    exclude_question_ids = set()
    candidate_dates = set()
    question_ids = {
        progress.question_id
        for progress, _ in progress_quality_pairs
        if progress.question_id is not None
    }
    question_metadata = load_question_review_metadata(db, question_ids)

    for progress, quality in progress_quality_pairs:
        metadata = question_metadata.get(progress.question_id, {})
        scheduling = update_progress(progress, quality, today=today)
        scheduling["type_q"] = metadata.get("type_q")
        scheduling = apply_favorite_review_frequency(
            scheduling,
            favorite=metadata.get("favorite", False)
        )
        items.append((progress, quality, scheduling))

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
        [scheduling for _, _, scheduling in items],
        daily_loads,
        daily_type_loads=daily_type_loads
    )

    for (progress, quality, _), scheduling in zip(items, smoothed_schedules):
        write_scheduling(progress, quality, scheduling)

    return smoothed_schedules


def apply_scheduling(db, progress: Progress, quality: int, today=None):
    return apply_scheduling_batch(
        db,
        [(progress, quality)],
        today=today
    )[0]


def rebalance_progress_calendar(db, today=None):
    settings = get_review_settings(db)
    daily_target = settings["catchup_daily_target"]
    progress_rows = (
        db.query(Progress, Question.type_q)
        .join(Question, Question.id == Progress.question_id)
        .all()
    )
    progresses = [progress for progress, _ in progress_rows]
    entries = [
        {
            "progress_id": progress.id,
            "question_id": progress.question_id,
            "next_review": progress.next_review,
            "last_review": progress.last_review,
            "interval": progress.interval or 0,
            "difficulty": progress.difficulty,
            "type_q": type_q,
            "fsrs_card": progress.fsrs_card
        }
        for progress, type_q in progress_rows
    ]
    rebalanced = rebalance_review_calendar(
        entries,
        daily_target,
        today=today
    )
    updated_count = 0
    moved_count = 0

    for progress, scheduling in zip(progresses, rebalanced):
        next_review_changed = progress.next_review != scheduling["next_review"]
        interval_changed = (progress.interval or 0) != scheduling["interval"]

        if next_review_changed:
            moved_count += 1

        if next_review_changed or interval_changed:
            updated_count += 1
            progress.next_review = scheduling["next_review"]
            progress.interval = scheduling["interval"]
            if scheduling.get("fsrs_card"):
                progress.fsrs_card = scheduling["fsrs_card"]
                progress.fsrs_version = FSRS_VERSION

    return {
        "daily_target": daily_target,
        "updated": updated_count,
        "moved": moved_count,
        "total": len(progresses)
    }
