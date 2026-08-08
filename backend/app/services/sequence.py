from fastapi import HTTPException

from ..models import Question


# Exact rank = Good, off by one = Hard, anything else = Again. Easy (3) is never
# produced: like timeline, the grade is computed from a distance, and "you were
# exactly right" is the ceiling.
SEQUENCE_QUALITY_EXACT = 2
SEQUENCE_QUALITY_NEAR = 1
SEQUENCE_QUALITY_MISS = 0


def _sequence_error(message: str):
    raise HTTPException(400, message)


def raw_position(question):
    # Ranks live in the JSON blob, so anything can end up in there. Rows with a
    # missing or unusable position sort last and get repaired by
    # dense_positions.
    data = question.data or {}
    value = data.get("position")

    try:
        position = int(value)
    except (TypeError, ValueError):
        return None

    return position if position >= 1 else None


def validate_sequence_data(data):
    position = (data or {}).get("position")

    try:
        value = int(position)
    except (TypeError, ValueError):
        _sequence_error("Sequence items require an integer data.position")

    if value < 1:
        _sequence_error("Sequence positions start at 1")

    return {**(data or {}), "position": value}


def validate_question_sequence(type_q: str, group_id: int | None, data):
    if type_q != "sequence":
        return

    # The inverse of the timeline rule: a rank with no list to rank it in is
    # meaningless, and an ungrouped sequence item would fall through review
    # serialization into the plain-card path.
    if not group_id:
        _sequence_error("Sequence questions must belong to a sequence group")

    validate_sequence_data(data)


def dense_positions(questions):
    # Single source of truth for ranks, used by BOTH the serializer and the
    # grader so what the player sees can never disagree with what is graded.
    # PATCH /questions/{id} can write any data blob, so duplicate or missing
    # positions are repaired here rather than trusted.
    ordered = sorted(
        (
            question
            for question in questions or []
            if question.type_q == "sequence"
        ),
        key=lambda question: (
            raw_position(question) is None,
            raw_position(question) or 0,
            question.id or 0
        )
    )

    return {
        question.id: index + 1
        for index, question in enumerate(ordered)
    }


def sequence_group_questions(db, questions=None, group_ids=None):
    # Ranks are only meaningful relative to the whole list, so load every item
    # of every touched group in one query.
    group_ids = set(group_ids or []) | {
        question.group_id
        for question in questions or []
        if question.group_id
    }

    if not group_ids:
        return {}

    siblings = (
        db.query(Question)
        .filter(
            Question.group_id.in_(group_ids),
            Question.type_q == "sequence"
        )
        .all()
    )

    by_group = {}

    for question in siblings:
        by_group.setdefault(question.group_id, []).append(question)

    return by_group


def sequence_positions_for_questions(db, questions):
    by_group = sequence_group_questions(db, questions)

    if not by_group:
        return {}, {}

    positions = {}
    group_sizes = {}

    for group_id, group_questions in by_group.items():
        positions.update(dense_positions(group_questions))
        group_sizes[group_id] = len(group_questions)

    return positions, group_sizes


def reconcile_sequence_quality(auto_quality, requested):
    """
    Final scheduling quality for a sequence answer.

    Same contract as reconcile_timeline_quality: placement decides correctness,
    the learner only refines a hit. A miss can never be talked up and a hit can
    never be demoted to a miss, so a tampered client cannot inflate a wrong
    answer's interval.

    This is what makes Easy reachable at all. Until now SEQUENCE_QUALITY_EXACT
    was the ceiling, so a sequence item could never earn accelerated growth --
    the type was all downside: much to lose on a lapse, nothing to win.
    """
    if auto_quality == 0:
        return 0

    if requested is None:
        return auto_quality

    return max(1, min(3, int(requested)))


