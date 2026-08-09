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
SEQUENCE_MODE_GAP_FILL = "gap_fill"
SEQUENCE_MODE_MULTIPLE_CHOICE = "multiple_choice"
SEQUENCE_MODE_REORDER = "reorder"
SEQUENCE_MODE_RECITE = "recite"

SEQUENCE_GOAL_RECITATION = "recitation"
SEQUENCE_GOAL_RANDOM_ACCESS = "random_access"
SEQUENCE_REVIEW_GOALS = (
    SEQUENCE_GOAL_RECITATION,
    SEQUENCE_GOAL_RANDOM_ACCESS
)

SEQUENCE_MODES = (
    SEQUENCE_MODE_TYPE_POSITION,
    SEQUENCE_MODE_GAP_FILL,
    SEQUENCE_MODE_MULTIPLE_CHOICE,
    SEQUENCE_MODE_REORDER,
    SEQUENCE_MODE_RECITE
)
DEFAULT_SEQUENCE_MODE = SEQUENCE_MODE_TYPE_POSITION

# type_position is the shared baseline: free recall of a label from a bare index,
# a grid at a time so elimination is available. That is what type_all means
# everywhere else, so it anchors the scale at the reference difficulty.
SEQUENCE_TYPE_POSITION_DIFFICULTY = 1.0

# gap_fill replaces next_in_sequence, which prompted with a bare predecessor
# label. The rail shows the same predecessor IN CONTEXT, which is a better cue
# and structurally cannot leak (a blank's own label is never drawn).
#
# But context in a list is not context on a map. A map's surrounding zones are
# the CUE and the answer appears nowhere on screen; a list's surrounding items
# ARE the answer, so a nearly-complete rail is answerable by subtraction with no
# knowledge of the order at all -- and gets easier the more of the list is
# known, which is backwards. So the difficulty is not a constant: it scales with
# how much of the rail was blank, which is exactly what decoys and windowing
# manipulate. Priced from the posted rail, never from a client-supplied count.
SEQUENCE_GAP_FILL_MIN_DIFFICULTY = 0.5
SEQUENCE_GAP_FILL_MAX_DIFFICULTY = 1.0

# recite is the only mode above the reference: produce the chain from a start
# point with nothing on screen to lean on. Deliberately 1.2 and not the 1.4 a
# first pass suggested -- see
# test_above_reference_difficulty_rewards_and_forgives_in_lockstep: a hard mode
# both stretches the interval on success AND softens the lapse, so at 1.4 a
# failed recite would leave a card nearly twice as strong as a failed
# type_position. The reward also saturates at 1.5, so the top of the scale buys
# less than it looks like it does.
SEQUENCE_RECITE_DIFFICULTY = 1.2

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


def normalize_sequence_review_goal(value):
    value = str(value or "").strip()

    return value if value in SEQUENCE_REVIEW_GOALS else None


def sequence_review_goal(group):
    """Resolve the skill the author intends this ordered group to train.

    Existing groups need no migration: hand-authored order means recitation,
    while an order derived from a date/number is a random-access catalogue.
    An explicit override wins without coupling it to later order edits.
    """
    data = getattr(group, "data", None) or {}
    explicit = normalize_sequence_review_goal(data.get("review_goal"))

    if explicit:
        return explicit

    order = data.get("order") if isinstance(data.get("order"), dict) else {}

    return (
        SEQUENCE_GOAL_RANDOM_ACCESS
        if order.get("mode") == "derived"
        else SEQUENCE_GOAL_RECITATION
    )


def merge_sequence_review_goal(group_data, value):
    merged = dict(group_data or {})
    normalized = normalize_sequence_review_goal(value)

    if normalized:
        merged["review_goal"] = normalized
    else:
        merged.pop("review_goal", None)

    return merged


def _tuned_number(tuning, key, default):
    if not isinstance(tuning, dict):
        return default

    try:
        return float(tuning.get(key, default))
    except (TypeError, ValueError):
        return default


def sequence_reorder_difficulty(context_count=0, tuning=None):
    base = click_prompt_base_difficulty(context_count)
    bias = _tuned_number(tuning, "sequence_reorder_bias", 0.0)
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

    return max(floor, min(ceiling, base + bias))


def sequence_gap_fill_difficulty(blank_count=0, label_count=0, tuning=None):
    floor = _tuned_number(
        tuning,
        "sequence_gap_fill_min_difficulty",
        SEQUENCE_GAP_FILL_MIN_DIFFICULTY
    )
    ceiling = _tuned_number(
        tuning,
        "sequence_gap_fill_max_difficulty",
        SEQUENCE_GAP_FILL_MAX_DIFFICULTY
    )
    visible = blank_count + label_count

    if visible <= 0:
        return ceiling

    # The share of the rail the learner had to produce rather than read. One
    # blank among 23 labels is nearly free; four blanks among three labels is a
    # real retrieval.
    return floor + ((ceiling - floor) * (blank_count / visible))


