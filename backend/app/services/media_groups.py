from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_manage_question, serialize_progress
from .map_zones import merge_tags
from .media import (
    MEDIA_UPLOAD_MAX_BYTES,
    delete_unreferenced_media_files,
    media_points_to_same_static_file,
    store_remote_image,
    store_uploaded_image
)
from .questions import delete_question_dependents


def derive_media_group_tags(questions):
    return merge_tags(*[
        question.tags or []
        for question in questions or []
        if question.type_q == "media"
    ])


def get_media_group_or_404(db, group_id: int):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    if group.type_group != "media":
        raise HTTPException(400, "Group is not a media group")

    return group


def serialize_media_item_for_editor(question):
    return {
        "id": question.id,
        "type_q": question.type_q,
        "question": question.question,
        "answer": question.answer,
        "label": question.answer,
        "media": question.media,
        "tags": question.tags or [],
        "group_id": question.group_id,
        "data": question.data or {},
        "aliases": question.data.get("aliases", []) if question.data else [],
        "progress": serialize_progress(question.progress)
    }


def list_media_group_items(db, group_id: int):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions).joinedload(Question.progress))
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    if group.type_group != "media":
        raise HTTPException(400, "Group is not a media group")

    return [
        serialize_media_item_for_editor(question)
        for question in group.questions
        if question.type_q == "media"
    ]


def upload_media_group_media(db, group_id: int, upload_file):
    group = get_media_group_or_404(db, group_id)

    return store_uploaded_image(
        upload_file,
        storage_subdir=f"media-groups/{group.id}",
        max_bytes=MEDIA_UPLOAD_MAX_BYTES,
        allow_audio_video=True
    )


def upload_media_group_media_url(db, group_id: int, url: str):
    group = get_media_group_or_404(db, group_id)

    return store_remote_image(
        url,
        storage_subdir=f"media-groups/{group.id}",
        max_bytes=MEDIA_UPLOAD_MAX_BYTES,
        allow_audio_video=True
    )


def build_media_question_text(group, answer):
    label = str(answer or "").strip() or "Média"
    return f"{group.name} - {label}"


def build_media_item_data(existing_data, payload_data, aliases):
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


def media_values_equal(left, right):
    return (left or "") == (right or "") or media_points_to_same_static_file(left, right)


def media_item_payload_changed(item, desired_answer, desired_media, desired_data):
    return (
        (item.answer or "") != desired_answer or
        not media_values_equal(item.media, desired_media) or
        (item.data or {}) != desired_data
    )


def save_media_group_items(db, group_id: int, payload):
    group = get_media_group_or_404(db, group_id)
    group_updates = {}
    shared_tags_provided = False
    shared_tags = None
    media_to_delete = []

    if payload.group:
        group_updates = payload.group.model_dump(exclude_unset=True)
        old_group_media = group.media

        for field in ["name", "media"]:
            if field in group_updates:
                setattr(group, field, group_updates[field])

        if (
            "media" in group_updates and
            not media_points_to_same_static_file(old_group_media, group.media)
        ):
            media_to_delete.append(old_group_media)

        if "tags" in group_updates:
            shared_tags_provided = True
            shared_tags = group_updates.get("tags") or []

    existing_items = (
        db.query(Question)
        .filter(
            Question.group_id == group_id,
            Question.type_q == "media"
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
            f"Media items not found: {missing_deleted_ids}"
        )

    created_ids = []
    updated_ids = []

    try:
        deleted_items = [
            existing_by_id[item_id]
            for item_id in deleted_item_ids
        ]
        media_to_delete.extend(item.media for item in deleted_items)

        if deleted_item_ids:
            delete_question_dependents(db, deleted_item_ids_list)

            for item in deleted_items:
                db.delete(item)

        if shared_tags_provided:
            for item in existing_items:
                if item.id not in deleted_item_ids:
                    item.tags = shared_tags

        if "name" in group_updates:
            for item in existing_items:
                if item.id not in deleted_item_ids:
                    item.question = build_media_question_text(group, item.answer)

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
                        f"Media item {item_payload.id} not found"
                    )

            if not item:
                item = Question(
                    type_q="media",
                    question=build_media_question_text(group, item_payload.answer),
                    answer=item_payload.answer or "",
                    media=item_payload.media or "",
                    tags=shared_tags if shared_tags_provided else [],
                    data=build_media_item_data(
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
                desired_answer = item_payload.answer or ""
                desired_media = item_payload.media or ""
                desired_data = build_media_item_data(
                    item.data or {},
                    item_payload.data or {},
                    aliases
                )
                payload_changed = media_item_payload_changed(
                    item,
                    desired_answer,
                    desired_media,
                    desired_data
                )
                old_media = item.media
                item.answer = desired_answer
                item.question = build_media_question_text(group, item.answer)
                item.media = desired_media
                item.data = desired_data

                if shared_tags_provided:
                    item.tags = shared_tags

                if not media_points_to_same_static_file(old_media, item.media):
                    media_to_delete.append(old_media)

                if payload_changed:
                    updated_ids.append(item.id)

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
            Question.type_q == "media"
        )
        .all()
    )
    question_count = len(saved_items)
    response_tags = shared_tags if shared_tags_provided else derive_media_group_tags(
        saved_items
    )

    delete_unreferenced_media_files(db, media_to_delete)

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
