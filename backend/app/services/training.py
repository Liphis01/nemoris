import hashlib
import json
import random
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import joinedload, selectinload

from ..models import Collection, Question, QuestionGroup, question_collection
from ..serializers import serialize_progress
from .collections import (
    generated_collection_response_fields,
    sync_generated_hard_collection
)
from .image_modes import (
    DEFAULT_IMAGE_MODE,
    normalize_image_mode
)
from .map_modes import (
    DEFAULT_MAP_MODE,
    normalize_map_mode
)
from .text_modes import (
    DEFAULT_TEXT_MODE,
    normalize_text_mode
)
from .sequence import (
    dense_positions
)
from .sequence_modes import (
    DEFAULT_SEQUENCE_MODE,
    normalize_sequence_mode
)
from .map_zones import merge_tags
from .map_eligibility import reviewable_question_filter
from .review import serialize_review_items
from .tag_hierarchy import (
    descendants,
    ensure_stored_tag_ids,
    label_for_tag,
    load_tag_hierarchy,
    parent_map,
    resolve_tag_id,
    tag_usage_counts
)
from .timeline import grade_timeline_answer, validate_timeline_data


TRAINING_RECORD_KEY = "training_record"
TRAINING_RECORDS_KEY = "training_records"
TRAINING_RECORD_FIELDS = {
    "best_found_percent",
    "best_found_count",
    "best_found_elapsed_ms",
    "best_found_at",
    "best_time_ms",
    "best_time_at",
    "question_count",
    "content_fingerprint"
}
MODE_GROUP_TYPES = {"map", "media", "text", "sequence"}


def normalize_scope_tag(value):
    # Questions store language-neutral IDs. Labels are deliberately not used
    # as identity here; the request boundary resolves legacy/root aliases once.
    return str(value or "").strip()


def question_has_exact_tag(question, normalized_tag):
    return any(
        normalize_scope_tag(tag) == normalized_tag
        for tag in (question.tags or [])
    )


def question_in_tag_subtree(question, tag_keys):
    return any(
        normalize_scope_tag(tag) in tag_keys
        for tag in (question.tags or [])
    )


def _training_tag_subtree(db, normalized_tag):
    """All tag keys covered when training on ``normalized_tag`` — the tag itself
    plus every descendant in the hierarchy."""
    pmap = parent_map(load_tag_hierarchy(db))
    return descendants(normalized_tag, pmap)


def _training_question_query(db):
    return (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            selectinload(Question.group)
            .selectinload(QuestionGroup.questions)
            .selectinload(Question.progress)
        )
        .filter(reviewable_question_filter())
        .order_by(Question.id)
    )


def _training_questions_by_ids(db, question_ids):
    question_ids = list(question_ids or [])

    if not question_ids:
        return []

    questions = (
        _training_question_query(db)
        .filter(Question.id.in_(question_ids))
        .all()
    )
    questions_by_id = {
        question.id: question
        for question in questions
    }

    return [
        questions_by_id[question_id]
        for question_id in question_ids
        if question_id in questions_by_id
    ]


def _shuffled_training_items(items):
    shuffled = list(items or [])
    random.shuffle(shuffled)
    return shuffled


def _question_ids_for_training_tag(db, tag_keys):
    rows = db.execute(
        text(
            """
            SELECT questions.id, tag.value
            FROM questions
            JOIN json_each(questions.tags) AS tag
            WHERE questions.tags IS NOT NULL
            ORDER BY questions.id
            """
        )
    ).all()
    question_ids = []
    seen_question_ids = set()

    for question_id, tag_value in rows:
        if question_id in seen_question_ids:
            continue

        if normalize_scope_tag(tag_value) not in tag_keys:
            continue

        seen_question_ids.add(question_id)
        question_ids.append(question_id)

    return question_ids


def _clean_string(value):
    return str(value or "").strip()


