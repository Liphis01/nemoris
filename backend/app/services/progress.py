from datetime import date

from ..models import Progress
from ..scheduler import update_progress


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

    history.append({
        "reviewed_on": scheduling["last_review"].isoformat(),
        "quality": quality,
        "stability": scheduling["stability"],
        "difficulty": scheduling["difficulty"],
        "reps": scheduling["reps"],
        "lapses": scheduling["lapses"],
        "interval": scheduling["interval"],
        "next_review": scheduling["next_review"].isoformat()
    })

    progress.history = history


def apply_scheduling(progress: Progress, quality: int):
    # Central write path for review answers. Keeping history updates here avoids
    # duplicating scheduling logic between text and map endpoints.
    scheduling = update_progress(progress, quality)

    progress.stability = scheduling["stability"]
    progress.difficulty = scheduling["difficulty"]
    progress.reps = scheduling["reps"]
    progress.lapses = scheduling["lapses"]
    progress.interval = scheduling["interval"]
    progress.last_review = scheduling["last_review"]
    progress.next_review = scheduling["next_review"]

    record_answer_history(progress, quality, scheduling)

    return scheduling
