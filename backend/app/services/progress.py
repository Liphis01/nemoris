from datetime import date

from sqlalchemy import func

from ..models import Progress
from ..scheduler import (
    assign_smoothed_schedules,
    candidate_review_dates,
    update_progress
)


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

    record_answer_history(progress, quality, scheduling)

    return scheduling


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


def apply_scheduling_batch(db, progress_quality_pairs, today=None):
    # Central write path for review answers. It computes raw scheduling first,
    # then smooths the whole batch so longer intervals claim flexible slots
    # before shorter intervals.
    items = []
    exclude_question_ids = set()
    candidate_dates = set()

    for progress, quality in progress_quality_pairs:
        scheduling = update_progress(progress, quality, today=today)
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
    smoothed_schedules = assign_smoothed_schedules(
        [scheduling for _, _, scheduling in items],
        daily_loads
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