def _group_training_fingerprint_payload(group, questions):
    # The training record is a best-time for completing the whole group, so it
    # only becomes meaningless when the *set* of items changes. Editing an
    # existing item's answer/media/aliases is a content fix that leaves the
    # challenge intact, so the fingerprint is built from item membership and
    # group-level structure only, never from per-item content.
    item_ids = sorted(
        question.id
        for question in questions or []
        if question.type_q == group.type_group and question.id is not None
    )

    payload = {
        "group_id": group.id,
        "type_group": group.type_group,
        "item_ids": item_ids
    }

    if group.type_group == "map":
        # Swapping a map's background image is a whole-group change, not an item
        # edit, so it still retires the record.
        payload["media"] = _clean_string(group.media)

    if group.type_group == "sequence":
        # For every other type the challenge is the *set* of items, so sorted
        # ids are enough. A sequence is the order itself: permuting the same
        # items is a different challenge entirely, and sorted ids cannot see it.
        positions = dense_positions(questions)
        payload["positions"] = sorted(
            (question.id, positions[question.id])
            for question in questions or []
            if question.type_q == "sequence" and question.id is not None
        )

    return payload


def _hash_training_fingerprint_payload(payload):
    serialized = json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True
    )

    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def training_fingerprints_for_groups(db, groups):
    groups = list(groups or [])
    group_ids = [
        group.id
        for group in groups
        if group.id is not None
    ]
    questions_by_group_id = {
        group_id: []
        for group_id in group_ids
    }

    if group_ids:
        questions = (
            db.query(Question)
            .filter(
                Question.group_id.in_(group_ids),
                Question.type_q.in_(["map", "media", "text", "sequence"]),
                reviewable_question_filter(),
            )
            .order_by(Question.id)
            .all()
        )

        for question in questions:
            questions_by_group_id.setdefault(question.group_id, []).append(
                question
            )

    return {
        group.id: _hash_training_fingerprint_payload(
            _group_training_fingerprint_payload(
                group,
                questions_by_group_id.get(group.id, [])
            )
        )
        for group in groups
    }


def group_training_fingerprint(db, group):
    if isinstance(group, int):
        group = (
            db.query(QuestionGroup)
            .filter(QuestionGroup.id == group)
            .first()
        )

    if not group:
        return None

    return training_fingerprints_for_groups(db, [group]).get(group.id)


def _collection_training_fingerprint_payload(collection, questions):
    # Like groups, a collection's record only depends on which questions belong
    # to it, not on their content (see _group_training_fingerprint_payload).
    item_ids = sorted(
        question.id
        for question in questions or []
        if question.id is not None
    )

    return {
        "collection_id": collection.id,
        "item_ids": item_ids
    }


def training_fingerprints_for_collections(db, collections):
    collections = list(collections or [])
    collection_ids = [
        collection.id
        for collection in collections
        if collection.id is not None
    ]
    questions_by_collection_id = {
        collection_id: []
        for collection_id in collection_ids
    }

    if collection_ids:
        rows = (
            db.query(question_collection.c.collection_id, Question)
            .join(
                Question,
                question_collection.c.question_id == Question.id
            )
            .options(joinedload(Question.group))
            .filter(question_collection.c.collection_id.in_(collection_ids))
            .order_by(question_collection.c.collection_id, Question.id)
            .all()
        )

        for collection_id, question in rows:
            questions_by_collection_id.setdefault(collection_id, []).append(
                question
            )

    return {
        collection.id: _hash_training_fingerprint_payload(
            _collection_training_fingerprint_payload(
                collection,
                questions_by_collection_id.get(collection.id, [])
            )
        )
        for collection in collections
    }


def collection_training_fingerprint(db, collection):
    if isinstance(collection, int):
        collection = (
            db.query(Collection)
            .filter(Collection.id == collection)
            .first()
        )

    if not collection:
        return None

    return training_fingerprints_for_collections(db, [collection]).get(
        collection.id
    )


