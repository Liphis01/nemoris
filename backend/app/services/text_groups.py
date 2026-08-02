from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_manage_question, serialize_progress
from .map_zones import merge_tags
from .tag_hierarchy import ensure_tag_ids
from .questions import delete_question_dependents


def derive_text_group_tags(questions):
    return merge_tags(*[
        question.tags or []
        for question in questions or []
        if question.type_q == "text"
    ])


def get_text_group_or_404(db, group_id: int):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    if group.type_group != "text":
        raise HTTPException(400, "Group is not a text group")

    return group


def serialize_text_item_for_editor(question):
    return {
        "id": question.id,
        "type_q": question.type_q,
        "question": question.question,
        "answer": question.answer,
        "label": question.answer,
        "tags": question.tags or [],
        "group_id": question.group_id,
        "data": question.data or {},
        "aliases": question.data.get("aliases", []) if question.data else [],
        "progress": serialize_progress(question.progress)
    }


def list_text_group_items(db, group_id: int):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions).joinedload(Question.progress))
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    if group.type_group != "text":
        raise HTTPException(400, "Group is not a text group")

    return [
        serialize_text_item_for_editor(question)
        for question in group.questions
        if question.type_q == "text"
    ]


def build_text_item_data(existing_data, payload_data, aliases):
    data = {
        **(existing_data or {}),
        **(payload_data or {})
    }
    data["aliases"] = [
        alias
        for alias in aliases or []
        if alias
    ]
    return data


def text_item_payload_changed(item, desired_question, desired_answer, desired_data):
    return (
        (item.question or "") != desired_question or
        (item.answer or "") != desired_answer or
        (item.data or {}) != desired_data
    )


def save_text_group_items(db, group_id: int, payload):
    group = get_text_group_or_404(db, group_id)
    group_updates = {}
    shared_tags_provided = False
    shared_tags = None

    if payload.group:
        group_updates = payload.group.model_dump(exclude_unset=True)

        if "name" in group_updates:
            group.name = group_updates["name"]

        if "tags" in group_updates:
            shared_tags_provided = True
            shared_tags = ensure_tag_ids(db, group_updates.get("tags"))

    existing_items = (
        db.query(Question)
        .filter(
            Question.group_id == group_id,
            Question.type_q == "text"
        )
        .all()
    )
    existing_by_id = {
        item.id: item
        for item in existing_items
    }
    deleted_item_ids_list = list(dict.fromkeys(payload.deleted_item_ids or []))
    deleted_item_ids = set(deleted_item_ids_list)
    missing_deleted_ids = [
        item_id
        for item_id in deleted_item_ids
        if item_id not in existing_by_id
    ]

    if missing_deleted_ids:
        raise HTTPException(
            404,
            f"Text items not found: {missing_deleted_ids}"
        )

    created_ids = []
    updated_ids = []

    try:
        deleted_items = [
            existing_by_id[item_id]
            for item_id in deleted_item_ids
        ]

        if deleted_item_ids:
            delete_question_dependents(db, deleted_item_ids_list)

            for item in deleted_items:
                db.delete(item)

        if shared_tags_provided:
            for item in existing_items:
                if item.id not in deleted_item_ids:
                    item.tags = shared_tags

        for item_payload in payload.items:
            aliases = [
                alias
                for alias in item_payload.aliases
                if alias
            ]
            item = None

            if item_payload.id:
                item = existing_by_id.get(item_payload.id)

                if not item or item.id in deleted_item_ids:
                    raise HTTPException(
                        404,
                        f"Text item {item_payload.id} not found"
                    )

            desired_question = item_payload.question or ""
            desired_answer = item_payload.answer or ""

            if not item:
                item = Question(
                    type_q="text",
                    question=desired_question,
                    answer=desired_answer,
                    media=None,
                    tags=shared_tags if shared_tags_provided else [],
                    data=build_text_item_data(
                        {},
                        item_payload.data or {},
                        aliases
                    ),
                    group_id=group_id
                )

                db.add(item)
                db.flush()
                existing_by_id[item.id] = item
                created_ids.append(item.id)
            else:
                desired_data = build_text_item_data(
                    item.data or {},
                    item_payload.data or {},
                    aliases
                )

                if text_item_payload_changed(
                    item,
                    desired_question,
                    desired_answer,
                    desired_data
                ):
                    updated_ids.append(item.id)

                item.question = desired_question
                item.answer = desired_answer
                item.data = desired_data

                if shared_tags_provided:
                    item.tags = shared_tags

        db.commit()
    except Exception:
        db.rollback()
        raise

    saved_items = (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .filter(
            Question.group_id == group_id,
            Question.type_q == "text"
        )
        .all()
    )
    question_count = len(saved_items)
    response_tags = shared_tags if shared_tags_provided else derive_text_group_tags(
        saved_items
    )

    return {
        "group": {
            "id": group.id,
            "type_group": group.type_group,
            "name": group.name,
            "media": group.media,
            "tags": response_tags,
            "question_count": question_count
        },
        "items": [
            serialize_manage_question(item)
            for item in saved_items
        ],
        "createdQuestionIds": created_ids,
        "updatedQuestionIds": updated_ids,
        "deletedQuestionIds": deleted_item_ids_list,
        "question_count": question_count
    }
