from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import (
    Collection,
    Progress,
    Question,
    QuestionGroup,
    question_collection
)
from ..serializers import serialize_manage_question
from .media import delete_unreferenced_media_file, media_points_to_same_static_file
from .timeline import validate_question_timeline


GROUP_COMPATIBILITY = {
    # Group type -> allowed Question.type_q values. Add here before allowing a
    # new grouped review type through create/update.
    "map": ["map"],
    "media": ["media"],
    "text": ["text"]
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
    # Progress is created lazily on first answer so new cards stay outside the
    # scheduled review workload until the user chooses bonus questions.
    validate_question_timeline(payload.type_q, payload.group_id, payload.data)
    validate_group_compatibility(db, payload.type_q, payload.group_id)

    question = Question(
        type_q=payload.type_q,
        question=payload.question,
        answer=payload.answer,
        media=payload.media,
        answer_media=payload.answer_media,
        tags=payload.tags or [],
        data=payload.data or {},
        group_id=payload.group_id
    )

    db.add(question)
    db.flush()

    if payload.group_id and payload.type_q in {"map", "media", "text"}:
        from .training import clear_training_record_for_group_id

        clear_training_record_for_group_id(db, payload.group_id)

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
    old_media = question.media
    old_answer_media = question.answer_media
    old_group_id = question.group_id
    old_type = question.type_q

    from .training import (
        clear_training_records_for_group_ids,
        question_training_signature
    )

    old_training_signature = question_training_signature(
        old_type,
        question.answer,
        question.media,
        question.data or {}
    )

    # Validate the final type/group combination, not only fields explicitly
    # present in the payload.
    future_type = updates.get("type_q", question.type_q)
    future_group_id = updates.get("group_id", question.group_id)
    future_data = updates.get("data", question.data or {})
    validate_question_timeline(future_type, future_group_id, future_data)
    validate_group_compatibility(db, future_type, future_group_id)

    for field in ["type_q", "question", "answer", "media", "answer_media", "tags", "data", "group_id"]:
        if field in updates:
            setattr(question, field, updates[field])

    if "collection_ids" in updates:
        question.collections = get_collections_by_ids(db, updates["collection_ids"])

    new_training_signature = question_training_signature(
        question.type_q,
        question.answer,
        question.media,
        question.data or {}
    )
    old_was_grouped_training_item = old_group_id and old_type in {"map", "media", "text"}
    new_is_grouped_training_item = (
        question.group_id and
        question.type_q in {"map", "media", "text"}
    )
    training_content_changed = (
        old_group_id != question.group_id or
        old_type != question.type_q or
        old_training_signature != new_training_signature
    )

    if training_content_changed:
        affected_group_ids = []

        if old_was_grouped_training_item:
            affected_group_ids.append(old_group_id)

        if new_is_grouped_training_item:
            affected_group_ids.append(question.group_id)

        clear_training_records_for_group_ids(db, affected_group_ids)

    db.commit()
    db.refresh(question)

    if (
        "media" in updates and
        not media_points_to_same_static_file(old_media, question.media)
    ):
        delete_unreferenced_media_file(db, old_media)

    if (
        "answer_media" in updates and
        not media_points_to_same_static_file(old_answer_media, question.answer_media)
    ):
        delete_unreferenced_media_file(db, old_answer_media)

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


def delete_question_dependents(db, question_ids):
    if not question_ids:
        return

    # Relationship cascades are intentionally not enabled in the models, so
    # question-owned rows have to be removed explicitly before deleting rows
    # from questions.
    db.execute(
        question_collection.delete().where(
            question_collection.c.question_id.in_(question_ids)
        )
    )
    db.query(Progress).filter(Progress.question_id.in_(question_ids)).delete(
        synchronize_session=False
    )


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
    question_media = question.media
    question_answer_media = question.answer_media
    group_media = group.media if group else None
    if group and question.type_q in {"map", "media", "text"}:
        from .training import clear_training_record

        clear_training_record(group)

    # Clear many-to-many links and progress explicitly because cascades are not
    # enabled on these relationships.
    delete_question_dependents(db, [question.id])
    db.delete(question)
    db.commit()
    delete_unreferenced_media_file(db, question_media)
    delete_unreferenced_media_file(db, question_answer_media)

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
            delete_unreferenced_media_file(db, group_media)
