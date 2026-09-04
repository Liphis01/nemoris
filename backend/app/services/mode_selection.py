import math
import random

from ..scheduler import progress_in_relearning


MODE_AFFINITY_SUPPORT = "support"
MODE_AFFINITY_RECALL_PROBE = "recall_probe"
MODE_AFFINITY_MEDIUM = "medium"
MODE_AFFINITY_STRONG = "strong"
MODE_AFFINITIES = (
    MODE_AFFINITY_SUPPORT,
    MODE_AFFINITY_RECALL_PROBE,
    MODE_AFFINITY_MEDIUM,
    MODE_AFFINITY_STRONG
)
WEIGHT_TEMPERATURE = 1.15
# Shared minimum element count for every "choose-among-elements" mode
# (click_prompt and the multiple-choice modes). Below this, such modes are
# degenerate (picking blindly among 1-3 options), so they are never offered.
CHOICE_MODE_MIN_CONTEXT = 5
# How many of a question's most recent history entries to inspect when
# scoring mode variety, and how hard a mode's average recent share pulls its
# score down.
RECENT_MODE_LOOKBACK = 6
RECENT_MODE_WEIGHT = 0.55

TYPE_MAP = "map"
TYPE_MEDIA = "media"
TYPE_TEXT = "text"
TYPE_SEQUENCE = "sequence"

MODE_TYPE_ALL = "type_all"
MODE_TYPE_PROMPT = "type_prompt"
MODE_CLICK_PROMPT = "click_prompt"
MODE_MULTIPLE_CHOICE = "multiple_choice"
MODE_MULTIPLE_CHOICE_LABEL = "multiple_choice_label"
MODE_MULTIPLE_CHOICE_MEDIA = "multiple_choice_media"
MODE_MULTIPLE_CHOICE_IMAGE = "multiple_choice_image"
MODE_MATCH = "match"
MODE_TYPE_POSITION = "type_position"
MODE_GAP_FILL = "gap_fill"
MODE_REORDER = "reorder"
MODE_RECITE = "recite"

SEQUENCE_GOAL_RECITATION = "recitation"

HISTORY_MODE_KEYS = (
    "map_mode",
    "image_mode",
    "text_mode",
    "sequence_mode"
)
ANSWER_EVENT_MODE_KEYS = {
    "map": "map_mode",
    "media": "image_mode",
    "text": "text_mode",
    "sequence": "sequence_mode"
}
UNSUPPORTED_RECALL_MODES = {
    "map_mode": {"type_all", "type_prompt"},
    "image_mode": {"type_all", "type_prompt"},
    "text_mode": {"type_all"},
    "sequence_mode": {"type_position", "recite"}
}
SUPPORTED_MODES = {
    "map_mode": {"multiple_choice", "click_prompt"},
    "image_mode": {
        "multiple_choice_label",
        "multiple_choice_media",
        "multiple_choice_image"
    },
    "text_mode": {"match"},
    "sequence_mode": {"multiple_choice", "gap_fill", "reorder"}
}


def _progress_started(progress):
    history = progress.history if progress else []

    return bool(
        progress and (
            (progress.reps or 0) > 0 or
            progress.last_review or
            len(history or []) > 0
        )
    )


def _history_quality(entry):
    value = entry.get("effective_quality", entry.get("quality"))

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _history_mode(entry):
    for key in HISTORY_MODE_KEYS:
        mode = entry.get(key)

        if mode:
            return key, str(mode)

    event = entry.get("answer_event")

    if not isinstance(event, dict):
        return None, None

    key = ANSWER_EVENT_MODE_KEYS.get(event.get("type_q"))
    mode = event.get("mode")

    if key and mode:
        return key, str(mode)

    return None, None


def history_entry_is_recall_proof(entry):
    """A successful unsupported recall row proves mastery for mode selection."""
    if not isinstance(entry, dict):
        return False

    quality = _history_quality(entry)

    if quality is None or quality < 2:
        return False

    key, mode = _history_mode(entry)

    if mode in SUPPORTED_MODES.get(key, set()):
        return False

    return mode in UNSUPPORTED_RECALL_MODES.get(key, set())


