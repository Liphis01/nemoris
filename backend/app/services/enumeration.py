"""One-card quota enumeration: produce any k distinct authored members."""

from fastapi import HTTPException

from .answer_policy import effective_answer_policy, normalize_answer_text


def _bad(detail):
    raise HTTPException(status_code=422, detail=detail)


def validate_enumeration_data(data):
    enumeration = (data or {}).get("enumeration")
    if not isinstance(enumeration, dict):
        _bad("data.enumeration est requis.")
    members = enumeration.get("members")
    if not isinstance(members, list) or not members:
        _bad("Une énumération doit contenir au moins un membre.")
    normalized, seen = [], set()
    for entry in members:
        if not isinstance(entry, dict):
            _bad("Un membre est mal formé.")
        value = str(entry.get("value") or "").strip()
        aliases = [str(alias).strip() for alias in (entry.get("aliases") or [])]
        aliases = [alias for alias in aliases if alias]
        values = [value, *aliases]
        if not value:
            _bad("Le nom de chaque membre est requis.")
        keys = [normalize_answer_text(value) for value in values]
        if len(keys) != len(set(keys)) or any(key in seen for key in keys):
            _bad("Un membre ou son alias est ambigu ou dupliqué.")
        seen.update(keys); normalized.append({"value": value, "aliases": aliases})
    try:
        required_count = int(enumeration.get("required_count"))
    except (TypeError, ValueError):
        _bad("Le quota doit être un entier.")
    if required_count < 1 or required_count > len(normalized):
        _bad("Le quota doit être compris entre 1 et le nombre de membres.")
    return {"members": normalized, "required_count": required_count, "format": 1}


def validate_question_enumeration(type_q, group_id, data):
    if type_q != "enumeration":
        return data
    if group_id is not None:
        _bad("Une énumération ne peut pas appartenir à un groupe.")
    return {**(data or {}), "enumeration": validate_enumeration_data(data)}


def validate_enumeration_pack_entries(question_entries):
    for entry in question_entries or []:
        if entry.get("type_q") != "enumeration":
            continue
        normalized = validate_enumeration_data(entry.get("data") or {})
        if ((entry.get("data") or {}).get("enumeration")) != normalized:
            raise ValueError("Invalid enumeration pack: metadata is not canonical")


def grade_enumeration_answers(question, answers):
    enumeration = validate_enumeration_data(question.data or {})
    policy = effective_answer_policy(question=question, type_q="enumeration")
    claimed, seen_responses, matched, duplicates, unmatched = set(), set(), [], [], []
    for raw in [str(value or "").strip() for value in answers]:
        if not raw:
            continue
        response = normalize_answer_text(raw, policy)
        if response in seen_responses:
            duplicates.append(raw)
            continue
        seen_responses.add(response)
        member = next((member for member in enumeration["members"] if response in {normalize_answer_text(value, policy) for value in [member["value"], *member["aliases"]]}), None)
        if member and member["value"] not in claimed:
            claimed.add(member["value"])
            matched.append({"answer": raw, "expected": member["value"]})
        elif member:
            duplicates.append(raw)
        else:
            unmatched.append(raw)
    missing_count = max(0, enumeration["required_count"] - len(matched))
    return {
        "correct": len(matched) >= enumeration["required_count"],
        "matched": matched,
        "duplicates": duplicates,
        "unmatched": unmatched,
        "missing_count": missing_count,
        "enumeration": enumeration,
        "answer_policy": policy
    }
