from .mode_difficulty import click_prompt_base_difficulty
from .mode_selection import (
    CHOICE_MODE_MIN_CONTEXT,
    MODE_AFFINITY_STRONG,
    MODE_AFFINITY_SUPPORT,
    apply_recent_mode_penalty,
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
MAP_TYPE_PROMPT_DIFFICULTY = 1.05
MAP_MULTIPLE_CHOICE_DIFFICULTY = 0.55


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
    difficulty = click_prompt_base_difficulty(context_count)

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
        scores[MAP_MODE_MULTIPLE_CHOICE] -= 0.4
    elif context_count >= 12:
        scores[MAP_MODE_CLICK_PROMPT] += 0.5

    apply_recent_mode_penalty(scores, due_questions, "map_mode", MAP_MODES)

    tie_order = {
        MAP_MODE_MULTIPLE_CHOICE: 0,
        MAP_MODE_CLICK_PROMPT: 1,
        MAP_MODE_TYPE_PROMPT: 2,
        MAP_MODE_TYPE_ALL: 3
    }
    eligible_modes = list(MAP_MODES)

    if choice_context_count < CHOICE_MODE_MIN_CONTEXT:
        eligible_modes = [
            mode
            for mode in eligible_modes
            if mode != MAP_MODE_MULTIPLE_CHOICE
        ]

    if context_count < CHOICE_MODE_MIN_CONTEXT:
        eligible_modes = [
            mode
            for mode in eligible_modes
            if mode != MAP_MODE_CLICK_PROMPT
        ]

    return weighted_mode_choice(
        eligible_modes,
        scores,
        tie_order,
        rng=rng
    )
