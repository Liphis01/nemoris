from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_manage_question, serialize_progress
from .map_zones import merge_tags
from .tag_hierarchy import ensure_tag_ids
from .questions import delete_question_dependents
from .sequence import dense_positions
from .sequence_order import (
    SEQUENCE_ORDER_VALUE_KEY,
    derive_sequence_positions,
    merge_sequence_order,
    sequence_order_settings
)


def derive_sequence_group_tags(questions):
    return merge_tags(*[
        question.tags or []
        for question in questions or []
        if question.type_q == "sequence"
    ])


def get_sequence_group_or_404(db, group_id: int):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    if group.type_group != "sequence":
        raise HTTPException(400, "Group is not a sequence group")

    return group


def serialize_sequence_item_for_editor(question, position):
    return {
        "id": question.id,
        "type_q": question.type_q,
        "question": question.question,
        "answer": question.answer,
        "label": question.answer,
        "position": position,
        "tags": question.tags or [],
        "group_id": question.group_id,
        "data": question.data or {},
        "aliases": question.data.get("aliases", []) if question.data else [],
        "progress": serialize_progress(question.progress),
        "suspended": bool(question.suspended)
    }


def list_sequence_group_items(db, group_id: int):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions).joinedload(Question.progress))
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    if group.type_group != "sequence":
        raise HTTPException(400, "Group is not a sequence group")

    items = [
        question
        for question in group.questions
        if question.type_q == "sequence"
    ]
    positions = dense_positions(items)

    return sorted(
        [
            serialize_sequence_item_for_editor(question, positions[question.id])
            for question in items
        ],
        key=lambda item: item["position"]
    )


def build_sequence_item_data(existing_data, payload_data, aliases, position):
    data = {
        **(existing_data or {}),
        **(payload_data or {})
    }
    data["aliases"] = [
        alias
        for alias in aliases or []
        if alias
    ]
    # The array order is the rank. Any position the client sent is overwritten,
    # so ranks stay dense 1..N through every insert, delete and reorder without
    # a renumbering pass.
    data["position"] = position

    return data


def sequence_item_payload_changed(item, desired_answer, desired_data):
    return (
        (item.answer or "") != desired_answer or
        (item.data or {}) != desired_data
    )


def save_sequence_group_items(db, group_id: int, payload):
    group = get_sequence_group_or_404(db, group_id)
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

        if "order" in group_updates:
            # Merged, not assigned: group.data also holds training_record and
            # training_records, and a whole-dict replace would drop them.
            group.data = merge_sequence_order(
                group.data,
                group_updates.get("order")
            )

    order = sequence_order_settings(group)

    existing_items = (
        db.query(Question)
        .filter(
            Question.group_id == group_id,
            Question.type_q == "sequence"
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
            f"Sequence items not found: {missing_deleted_ids}"
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

        derived_positions = None

        if order:
            # The attribute may live on the stored row rather than the payload:
            # the editor only resends `data` for rows it touched, and
            # build_sequence_item_data preserves unsent keys.
            def order_value_for(index, item_payload):
                sent = (item_payload.data or {}).get(SEQUENCE_ORDER_VALUE_KEY)

                if sent is not None:
                    return sent

                stored = existing_by_id.get(item_payload.id) if item_payload.id else None

                return (stored.data or {}).get(SEQUENCE_ORDER_VALUE_KEY) if stored else None

            derived_positions = derive_sequence_positions(
                [
                    (index, order_value_for(index, item_payload))
                    for index, item_payload in enumerate(payload.items)
                ],
                order["kind"]
            )

        for index, item_payload in enumerate(payload.items):
            # Array order is the rank for a manual group; a derived group sorts
            # on its declared attribute instead. Either way an integer rank is
            # written, so every downstream reader is unchanged.
            position = (
                derived_positions[index]
                if derived_positions is not None
                else index + 1
            )
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
                        f"Sequence item {item_payload.id} not found"
                    )

            desired_answer = item_payload.answer or ""

            if not item:
                item = Question(
                    type_q="sequence",
                    # Every generic surface (manage rows, stats, the bonus menu)
                    # reads `question`, and QuestionCreate requires it, so the
                    # single label the editor collects fills both columns.
                    question=desired_answer,
                    answer=desired_answer,
                    media=None,
                    tags=shared_tags if shared_tags_provided else [],
                    data=build_sequence_item_data(
                        {},
                        item_payload.data or {},
                        aliases,
                        position
                    ),
                    group_id=group_id
                )

                db.add(item)
                db.flush()
                existing_by_id[item.id] = item
                created_ids.append(item.id)
            else:
                desired_data = build_sequence_item_data(
                    item.data or {},
                    item_payload.data or {},
                    aliases,
                    position
                )

                if sequence_item_payload_changed(
                    item,
                    desired_answer,
                    desired_data
                ):
                    updated_ids.append(item.id)

                item.question = desired_answer
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
            Question.type_q == "sequence"
        )
        .all()
    )
    question_count = len(saved_items)
    response_tags = (
        shared_tags
        if shared_tags_provided
        else derive_sequence_group_tags(saved_items)
    )

    return {
        "group": {
            "id": group.id,
            "type_group": group.type_group,
            "name": group.name,
            "media": group.media,
            "tags": response_tags,
            # The editor needs its order setting echoed back, or it cannot tell
            # a save succeeded and would re-enable manual reordering.
            "data": group.data or {},
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
