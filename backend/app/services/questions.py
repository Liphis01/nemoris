from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Collection, Progress, Question, QuestionGroup
from ..serializers import serialize_manage_question
from .progress import create_initial_progress


GROUP_COMPATIBILITY = {
    # Group type -> allowed Question.type_q values. Add here before allowing a
    # new grouped review type through create/update.
    "map": ["map"]
}


def validate_group_compatibility(db, type_q: str, group_id: int | None):
    # Ungrouped questions are always valid.
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


def get_collections_by_ids(db, collection_ids):
    if not collection_ids:
        return []

    return (
        db.query(Collection)
        .filter(Collection.id.in_(collection_ids))
        .all()
    )


def create_question(db, payload):
    # Every created question immediately gets its own Progress row. This keeps
    # grouped map zones independently reviewable.
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
        question.collections = get_collections_by_ids(db, payload.collection_ids)

    return question


def create_questions_bulk(db, questions):
    # Bulk creation is all-or-nothing so CSV/import failures do not leave a
    # half-created set of review items.
    created = []

    try:
        for payload in questions:
            created.append(create_question(db, payload))

        db.commit()
    except Exception:
        db.rollback()
        raise

    return created


def list_questions_for_manage(db):
    # Manage renders a spreadsheet/browser view, so fetch related display data
    # up front instead of relying on lazy relationships.
    questions = (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .all()
    )

    return [serialize_manage_question(question) for question in questions]


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


def update_question(db, question_id: int, payload):
    question = get_question_for_update(db, question_id)
    updates = payload.model_dump(exclude_unset=True)

    # Validate the final type/group combination, not only fields explicitly
    # present in the payload.
    future_type = updates.get("type_q", question.type_q)
    future_group_id = updates.get("group_id", question.group_id)
    validate_group_compatibility(db, future_type, future_group_id)

    for field in ["type_q", "question", "answer", "media", "tags", "data", "group_id"]:
        if field in updates:
            setattr(question, field, updates[field])

    if "collection_ids" in updates:
        question.collections = get_collections_by_ids(db, updates["collection_ids"])

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

    question.collections = get_collections_by_ids(db, collection_ids)
    db.commit()


def delete_question(db, question_id: int):
    question = (
        db.query(Question)
        .options(joinedload(Question.group))
        .filter(Question.id == question_id)
        .first()
    )

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    group = question.group
    # Clear many-to-many links and progress explicitly because cascades are not
    # enabled on these relationships.
    question.collections = []
    db.query(Progress).filter(Progress.question_id == question.id).delete()
    db.delete(question)
    db.commit()

    if group:
        # Empty groups are removed automatically after their last question is
        # deleted, keeping the Manage sidebar tidy.
        remaining = (
            db.query(Question)
            .filter(Question.group_id == group.id)
            .count()
        )

        if remaining == 0:
            db.delete(group)
            db.commit()
