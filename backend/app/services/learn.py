"""Confusion counters produced by the Learn screen.

The Learn screen is a scratchpad -- it never grades a card and never touches
Progress. The one thing worth keeping from a session is which pairs the learner
mixed up, because the multiple choice distractor picker already knows how to use
that signal: frontend/src/features/review/distractorSelection.js weights a
candidate by how often it was mis-picked for the target. Until now it could only
read mis-picks out of review history, so cards a learner had never been quizzed
on carried no signal at all.
"""

from datetime import date

from sqlalchemy import or_

from ..models import LearnConfusion, Question


def _coerce_id(value):
    try:
        coerced = int(value)
    except (TypeError, ValueError):
        return None

    return coerced if coerced > 0 else None


def record_learn_confusions(db, entries, today=None):
    """Fold one learn session's choice outcomes into the pair counters.

    Every entry is an exposure of the pair; only wrong picks add a mispick, so
    a pair the learner keeps getting right decays in relative weight instead of
    being boosted forever by one early mistake.
    """
    today = today or date.today()
    pending = {}

    for entry in entries or []:
        expected_id = _coerce_id(entry.get("expected_id"))
        picked_id = _coerce_id(entry.get("picked_id"))

        if expected_id is None or picked_id is None:
            continue

        if expected_id == picked_id:
            continue

        key = (expected_id, picked_id)
        slot = pending.setdefault(key, {"exposures": 0, "mispicks": 0})
        slot["exposures"] += 1

        if not entry.get("correct"):
            slot["mispicks"] += 1

    if not pending:
        return {"pairs": 0, "exposures": 0, "mispicks": 0}

    referenced = {
        question_id
        for pair in pending
        for question_id in pair
    }
    known_ids = {
        row[0]
        for row in db.query(Question.id)
        .filter(Question.id.in_(referenced))
        .all()
    }
    existing = {
        (row.expected_question_id, row.picked_question_id): row
        for row in db.query(LearnConfusion).filter(
            LearnConfusion.expected_question_id.in_(referenced)
        ).all()
    }
    written = 0
    exposures = 0
    mispicks = 0

    for (expected_id, picked_id), slot in pending.items():
        if expected_id not in known_ids or picked_id not in known_ids:
            continue

        row = existing.get((expected_id, picked_id))

        if row is None:
            row = LearnConfusion(
                expected_question_id=expected_id,
                picked_question_id=picked_id,
                exposures=0,
                mispicks=0
            )
            db.add(row)

        row.exposures = (row.exposures or 0) + slot["exposures"]
        row.mispicks = (row.mispicks or 0) + slot["mispicks"]
        row.last_seen_on = today
        written += 1
        exposures += slot["exposures"]
        mispicks += slot["mispicks"]

    db.commit()

    return {"pairs": written, "exposures": exposures, "mispicks": mispicks}


def learn_confusions_for_questions(db, question_ids):
    """Map every question id to the pairs it takes part in, either side.

    A pair is symmetric for distractor purposes: mixing up A and B means B is a
    good decoy for A and A is a good decoy for B.
    """
    ids = {
        coerced
        for coerced in (_coerce_id(value) for value in question_ids or [])
        if coerced is not None
    }

    if not ids:
        return {}

    rows = db.query(LearnConfusion).filter(
        or_(
            LearnConfusion.expected_question_id.in_(ids),
            LearnConfusion.picked_question_id.in_(ids)
        )
    ).all()
    by_question = {}

    for row in rows:
        for owner, candidate in (
            (row.expected_question_id, row.picked_question_id),
            (row.picked_question_id, row.expected_question_id)
        ):
            if owner not in ids:
                continue

            by_question.setdefault(owner, []).append({
                "candidate_id": candidate,
                "exposures": row.exposures or 0,
                "mispicks": row.mispicks or 0
            })

    for entries in by_question.values():
        entries.sort(key=lambda entry: (
            -entry["mispicks"],
            -entry["exposures"],
            entry["candidate_id"]
        ))

    return by_question


def _walk_question_nodes(node, found):
    """Yield every serialized card in a review payload.

    Review items nest: a map/media/text group carries `items` and
    `context_items`, and each of those is a card with its own question_id.
    """
    if isinstance(node, dict):
        if "question_id" in node:
            found.append(node)

        for value in node.values():
            _walk_question_nodes(value, found)
    elif isinstance(node, list):
        for value in node:
            _walk_question_nodes(value, found)


def attach_learn_confusions(db, items):
    """Add `learn_confusions` to every card in a serialized review payload."""
    nodes = []
    _walk_question_nodes(items, nodes)

    if not nodes:
        return items

    by_question = learn_confusions_for_questions(
        db,
        [node.get("question_id") for node in nodes]
    )

    for node in nodes:
        entries = by_question.get(_coerce_id(node.get("question_id")))

        if entries:
            node["learn_confusions"] = entries

    return items
