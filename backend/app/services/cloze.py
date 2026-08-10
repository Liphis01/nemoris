"""Cloze source parsing, generated-card identity, editing, and grading."""

from datetime import date, timedelta
import re
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Progress, Question, QuestionGroup
from ..serializers import serialize_progress
from .answer_policy import (
    effective_answer_policy,
    matches_answer_value,
    merge_answer_policy,
)
from .questions import delete_question_dependents
from .tag_hierarchy import ensure_tag_ids


CLOZE_MARKER_RE = re.compile(r"\\{\\{cloze:([0-9a-fA-F-]{36})::(.*?)\\}\\}", re.DOTALL)
CLOZE_NAMESPACE = uuid.UUID("183ab363-646a-5a8d-90f3-d703c655efe9")


def _bad(detail):
    raise HTTPException(status_code=422, detail=detail)


def parse_cloze_source(source):
    """Return stable deletion keys and answers from the private marker format."""
    source = str(source or "")
    values = {}
    cursor = 0
    while True:
        start = source.find("{{cloze:", cursor)
        if start < 0:
            break
        separator = source.find("::", start + len("{{cloze:"))
        end = source.find("}}", separator + 2) if separator >= 0 else -1
        if separator < 0 or end < 0:
            _bad("Un trou est mal formé.")
        raw_key = source[start + len("{{cloze:"):separator]
        try:
            key = str(uuid.UUID(raw_key))
        except (ValueError, AttributeError):
            _bad("Un trou est mal formé.")
        answer = source[separator + 2:end]
        if "{{cloze:" in answer or "}}" in answer:
            _bad("Les trous ne peuvent pas être imbriqués ou superposés.")
        if not answer.strip():
            _bad("Un trou ne peut pas être vide.")
        previous = values.get(key)
        if previous is not None and previous != answer:
            _bad("Toutes les occurrences d'un même trou doivent avoir la même réponse.")
        values[key] = answer
        cursor = end + 2
    return values


def cloze_question_guid(group_guid, key):
    return str(uuid.uuid5(CLOZE_NAMESPACE, f"{group_guid}:{key}"))


def validate_cloze_pack_entries(group_entries, question_entries):
    """Reject a pack whose cloze source and generated cards disagree."""
    groups = {
        entry.get("guid"): entry
        for entry in group_entries or []
        if entry.get("type_group") == "cloze"
    }
    for guid, group in groups.items():
        source = ((group.get("data") or {}).get("cloze") or {}).get("source")
        if source is None:
            raise ValueError("Invalid cloze pack: source is missing")
        values = parse_cloze_source(source)
        cards = [
            entry for entry in question_entries or []
            if entry.get("group_guid") == guid and entry.get("type_q") == "cloze"
        ]
        by_key = {
            ((entry.get("data") or {}).get("cloze") or {}).get("key"): entry
            for entry in cards
        }
        if set(by_key) != set(values):
            raise ValueError("Invalid cloze pack: generated cards do not match source")
        for key, answer in values.items():
            entry = by_key[key]
            if entry.get("guid") != cloze_question_guid(guid, key) or entry.get("answer") != answer:
                raise ValueError("Invalid cloze pack: card identity does not match source")


def cloze_question_data(key, buried_until=None):
    data = {"cloze": {"key": key}}
    if buried_until:
        data["cloze"]["buried_until"] = buried_until.isoformat()
    return data


def cloze_is_buried(question, today=None):
    if question.type_q != "cloze":
        return False
    value = ((question.data or {}).get("cloze") or {}).get("buried_until")
    if not value:
        return False
    try:
        return (today or date.today()) < date.fromisoformat(value)
    except ValueError:
        return False