def sequence_rail_counts(rail):
    """Blank-vs-label split of a rail, the input both rail-priced modes need."""
    blanks = 0
    labels = 0

    for slot in rail or []:
        kind = slot.get("kind") if isinstance(slot, dict) else getattr(slot, "kind", None)

        if kind in ("blank", "decoy"):
            # A decoy is indistinguishable from a real blank while answering,
            # so it costs the learner exactly as much and counts as one.
            blanks += 1
        elif kind == "anchor":
            labels += 1

    return blanks, labels


def sequence_mode_difficulty(mode=None, context_count=0, rail=None, tuning=None):
    mode = normalize_sequence_mode(mode)
    blank_count, label_count = sequence_rail_counts(rail)

    if mode == SEQUENCE_MODE_REORDER:
        # Graded on the pool of free slots. With a rail that pool is stated
        # rather than declared, so windowing (which genuinely shrinks the
        # choice space) lowers the difficulty instead of being asserted to.
        return sequence_reorder_difficulty(
            context_count=blank_count if rail else context_count,
            tuning=tuning
        )

    if mode == SEQUENCE_MODE_GAP_FILL:
        return sequence_gap_fill_difficulty(
            blank_count=blank_count,
            label_count=label_count,
            tuning=tuning
        )

    if mode == SEQUENCE_MODE_RECITE:
        return _tuned_number(
            tuning,
            "sequence_recite_difficulty",
            SEQUENCE_RECITE_DIFFICULTY
        )

    if mode == SEQUENCE_MODE_MULTIPLE_CHOICE:
        return _tuned_number(
            tuning,
            "multiple_choice_difficulty",
            SEQUENCE_MULTIPLE_CHOICE_DIFFICULTY
        )

    return _tuned_number(
        tuning,
        "sequence_type_position_difficulty",
        SEQUENCE_TYPE_POSITION_DIFFICULTY
    )


def choose_sequence_review_mode(
    due_questions,
    context_questions,
    multiple_choice_context_count=None,
    review_goal=None,
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
            SEQUENCE_MODE_GAP_FILL: 3.6,
            SEQUENCE_MODE_REORDER: 3.3,
            SEQUENCE_MODE_RECITE: 0.6,
            SEQUENCE_MODE_TYPE_POSITION: 0.9
        }
    elif strong_count / len(due_questions) >= 0.55:
        # Confident set -> favour producing the chain over reading it. This is
        # the configuration a mature list spends most of its life in, and the
        # one that used to collapse onto the two worst modes: reorder needs 5
        # due items so it was excluded, leaving type_position and the old
        # next_in_sequence near-certain. recite works at 1 due item or 20.
        base_scores = {
            SEQUENCE_MODE_RECITE: 3.8,
            SEQUENCE_MODE_TYPE_POSITION: 3.0,
            SEQUENCE_MODE_GAP_FILL: 2.2,
            SEQUENCE_MODE_REORDER: 1.8,
            SEQUENCE_MODE_MULTIPLE_CHOICE: 0.9
        }
    else:
        base_scores = {
            SEQUENCE_MODE_GAP_FILL: 3.4,
            SEQUENCE_MODE_REORDER: 3.2,
            SEQUENCE_MODE_RECITE: 2.6,
            SEQUENCE_MODE_MULTIPLE_CHOICE: 2.0,
            SEQUENCE_MODE_TYPE_POSITION: 1.5
        }

    scores = dict(base_scores)

    apply_recent_mode_penalty(scores, due_questions, "sequence_mode", SEQUENCE_MODES)

    tie_order = {
        SEQUENCE_MODE_MULTIPLE_CHOICE: 0,
        SEQUENCE_MODE_REORDER: 1,
        SEQUENCE_MODE_GAP_FILL: 2,
        SEQUENCE_MODE_RECITE: 3,
        SEQUENCE_MODE_TYPE_POSITION: 4
    }
    eligible_modes = list(SEQUENCE_MODES)

    if review_goal == SEQUENCE_GOAL_RECITATION:
        eligible_modes = [
            SEQUENCE_MODE_GAP_FILL,
            SEQUENCE_MODE_REORDER,
            SEQUENCE_MODE_RECITE
        ]
    elif review_goal == SEQUENCE_GOAL_RANDOM_ACCESS:
        eligible_modes = [
            SEQUENCE_MODE_TYPE_POSITION,
            SEQUENCE_MODE_MULTIPLE_CHOICE
        ]

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

    # No adjacency guard any more. next_in_sequence needed one because it
    # PRINTED the predecessor's label as a prompt, so two adjacent due items
    # meant one of them was captioned with the other's answer. The rail never
    # draws a blank's label, so adjacent blanks give the learner less context,
    # not leaked context -- harder, which is correct. See
    # test_a_blank_never_carries_its_own_label.

    return weighted_mode_choice(eligible_modes, scores, tie_order, rng=rng)
