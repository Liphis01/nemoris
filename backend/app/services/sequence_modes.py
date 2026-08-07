from .mode_difficulty import click_prompt_base_difficulty
from .mode_selection import (
    CHOICE_MODE_MIN_CONTEXT,
    MODE_AFFINITY_STRONG,
    MODE_AFFINITY_SUPPORT,
    apply_recent_mode_penalty,
    question_mode_affinity_counts,
    weighted_mode_choice
)


SEQUENCE_MODE_TYPE_POSITION = "type_position"
SEQUENCE_MODE_NEXT_IN_SEQUENCE = "next_in_sequence"
SEQUENCE_MODE_MULTIPLE_CHOICE = "multiple_choice"
SEQUENCE_MODE_REORDER = "reorder"

SEQUENCE_MODES = (
    SEQUENCE_MODE_TYPE_POSITION,
    SEQUENCE_MODE_NEXT_IN_SEQUENCE,
    SEQUENCE_MODE_MULTIPLE_CHOICE,
    SEQUENCE_MODE_REORDER
)
DEFAULT_SEQUENCE_MODE = SEQUENCE_MODE_TYPE_POSITION

# type_position is the shared baseline: free recall of a label from a bare index,
# a grid at a time so elimination is available. That is what type_all means
# everywhere else, so it anchors the scale at the reference difficulty.
SEQUENCE_TYPE_POSITION_DIFFICULTY = 1.0

# next_in_sequence is still free recall (nothing on screen to pick from), so it
# stays near the top of the scale -- well above text `match` (0.6, recognition
# among every answer). But the predecessor is the strongest cue an ordered list
# has, and chaining is how ordered lists are actually stored, so it is the mode
# you pass most easily.
SEQUENCE_NEXT_DIFFICULTY = 0.8

# Same shape as the map/image 4-option QCM (a 25% floor), so reuse their number
# and keep the FSRS penalty/reward curve comparable across types.
SEQUENCE_MULTIPLE_CHOICE_DIFFICULTY = 0.55

# reorder is graded per item but played as one pass over a shrinking pool: place
# the obvious ones, and the rest fall out by elimination (the last free slot is a
# free pick). That is exactly the click_prompt curve, so it is reused verbatim
# rather than re-derived -- see mode_difficulty.py.
SEQUENCE_REORDER_MIN_DIFFICULTY = 0.4
SEQUENCE_REORDER_MAX_DIFFICULTY = 0.95

# Modes that let the player choose among elements on screen are degenerate below
# the shared minimum: ordering three items is not a test, and a QCM needs enough
# peers to draw distractors from.
SEQUENCE_CHOICE_MODES = (
    SEQUENCE_MODE_MULTIPLE_CHOICE,
    SEQUENCE_MODE_REORDER
)


def normalize_sequence_mode(mode):
    value = str(mode or "").strip()

    return value if value in SEQUENCE_MODES else DEFAULT_SEQUENCE_MODE


def _tuned_number(tuning, key, default):
    if not isinstance(tuning, dict):
        return default

    try:
        return float(tuning.get(key, default))
    except (TypeError, ValueError):
        return default


def sequence_reorder_difficulty(context_count=0, tuning=None):
    base = click_prompt_base_difficulty(context_count)
    floor = _tuned_number(
        tuning,
        "sequence_reorder_min_difficulty",
        SEQUENCE_REORDER_MIN_DIFFICULTY
    )
    ceiling = _tuned_number(
        tuning,
        "sequence_reorder_max_difficulty",
        SEQUENCE_REORDER_MAX_DIFFICULTY
    )

    return max(floor, min(ceiling, base))