def has_recall_proof_since_latest_miss(progress):
    history = list(progress.history or []) if progress else []

    for entry in reversed(history):
        if not isinstance(entry, dict):
            continue

        quality = _history_quality(entry)

        if quality == 0:
            return False

        if history_entry_is_recall_proof(entry):
            return True

    return False


def questions_have_recall_proof(questions):
    questions = list(questions or [])

    return bool(questions) and all(
        has_recall_proof_since_latest_miss(getattr(question, "progress", None))
        for question in questions
    )


def questions_are_unstarted(questions):
    questions = list(questions or [])

    return bool(questions) and all(
        not _progress_started(getattr(question, "progress", None))
        for question in questions
    )


def restrict_modes_or_fallback(eligible_modes, preferred_modes):
    eligible_modes = list(eligible_modes or [])
    preferred_modes = set(preferred_modes or [])
    preferred = [
        mode
        for mode in eligible_modes
        if mode in preferred_modes
    ]

    return preferred or eligible_modes


def _safe_count(value):
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _rail_blank_question_ids(rail):
    blank_ids = set()

    for slot in rail or []:
        if not isinstance(slot, dict):
            continue

        if slot.get("kind") != "blank":
            continue

        question_id = slot.get("question_id")

        if question_id is not None:
            blank_ids.add(question_id)

    return blank_ids


def review_mode_is_meaningful(
    type_q,
    mode,
    *,
    item_count=0,
    active_context_count=0,
    choice_context_count=None,
    rail=None,
    item_ids=None
):
    """True when a Review presentation has enough information for this mode."""
    type_q = str(type_q or "").strip()
    mode = str(mode or "").strip()
    item_count = _safe_count(item_count)
    active_context_count = _safe_count(active_context_count)
    choice_context_count = (
        active_context_count
        if choice_context_count is None
        else _safe_count(choice_context_count)
    )

    if item_count <= 0:
        return False

    if type_q == TYPE_MAP:
        if mode == MODE_MULTIPLE_CHOICE:
            return choice_context_count >= CHOICE_MODE_MIN_CONTEXT
        if mode == MODE_CLICK_PROMPT:
            return active_context_count >= CHOICE_MODE_MIN_CONTEXT
        return mode in {MODE_TYPE_ALL, MODE_TYPE_PROMPT}

    if type_q == TYPE_MEDIA:
        if mode == MODE_TYPE_ALL:
            return item_count > 1
        if mode in {
            MODE_MULTIPLE_CHOICE_LABEL,
            MODE_MULTIPLE_CHOICE_MEDIA,
            MODE_MULTIPLE_CHOICE_IMAGE
        }:
            return choice_context_count >= CHOICE_MODE_MIN_CONTEXT
        return mode == MODE_TYPE_PROMPT

    if type_q == TYPE_TEXT:
        if mode == MODE_MATCH:
            return item_count >= CHOICE_MODE_MIN_CONTEXT
        return mode == MODE_TYPE_ALL

    if type_q == TYPE_SEQUENCE:
        if mode == MODE_MULTIPLE_CHOICE:
            return choice_context_count >= CHOICE_MODE_MIN_CONTEXT
        if mode == MODE_REORDER:
            return item_count >= CHOICE_MODE_MIN_CONTEXT
        if mode == MODE_GAP_FILL:
            if rail is None:
                return item_count > 0

            blank_ids = _rail_blank_question_ids(rail)

            if not blank_ids:
                return False

            if item_ids is None:
                return True

            return blank_ids == set(item_ids or [])
        return mode in {MODE_TYPE_POSITION, MODE_RECITE}

    return True


