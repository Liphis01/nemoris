import math
import random


MODE_AFFINITY_SUPPORT = "support"
MODE_AFFINITY_MEDIUM = "medium"
MODE_AFFINITY_STRONG = "strong"
MODE_AFFINITIES = (
    MODE_AFFINITY_SUPPORT,
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


def _progress_started(progress):
    history = progress.history if progress else []

    return bool(
        progress and (
            (progress.reps or 0) > 0 or
            progress.last_review or
            len(history or []) > 0
        )
    )


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
        return MODE_AFFINITY_STRONG

    return MODE_AFFINITY_MEDIUM


def question_mode_affinity_counts(questions):
    counts = {affinity: 0 for affinity in MODE_AFFINITIES}

    for question in questions or []:
        counts[question_mode_affinity(question)] += 1

    return counts


def recent_mode_counts(questions, history_key, valid_modes, limit=RECENT_MODE_LOOKBACK):
    counts = {}

    for question in questions or []:
        progress = getattr(question, "progress", None)
        history = list(progress.history or []) if progress else []
        seen = 0

        for entry in reversed(history):
            if not isinstance(entry, dict):
                continue

            mode = entry.get(history_key)

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
    limit=RECENT_MODE_LOOKBACK
):
    questions = list(questions or [])

    if not questions:
        return scores

    counts = recent_mode_counts(questions, history_key, valid_modes, limit=limit)

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
