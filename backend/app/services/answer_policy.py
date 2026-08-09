import re
import unicodedata
from copy import deepcopy


ANSWER_POLICY_PRESET_RELAXED = "relaxed"
ANSWER_POLICY_PRESET_EXACT = "exact"
ANSWER_POLICY_PRESETS = {
    ANSWER_POLICY_PRESET_RELAXED,
    ANSWER_POLICY_PRESET_EXACT
}

ANSWER_POLICY_RELAXED = {
    "preset": ANSWER_POLICY_PRESET_RELAXED,
    "case": "ignore",
    "diacritics": "ignore",
    "spacing": "relaxed",
    "punctuation": "relaxed",
    "fuzzy": "none"
}

ANSWER_POLICY_EXACT = {
    "preset": ANSWER_POLICY_PRESET_EXACT,
    "case": "strict",
    "diacritics": "strict",
    "spacing": "strict",
    "punctuation": "strict",
    "fuzzy": "none"
}

ANSWER_POLICY_DEFAULT_BY_TYPE = {
    "map": ANSWER_POLICY_RELAXED,
    "media": ANSWER_POLICY_RELAXED,
    "text": ANSWER_POLICY_RELAXED,
    "sequence": ANSWER_POLICY_RELAXED
}

ANSWER_POLICY_GOLDEN_VECTORS = [
    {
        "policy": ANSWER_POLICY_RELAXED,
        "left": "Ville-Lumiere",
        "right": "ville lumiere",
        "matches": True
    },
    {
        "policy": ANSWER_POLICY_RELAXED,
        "left": "État",
        "right": "etat",
        "matches": True
    },
    {
        "policy": ANSWER_POLICY_EXACT,
        "left": "État",
        "right": "etat",
        "matches": False
    },
    {
        "policy": ANSWER_POLICY_EXACT,
        "left": "Ville-Lumiere",
        "right": "Ville Lumiere",
        "matches": False
    }
]


def answer_policy_for_preset(preset):
    if preset == ANSWER_POLICY_PRESET_EXACT:
        return deepcopy(ANSWER_POLICY_EXACT)

    return deepcopy(ANSWER_POLICY_RELAXED)


def normalize_answer_policy(policy=None, type_q=None):
    base = deepcopy(
        ANSWER_POLICY_DEFAULT_BY_TYPE.get(type_q, ANSWER_POLICY_RELAXED)
    )

    if not isinstance(policy, dict):
        return base

    preset = policy.get("preset")
    if preset in ANSWER_POLICY_PRESETS:
        base = answer_policy_for_preset(preset)

    for key, allowed in {
        "case": {"ignore", "strict"},
        "diacritics": {"ignore", "strict"},
        "spacing": {"relaxed", "strict"},
        "punctuation": {"relaxed", "strict"},
        "fuzzy": {"none"}
    }.items():
        value = policy.get(key)
        if value in allowed:
            base[key] = value

    base["preset"] = (
        ANSWER_POLICY_PRESET_EXACT
        if all(
            base[key] == "strict"
            for key in ["case", "diacritics", "spacing", "punctuation"]
        )
        else base.get("preset") or ANSWER_POLICY_PRESET_RELAXED
    )
    base["fuzzy"] = "none"

    return base


def merge_answer_policy(data, policy, type_q=None):
    next_data = dict(data or {})
    normalized = normalize_answer_policy(policy, type_q=type_q)

    if normalized == normalize_answer_policy(None, type_q=type_q):
        next_data.pop("answer_policy", None)
    else:
        next_data["answer_policy"] = normalized

    return next_data


def effective_answer_policy(question=None, group=None, type_q=None):
    resolved_type = type_q or getattr(question, "type_q", None)
    group_data = getattr(group, "data", None) if group is not None else None
    if group_data is None and question is not None:
        group_data = getattr(getattr(question, "group", None), "data", None)
    question_data = getattr(question, "data", None) if question is not None else None

    group_policy = (
        group_data.get("answer_policy")
        if isinstance(group_data, dict)
        else None
    )
    question_policy = (
        question_data.get("answer_policy")
        if isinstance(question_data, dict)
        else None
    )

    return normalize_answer_policy(
        question_policy or group_policy,
        type_q=resolved_type
    )


def normalize_answer_text(value, policy=None):
    resolved_policy = normalize_answer_policy(policy)
    text = str(value if value is not None else "")

    if resolved_policy["case"] == "ignore":
        text = text.lower()

    if resolved_policy["diacritics"] == "ignore":
        decomposed = unicodedata.normalize("NFD", text)
        text = "".join(
            char
            for char in decomposed
            if unicodedata.category(char) != "Mn"
        )

    if resolved_policy["punctuation"] == "relaxed":
        text = re.sub(r"[-\s]+", " ", text)
    elif resolved_policy["spacing"] == "relaxed":
        text = re.sub(r"\s+", " ", text)

    if resolved_policy["spacing"] == "relaxed":
        text = text.strip()

    return text


def answer_values(question):
    data = getattr(question, "data", None) or {}
    values = [
        getattr(question, "answer", None),
        *(data.get("aliases") or [])
    ]
    if getattr(question, "type_q", None) == "map":
        values.append(data.get("code"))

    return values


def matches_answer_value(question, raw_response, policy=None):
    expected = normalize_answer_policy(policy, type_q=getattr(question, "type_q", None))
    normalized_response = normalize_answer_text(raw_response, expected)

    if not normalized_response:
        return False

    return any(
        normalize_answer_text(value, expected) == normalized_response
        for value in answer_values(question)
        if value
    )


def coerce_response_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def candidate_ids_for(question_id, candidates):
    values = (candidates or {}).get(question_id)
    if values is None:
        values = (candidates or {}).get(str(question_id), [])

    ids = []
    for value in values or []:
        coerced = coerce_response_id(value)
        if coerced is not None:
            ids.append(coerced)

    return ids


def grade_answer_submission(question, raw_response, policy=None):
    response_id = coerce_response_id(raw_response)

    if response_id is not None:
        return {
            "matched": response_id == getattr(question, "id", None),
            "resolved_response_id": response_id
        }

    matched = matches_answer_value(question, raw_response, policy=policy)

    return {
        "matched": matched,
        "resolved_response_id": getattr(question, "id", None) if matched else None
    }
