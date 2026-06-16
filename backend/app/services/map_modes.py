import math

from .mode_selection import (
    MULTIPLE_CHOICE_MIN_CONTEXT,
    MODE_AFFINITY_STRONG,
    MODE_AFFINITY_SUPPORT,
    question_mode_affinity_counts,
    weighted_mode_choice
)


MAP_MODE_TYPE_ALL = "type_all"
MAP_MODE_CLICK_PROMPT = "click_prompt"
MAP_MODE_TYPE_PROMPT = "type_prompt"
MAP_MODE_MULTIPLE_CHOICE = "multiple_choice"

MAP_MODES = (
    MAP_MODE_TYPE_ALL,
    MAP_MODE_CLICK_PROMPT,
    MAP_MODE_TYPE_PROMPT,
    MAP_MODE_MULTIPLE_CHOICE
)
DEFAULT_MAP_MODE = MAP_MODE_TYPE_ALL
MAP_TYPE_ALL_DIFFICULTY = 1.0
MAP_TYPE_PROMPT_DIFFICULTY = 1.15
MAP_MULTIPLE_CHOICE_DIFFICULTY = 0.5


def normalize_map_mode(mode):
    value = str(mode or "").strip()

    return value if value in MAP_MODES else DEFAULT_MAP_MODE


def _tuned_number(tuning, key, default):
    if not isinstance(tuning, dict):
        return default

    try:
        return float(tuning.get(key, default))
    except (TypeError, ValueError):
        return default


def map_click_prompt_difficulty(context_count=0, tuning=None):
    try:
        count = max(1, int(context_count))
    except (TypeError, ValueError):
        count = 1

    difficulty = 0.95 - (0.55 / math.sqrt(count))

    if tuning is None:
        return max(0.4, min(0.95, difficulty))

    difficulty += _tuned_number(tuning, "click_prompt_bias", 0.0)

    return max(0.35, min(0.98, difficulty))


def map_mode_difficulty(mode=None, context_count=0, tuning=None):
    mode = normalize_map_mode(mode)

    if mode == MAP_MODE_TYPE_PROMPT:
        return _tuned_number(
            tuning,
            "type_prompt_difficulty",
            MAP_TYPE_PROMPT_DIFFICULTY
        )

    if mode == MAP_MODE_MULTIPLE_CHOICE:
        return _tuned_number(
            tuning,
            "multiple_choice_difficulty",
            MAP_MULTIPLE_CHOICE_DIFFICULTY
        )

    if mode == MAP_MODE_CLICK_PROMPT:
        return map_click_prompt_difficulty(context_count, tuning=tuning)

    return MAP_TYPE_ALL_DIFFICULTY


def calibrate_map_quality(raw_quality, mode=None, context_count=0):
    try:
        quality = int(raw_quality)
    except (TypeError, ValueError):
        quality = 0

    return max(0, min(3, quality))


def _recent_mode_counts(questions, limit=6):
    counts = {}

    for question in questions or []:
        history = list(question.progress.history or []) if question.progress else []
        seen = 0

        for entry in reversed(history):
            if not isinstance(entry, dict):
                continue

            mode = entry.get("map_mode")

            if mode in MAP_MODES:
                counts[mode] = counts.get(mode, 0) + 1
                seen += 1

            if seen >= limit:
                break

    return counts


def choose_map_review_mode(
    due_questions,
    context_questions,
    multiple_choice_context_count=None,
    rng=None
):
    due_questions = list(due_questions or [])
    context_questions = list(context_questions or [])
    context_count = len(context_questions)
    choice_context_count = (
        context_count
        if multiple_choice_context_count is None
        else multiple_choice_context_count
    )

    if not due_questions:
        return DEFAULT_MAP_MODE

    affinity_counts = question_mode_affinity_counts(due_questions)
    support_count = affinity_counts[MODE_AFFINITY_SUPPORT]
    strong_count = affinity_counts[MODE_AFFINITY_STRONG]

    if support_count / len(due_questions) >= 0.55:
        base_scores = {
            MAP_MODE_MULTIPLE_CHOICE: 4.0,
            MAP_MODE_CLICK_PROMPT: 3.3,
            MAP_MODE_TYPE_PROMPT: 2.0,
            MAP_MODE_TYPE_ALL: 0.9
        }
    elif strong_count / len(due_questions) >= 0.55:
        base_scores = {
            MAP_MODE_TYPE_PROMPT: 3.5,
            MAP_MODE_TYPE_ALL: 3.1,
            MAP_MODE_CLICK_PROMPT: 1.8,
            MAP_MODE_MULTIPLE_CHOICE: 0.9
        }
    else:
        base_scores = {
            MAP_MODE_CLICK_PROMPT: 3.2,
            MAP_MODE_TYPE_PROMPT: 3.0,
            MAP_MODE_MULTIPLE_CHOICE: 2.0,
            MAP_MODE_TYPE_ALL: 1.5
        }

    scores = dict(base_scores)

    if context_count <= 4:
        scores[MAP_MODE_CLICK_PROMPT] -= 1.1
        scores[MAP_MODE_MULTIPLE_CHOICE] -= 0.4
    elif context_count >= 12:
        scores[MAP_MODE_CLICK_PROMPT] += 0.5

    recent_counts = _recent_mode_counts(due_questions)

    for mode, count in recent_counts.items():
        scores[mode] = scores.get(mode, 0) - (0.55 * count)

    tie_order = {
        MAP_MODE_MULTIPLE_CHOICE: 0,
        MAP_MODE_CLICK_PROMPT: 1,
        MAP_MODE_TYPE_PROMPT: 2,
        MAP_MODE_TYPE_ALL: 3
    }
    eligible_modes = list(MAP_MODES)

    if choice_context_count < MULTIPLE_CHOICE_MIN_CONTEXT:
        eligible_modes = [
            mode
            for mode in eligible_modes
            if mode != MAP_MODE_MULTIPLE_CHOICE
        ]

    return weighted_mode_choice(
        eligible_modes,
        scores,
        tie_order,
        rng=rng
    )