def serialize_training_record(data, content_fingerprint=None):
    record = (data or {}).get(TRAINING_RECORD_KEY)

    if not isinstance(record, dict):
        return None

    if (
        content_fingerprint is not None and
        record.get("content_fingerprint") != content_fingerprint
    ):
        return None

    return {
        key: record[key]
        for key in TRAINING_RECORD_FIELDS
        if key in record
    }


def default_training_mode_for_group_type(group_type):
    if group_type == "map":
        return DEFAULT_MAP_MODE

    if group_type == "media":
        return DEFAULT_IMAGE_MODE

    if group_type == "text":
        return DEFAULT_TEXT_MODE

    if group_type == "sequence":
        return DEFAULT_SEQUENCE_MODE

    return None


def normalize_training_mode_for_group_type(group_type, mode):
    if group_type == "map":
        return normalize_map_mode(mode)

    if group_type == "media":
        return normalize_image_mode(mode)

    if group_type == "text":
        return normalize_text_mode(mode)

    if group_type == "sequence":
        return normalize_sequence_mode(mode)

    return None


def _serialize_record(record, content_fingerprint=None):
    if not isinstance(record, dict):
        return None

    if (
        content_fingerprint is not None and
        record.get("content_fingerprint") != content_fingerprint
    ):
        return None

    return {
        key: record[key]
        for key in TRAINING_RECORD_FIELDS
        if key in record
    }


def _serialize_previous_record(record, content_fingerprint=None):
    if not isinstance(record, dict):
        return None

    record_fingerprint = record.get("content_fingerprint")

    if not record_fingerprint or content_fingerprint is None:
        return None

    if record_fingerprint == content_fingerprint:
        return None

    return {
        key: record[key]
        for key in TRAINING_RECORD_FIELDS
        if key in record
    }


def serialize_previous_training_record(data, content_fingerprint=None):
    return _serialize_previous_record(
        (data or {}).get(TRAINING_RECORD_KEY),
        content_fingerprint
    )


def serialize_training_records(data, content_fingerprint=None, group_type="map"):
    data = data or {}
    raw_records = data.get(TRAINING_RECORDS_KEY)
    records = {}
    default_mode = default_training_mode_for_group_type(group_type)

    if isinstance(raw_records, dict):
        for mode, record in raw_records.items():
            normalized_mode = normalize_training_mode_for_group_type(
                group_type,
                mode
            )

            if normalized_mode != mode:
                continue

            serialized = _serialize_record(record, content_fingerprint)

            if serialized:
                records[normalized_mode] = serialized

    legacy_record = serialize_training_record(data, content_fingerprint)

    if legacy_record and default_mode and default_mode not in records:
        records[default_mode] = legacy_record

    return records


def serialize_previous_training_records(
    data,
    content_fingerprint=None,
    group_type="map"
):
    data = data or {}
    raw_records = data.get(TRAINING_RECORDS_KEY)
    records = {}
    default_mode = default_training_mode_for_group_type(group_type)

    if isinstance(raw_records, dict):
        for mode, record in raw_records.items():
            normalized_mode = normalize_training_mode_for_group_type(
                group_type,
                mode
            )

            if normalized_mode != mode:
                continue

            serialized = _serialize_previous_record(
                record,
                content_fingerprint
            )

            if serialized:
                records[normalized_mode] = serialized

    current_records = serialize_training_records(
        data,
        content_fingerprint,
        group_type
    )
    legacy_record = serialize_previous_training_record(
        data,
        content_fingerprint
    )

    if (
        legacy_record and
        default_mode and
        default_mode not in current_records and
        default_mode not in records
    ):
        records[default_mode] = legacy_record

    return records