def grade_sequence_ordering(true_order, produced_order, graded_ids):
    """
    Grade a produced ordering by RELATIVE order, not by index distance.

    Serial memory stores "what follows what", not indices, so the common
    failure -- one item forgotten or two swapped -- shifts everything after it
    and, under absolute grading, marks a dozen known items Again. Here each
    item is asked two questions instead: is my true predecessor still somewhere
    before me, and my true successor still somewhere after me. Both -> Good,
    one -> Hard, neither -> Again. A uniform shift preserves every such
    relation and grades clean.

    Deliberately relative order rather than adjacency ("is my neighbour still
    the SAME item"): adjacency fails both halves of a single swap outright and
    drags the two outer neighbours down with them, so one slip becomes four
    damaged cards. It also demands that client and server agree on the exact
    visible sequence, where this only needs them to agree on the set.

    Both orders are lists of question ids over the VISIBLE slots -- anchors and
    blanks, never the unstarted items, which are absent from both by
    construction and so cannot skew the comparison.
    """
    true_order = list(true_order or [])
    produced_order = list(produced_order or [])

    true_index = {question_id: index for index, question_id in enumerate(true_order)}
    produced_index = {
        question_id: index
        for index, question_id in enumerate(produced_order)
    }

    grades = {}

    for question_id in graded_ids or []:
        if question_id not in produced_index or question_id not in true_index:
            # Never placed, or not on the rail at all: an unanswered item is a
            # miss, not a vacuous pass for having no neighbours to contradict.
            grades[question_id] = {
                "quality": SEQUENCE_QUALITY_MISS,
                "distance": None
            }
            continue

        rank = true_index[question_id]
        placed = produced_index[question_id]
        checks = []

        for neighbour_rank, expected_before in ((rank - 1, True), (rank + 1, False)):
            if neighbour_rank < 0 or neighbour_rank >= len(true_order):
                # An edge of the visible run carries no constraint. Grading it
                # as satisfied would hand every run boundary free credit.
                continue

            neighbour = true_order[neighbour_rank]

            if neighbour not in produced_index:
                continue

            is_before = produced_index[neighbour] < placed
            checks.append(is_before is expected_before)

        if not checks:
            # Nothing visible to order against; fall back to the placement.
            quality = (
                SEQUENCE_QUALITY_EXACT
                if placed == rank
                else SEQUENCE_QUALITY_MISS
            )
        elif all(checks):
            quality = SEQUENCE_QUALITY_EXACT
        elif any(checks):
            quality = SEQUENCE_QUALITY_NEAR
        else:
            quality = SEQUENCE_QUALITY_MISS

        grades[question_id] = {
            "quality": quality,
            "distance": abs(placed - rank)
        }

    return grades


def grade_sequence_recitation(expected_order, run, started_ids):
    """
    Grade a recitation run: produce items forward until you stall.

    Everything before the stall is Good, the stall itself is Again, and
    everything after it is NOT GRADED -- absent from the result entirely. That
    asymmetry is the point: failing to recall item 7 says nothing about item 12,
    and marking the untouched tail wrong is exactly the "one gap becomes ten
    lapses" defect this milestone exists to remove.

    Two hard rules:

    - The walk stops at the first item the learner has never reviewed. Grading
      an unstarted stall would create a Progress row -- and a lapse -- for a
      card that has never been shown, which is the one thing the whole
      withholding mechanism exists to prevent.
    - Only started items are graded at all, so reciting past the due set costs
      nothing and earns nothing.

    Returns `({question_id: quality}, stall_id)`.
    """
    run = list(run or [])
    started_ids = set(started_ids or [])
    graded = {}
    stall = None

    for index, expected_id in enumerate(expected_order or []):
        if expected_id not in started_ids:
            # A never-seen item ends the run rather than failing it.
            break

        if index >= len(run):
            stall = expected_id
            break

        if run[index] != expected_id:
            stall = expected_id
            break

        graded[expected_id] = SEQUENCE_QUALITY_EXACT

    if stall is not None:
        graded[stall] = SEQUENCE_QUALITY_MISS

    return graded, stall


def grade_sequence_position(expected, guessed):
    if guessed is None or expected is None:
        return {
            "quality": SEQUENCE_QUALITY_MISS,
            "distance": None
        }

    distance = abs(int(expected) - int(guessed))

    if distance == 0:
        quality = SEQUENCE_QUALITY_EXACT
    elif distance == 1:
        quality = SEQUENCE_QUALITY_NEAR
    else:
        quality = SEQUENCE_QUALITY_MISS

    return {
        "quality": quality,
        "distance": distance
    }