def review_mode_fallback(
    type_q,
    mode,
    *,
    item_count=0,
    active_context_count=0,
    choice_context_count=None,
    rail=None,
    item_ids=None,
    review_goal=None
):
    if review_mode_is_meaningful(
        type_q,
        mode,
        item_count=item_count,
        active_context_count=active_context_count,
        choice_context_count=choice_context_count,
        rail=rail,
        item_ids=item_ids
    ):
        return str(mode or "").strip()

    type_q = str(type_q or "").strip()

    if type_q == TYPE_MAP:
        return MODE_TYPE_PROMPT

    if type_q == TYPE_MEDIA:
        return MODE_TYPE_PROMPT

    if type_q == TYPE_TEXT:
        return MODE_TYPE_ALL

    if type_q == TYPE_SEQUENCE:
        if review_goal == SEQUENCE_GOAL_RECITATION and review_mode_is_meaningful(
            TYPE_SEQUENCE,
            MODE_GAP_FILL,
            item_count=item_count,
            active_context_count=active_context_count,
            choice_context_count=choice_context_count,
            rail=rail,
            item_ids=item_ids
        ):
            return MODE_GAP_FILL

        return MODE_TYPE_POSITION

    return str(mode or "").strip()


def latest_relearning_history_mode(progress, today=None):
    if not progress_in_relearning(progress, today):
        return None, None

    history = list(progress.history or []) if progress else []
    latest = history[-1] if history else None

    if not isinstance(latest, dict):
        return None, None

    return _history_mode(latest)


def question_mode_affinity(question):
    progress = getattr(question, "progress", None)

    if not _progress_started(progress):
        return MODE_AFFINITY_SUPPORT

    try:
        difficulty = float(progress.difficulty or 5.0)
    except (TypeError, ValueError):
        difficulty = 5.0

    reps = progress.reps or 0

    if reps < 3 or difficulty >= 6.7 or (progress.lapses or 0) > 0:
        return MODE_AFFINITY_SUPPORT

    if difficulty <= 4.2:
        if not has_recall_proof_since_latest_miss(progress):
            return MODE_AFFINITY_RECALL_PROBE

        return MODE_AFFINITY_STRONG

    return MODE_AFFINITY_MEDIUM


def question_mode_affinity_counts(questions):
    counts = {affinity: 0 for affinity in MODE_AFFINITIES}

    for question in questions or []:
        counts[question_mode_affinity(question)] += 1

    return counts


def recent_mode_counts(
    questions,
    history_key,
    valid_modes,
    limit=RECENT_MODE_LOOKBACK,
    mode_normalizer=None
):
    counts = {}

    for question in questions or []:
        progress = getattr(question, "progress", None)
        history = list(progress.history or []) if progress else []
        seen = 0

        for entry in reversed(history):
            if not isinstance(entry, dict):
                continue

            mode = entry.get(history_key)

            if mode_normalizer:
                mode = mode_normalizer(mode)

            if mode in valid_modes:
                counts[mode] = counts.get(mode, 0) + 1
                seen += 1

            if seen >= limit:
                break

    return counts


def apply_recent_mode_penalty(
    scores,
    questions,
    history_key,
    valid_modes,
    weight=RECENT_MODE_WEIGHT,
    limit=RECENT_MODE_LOOKBACK,
    mode_normalizer=None
):
    questions = list(questions or [])

    if not questions:
        return scores

    counts = recent_mode_counts(
        questions,
        history_key,
        valid_modes,
        limit=limit,
        mode_normalizer=mode_normalizer
    )

    # Each question contributes at most `limit` sightings, so dividing by the
    # due-set size keeps the penalty an average-per-question share regardless
    # of how many questions are being scored together.
    for mode, count in counts.items():
        scores[mode] = scores.get(mode, 0) - (weight * count / len(questions))

    return scores


def weighted_mode_choice(modes, scores, tie_order, rng=None):
    modes = list(modes or [])

    if not modes:
        return None

    if rng is None:
        rng = random

    max_score = max(scores.get(mode, 0) for mode in modes)
    weighted_modes = [
        (
            mode,
            math.exp((scores.get(mode, 0) - max_score) * WEIGHT_TEMPERATURE)
        )
        for mode in modes
    ]
    weighted_modes.sort(
        key=lambda item: (-item[1], tie_order.get(item[0], len(tie_order)))
    )

    total_weight = sum(weight for _, weight in weighted_modes)
    threshold = rng.random() * total_weight
    cumulative = 0

    for mode, weight in weighted_modes:
        cumulative += weight

        if threshold <= cumulative:
            return mode

    return weighted_modes[-1][0]
