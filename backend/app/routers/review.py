from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import Progress, Question
from ..schemas import (
    AnswerRequest,
    ImageAnswerRequest,
    MapAnswerRequest,
    ReviewSettings,
    TimelineAnswerRequest
)
from ..serializers import serialize_progress
from ..services.progress import (
    apply_scheduling,
    apply_scheduling_batch,
    create_initial_progress,
    rebalance_progress_calendar,
    replace_latest_scheduling
)
from ..services.review import get_review_items
from ..services.settings import (
    get_review_settings,
    get_startup_rebalance_notice,
    save_review_settings
)
from ..services.timeline import grade_timeline_answer, validate_timeline_data


router = APIRouter()


@router.get("/review/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = get_review_settings(db)
    db.commit()

    return settings


@router.put("/review/settings")
def update_settings(
    data: ReviewSettings,
    db: Session = Depends(get_db)
):
    settings = save_review_settings(db, data.model_dump())
    db.commit()

    return settings


@router.post("/review/rebalance")
def rebalance_review(db: Session = Depends(get_db)):
    result = rebalance_progress_calendar(db)
    db.commit()

    return {
        "status": "ok",
        **result
    }


@router.get("/review/startup_notice")
def get_startup_notice(db: Session = Depends(get_db)):
    return get_startup_rebalance_notice(db)


@router.get("/review")
def get_review(
    include_new: bool = False,
    db: Session = Depends(get_db)
):
    # The service handles due filtering and runtime map grouping.
    return get_review_items(db, include_new=include_new)


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

    apply_scheduling(db, progress, data.quality)
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


@router.post("/answer/revise")
def revise_answer_question(data: AnswerRequest, db: Session = Depends(get_db)):
    progress = (
        db.query(Progress)
        .filter(Progress.question_id == data.question_id)
        .first()
    )

    if not progress:
        progress = create_initial_progress(data.question_id)
        db.add(progress)

    replace_latest_scheduling(db, progress, data.quality)
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
    apply_answer_batch(db, data.items)
    return {"status": "ok"}


@router.post("/answer_image")
def answer_image(data: ImageAnswerRequest, db: Session = Depends(get_db)):
    apply_answer_batch(db, data.items)
    return {"status": "ok"}


def apply_answer_batch(db, items):
    question_ids = list(items.keys())

    # One grouped submit can grade many independent questions. Fetch existing
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

    progress_quality_pairs = []

    for question_id, quality in items.items():
        progress = progress_map.get(question_id)

        if not progress:
            progress = create_initial_progress(question_id)
            db.add(progress)
            progress_map[question_id] = progress

        progress_quality_pairs.append((progress, quality))

    apply_scheduling_batch(db, progress_quality_pairs)

    db.commit()


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
    progress_quality_pairs = []

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

        progress_quality_pairs.append((progress, grading["quality"]))

        results.append({
            "question_id": question_id,
            "quality": grading["quality"],
            "expected": timeline,
            "guess": guess.model_dump(),
            "start": grading["start"],
            "end": grading["end"]
        })

    apply_scheduling_batch(db, progress_quality_pairs)

    for result in results:
        result["progress"] = serialize_progress(
            progress_map[result["question_id"]]
        )

    db.commit()

    return {
        "status": "ok",
        "results": results
    }
