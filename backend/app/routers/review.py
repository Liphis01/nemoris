from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db
from ..models import Progress, Question
from ..schemas import (
    AnswerRequest,
    MapAnswerRequest,
    MediaAnswerRequest,
    RelearningGraduateRequest,
    ReviewSettings,
    SequenceAnswerRequest,
    TextAnswerRequest,
    TimelineAnswerRequest
)
from ..scheduler import progress_in_relearning
from ..serializers import serialize_progress
from ..services.collections import sync_generated_hard_collection
from ..services.progress import (
    apply_scheduling,
    apply_scheduling_batch,
    create_initial_progress,
    graduate_relearning,
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
from ..services.text_modes import (
    DEFAULT_TEXT_MODE,
    TEXT_MODE_TYPE_REVERSE,
    calibrate_text_quality,
    text_mode_difficulty,
    normalize_text_mode
)
from ..services.intake import (
    compute_intake_quota,
    intake_runway_days,
    tune_intake_rate,
    unstarted_question_count
)
from ..services.review import (
    get_review_items,
    get_review_summary
)
from ..services.settings import (
    clear_pace_pressure_notice,
    get_pace_pressure_notice,
    get_review_settings,
    get_startup_rebalance_notice,
    load_intake_settings,
    load_scheduler_tuning_settings,
    pace_tier_options,
    resolve_pace_tier,
    save_review_settings
)
from ..services.sequence_answers import grade_sequence_answer
from ..services.answer_events import (
    answer_event,
    direction_for_grouped_answer,
    presentation_for_grouped_answer,
    timeline_answer_event
)
from ..services.answer_policy import (
    candidate_ids_for,
    effective_answer_policy,
    grade_answer_submission,
    normalize_answer_text
)
from ..services.text_groups import text_group_reverse_mode_enabled
from ..services.timeline import (
    grade_timeline_answer,
    reconcile_timeline_quality,
    validate_timeline_data
)


router = APIRouter()


def answer_progress_payload(progress, today=None):
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
        "relearning": progress_in_relearning(progress, today),
        "history": progress.history or []
    }


def review_settings_payload(db, settings):
    # The stored settings plus what the picker needs to render itself: the tier
    # to highlight, the tiers on offer, and the rate the tuner has actually
    # settled on (which the UI shows next to the chosen tier).
    intake = load_intake_settings(db, settings["catchup_daily_target"])
    pool = unstarted_question_count(db)

    return {
        **settings,
        "pace_tier_resolved": resolve_pace_tier(
            settings["catchup_daily_target"],
            settings.get("pace_tier")
        ),
        "pace_tiers": pace_tier_options(),
        "effective_daily_target": intake["effective_daily_target"],
        "tuned_on": intake["tuned_on"],
        "last_retention": intake["last_retention"],
        "last_schedule_pressure": intake["last_schedule_pressure"],
        "rate_ratio": intake["rate_ratio"],
        # Settings is a cold, user-initiated route, so it can afford the pool
        # count and the grouped runway aggregate. Keep both OUT of
        # compute_intake_quota, which runs on the menu tile.
        "unstarted_count": pool,
        "intake_runway_days": intake_runway_days(db, date.today(), pool=pool)
    }


