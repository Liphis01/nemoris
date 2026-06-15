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
