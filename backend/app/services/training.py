import hashlib
import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_progress
from .map_zones import merge_tags
from .review import serialize_review_items
from .timeline import grade_timeline_answer, validate_timeline_data


TRAINING_RECORD_KEY = "training_record"
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


def clear_training_record(group):
    group_data = dict(group.data or {})

    if TRAINING_RECORD_KEY not in group_data:
        return False

    del group_data[TRAINING_RECORD_KEY]
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
                )
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
    record = dict(
        serialize_training_record(group_data, content_fingerprint) or {}
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

    group_data[TRAINING_RECORD_KEY] = record
    group.data = group_data
    db.commit()
    db.refresh(group)

    return {
        "training_record": serialize_training_record(
            group.data,
            content_fingerprint
        ),
        "is_new_best_percent": is_new_best_percent,
        "is_new_best_time": is_new_best_time
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
        items = serialize_review_items(questions)
        content_fingerprint = group_training_fingerprint(db, group_id)

        for item in items:
            if item.get("group_id") == group_id:
                item["training_fingerprint"] = content_fingerprint

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
