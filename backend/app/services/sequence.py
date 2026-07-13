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


def sequence_positions_for_questions(db, questions):
    # Ranks are only meaningful relative to the whole list, so load every item
    # of every touched group in one query.
    group_ids = {
        question.group_id
        for question in questions or []
        if question.group_id
    }

    if not group_ids:
        return {}, {}

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

    positions = {}
    group_sizes = {}

    for group_id, group_questions in by_group.items():
        positions.update(dense_positions(group_questions))
        group_sizes[group_id] = len(group_questions)

    return positions, group_sizes


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