def sequence_mode_difficulty(mode=None, context_count=0, tuning=None):
    mode = normalize_sequence_mode(mode)

    if mode == SEQUENCE_MODE_REORDER:
        return sequence_reorder_difficulty(
            context_count=context_count,
            tuning=tuning
        )

    if mode == SEQUENCE_MODE_MULTIPLE_CHOICE:
        return _tuned_number(
            tuning,
            "multiple_choice_difficulty",
            SEQUENCE_MULTIPLE_CHOICE_DIFFICULTY
        )

    if mode == SEQUENCE_MODE_NEXT_IN_SEQUENCE:
        return _tuned_number(
            tuning,
            "sequence_next_difficulty",
            SEQUENCE_NEXT_DIFFICULTY
        )

    return _tuned_number(
        tuning,
        "sequence_type_position_difficulty",
        SEQUENCE_TYPE_POSITION_DIFFICULTY
    )


def calibrate_sequence_quality(raw_quality, mode=None, context_count=0):
    try:
        quality = int(raw_quality)
    except (TypeError, ValueError):
        quality = 0

    return max(0, min(3, quality))


def choose_sequence_review_mode(
    due_questions,
    context_questions,
    multiple_choice_context_count=None,
    has_adjacent_due_positions=False,
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
        return DEFAULT_SEQUENCE_MODE

    affinity_counts = question_mode_affinity_counts(due_questions)
    support_count = affinity_counts[MODE_AFFINITY_SUPPORT]
    strong_count = affinity_counts[MODE_AFFINITY_STRONG]

    if support_count / len(due_questions) >= 0.55:
        # Struggling set -> favour recognition and placement over blind recall.
        base_scores = {
            SEQUENCE_MODE_MULTIPLE_CHOICE: 4.0,
            SEQUENCE_MODE_REORDER: 3.3,
            SEQUENCE_MODE_NEXT_IN_SEQUENCE: 2.0,
            SEQUENCE_MODE_TYPE_POSITION: 0.9
        }
    elif strong_count / len(due_questions) >= 0.55:
        # Confident set -> favour recall from a bare index.
        base_scores = {
            SEQUENCE_MODE_TYPE_POSITION: 3.5,
            SEQUENCE_MODE_NEXT_IN_SEQUENCE: 3.0,
            SEQUENCE_MODE_REORDER: 1.8,
            SEQUENCE_MODE_MULTIPLE_CHOICE: 0.9
        }
    else:
        base_scores = {
            SEQUENCE_MODE_REORDER: 3.2,
            SEQUENCE_MODE_NEXT_IN_SEQUENCE: 3.0,
            SEQUENCE_MODE_MULTIPLE_CHOICE: 2.0,
            SEQUENCE_MODE_TYPE_POSITION: 1.5
        }

    scores = dict(base_scores)

    apply_recent_mode_penalty(scores, due_questions, "sequence_mode", SEQUENCE_MODES)

    tie_order = {
        SEQUENCE_MODE_MULTIPLE_CHOICE: 0,
        SEQUENCE_MODE_REORDER: 1,
        SEQUENCE_MODE_NEXT_IN_SEQUENCE: 2,
        SEQUENCE_MODE_TYPE_POSITION: 3
    }
    eligible_modes = list(SEQUENCE_MODES)

    # multiple_choice draws its distractors from the peers on screen; reorder is
    # graded on the pool of free slots. Both collapse below the shared minimum.
    if choice_context_count < CHOICE_MODE_MIN_CONTEXT:
        eligible_modes = [
            mode
            for mode in eligible_modes
            if mode != SEQUENCE_MODE_MULTIPLE_CHOICE
        ]

    if len(due_questions) < CHOICE_MODE_MIN_CONTEXT:
        eligible_modes = [
            mode
            for mode in eligible_modes
            if mode != SEQUENCE_MODE_REORDER
        ]

    # next_in_sequence prompts with the predecessor's label. If the due set
    # contains adjacent positions, that predecessor may itself be due (and
    # unrevealed) or on screen in the same session -- either way, showing its
    # label leaks an answer. type_position stays eligible as the fallback.
    if has_adjacent_due_positions:
        eligible_modes = [
            mode
            for mode in eligible_modes
            if mode != SEQUENCE_MODE_NEXT_IN_SEQUENCE
        ]

    return weighted_mode_choice(eligible_modes, scores, tie_order, rng=rng)
