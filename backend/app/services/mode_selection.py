import math
import random


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
    "text_mode": {"type_all", "type_reverse"},
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