def get_cloze_group_or_404(db, group_id):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions).joinedload(Question.progress))
        .filter(QuestionGroup.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.type_group != "cloze":
        raise HTTPException(status_code=400, detail="Group is not a cloze group")
    return group


def serialize_cloze_card(question):
    return {
        "id": question.id,
        "guid": question.guid,
        "type_q": "cloze",
        "question": question.question,
        "key": ((question.data or {}).get("cloze") or {}).get("key"),
        "answer": question.answer,
        "tags": question.tags or [],
        "data": question.data or {},
        "group_id": question.group_id,
        "progress": serialize_progress(question.progress),
        "suspended": bool(question.suspended),
    }


def serialize_cloze_group(group):
    data = group.data or {}
    cloze = data.get("cloze") or {}
    cards = sorted(
        (question for question in (group.questions or []) if question.type_q == "cloze"),
        key=lambda question: question.id,
    )
    return {
        "group": {
            "id": group.id,
            "guid": group.guid,
            "type_group": group.type_group,
            "name": group.name,
            "data": data,
            "source": cloze.get("source", ""),
            "tags": (cards[0].tags or []) if cards else [],
            "answer_policy": data.get("answer_policy"),
            "question_count": len(cards),
        },
        "cards": [serialize_cloze_card(question) for question in cards],
    }


def get_cloze_group(db, group_id):
    return serialize_cloze_group(get_cloze_group_or_404(db, group_id))


def save_cloze_group(db, group_id, payload):
    group = get_cloze_group_or_404(db, group_id)
    source = str(payload.source or "")
    values = parse_cloze_source(source)
    if not values:
        _bad("La note doit contenir au moins un trou.")

    if payload.name is not None:
        group.name = payload.name
    tags = ensure_tag_ids(db, payload.tags or [])
    group_data = dict(group.data or {})
    group_data["cloze"] = {"source": source, "format": 1}
    if payload.answer_policy is not None:
        group_data = merge_answer_policy(group_data, payload.answer_policy, type_q="cloze")
    group.data = group_data

    existing = {
        ((question.data or {}).get("cloze") or {}).get("key"): question
        for question in group.questions or []
        if question.type_q == "cloze"
    }
    active_keys = set(values)
    removed = [question for key, question in existing.items() if key not in active_keys]
    removed_ids = [question.id for question in removed]
    created_ids = []

    try:
        if removed:
            delete_question_dependents(db, [question.id for question in removed])
            for question in removed:
                db.delete(question)

        for key, answer in values.items():
            question = existing.get(key)
            expected_guid = cloze_question_guid(group.guid, key)
            if question and question.answer != answer:
                # A changed expected value is a different memory. Remove the old
                # card (while retaining its append-only review log) and create a
                # new hidden key from the editor, never transfer its progress.
                _bad("Modifier le contenu d'un trou exige de créer un nouveau trou.")
            if question is None:
                question = Question(
                    guid=expected_guid,
                    type_q="cloze",
                    question=group.name,
                    answer=answer,
                    tags=tags,
                    data=cloze_question_data(key),
                    group_id=group.id,
                )
                db.add(question)
                db.flush()
                created_ids.append(question.id)
            else:
                question.guid = expected_guid
                question.question = group.name
                question.tags = tags
                data = dict(question.data or {})
                cloze_data = dict(data.get("cloze") or {})
                cloze_data["key"] = key
                data["cloze"] = cloze_data
                question.data = data

        db.commit()
    except Exception:
        db.rollback()
        raise

    result = get_cloze_group(db, group_id)
    result["items"] = result["cards"]
    result["deletedQuestionIds"] = removed_ids
    result["createdQuestionIds"] = created_ids
    result["updatedQuestionIds"] = [
        card["id"] for card in result["cards"] if card["id"] not in created_ids
    ]
    return result


def render_cloze_source(source, key):
    def replace(match):
        return "[ … ]" if str(uuid.UUID(match.group(1))) == key else match.group(2)
    return CLOZE_MARKER_RE.sub(replace, str(source or ""))


def bury_cloze_siblings(db, question, today=None):
    today = today or date.today()
    until = today + timedelta(days=1)
    siblings = (
        db.query(Question)
        .filter(Question.group_id == question.group_id, Question.type_q == "cloze")
        .all()
    )
    buried_ids = []
    for sibling in siblings:
        if sibling.id == question.id:
            continue
        data = dict(sibling.data or {})
        cloze = dict(data.get("cloze") or {})
        cloze["buried_until"] = until.isoformat()
        data["cloze"] = cloze
        sibling.data = data
        buried_ids.append(sibling.id)
    return buried_ids


def grade_cloze_answer(db, payload, schedule=True):
    question = (
        db.query(Question)
        .options(joinedload(Question.group), joinedload(Question.progress))
        .filter(Question.id == payload.question_id)
        .first()
    )
    if not question or question.type_q != "cloze" or question.group_id != payload.group_id:
        raise HTTPException(status_code=404, detail="Cloze card not found")
    group = question.group
    source = ((group.data or {}).get("cloze") or {}).get("source", "")
    key = ((question.data or {}).get("cloze") or {}).get("key")
    if not key or key not in parse_cloze_source(source):
        raise HTTPException(status_code=422, detail="Cloze source and card are inconsistent")

    policy = effective_answer_policy(question=question, group=group, type_q="cloze")
    response = str(payload.answer or "")
    correct = matches_answer_value(question, response, policy)
    return {
        "question_id": question.id,
        "group_id": group.id,
        "correct": correct,
        "expected": question.answer,
        "source": render_cloze_source(source, key),
        "answer_policy": policy,
    }
