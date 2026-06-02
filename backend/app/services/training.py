from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_progress
from .map_zones import merge_tags
from .review import serialize_review_items
from .timeline import grade_timeline_answer, validate_timeline_data


def normalize_scope_tag(value):
    return str(value or "").strip().casefold()


def question_has_exact_tag(question, normalized_tag):
    return any(
        normalize_scope_tag(tag) == normalized_tag
        for tag in (question.tags or [])
    )


def _training_question_query(db):
    return (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group)
        )
        .order_by(Question.id)
    )


def list_training_scopes(db):
    groups = (
        db.query(
            QuestionGroup,
            func.count(Question.id).label("question_count")
        )
        .outerjoin(Question)
        .group_by(QuestionGroup.id)
        .order_by(QuestionGroup.id)
        .all()
    )
    group_ids = [group.id for group, _ in groups]
    grouped_tag_rows = (
        db.query(Question.group_id, Question.tags)
        .filter(
            Question.group_id.in_(group_ids),
            Question.type_q.in_(["map", "image"])
        )
        .all()
        if group_ids else []
    )
    tags_by_group_id = {}

    for group_id, tags in grouped_tag_rows:
        tags_by_group_id[group_id] = merge_tags(
            tags_by_group_id.get(group_id, []),
            tags or []
        )

    tag_names_by_key = {}
    tag_counts_by_key = {}

    for (tags,) in db.query(Question.tags).all():
        seen_for_question = set()

        for tag in tags or []:
            display_name = str(tag or "").strip()
            key = normalize_scope_tag(display_name)

            if not key or key in seen_for_question:
                continue

            seen_for_question.add(key)
            tag_names_by_key.setdefault(key, display_name)
            tag_counts_by_key[key] = tag_counts_by_key.get(key, 0) + 1

    return {
        "groups": [
            {
                "id": group.id,
                "type_group": group.type_group,
                "name": group.name,
                "media": group.media,
                "tags": tags_by_group_id.get(group.id, []),
                "question_count": question_count
            }
            for group, question_count in groups
        ],
        "tags": [
            {
                "name": tag_names_by_key[key],
                "count": tag_counts_by_key[key]
            }
            for key in sorted(tag_names_by_key)
        ]
    }


def get_training_items(db, scope_type, group_id=None, tag=None):
    if scope_type == "group":
        if group_id is None:
            raise HTTPException(
                status_code=400,
                detail="group_id is required for group training"
            )

        group_exists = (
            db.query(QuestionGroup.id)
            .filter(QuestionGroup.id == group_id)
            .first()
        )

        if not group_exists:
            raise HTTPException(status_code=404, detail="Group not found")

        questions = (
            _training_question_query(db)
            .filter(Question.group_id == group_id)
            .all()
        )
        return serialize_review_items(questions)

    if scope_type == "tag":
        normalized_tag = normalize_scope_tag(tag)

        if not normalized_tag:
            raise HTTPException(
                status_code=400,
                detail="tag is required for tag training"
            )

        questions = [
            question
            for question in _training_question_query(db).all()
            if question_has_exact_tag(question, normalized_tag)
        ]
        return serialize_review_items(questions)

    raise HTTPException(status_code=400, detail="Invalid training scope")


def grade_training_timeline(db, items):
    question_ids = list(items.keys())
    questions = (
        db.query(Question)
        .options(joinedload(Question.progress))
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

    results = []

    for question_id, guess in items.items():
        question = question_map[question_id]

        if question.type_q != "timeline":
            raise HTTPException(
                status_code=400,
                detail=f"Question {question_id} is not a timeline question"
            )

        timeline = validate_timeline_data(question.data or {})
        grading = grade_timeline_answer(timeline, guess.model_dump())

        results.append({
            "question_id": question_id,
            "quality": grading["quality"],
            "expected": timeline,
            "guess": guess.model_dump(),
            "start": grading["start"],
            "end": grading["end"],
            "progress": serialize_progress(question.progress)
        })

    return {
        "status": "ok",
        "results": results
    }
