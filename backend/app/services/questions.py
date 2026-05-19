from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Collection, Progress, Question, QuestionGroup
from ..serializers import serialize_question_for_manage
from .progress import create_initial_progress


GROUP_COMPATIBILITY = {
    "map": ["map"]
}


def validate_group_compatibility(db, type_q: str, group_id: int | None):
    if not group_id:
        return None

    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    allowed = GROUP_COMPATIBILITY.get(group.type_group, [])

    if type_q not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"{type_q} incompatible with group type {group.type_group}"
        )

    return group


def load_collections(db, collection_ids):
    if not collection_ids:
        return []

    return (
        db.query(Collection)
        .filter(Collection.id.in_(collection_ids))
        .all()
    )


def create_question_record(db, payload):
    validate_group_compatibility(db, payload.type_q, payload.group_id)

    question = Question(
        type_q=payload.type_q,
        question=payload.question,
        answer=payload.answer,
        media=payload.media,
        tags=payload.tags or [],
        data=payload.data or {},
        group_id=payload.group_id
    )

    db.add(question)
    db.flush()
    db.add(create_initial_progress(question.id))

    if payload.collection_ids:
        question.collections = load_collections(db, payload.collection_ids)

    return question


def create_questions_bulk_records(db, questions):
    created = []

    try:
        for payload in questions:
            created.append(create_question_record(db, payload))

        db.commit()
    except Exception:
        db.rollback()
        raise

    return created


def get_manage_questions(db):
    questions = (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .all()
    )

    return [serialize_question_for_manage(question) for question in questions]


def get_question_for_update(db, question_id: int):
    question = (
        db.query(Question)
        .options(
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .filter(Question.id == question_id)
        .first()
    )

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    return question


def update_question_record(db, question_id: int, payload):
    question = get_question_for_update(db, question_id)
    updates = payload.model_dump(exclude_unset=True)

    future_type = updates.get("type_q", question.type_q)
    future_group_id = updates.get("group_id", question.group_id)
    validate_group_compatibility(db, future_type, future_group_id)

    for field in ["type_q", "question", "answer", "media", "tags", "data", "group_id"]:
        if field in updates:
            setattr(question, field, updates[field])

    if "collection_ids" in updates:
        question.collections = load_collections(db, updates["collection_ids"])

    db.commit()
    db.refresh(question)

    return question


def set_question_collections(db, question_id: int, collection_ids):
    question = (
        db.query(Question)
        .filter(Question.id == question_id)
        .first()
    )

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    question.collections = load_collections(db, collection_ids)
    db.commit()


def delete_question_record(db, question_id: int):
    question = (
        db.query(Question)
        .options(joinedload(Question.group))
        .filter(Question.id == question_id)
        .first()
    )

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    group = question.group
    question.collections = []
    db.query(Progress).filter(Progress.question_id == question.id).delete()
    db.delete(question)
    db.commit()

    if group:
        remaining = (
            db.query(Question)
            .filter(Question.group_id == group.id)
            .count()
        )

        if remaining == 0:
            db.delete(group)
            db.commit()
