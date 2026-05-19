from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import Progress, Question
from ..schemas import AnswerRequest, MapAnswerRequest, TimelineAnswerRequest
from ..serializers import serialize_progress
from ..services.progress import apply_scheduling, create_initial_progress
from ..services.review import get_review_items
from ..services.timeline import grade_timeline_answer, validate_timeline_data


router = APIRouter()


@router.get("/review")
def get_review(
    tags: Optional[List[str]] = Query(default=None),
    limit: int = 200,
    collection_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    # The service handles due filtering and runtime map grouping; the route only
    # translates query parameters into that call.
    return get_review_items(
        db,
        tags=tags,
        limit=limit,
        collection_id=collection_id
    )


@router.post("/answer")
def answer_question(data: AnswerRequest, db: Session = Depends(get_db)):
    # Old/imported questions may not have progress yet, so create it lazily on
    # first answer.
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

    # One map submit can grade many independent zone questions. Fetch existing
    # progress rows in one query, then create any missing rows while iterating.
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


@router.post("/answer_timeline")
def answer_timeline(data: TimelineAnswerRequest, db: Session = Depends(get_db)):
    question_ids = list(data.items.keys())

    questions = (
        db.query(Question)
        .filter(Question.id.in_(question_ids))
        .all()
    )
    question_map = {
        question.id: question
        for question in questions
    }

    missing_ids = [
        question_id
        for question_id in question_ids
        if question_id not in question_map
    ]

    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Questions not found: {missing_ids}"
        )

    existing_progresses = (
        db.query(Progress)
        .filter(Progress.question_id.in_(question_ids))
        .all()
    )
    progress_map = {
        progress.question_id: progress
        for progress in existing_progresses
    }
    results = []

    for question_id, guess in data.items.items():
        question = question_map[question_id]

        if question.type_q != "timeline":
            raise HTTPException(
                status_code=400,
                detail=f"Question {question_id} is not a timeline question"
            )

        timeline = validate_timeline_data(question.data or {})
        grading = grade_timeline_answer(timeline, guess.model_dump())
        progress = progress_map.get(question_id)

        if not progress:
            progress = create_initial_progress(question_id)
            db.add(progress)
            progress_map[question_id] = progress

        apply_scheduling(progress, grading["quality"])

        results.append({
            "question_id": question_id,
            "quality": grading["quality"],
            "expected": timeline,
            "guess": guess.model_dump(),
            "start": grading["start"],
            "end": grading["end"],
            "progress": serialize_progress(progress)
        })

    db.commit()

    return {
        "status": "ok",
        "results": results
    }
