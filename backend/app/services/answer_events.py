from .answer_policy import ANSWER_POLICY_RELAXED
from .type_contracts import (
    PRESENTATION_MAP_GROUP,
    PRESENTATION_MEDIA_GROUP,
    PRESENTATION_SEQUENCE_GROUP,
    PRESENTATION_TEXT_GROUP,
    PRESENTATION_TIMELINE_GROUP
)


ANSWER_POLICY_CURRENT_RELAXED = ANSWER_POLICY_RELAXED
GRADER_VERSION = "m2.0"
PRESENTATION_VERSION = "m2.0"


def _coerce_candidate_ids(candidate_ids):
    ids = []

    for value in candidate_ids or []:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue

    return ids


def _coerce_resolved_id(value):
    if value is None:
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def answer_event(
    *,
    question,
    raw_response=None,
    resolved_response_id=None,
    expected_value=None,
    type_q=None,
    presentation_kind=None,
    mode=None,
    direction=None,
    candidate_ids=None,
    answer_policy=None,
    grader_version=GRADER_VERSION,
    presentation_version=PRESENTATION_VERSION,
    context=None
):
    resolved_type = type_q or getattr(question, "type_q", None)

    return {
        "raw_response": raw_response,
        "resolved_response_id": _coerce_resolved_id(resolved_response_id),
        "expected_card_id": getattr(question, "id", None),
        "expected_value": expected_value,
        "type_q": resolved_type,
        "presentation_kind": presentation_kind,
        "mode": mode,
        "direction": direction,
        "candidate_ids": _coerce_candidate_ids(candidate_ids),
        "answer_policy": dict(answer_policy or ANSWER_POLICY_CURRENT_RELAXED),
        "grader_version": grader_version,
        "presentation_version": presentation_version,
        "context": dict(context or {})
    }


def direction_for_grouped_answer(type_q, mode):
    if type_q == "map":
        return {
            "click_prompt": "label_to_zone",
            "multiple_choice": "label_to_zone",
            "type_prompt": "zone_to_label",
            "type_all": "zone_to_label"
        }.get(mode, "zone_to_label")

    if type_q == "media":
        return {
            "multiple_choice_media": "label_to_media",
            # Histories created before M2.1 are retained verbatim.
            "multiple_choice_image": "label_to_media",
            "multiple_choice_label": "media_to_label",
            "type_prompt": "media_to_label",
            "type_all": "media_to_label"
        }.get(mode, "media_to_label")

    if type_q == "text":
        return {
            "match": "prompt_to_answer_match",
            "type_reverse": "answer_to_prompt",
            "type_all": "prompt_to_answer"
        }.get(mode, "prompt_to_answer")

    return None


def presentation_for_grouped_answer(type_q):
    return {
        "map": PRESENTATION_MAP_GROUP,
        "media": PRESENTATION_MEDIA_GROUP,
        "text": PRESENTATION_TEXT_GROUP
    }.get(type_q)


def sequence_answer_event(
    *,
    question,
    raw_response=None,
    resolved_response_id=None,
    expected_value=None,
    mode=None,
    candidate_ids=None,
    answer_policy=None,
    context=None
):
    return answer_event(
        question=question,
        raw_response=raw_response,
        resolved_response_id=resolved_response_id,
        expected_value=expected_value,
        type_q="sequence",
        presentation_kind=PRESENTATION_SEQUENCE_GROUP,
        mode=mode,
        direction="sequence_retrieval",
        candidate_ids=candidate_ids,
        answer_policy=answer_policy,
        context=context
    )


def timeline_answer_event(*, question, raw_response, expected_value, context=None):
    return answer_event(
        question=question,
        raw_response=raw_response,
        expected_value=expected_value,
        type_q="timeline",
        presentation_kind=PRESENTATION_TIMELINE_GROUP,
        mode="event_to_date",
        direction="event_to_date",
        candidate_ids=[],
        context=context
    )