def list_training_scopes(db):
    ensure_stored_tag_ids(db)
    sync_generated_hard_collection(db)

    groups = (
        db.query(
            QuestionGroup,
            func.count(Question.id).label("question_count")
        )
        .outerjoin(Question)
        .filter(reviewable_question_filter())
        .group_by(QuestionGroup.id)
        .order_by(QuestionGroup.id)
        .all()
    )
    group_ids = [group.id for group, _ in groups]
    fingerprints_by_group_id = training_fingerprints_for_groups(
        db,
        [group for group, _ in groups]
    )
    collections = (
        db.query(
            Collection,
            func.count(question_collection.c.question_id).label(
                "question_count"
            )
        )
        .outerjoin(
            question_collection,
            Collection.id == question_collection.c.collection_id
        )
        .group_by(Collection.id)
        .order_by(Collection.id)
        .all()
    )
    fingerprints_by_collection_id = training_fingerprints_for_collections(
        db,
        [collection for collection, _ in collections]
    )
    grouped_tag_rows = (
        db.query(Question.group_id, Question.tags)
        .filter(
            Question.group_id.in_(group_ids),
            Question.type_q.in_(["map", "media"])
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

    hierarchy = load_tag_hierarchy(db)
    pmap = parent_map(hierarchy)
    tag_names_by_key = {}
    tag_counts_by_key = {}

    # Surface every hierarchy node as a theme — including pure-parent nodes that
    # no question is directly tagged with (e.g. "geography").
    all_parent_keys = {
        parent
        for parent_list in pmap.values()
        for parent in parent_list
    }

    for key in set(hierarchy.get("nodes", {})) | set(pmap) | all_parent_keys:
        if key:
            tag_names_by_key.setdefault(key, label_for_tag(hierarchy, key))
            tag_counts_by_key.setdefault(key, 0)

    # Rolled up through the hierarchy, so parent themes total their descendants.
    usage_counts, usage_displays = tag_usage_counts(db, pmap)

    for key, count in usage_counts.items():
        tag_counts_by_key[key] = tag_counts_by_key.get(key, 0) + count

    for key, display_name in usage_displays.items():
        tag_names_by_key.setdefault(key, label_for_tag(hierarchy, key) or display_name)

    return {
        "groups": [
            {
                "id": group.id,
                "type_group": group.type_group,
                "name": group.name,
                "media": group.media,
                "map": (group.data or {}).get("map"),
                "tags": tags_by_group_id.get(group.id, []),
                "question_count": question_count,
                "training_record": serialize_training_record(
                    group.data,
                    fingerprints_by_group_id.get(group.id)
                ),
                "training_records": (
                    serialize_training_records(
                        group.data,
                        fingerprints_by_group_id.get(group.id),
                        group.type_group
                    )
                    if group.type_group in MODE_GROUP_TYPES
                    else {}
                ),
                "previous_training_record": (
                    serialize_previous_training_record(
                        group.data,
                        fingerprints_by_group_id.get(group.id)
                    )
                    if group.type_group in MODE_GROUP_TYPES
                    else None
                ),
                "previous_training_records": (
                    serialize_previous_training_records(
                        group.data,
                        fingerprints_by_group_id.get(group.id),
                        group.type_group
                    )
                    if group.type_group in MODE_GROUP_TYPES
                    else {}
                )
            }
            for group, question_count in groups
        ],
        "collections": [
            {
                "id": collection.id,
                "name": collection.name,
                "question_count": question_count,
                "training_record": serialize_training_record(
                    collection.data,
                    fingerprints_by_collection_id.get(collection.id)
                ),
                **generated_collection_response_fields(collection)
            }
            for collection, question_count in collections
        ],
        "tags": [
            {
                "id": key,
                "key": key,
                "label": tag_names_by_key[key],
                # Kept during the frontend transition; unlike before it is a
                # display alias and never sent back as identity.
                "name": tag_names_by_key[key],
                "count": tag_counts_by_key[key]
            }
            # Keys are random UUIDs for user tags, so sort on the label to get
            # a stable, display-friendly order.
            for key in sorted(
                tag_names_by_key,
                key=lambda key: (tag_names_by_key[key] or "", key)
            )
            if tag_counts_by_key.get(key, 0) > 0
            and key not in set(hierarchy.get("hidden_core_roots") or [])
        ]
    }


def _current_utc_timestamp():
    return datetime.now(timezone.utc).isoformat()


def _found_percent(found_count, question_count):
    return round((found_count / question_count) * 100, 2)


def _should_update_best_found(record, percent, elapsed_ms):
    previous_percent = record.get("best_found_percent")

    if previous_percent is None:
        return True

    if percent > previous_percent:
        return True

    if percent < previous_percent:
        return False

    previous_elapsed = record.get("best_found_elapsed_ms")

    return previous_elapsed is None or elapsed_ms < previous_elapsed


def _attach_text_training_aliases(items, questions):
    aliases_by_question_id = {
        question.id: (
            question.data.get("aliases", [])
            if isinstance(question.data, dict)
            else []
        )
        for question in questions or []
        if question.type_q == "text"
    }

    for item in items or []:
        if item.get("type_q") == "text":
            item["aliases"] = aliases_by_question_id.get(
                item.get("question_id"),
                []
            )

    return items


def record_training_attempt(db, group_id, payload):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    current_questions = (
        db.query(Question)
        .filter(
            Question.group_id == group.id,
            Question.type_q == group.type_group
        )
        .all()
    )
    current_question_count = len(current_questions)
    content_fingerprint = _hash_training_fingerprint_payload(
        _group_training_fingerprint_payload(group, current_questions)
    )

    if current_question_count <= 0:
        raise HTTPException(
            status_code=400,
            detail="Group has no training items"
        )

    if payload.question_count != current_question_count:
        raise HTTPException(
            status_code=400,
            detail="Training question count no longer matches the group"
        )

    if payload.content_fingerprint != content_fingerprint:
        raise HTTPException(
            status_code=409,
            detail="Training content changed; restart the session"
        )

    if payload.found_count > payload.question_count:
        raise HTTPException(
            status_code=400,
            detail="found_count cannot exceed question_count"
        )

    group_data = dict(group.data or {})
    mode = normalize_training_mode_for_group_type(
        group.type_group,
        payload.mode
    )
    default_mode = default_training_mode_for_group_type(group.type_group)
    existing_records = (
        group_data.get(TRAINING_RECORDS_KEY)
        if isinstance(group_data.get(TRAINING_RECORDS_KEY), dict)
        else {}
    )
    existing_record = (
        _serialize_record(
            existing_records.get(mode),
            content_fingerprint
        )
        if mode
        else serialize_training_record(group_data, content_fingerprint)
    )

    if mode == default_mode and not existing_record:
        existing_record = serialize_training_record(
            group_data,
            content_fingerprint
        )

    record = dict(existing_record or {})
    timestamp = _current_utc_timestamp()
    percent = _found_percent(payload.found_count, payload.question_count)
    is_new_best_percent = False
    is_new_best_time = False
    record["content_fingerprint"] = content_fingerprint

    if _should_update_best_found(record, percent, payload.elapsed_ms):
        record.update({
            "best_found_percent": percent,
            "best_found_count": payload.found_count,
            "best_found_elapsed_ms": payload.elapsed_ms,
            "best_found_at": timestamp,
            "question_count": payload.question_count
        })
        is_new_best_percent = True

    if payload.found_count == payload.question_count:
        best_time_ms = record.get("best_time_ms")

        if best_time_ms is None or payload.elapsed_ms < best_time_ms:
            record.update({
                "best_time_ms": payload.elapsed_ms,
                "best_time_at": timestamp,
                "question_count": payload.question_count
            })
            is_new_best_time = True

    if mode:
        records = dict(existing_records)
        records[mode] = record
        group_data[TRAINING_RECORDS_KEY] = records

        if mode == default_mode:
            group_data[TRAINING_RECORD_KEY] = record
    else:
        group_data[TRAINING_RECORD_KEY] = record

    group.data = group_data
    db.commit()
    db.refresh(group)
    training_records = (
        serialize_training_records(
            group.data,
            content_fingerprint,
            group.type_group
        )
        if group.type_group in MODE_GROUP_TYPES
        else {}
    )
    previous_training_records = (
        serialize_previous_training_records(
            group.data,
            content_fingerprint,
            group.type_group
        )
        if group.type_group in MODE_GROUP_TYPES
        else {}
    )

    return {
        "training_record": (
            training_records.get(mode or default_mode)
            if group.type_group in MODE_GROUP_TYPES
            else serialize_training_record(group.data, content_fingerprint)
        ),
        "training_records": training_records,
        "previous_training_record": (
            serialize_previous_training_record(
                group.data,
                content_fingerprint
            )
            if group.type_group in MODE_GROUP_TYPES
            else None
        ),
        "previous_training_records": previous_training_records,
        "is_new_best_percent": is_new_best_percent,
        "is_new_best_time": is_new_best_time
    }


def record_collection_training_attempt(db, collection_id, payload):
    collection = (
        db.query(Collection)
        .filter(Collection.id == collection_id)
        .first()
    )

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    current_questions = (
        db.query(Question)
        .join(
            question_collection,
            question_collection.c.question_id == Question.id
        )
        .options(joinedload(Question.group))
        .filter(question_collection.c.collection_id == collection.id)
        .order_by(Question.id)
        .all()
    )
    current_question_count = len(current_questions)
    content_fingerprint = _hash_training_fingerprint_payload(
        _collection_training_fingerprint_payload(
            collection,
            current_questions
        )
    )

    if current_question_count <= 0:
        raise HTTPException(
            status_code=400,
            detail="Collection has no training items"
        )

    if payload.question_count != current_question_count:
        raise HTTPException(
            status_code=400,
            detail="Training question count no longer matches the collection"
        )

    if payload.content_fingerprint != content_fingerprint:
        raise HTTPException(
            status_code=409,
            detail="Training content changed; restart the session"
        )

    if payload.found_count > payload.question_count:
        raise HTTPException(
            status_code=400,
            detail="found_count cannot exceed question_count"
        )

    collection_data = dict(collection.data or {})
    record = dict(
        serialize_training_record(collection_data, content_fingerprint) or {}
    )
    timestamp = _current_utc_timestamp()
    percent = _found_percent(payload.found_count, payload.question_count)
    is_new_best_percent = False
    is_new_best_time = False
    record["content_fingerprint"] = content_fingerprint

    if _should_update_best_found(record, percent, payload.elapsed_ms):
        record.update({
            "best_found_percent": percent,
            "best_found_count": payload.found_count,
            "best_found_elapsed_ms": payload.elapsed_ms,
            "best_found_at": timestamp,
            "question_count": payload.question_count
        })
        is_new_best_percent = True

    if payload.found_count == payload.question_count:
        best_time_ms = record.get("best_time_ms")

        if best_time_ms is None or payload.elapsed_ms < best_time_ms:
            record.update({
                "best_time_ms": payload.elapsed_ms,
                "best_time_at": timestamp,
                "question_count": payload.question_count
            })
            is_new_best_time = True

    collection_data[TRAINING_RECORD_KEY] = record
    collection.data = collection_data
    db.commit()
    db.refresh(collection)

    return {
        "training_record": serialize_training_record(
            collection.data,
            content_fingerprint
        ),
        "training_records": {},
        "is_new_best_percent": is_new_best_percent,
        "is_new_best_time": is_new_best_time
    }


def get_training_items(
    db,
    scope_type,
    group_id=None,
    collection_id=None,
    tag=None,
    map_mode=None,
    image_mode=None,
    text_mode=None,
    sequence_mode=None
):
    ensure_stored_tag_ids(db)
    if scope_type == "group":
        if group_id is None:
            raise HTTPException(
                status_code=400,
                detail="group_id is required for group training"
            )

        group = (
            db.query(QuestionGroup)
            .filter(QuestionGroup.id == group_id)
            .first()
        )

        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        questions = (
            _training_question_query(db)
            .filter(Question.group_id == group_id)
            .all()
        )
        normalized_sequence_mode = normalize_sequence_mode(sequence_mode)
        items = _attach_text_training_aliases(
            serialize_review_items(
                questions,
                forced_sequence_mode=normalized_sequence_mode
            ),
            questions
        )
        content_fingerprint = group_training_fingerprint(db, group_id)
        normalized_map_mode = normalize_map_mode(map_mode)
        normalized_image_mode = normalize_image_mode(image_mode)
        normalized_text_mode = normalize_text_mode(text_mode)

        for item in items:
            if item.get("group_id") == group_id:
                item["training_fingerprint"] = content_fingerprint
                if item.get("type_q") == "map":
                    item["mode"] = normalized_map_mode
                elif item.get("type_q") == "media":
                    item["mode"] = normalized_image_mode
                elif item.get("type_q") == "text":
                    item["mode"] = normalized_text_mode
                elif item.get("type_q") == "sequence":
                    item["mode"] = normalized_sequence_mode

        return _shuffled_training_items(items)

    if scope_type == "collection":
        if collection_id is None:
            raise HTTPException(
                status_code=400,
                detail="collection_id is required for collection training"
            )

        collection = (
            db.query(Collection)
            .filter(Collection.id == collection_id)
            .first()
        )

        if not collection:
            raise HTTPException(
                status_code=404,
                detail="Collection not found"
            )

        questions = (
            _training_question_query(db)
            .join(
                question_collection,
                question_collection.c.question_id == Question.id
            )
            .filter(question_collection.c.collection_id == collection_id)
            .all()
        )
        selected_question_ids = {
            question.id
            for question in questions
        }
        items = _attach_text_training_aliases(
            serialize_review_items(
                questions,
                forced_sequence_mode=DEFAULT_SEQUENCE_MODE
            ),
            questions
        )
        content_fingerprint = collection_training_fingerprint(
            db,
            collection
        )
        normalized_map_mode = normalize_map_mode(DEFAULT_MAP_MODE)
        normalized_image_mode = normalize_image_mode(DEFAULT_IMAGE_MODE)
        normalized_text_mode = normalize_text_mode(DEFAULT_TEXT_MODE)
        normalized_sequence_mode = normalize_sequence_mode(DEFAULT_SEQUENCE_MODE)

        for item in items:
            item["training_fingerprint"] = content_fingerprint

            if item.get("type_q") == "map":
                item["mode"] = normalized_map_mode
            elif item.get("type_q") == "media":
                item["mode"] = normalized_image_mode
            elif item.get("type_q") == "text":
                item["mode"] = normalized_text_mode
            elif item.get("type_q") == "sequence":
                item["mode"] = normalized_sequence_mode

            if isinstance(item.get("context_items"), list):
                context_items = [
                    context_item
                    for context_item in item["context_items"]
                    if context_item.get("question_id") in selected_question_ids
                ]
                item["context_items"] = context_items or item.get("items", [])

        return _shuffled_training_items(items)

    if scope_type == "tag":
        hierarchy = load_tag_hierarchy(db)
        normalized_tag = resolve_tag_id(hierarchy, tag)

        if not normalized_tag:
            raise HTTPException(
                status_code=400,
                detail="tag is required for tag training"
            )

        tag_keys = _training_tag_subtree(db, normalized_tag)
        questions = [
            question
            for question in _training_questions_by_ids(
                db,
                _question_ids_for_training_tag(db, tag_keys)
            )
            if question_in_tag_subtree(question, tag_keys)
        ]
        return _attach_text_training_aliases(
            serialize_review_items(
                questions,
                forced_sequence_mode=DEFAULT_SEQUENCE_MODE
            ),
            questions
        )

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
