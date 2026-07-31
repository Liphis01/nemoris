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
from .media import (
    delete_unreferenced_media_file,
    media_points_to_same_static_file,
    removed_media_refs
)
from .media_pool import read_media_pool
from .sequence import validate_question_sequence
from .tombstones import record_question_tombstones, record_tombstone
from .timeline import validate_question_timeline


GROUP_COMPATIBILITY = {
    # Group type -> allowed Question.type_q values. Add here before allowing a
    # new grouped review type through create/update.
    "map": ["map"],
    "media": ["media"],
    "text": ["text"],
    "sequence": ["sequence"]
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
    validate_question_sequence(payload.type_q, payload.group_id, payload.data)
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
    old_pool_refs = read_media_pool(question.media, question.data)
    old_answer_media = question.answer_media

    # Validate the final type/group combination, not only fields explicitly
    # present in the payload.
    future_type = updates.get("type_q", question.type_q)
    future_group_id = updates.get("group_id", question.group_id)
    future_data = updates.get("data", question.data or {})
    validate_question_timeline(future_type, future_group_id, future_data)
    validate_question_sequence(future_type, future_group_id, future_data)
    validate_group_compatibility(db, future_type, future_group_id)

    for field in [
        "type_q",
        "question",
        "answer",
        "media",
        "answer_media",
        "tags",
        "data",
        "group_id",
        "suspended"
    ]:
        if field in updates:
            setattr(question, field, updates[field])

    if "collection_ids" in updates:
        question.collections = get_collections_by_ids(db, updates["collection_ids"])

    db.commit()
    db.refresh(question)

    # Cover + pool images both live in the media/data the update just wrote, so
    # diff the whole ref set: a pool image dropped via `data` is pruned too.
    new_pool_refs = read_media_pool(question.media, question.data)

    for ref in removed_media_refs(old_pool_refs, new_pool_refs):
        delete_unreferenced_media_file(db, ref)

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

    # Every question-deletion path funnels through here, so this is the single
    # spot where deletion tombstones are recorded (while guids still exist).
    record_question_tombstones(db, question_ids)

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
    question_media_refs = read_media_pool(question.media, question.data)
    question_answer_media = question.answer_media
    group_media = group.media if group else None

    # Clear many-to-many links and progress explicitly because cascades are not
    # enabled on these relationships.
    delete_question_dependents(db, [question.id])
    db.delete(question)
    db.commit()

    for ref in question_media_refs:
        delete_unreferenced_media_file(db, ref)

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
            record_tombstone(db, "question_group", group.guid)
            db.delete(group)
            db.commit()
            delete_unreferenced_media_file(db, group_media)
