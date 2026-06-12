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
from ..services.map_modes import (
    DEFAULT_MAP_MODE,
    calibrate_map_quality,
    map_mode_difficulty,
    normalize_map_mode
)
from ..services.image_modes import (
    DEFAULT_IMAGE_MODE,
    IMAGE_MULTIPLE_CHOICE_MODES,
    calibrate_image_quality,
    image_mode_difficulty,
    normalize_image_mode
)
from ..services.review import get_review_items
from ..services.settings import (
    get_review_settings,
    get_startup_rebalance_notice,
    load_scheduler_tuning_settings,
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
        "ideal_interval": progress.ideal_interval,
        "last_review": progress.last_review,
        "next_review": progress.next_review,
        "ideal_next_review": progress.ideal_next_review,
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
        "ideal_interval": progress.ideal_interval,
        "last_review": progress.last_review,
        "next_review": progress.next_review,
        "ideal_next_review": progress.ideal_next_review,
        "reps": progress.reps,
        "lapses": progress.lapses,
        "history": progress.history or []
    }


@router.post("/answer_map")
def answer_map(data: MapAnswerRequest, db: Session = Depends(get_db)):
    apply_answer_batch(
        db,
        data.items,
        map_mode=data.mode or DEFAULT_MAP_MODE,
        require_type="map"
    )
    return {"status": "ok"}


@router.post("/answer_image")
def answer_image(data: ImageAnswerRequest, db: Session = Depends(get_db)):
    apply_answer_batch(
        db,
        data.items,
        image_mode=data.mode or DEFAULT_IMAGE_MODE,
        require_type="image"
    )
    return {"status": "ok"}


def apply_answer_batch(db, items, map_mode=None, image_mode=None, require_type=None):
    question_ids = list(items.keys())
    questions = (
        db.query(Question)
        .filter(Question.id.in_(question_ids))
        .all()
    )
    question_map = {
        question.id: question
        for question in questions
    }
    if require_type:
        wrong_type_ids = [
            question_id
            for question_id in question_ids
            if (
                question_id in question_map and
                question_map[question_id].type_q != require_type
            )
        ]

        if wrong_type_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Questions are not {require_type}: {wrong_type_ids}"
            )

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

    context_counts_by_group_id = {}
    scheduler_tuning = load_scheduler_tuning_settings(db)
    normalized_map_mode = normalize_map_mode(map_mode) if map_mode else None
    normalized_image_mode = (
        normalize_image_mode(image_mode)
        if image_mode
        else None
    )

    if normalized_map_mode or normalized_image_mode:
        context_type = "map" if normalized_map_mode else "image"
        group_ids = {
            question.group_id
            for question in questions
            if question.group_id is not None
        }

        if group_ids:
            for group_id in group_ids:
                context_counts_by_group_id[group_id] = (
                    db.query(Question)
                    .filter(
                        Question.group_id == group_id,
                        Question.type_q == context_type
                    )
                    .count()
                )

    progress_quality_pairs = []

    for question_id, quality in items.items():
        question = question_map.get(question_id)
        progress = progress_map.get(question_id)

        if not progress:
            progress = create_initial_progress(question_id)
            db.add(progress)
            progress_map[question_id] = progress

        if normalized_map_mode:
            context_count = context_counts_by_group_id.get(
                question.group_id if question else None,
                0
            )
            raw_quality = calibrate_map_quality(quality)
            difficulty = map_mode_difficulty(
                normalized_map_mode,
                context_count=context_count,
                tuning=scheduler_tuning
            )
            progress_quality_pairs.append((
                progress,
                raw_quality,
                {
                    "map_mode": normalized_map_mode,
                    "map_context_count": context_count,
                    "raw_quality": raw_quality,
                    "effective_quality": raw_quality,
                    "mode_adjusted": difficulty != 1.0,
                    "mode_difficulty": difficulty
                }
            ))
        elif normalized_image_mode:
            context_count = context_counts_by_group_id.get(
                question.group_id if question else None,
                0
            )
            raw_quality = calibrate_image_quality(quality)
            difficulty = image_mode_difficulty(
                normalized_image_mode,
                context_count=context_count,
                tuning=scheduler_tuning
            )
            metadata = {
                "image_mode": normalized_image_mode,
                "image_context_count": context_count,
                "raw_quality": raw_quality,
                "effective_quality": raw_quality,
                "mode_adjusted": difficulty != 1.0,
                "mode_difficulty": difficulty
            }

            if normalized_image_mode in IMAGE_MULTIPLE_CHOICE_MODES:
                metadata["image_choice_count"] = min(4, context_count)

            progress_quality_pairs.append((
                progress,
                raw_quality,
                metadata
            ))
        else:
            progress_quality_pairs.append((progress, quality))

    apply_scheduling_batch(
        db,
        progress_quality_pairs,
        scheduler_tuning=scheduler_tuning
    )

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
