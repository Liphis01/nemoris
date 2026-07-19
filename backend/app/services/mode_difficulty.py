import math


# click_prompt is a recognition/location task whose clickable pool SHRINKS as
# the session is answered (the k-th of N prompts faces only N-k+1 options, the
# last is a free pick of 1), and the player can answer the obvious ones first
# and get the rest by elimination. So difficulty must track the AVERAGE pool
# size (~half of N), not the initial maximum. This curve is anchored so that
# N=5 -> ~0.55 (just above multiple_choice) and N=30 -> ~0.78 (still well below
# type_all=1.0). Single source of truth: map_modes, image_modes and the
# scheduler-replay all call this so live scheduling and the auto-tuner agree.
CLICK_PROMPT_BASE = 0.94
CLICK_PROMPT_SCALE = 0.87


def click_prompt_base_difficulty(context_count):
    try:
        count = max(1, int(context_count))
    except (TypeError, ValueError):
        count = 1

    return CLICK_PROMPT_BASE - (CLICK_PROMPT_SCALE / math.sqrt(count))
