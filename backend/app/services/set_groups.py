"""Membership-set sources, generated cards, and unordered server grading."""

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_progress
from .answer_policy import effective_answer_policy, matches_answer_value, merge_answer_policy, normalize_answer_text
from .questions import delete_question_dependents
from .tag_hierarchy import ensure_tag_ids


SET_NAMESPACE = uuid.UUID("e053ab25-8778-59ed-9ba9-6b5f50c9d62e")


def _bad(detail):
    raise HTTPException(status_code=422, detail=detail)


def _key(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        _bad("Chaque membre doit avoir une clé UUID valide.")


def normalize_set_source(members):
    if not isinstance(members, list) or not members:
        _bad("L'ensemble doit contenir au moins un membre.")
    normalized, keys, values = [], set(), set()
    for entry in members:
        if not isinstance(entry, dict):
            _bad("Un membre est mal formé.")
        key = _key(entry.get("key"))
        value = str(entry.get("value") or "").strip()
        aliases = [str(alias).strip() for alias in (entry.get("aliases") or [])]
        aliases = [alias for alias in aliases if alias]
        if not value:
            _bad("Le nom de chaque membre est requis.")
        if key in keys:
            _bad("Les clés des membres doivent être uniques.")
        values_for_member = [value, *aliases]
        normalized_values = [normalize_answer_text(candidate) for candidate in values_for_member]
        if len(set(normalized_values)) != len(normalized_values) or any(candidate in values for candidate in normalized_values):
            _bad("Un membre ou son alias est ambigu ou dupliqué.")
        keys.add(key)
        values.update(normalized_values)
        normalized.append({"key": key, "value": value, "aliases": aliases})
    return {"format": 1, "members": normalized}


def set_question_guid(group_guid, key):
    return str(uuid.uuid5(SET_NAMESPACE, f"{group_guid}:{key}"))


def set_question_data(member):
    return {"set": {"key": member["key"]}, "aliases": member["aliases"]}


def get_set_group_or_404(db, group_id):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions).joinedload(Question.progress))
        .filter(QuestionGroup.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.type_group != "set":
        raise HTTPException(status_code=400, detail="Group is not a membership set")
    return group


def serialize_set_card(question):
    return {
        "id": question.id, "guid": question.guid, "type_q": "set",
        "question": question.question, "answer": question.answer,
        "tags": question.tags or [], "data": question.data or {},
        "group_id": question.group_id, "progress": serialize_progress(question.progress),
        "suspended": bool(question.suspended),
    }


def serialize_set_group(group):
    source = ((group.data or {}).get("set") or {})
    cards = sorted((item for item in (group.questions or []) if item.type_q == "set"), key=lambda item: item.id)
    return {"group": {
        "id": group.id, "guid": group.guid, "type_group": "set", "name": group.name,
        "data": group.data or {}, "members": source.get("members", []),
        "tags": (cards[0].tags or []) if cards else [],
        "answer_policy": (group.data or {}).get("answer_policy"), "question_count": len(cards),
    }, "cards": [serialize_set_card(card) for card in cards]}


def get_set_group(db, group_id):
    return serialize_set_group(get_set_group_or_404(db, group_id))


def save_set_group(db, group_id, payload):
    group = get_set_group_or_404(db, group_id)
    incoming = normalize_set_source(payload.members)
    preserve_progress = payload.edit_policy == "preserve_progress"
    previous_source = ((group.data or {}).get("set") or {}).get("members")
    previous = normalize_set_source(previous_source)["members"] if previous_source else []
    existing = {((item.data or {}).get("set") or {}).get("key"): item for item in group.questions or [] if item.type_q == "set"}
    previous_by_key = {member["key"]: member for member in previous}

    members, replaced_keys = [], set()
    for member in incoming["members"]:
        old = previous_by_key.get(member["key"])
        if old and not preserve_progress and (
            old["value"] != member["value"] or
            old["aliases"] != member["aliases"]
        ):
            replaced_keys.add(member["key"])
            member = {**member, "key": str(uuid.uuid4())}
        members.append(member)
    source = {"format": 1, "members": members}

    if payload.name is not None:
        group.name = payload.name
    tags = ensure_tag_ids(db, payload.tags or [])
    data = dict(group.data or {})
    data["set"] = source
    if payload.answer_policy is not None:
        data = merge_answer_policy(data, payload.answer_policy, type_q="set")
    group.data = data

    active_keys = {member["key"] for member in members}
    removed = [item for key, item in existing.items() if key not in active_keys]
    removed_ids, created_ids = [item.id for item in removed], []
    try:
        if removed:
            delete_question_dependents(db, removed_ids)
            for item in removed:
                db.delete(item)
        for member in members:
            item = existing.get(member["key"])
            if item is None:
                item = Question(
                    guid=set_question_guid(group.guid, member["key"]), type_q="set",
                    question=group.name, answer=member["value"], tags=tags,
                    data=set_question_data(member), group_id=group.id,
                )
                db.add(item); db.flush(); created_ids.append(item.id)
            else:
                item.guid = set_question_guid(group.guid, member["key"])
                item.question = group.name
                item.answer = member["value"]
                item.tags = tags
                item.data = set_question_data(member)
        db.commit()
    except Exception:
        db.rollback()
        raise
    result = get_set_group(db, group_id)
    result.update({"items": result["cards"], "deletedQuestionIds": removed_ids, "createdQuestionIds": created_ids, "replacedMemberKeys": list(replaced_keys)})
    return result


def validate_set_pack_entries(group_entries, question_entries):
    for group in group_entries or []:
        if group.get("type_group") != "set":
            continue
        source = normalize_set_source(((group.get("data") or {}).get("set") or {}).get("members"))
        cards = [entry for entry in question_entries or [] if entry.get("group_guid") == group.get("guid") and entry.get("type_q") == "set"]
        by_key = {((entry.get("data") or {}).get("set") or {}).get("key"): entry for entry in cards}
        members = {member["key"]: member for member in source["members"]}
        if set(by_key) != set(members):
            raise ValueError("Invalid set pack: generated cards do not match source")
        for key, member in members.items():
            entry = by_key[key]
            if entry.get("guid") != set_question_guid(group.get("guid"), key) or entry.get("answer") != member["value"] or entry.get("data") != set_question_data(member):
                raise ValueError("Invalid set pack: card identity does not match source")


def set_presentation(group, questions, mode="collect_members"):
    return {
        "group_id": group.id, "type_q": "set", "presentation_kind": "set_group",
        "name": group.name, "mode": mode,
        "answer_policy": effective_answer_policy(group=group, type_q="set"),
        # Intentionally no member count or labels: neither reveals membership nor
        # turns the target set size into an unintended cue.
        "items": [{"question_id": item.id, "progress": serialize_progress(item.progress)} for item in questions],
    }


def grade_set_answers(db, payload):
    target_ids = list(dict.fromkeys(payload.question_ids))
    if len(target_ids) != len(payload.question_ids):
        _bad("Les membres à corriger doivent être uniques.")
    targets = db.query(Question).options(joinedload(Question.group), joinedload(Question.progress)).filter(Question.id.in_(target_ids), Question.type_q == "set").all()
    if len(targets) != len(target_ids) or any(item.group_id != payload.group_id for item in targets):
        raise HTTPException(status_code=404, detail="Set cards not found")
    group = targets[0].group
    all_members = db.query(Question).filter(Question.group_id == group.id, Question.type_q == "set").all()
    source = normalize_set_source(((group.data or {}).get("set") or {}).get("members"))
    valid_keys = {member["key"] for member in source["members"]}
    if {((item.data or {}).get("set") or {}).get("key") for item in all_members} != valid_keys:
        _bad("La source de l'ensemble et ses cartes sont incohérentes.")
    policy = effective_answer_policy(group=group, type_q="set")
    claimed, recognized, unmatched = set(), [], []
    for raw in [str(answer or "").strip() for answer in payload.answers]:
        if not raw:
            continue
        match = next((item for item in all_members if item.id not in claimed and matches_answer_value(item, raw, policy)), None)
        if match:
            claimed.add(match.id)
            recognized.append({"answer": raw, "question_id": match.id, "expected": match.answer, "target": match.id in target_ids})
        else:
            unmatched.append(raw)
    return {"group": group, "items": [{
        "question": item, "question_id": item.id, "correct": item.id in claimed,
        "answer": next((entry["answer"] for entry in recognized if entry["question_id"] == item.id), ""),
        "expected": item.answer, "answer_policy": policy,
    } for item in targets], "recognized": recognized, "unmatched": unmatched}
