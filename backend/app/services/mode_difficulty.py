import math


PROMPT_RECALL_ERROR_BUDGETS = (None, 2, 1, 0)
PROMPT_RECALL_MAX_DIFFICULTY = 1.35
PROMPT_RECALL_STRICTNESS_SCALE = 0.25


def normalize_prompt_error_budget(value):
    if value is None:
        return None

    try:
        budget = int(value)
    except (TypeError, ValueError):
        return None

    return budget if budget in {0, 1, 2} else None


def prompted_recall_strictness_bonus(max_errors_per_question=None):
    budget = normalize_prompt_error_budget(max_errors_per_question)

    if budget is None:
        return 0.0

    return PROMPT_RECALL_STRICTNESS_SCALE / (budget + 1)


def prompted_recall_difficulty(
    base_difficulty,
    max_errors_per_question=None,
    *,
    max_difficulty=PROMPT_RECALL_MAX_DIFFICULTY
):
    try:
        base = float(base_difficulty)
    except (TypeError, ValueError):
        base = 1.05

    return min(
        max_difficulty,
        base + prompted_recall_strictness_bonus(max_errors_per_question)
    )


# click_prompt is a recognition/location task whose clickable pool SHRINKS as
# the session is answered (the k-th of N prompts faces only N-k+1 options, the
# last is a free pick of 1), and the player can answer the obvious ones first
# and get the rest by elimination. So difficulty must track the AVERAGE pool
# size (~half of N), not the initial maximum. This curve is anchored so that
# N=5 -> ~0.55 (just above multiple_choice) and N=30 -> ~0.78 (still well below
# full prompted recall. Single source of truth: map_modes, image_modes and the
# scheduler-replay all call this so live scheduling and the auto-tuner agree.
CLICK_PROMPT_BASE = 0.94
CLICK_PROMPT_SCALE = 0.87


def click_prompt_base_difficulty(context_count):
    try:
        count = max(1, int(context_count))
    except (TypeError, ValueError):
        count = 1

    return CLICK_PROMPT_BASE - (CLICK_PROMPT_SCALE / math.sqrt(count))
