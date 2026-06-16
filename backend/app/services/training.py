import hashlib
import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from ..models import Collection, Question, QuestionGroup, question_collection
from ..serializers import serialize_progress
from .image_modes import (
    DEFAULT_IMAGE_MODE,
    normalize_image_mode
)
from .map_modes import (
    DEFAULT_MAP_MODE,
    normalize_map_mode
)
from .map_zones import merge_tags
from .review import serialize_review_items
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
MODE_GROUP_TYPES = {"map", "image"}


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
            .joinedload(QuestionGroup.questions)
            .joinedload(Question.progress)
        )
        .order_by(Question.id)
    )


def _clean_string(value):
    return str(value or "").strip()


def _normalized_aliases(data):
    aliases = (data or {}).get("aliases", [])

    return sorted([
        _clean_string(alias)
        for alias in aliases
        if _clean_string(alias)
    ])


def question_training_signature(type_q, answer=None, media=None, data=None):
    if type_q == "map":
        return {
            "answer": _clean_string(answer),
            "code": _clean_string((data or {}).get("code")),
            "aliases": _normalized_aliases(data)
        }

    if type_q == "image":
        return {
            "answer": _clean_string(answer),
            "media": _clean_string(media),
            "aliases": _normalized_aliases(data)
        }

    if type_q == "text":
        return {
            "answer": _clean_string(answer),
            "media": _clean_string(media),
            "aliases": _normalized_aliases(data)
        }

    if type_q == "timeline":
        return {
            "answer": _clean_string(answer),
            "media": _clean_string(media),
            "timeline": (data or {}).get("timeline")
        }

    return None


def _group_training_fingerprint_payload(group, questions):
    items = []

    for question in sorted(questions or [], key=lambda item: item.id or 0):
        if question.type_q != group.type_group:
            continue

        signature = question_training_signature(
            question.type_q,
            question.answer,
            question.media,
            question.data or {}
        )

        if signature is None:
            continue

        items.append({
            "id": question.id,
            **signature
        })

    payload = {
        "group_id": group.id,
        "type_group": group.type_group,
        "items": items
    }

    if group.type_group == "map":
        payload["media"] = _clean_string(group.media)

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
                Question.type_q.in_(["map", "image"])
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


def _collection_question_training_signature(question):
    signature = question_training_signature(
        question.type_q,
        question.answer,
        question.media,
        question.data or {}
    ) or {}

    payload = {
        "id": question.id,
        "type_q": question.type_q,
        "question": _clean_string(question.question),
        **signature
    }

    if question.group and question.type_q in {"map", "image"}:
        payload["group"] = {
            "id": question.group.id,
            "type_group": question.group.type_group,
            "media": _clean_string(question.group.media)
        }

    return payload


def _collection_training_fingerprint_payload(collection, questions):
    return {
        "collection_id": collection.id,
        "items": [
            _collection_question_training_signature(question)
            for question in sorted(questions or [], key=lambda item: item.id or 0)
        ]
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


def clear_training_record(group):
    group_data = dict(group.data or {})
    changed = False

    if TRAINING_RECORD_KEY in group_data:
        del group_data[TRAINING_RECORD_KEY]
        changed = True

    if TRAINING_RECORDS_KEY in group_data:
        del group_data[TRAINING_RECORDS_KEY]
        changed = True

    if not changed:
        return False

    group.data = group_data
    return True


def clear_training_record_for_group_id(db, group_id):
    if not group_id:
        return False

    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        return False

    return clear_training_record(group)


def clear_training_records_for_group_ids(db, group_ids):
    cleared = False

    for group_id in sorted(set(group_ids or [])):
        cleared = clear_training_record_for_group_id(db, group_id) or cleared

    return cleared


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

    if group_type == "image":
        return DEFAULT_IMAGE_MODE

    return None


def normalize_training_mode_for_group_type(group_type, mode):
    if group_type == "map":
        return normalize_map_mode(mode)

    if group_type == "image":
        return normalize_image_mode(mode)

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
                )
            }
            for collection, question_count in collections
        ],
        "tags": [
            {
                "name": tag_names_by_key[key],
                "count": tag_counts_by_key[key]
            }
            for key in sorted(tag_names_by_key)
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

    return {
        "training_record": (
            training_records.get(mode or default_mode)
            if group.type_group in MODE_GROUP_TYPES
            else serialize_training_record(group.data, content_fingerprint)
        ),
        "training_records": training_records,
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
    image_mode=None
):
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
        items = _attach_text_training_aliases(
            serialize_review_items(questions),
            questions
        )
        content_fingerprint = group_training_fingerprint(db, group_id)
        normalized_map_mode = normalize_map_mode(map_mode)
        normalized_image_mode = normalize_image_mode(image_mode)

        for item in items:
            if item.get("group_id") == group_id:
                item["training_fingerprint"] = content_fingerprint
                if item.get("type_q") == "map":
                    item["mode"] = normalized_map_mode
                elif item.get("type_q") == "image":
                    item["mode"] = normalized_image_mode

        return items

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
            serialize_review_items(questions),
            questions
        )
        content_fingerprint = collection_training_fingerprint(
            db,
            collection
        )
        normalized_map_mode = normalize_map_mode(DEFAULT_MAP_MODE)
        normalized_image_mode = normalize_image_mode(DEFAULT_IMAGE_MODE)

        for item in items:
            item["training_fingerprint"] = content_fingerprint

            if item.get("type_q") == "map":
                item["mode"] = normalized_map_mode
            elif item.get("type_q") == "image":
                item["mode"] = normalized_image_mode

            if isinstance(item.get("context_items"), list):
                context_items = [
                    context_item
                    for context_item in item["context_items"]
                    if context_item.get("question_id") in selected_question_ids
                ]
                item["context_items"] = context_items or item.get("items", [])

        return items

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
        return _attach_text_training_aliases(
            serialize_review_items(questions),
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
