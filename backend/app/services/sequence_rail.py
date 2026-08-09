"""
The sequence context rail: the ONE place that decides what a learner sees.

Every sequence mode draws the same surface -- the list, with what is due blanked
out -- the way a map review always shows the whole map and only changes which
zone is probed. Modes differ in what they ask, not in how much they reveal.

Visibility lived in three places before this module (the `anchors` list, the
`previous_label_for()` closure, and a `has_adjacent_due_positions` mode filter),
and that is exactly how the M0 0.3 answer leak happened: two call sites
independently deciding what to show, one of them printing a due item's label as
another due item's prompt. There is one rule here and everything renders from
its output.
"""

import random

from .progress import progress_has_started


# Slots shown either side of a blank once a list is long enough to need
# windowing. Deliberately EPHEMERAL: recomputed every session and centred on
# whatever is due, never stored on the item. A stored chunk boundary would
# harden into a scheduling boundary and impose a grouping the learner did not
# choose; a window just decides what is on screen right now.
SEQUENCE_RAIL_WINDOW = 3

# Below this a list fits on screen whole and windowing only fragments it.
SEQUENCE_RAIL_WINDOW_MIN_LENGTH = 14

SLOT_ANCHOR = "anchor"
SLOT_BLANK = "blank"
SLOT_DECOY = "decoy"
SLOT_HIDDEN = "hidden"


def _visible_positions(blank_positions, decoy_positions, length, window):
    if not window:
        return set(range(1, length + 1))

    visible = set(decoy_positions)

    for position in blank_positions:
        visible.update(
            range(max(1, position - window), min(length, position + window) + 1)
        )

    return visible


def build_rail(
    questions,
    positions,
    due_ids,
    chunk_due_ids=None,
    decoy_count=0,
    window=None,
    rng=None
):
    """
    Build the slot list for one chunk.

    `due_ids` is the GROUP's due set, not the chunk's. An item due in a later
    chunk of the same session is still an answer the learner has not given yet,
    so its label stays off screen -- the mistake
    test_chunked_lists_do_not_leak_the_other_chunks_due_items exists to catch.

    `decoy_count` blanks that many already-known slots alongside the real ones.
    Without it a nearly-learned list is answerable by subtraction: show 23 of 24
    letters and the missing one needs no knowledge of the order at all, only of
    the set -- and that gets EASIER the more of the list is known, which is
    backwards. Decoys are ungraded; they exist to make the blanks unattributable.
    """
    due_ids = set(due_ids or [])
    chunk_due_ids = set(chunk_due_ids if chunk_due_ids is not None else due_ids)
    length = len(positions or {})

    by_position = {
        positions[question.id]: question
        for question in questions or []
        if question.id in (positions or {})
    }

    # The decoy pool is exactly the anchor pool: started, and not due anywhere
    # in the group. Everything else is either unknown to the learner or an
    # answer they still owe, and blanking those teaches nothing.
    candidates = sorted(
        position
        for position, question in by_position.items()
        if question.id not in due_ids and progress_has_started(question.progress)
    )

    blank_positions = sorted(
        position
        for position, question in by_position.items()
        if question.id in chunk_due_ids
    )

    if decoy_count > 0 and candidates and blank_positions:
        # Prefer decoys near a blank: one out in an unvisited part of the list
        # is invisible after windowing and costs the learner a detour.
        candidates.sort(
            key=lambda position: min(
                abs(position - blank) for blank in blank_positions
            )
        )
        pool = candidates[: max(decoy_count * 3, decoy_count)]
        (rng or random).shuffle(pool)
        decoy_positions = set(pool[:decoy_count])
    else:
        decoy_positions = set()

    visible = _visible_positions(
        blank_positions,
        decoy_positions,
        length,
        window
    )

    rail = []

    for position in range(1, length + 1):
        if position not in visible:
            continue

        question = by_position.get(position)

        if question is None:
            continue

        slot = {"position": position, "question_id": question.id}

        if question.id in chunk_due_ids:
            slot["kind"] = SLOT_BLANK
        elif position in decoy_positions:
            slot["kind"] = SLOT_DECOY
        elif question.id in due_ids or not progress_has_started(question.progress):
            # Due in another chunk, or never reviewed. Either way the label is
            # withheld: revealing an unstarted item teaches the answer before
            # the card's first review.
            slot["kind"] = SLOT_HIDDEN
        else:
            slot["kind"] = SLOT_ANCHOR
            slot["label"] = question.answer

        rail.append(slot)

    return rail


