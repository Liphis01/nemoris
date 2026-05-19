from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import Progress
from ..schemas import AnswerRequest, MapAnswerRequest
from ..services.progress import apply_scheduling, create_initial_progress
from ..services.review import get_review_items


router = APIRouter()


@router.get("/review")
def get_review(
    tags: Optional[List[str]] = Query(default=None),
    limit: int = 200,
    collection_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    return get_review_items(
        db,
        tags=tags,
        limit=limit,
        collection_id=collection_id
    )


@router.post("/answer")
def answer_question(data: AnswerRequest, db: Session = Depends(get_db)):
    progress = (
        db.query(Progress)
        .filter(Progress.question_id == data.question_id)
        .first()
    )

    if not progress:
        progress = create_initial_progress(data.question_id)
        db.add(progress)

    apply_scheduling(progress, data.quality)
    db.commit()

    return {
        "stability": progress.stability,
        "difficulty": progress.difficulty,
        "interval": progress.interval,
        "last_review": progress.last_review,
        "next_review": progress.next_review,
        "reps": progress.reps,
        "lapses": progress.lapses,
        "history": progress.history or []
    }


@router.post("/answer_map")
def answer_map(data: MapAnswerRequest, db: Session = Depends(get_db)):
    question_ids = list(data.items.keys())

    existing_progresses = (
        db.query(Progress)
        .filter(Progress.question_id.in_(question_ids))
        .all()
    )

    progress_map = {
        progress.question_id: progress
        for progress in existing_progresses
    }

    for question_id, quality in data.items.items():
        progress = progress_map.get(question_id)

        if not progress:
            progress = create_initial_progress(question_id)
            db.add(progress)
            progress_map[question_id] = progress

        apply_scheduling(progress, quality)

    db.commit()

    return {"status": "ok"}