@router.get("/review/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = get_review_settings(db)
    payload = review_settings_payload(db, settings)
    db.commit()

    return payload


@router.put("/review/settings")
def update_settings(
    data: ReviewSettings,
    db: Session = Depends(get_db)
):
    settings = save_review_settings(db, data.model_dump(exclude_none=True))
    payload = review_settings_payload(db, settings)
    db.commit()

    return payload


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


@router.get("/review/pace_notice")
def get_pace_notice(db: Session = Depends(get_db)):
    return get_pace_pressure_notice(db)


@router.post("/review/pace_notice/dismiss")
def dismiss_pace_notice(db: Session = Depends(get_db)):
    clear_pace_pressure_notice(db)
    db.commit()

    return {"status": "ok"}


@router.get("/review")
def get_review(db: Session = Depends(get_db)):
    # Lazy once-per-day intake tuning. This is the only write on this route: one
    # AppSetting row, and a no-op on every call after the first of the day. It
    # is committed before the session is assembled so get_review_items still
    # runs against a clean session and stays a pure read.
    tuned = tune_intake_rate(db)

    if tuned["changed"]:
        db.commit()

    quota = compute_intake_quota(
        db,
        daily_target=tuned["daily_target"],
        rate_ratio=tuned["rate_ratio"]
    )

    # The service handles due filtering and runtime map grouping.
    return get_review_items(db, intake_quota=quota)


@router.get("/review/intake")
def get_intake(db: Session = Depends(get_db)):
    # Read-only view of today's quota and the reasoning behind it.
    return compute_intake_quota(db)


@router.get("/review/summary")
def get_summary(db: Session = Depends(get_db)):
    return get_review_summary(db)


@router.post("/answer")
def answer_question(data: AnswerRequest, db: Session = Depends(get_db)):
    # Old/imported questions may not have progress yet, so create it lazily on
    # first answer. A failed first answer schedules like any other review: FSRS
    # keeps a failed card due today, so a bonus question answered wrong lands in
    # the normal review queue instead of staying new.
    progress = (
        db.query(Progress)
        .filter(Progress.question_id == data.question_id)
        .first()
    )

    if not progress:
        progress = create_initial_progress(
            data.question_id,
            today=data.review_date
        )
        db.add(progress)

    apply_scheduling(
        db,
        progress,
        data.quality,
        today=data.review_date
    )
    db.commit()
    sync_generated_hard_collection(db)

    return answer_progress_payload(progress, today=data.review_date)


@router.post("/answer/revise")
def revise_answer_question(data: AnswerRequest, db: Session = Depends(get_db)):
    progress = (
        db.query(Progress)
        .filter(Progress.question_id == data.question_id)
        .first()
    )

    if not progress:
        progress = create_initial_progress(
            data.question_id,
            today=data.review_date
        )
        db.add(progress)

    replace_latest_scheduling(
        db,
        progress,
        data.quality,
        today=data.review_date
    )
    db.commit()
    sync_generated_hard_collection(db)

    return answer_progress_payload(progress, today=data.review_date)


@router.post("/answer/relearning_graduate")
def graduate_relearning_cards(
    data: RelearningGraduateRequest,
    db: Session = Depends(get_db)
):
    # "Acquis": end the in-session relearning loop for these cards without
    # grading them. Scheduling is derived from the frozen first-fail state.
    graduated = graduate_relearning(
        db,
        data.question_ids,
        today=data.review_date
    )
    db.commit()

    return {
        "status": "ok",
        "graduated": [progress.question_id for progress in graduated]
    }


@router.post("/answer_map")
def answer_map(data: MapAnswerRequest, db: Session = Depends(get_db)):
    apply_answer_batch(
        db,
        data.items,
        map_mode=data.mode or DEFAULT_MAP_MODE,
        require_type="map",
        today=data.review_date,
        context_count=data.context_count,
        answers=data.answers,
        candidates=data.candidates
    )
    return {"status": "ok"}


@router.post("/answer_media")
def answer_media(data: MediaAnswerRequest, db: Session = Depends(get_db)):
    apply_answer_batch(
        db,
        data.items,
        image_mode=data.mode or DEFAULT_IMAGE_MODE,
        require_type="media",
        today=data.review_date,
        context_count=data.context_count,
        answers=data.answers,
        candidates=data.candidates
    )
    return {"status": "ok"}


@router.post("/answer_text")
def answer_text(data: TextAnswerRequest, db: Session = Depends(get_db)):
    apply_answer_batch(
        db,
        data.items,
        text_mode=data.mode or DEFAULT_TEXT_MODE,
        require_type="text",
        today=data.review_date,
        context_count=data.context_count,
        answers=data.answers,
        candidates=data.candidates
    )
    return {"status": "ok"}


def normalize_context_count(value):
    if value is None:
        return None

    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def apply_answer_batch(
    db,
    items,
    map_mode=None,
    image_mode=None,
    text_mode=None,
    require_type=None,
    today=None,
    context_count=None,
    answers=None,
    candidates=None
):
    answers = answers or {}
    candidates = candidates or {}
    question_ids = list(items.keys())
    questions = (
        db.query(Question)
        .options(joinedload(Question.group))
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
    submitted_context_count = normalize_context_count(context_count)
    normalized_map_mode = normalize_map_mode(map_mode) if map_mode else None
    normalized_image_mode = (
        normalize_image_mode(image_mode)
        if image_mode
        else None
    )
    normalized_text_mode = (
        normalize_text_mode(text_mode)
        if text_mode
        else None
    )
    if normalized_text_mode == TEXT_MODE_TYPE_REVERSE:
        grouped_questions = {}

        for question in questions:
            if question.type_q != "text" or not question.group_id or not question.group:
                raise HTTPException(
                    status_code=422,
                    detail="Le mode inversé est réservé aux groupes texte éligibles."
                )

            grouped_questions.setdefault(question.group_id, []).append(question)

        all_group_questions = (
            db.query(Question)
            .filter(
                Question.group_id.in_(grouped_questions),
                Question.type_q == "text"
            )
            .all()
        )
        all_questions_by_group_id = {}

        for question in all_group_questions:
            all_questions_by_group_id.setdefault(question.group_id, []).append(question)

        for group_id, group_questions in grouped_questions.items():
            group = group_questions[0].group

            if not text_group_reverse_mode_enabled(
                group,
                all_questions_by_group_id.get(group_id, [])
            ):
                raise HTTPException(
                    status_code=422,
                    detail="Le mode inversé n'est pas activé ou le groupe est ambigu."
                )

    if normalized_map_mode:
        group_ids = set()

        if submitted_context_count is None:
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
                        Question.type_q == "map"
                    )
                    .count()
                )
    elif normalized_image_mode:
        submitted_image_count = 0

        if submitted_context_count is None:
            for question in questions:
                if question.type_q != "media":
                    continue

                submitted_image_count += 1
                key = question.group_id
                context_counts_by_group_id[key] = (
                    context_counts_by_group_id.get(key, 0) + 1
                )

            if submitted_image_count == 0:
                submitted_image_count = len(question_ids)

    elif normalized_text_mode:
        submitted_text_count = 0

        if submitted_context_count is None:
            for question in questions:
                if question.type_q != "text":
                    continue

                submitted_text_count += 1
                key = question.group_id
                context_counts_by_group_id[key] = (
                    context_counts_by_group_id.get(key, 0) + 1
                )

            if submitted_text_count == 0:
                submitted_text_count = len(question_ids)

    progress_quality_pairs = []

    for question_id, quality in items.items():
        question = question_map.get(question_id)
        progress = progress_map.get(question_id)
        answer_provided = question_id in answers or str(question_id) in answers
        submitted_answer = (
            answers.get(question_id)
            if question_id in answers
            else answers.get(str(question_id))
        )
        submitted_candidates = candidate_ids_for(question_id, candidates)
        policy = effective_answer_policy(question=question, type_q=require_type)
        backend_grade = None

        if question is not None and answer_provided:
            if normalized_text_mode == TEXT_MODE_TYPE_REVERSE:
                expected = normalize_answer_text(question.question, policy)
                actual = normalize_answer_text(submitted_answer, policy)
                matched = bool(expected) and actual == expected
                backend_grade = {
                    "matched": matched,
                    "resolved_response_id": question.id if matched else None
                }
            else:
                backend_grade = grade_answer_submission(
                    question,
                    submitted_answer,
                    policy=policy
                )
            resolved_id = backend_grade.get("resolved_response_id")

            if (
                resolved_id is not None and
                submitted_candidates and
                resolved_id not in submitted_candidates
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Answer {resolved_id} was not in candidates for "
                        f"question {question_id}"
                    )
                )

        def authoritative_quality(raw_quality):
            if backend_grade is None:
                return raw_quality
            if not backend_grade["matched"]:
                return 0
            return raw_quality if raw_quality in {1, 2, 3} else 2

        def answer_context(extra=None):
            context = {
                **(extra or {}),
                "grading_authority": (
                    "backend" if backend_grade is not None else "legacy_client"
                )
            }
            if backend_grade is not None:
                context["backend_matched"] = backend_grade["matched"]
            return context

        if normalized_map_mode:
            raw_quality = calibrate_map_quality(quality)
            scheduled_quality = authoritative_quality(raw_quality)

            if not progress:
                progress = create_initial_progress(question_id, today=today)
                db.add(progress)
                progress_map[question_id] = progress

            active_context_count = (
                submitted_context_count
                if submitted_context_count is not None
                else context_counts_by_group_id.get(
                    question.group_id if question else None,
                    0
                )
            )
            difficulty = map_mode_difficulty(
                normalized_map_mode,
                context_count=active_context_count,
                tuning=scheduler_tuning
            )
            metadata = {
                "map_mode": normalized_map_mode,
                "map_context_count": active_context_count,
                "raw_quality": raw_quality,
                "effective_quality": scheduled_quality,
                "mode_adjusted": difficulty != 1.0,
                "mode_difficulty": difficulty
            }

            if answer_provided:
                metadata["answer"] = submitted_answer

            metadata["answer_event"] = answer_event(
                question=question,
                raw_response=submitted_answer,
                resolved_response_id=(
                    backend_grade.get("resolved_response_id")
                    if backend_grade is not None
                    else submitted_answer
                ),
                expected_value=question.answer if question else None,
                type_q="map",
                presentation_kind=presentation_for_grouped_answer("map"),
                mode=normalized_map_mode,
                direction=direction_for_grouped_answer("map", normalized_map_mode),
                candidate_ids=submitted_candidates,
                answer_policy=policy,
                context=answer_context({"context_count": active_context_count})
            )

            progress_quality_pairs.append((progress, scheduled_quality, metadata))
        elif normalized_image_mode:
            raw_quality = calibrate_image_quality(quality)
            scheduled_quality = authoritative_quality(raw_quality)

            if not progress:
                progress = create_initial_progress(question_id, today=today)
                db.add(progress)
                progress_map[question_id] = progress

            active_context_count = (
                submitted_context_count
                if submitted_context_count is not None
                else context_counts_by_group_id.get(
                    question.group_id if question else None,
                    submitted_image_count
                )
            )
            difficulty = image_mode_difficulty(
                normalized_image_mode,
                context_count=active_context_count,
                tuning=scheduler_tuning
            )
            metadata = {
                "image_mode": normalized_image_mode,
                "image_context_count": active_context_count,
                "raw_quality": raw_quality,
                "effective_quality": scheduled_quality,
                "mode_adjusted": difficulty != 1.0,
                "mode_difficulty": difficulty
            }

            if normalized_image_mode in IMAGE_MULTIPLE_CHOICE_MODES:
                metadata["image_choice_count"] = min(4, active_context_count)

            if answer_provided:
                metadata["answer"] = submitted_answer

            metadata["answer_event"] = answer_event(
                question=question,
                raw_response=submitted_answer,
                resolved_response_id=(
                    backend_grade.get("resolved_response_id")
                    if backend_grade is not None
                    else submitted_answer
                ),
                expected_value=question.answer if question else None,
                type_q="media",
                presentation_kind=presentation_for_grouped_answer("media"),
                mode=normalized_image_mode,
                direction=direction_for_grouped_answer(
                    "media",
                    normalized_image_mode
                ),
                candidate_ids=submitted_candidates,
                answer_policy=policy,
                context=answer_context({"context_count": active_context_count})
            )

            progress_quality_pairs.append((
                progress,
                scheduled_quality,
                metadata
            ))
        elif normalized_text_mode:
            raw_quality = calibrate_text_quality(quality)
            scheduled_quality = authoritative_quality(raw_quality)

            if not progress:
                progress = create_initial_progress(question_id, today=today)
                db.add(progress)
                progress_map[question_id] = progress

            active_context_count = (
                submitted_context_count
                if submitted_context_count is not None
                else context_counts_by_group_id.get(
                    question.group_id if question else None,
                    submitted_text_count
                )
            )
            difficulty = text_mode_difficulty(
                normalized_text_mode,
                context_count=active_context_count,
                tuning=scheduler_tuning
            )
            metadata = {
                "text_mode": normalized_text_mode,
                "text_context_count": active_context_count,
                "raw_quality": raw_quality,
                "effective_quality": scheduled_quality,
                "mode_adjusted": difficulty != 1.0,
                "mode_difficulty": difficulty
            }

            if answer_provided:
                metadata["answer"] = submitted_answer

            metadata["answer_event"] = answer_event(
                question=question,
                raw_response=submitted_answer,
                resolved_response_id=(
                    backend_grade.get("resolved_response_id")
                    if backend_grade is not None
                    else submitted_answer
                ),
                expected_value=(
                    question.question
                    if normalized_text_mode == TEXT_MODE_TYPE_REVERSE and question
                    else question.answer if question else None
                ),
                type_q="text",
                presentation_kind=presentation_for_grouped_answer("text"),
                mode=normalized_text_mode,
                direction=direction_for_grouped_answer("text", normalized_text_mode),
                candidate_ids=submitted_candidates,
                answer_policy=policy,
                context=answer_context({"context_count": active_context_count})
            )

            progress_quality_pairs.append((progress, scheduled_quality, metadata))
        else:
            if not progress:
                progress = create_initial_progress(question_id, today=today)
                db.add(progress)
                progress_map[question_id] = progress

            progress_quality_pairs.append((progress, quality))

    if progress_quality_pairs:
        apply_scheduling_batch(
            db,
            progress_quality_pairs,
            scheduler_tuning=scheduler_tuning,
            today=today
        )

    db.commit()
    sync_generated_hard_collection(db)


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
        payload = guess.model_dump()
        grading = grade_timeline_answer(timeline, payload)
        # Distance grades correctness; the learner may refine a hit's difficulty.
        final_quality = reconcile_timeline_quality(
            grading["quality"],
            payload.get("quality")
        )
        progress = progress_map.get(question_id)

        if not progress:
            progress = create_initial_progress(question_id, today=data.review_date)
            db.add(progress)
            progress_map[question_id] = progress

        progress_quality_pairs.append((
            progress,
            final_quality,
            {
                "answer": {
                    "start": payload["start"],
                    "end": payload.get("end")
                },
                "answer_event": timeline_answer_event(
                    question=question,
                    raw_response={
                        "start": payload["start"],
                        "end": payload.get("end")
                    },
                    expected_value=timeline,
                    context=data.presentation_context or {}
                )
            }
        ))

        results.append({
            "question_id": question_id,
            "quality": final_quality,
            "auto_quality": grading["quality"],
            "expected": timeline,
            # The guessed date only — the learner's quality is an input, not
            # part of what they placed on the timeline.
            "guess": {"start": payload["start"], "end": payload.get("end")},
            "start": grading["start"],
            "end": grading["end"]
        })

    if progress_quality_pairs:
        apply_scheduling_batch(
            db,
            progress_quality_pairs,
            today=data.review_date
        )

    for result in results:
        result["progress"] = serialize_progress(
            progress_map.get(result["question_id"])
        )

    db.commit()
    sync_generated_hard_collection(db)

    return {
        "status": "ok",
        "results": results
    }


@router.post("/answer_sequence")
def answer_sequence(data: SequenceAnswerRequest, db: Session = Depends(get_db)):
    return grade_sequence_answer(db, data, schedule=data.commit)