def sequence_decoy_count(mode, due_questions):
    """
    How many known slots to blank alongside the real ones.

    Typed modes only. In `reorder` the tray holds exactly the due items, so a
    slot with no tile to fill it is a decoy at a glance -- and putting decoy
    tiles in the tray would reveal their labels, handing elimination straight
    back. Windowing is what shrinks reorder's choice space instead.

    A struggling set gets none: decoys raise difficulty, and the point of the
    support bucket is that difficulty is already the problem.
    """
    from .mode_selection import (
        MODE_AFFINITY_SUPPORT,
        question_mode_affinity_counts
    )
    from .sequence_modes import (
        SEQUENCE_MODE_GAP_FILL,
        SEQUENCE_MODE_TYPE_POSITION
    )

    if mode not in (
        SEQUENCE_MODE_GAP_FILL,
        SEQUENCE_MODE_TYPE_POSITION
    ):
        return 0

    due_questions = list(due_questions or [])

    if not due_questions:
        return 0

    counts = question_mode_affinity_counts(due_questions)

    if counts[MODE_AFFINITY_SUPPORT] / len(due_questions) >= 0.55:
        return 0

    return 2


def build_recitation_presentations(rail):
    """Turn a possibly disjoint rail into safe contiguous recitation runs.

    A run starts at the first real blank in a contiguous, already-known region.
    Hidden/unstarted slots and window gaps are hard boundaries. Only the item
    immediately before the first target may be exposed as a cue; later anchors
    become hidden targets instead of leaking their labels.
    """
    ordered = sorted(rail or [], key=lambda slot: slot["position"])
    regions = []
    current = []
    previous_position = None

    for slot in ordered:
        boundary = (
            slot.get("kind") == SLOT_HIDDEN or
            (
                previous_position is not None and
                slot["position"] != previous_position + 1
            )
        )

        if boundary and current:
            regions.append(current)
            current = []

        if slot.get("kind") != SLOT_HIDDEN:
            current.append(slot)

        previous_position = slot["position"]

    if current:
        regions.append(current)

    presentations = []

    for region in regions:
        first_blank_index = next(
            (
                index
                for index, slot in enumerate(region)
                if slot.get("kind") == SLOT_BLANK
            ),
            None
        )

        if first_blank_index is None:
            continue

        cue_slot = region[first_blank_index - 1] if first_blank_index > 0 else None
        target_slots = region[first_blank_index:]
        presentations.append({
            "cue": (
                {
                    "question_id": cue_slot["question_id"],
                    "position": cue_slot["position"],
                    "label": cue_slot.get("label")
                }
                if cue_slot and cue_slot.get("kind") == SLOT_ANCHOR
                else None
            ),
            "run_start": target_slots[0]["position"] - 1,
            "targets": [
                {
                    "question_id": slot["question_id"],
                    "position": slot["position"]
                }
                for slot in target_slots
            ],
            "scheduled_ids": [
                slot["question_id"]
                for slot in target_slots
                if slot.get("kind") == SLOT_BLANK
            ]
        })

    return presentations


def rail_window_for(length):
    """No windowing until a list is long enough that one rail stops being readable."""
    return None if length < SEQUENCE_RAIL_WINDOW_MIN_LENGTH else SEQUENCE_RAIL_WINDOW


def rail_true_order(rail):
    """The visible slots in rank order -- the ordering grader's reference."""
    return [
        slot["question_id"]
        for slot in sorted(rail or [], key=lambda slot: slot["position"])
    ]


def rail_graded_ids(rail):
    """Only real blanks are scheduled. Decoys are answered but never graded."""
    return {
        slot["question_id"]
        for slot in rail or []
        if slot.get("kind") == SLOT_BLANK
    }
