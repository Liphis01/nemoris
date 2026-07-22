"""Deletion records for synced content (sync-roadmap 0.4).

Recording deletions (not just absences) is what stops a future sync pull from
resurrecting content deleted on this device. Rows are append-only; purging is
deferred until after a completed full sync (M2).
"""

from datetime import datetime, timezone

from ..models import Question, Tombstone


def record_tombstone(db, entity_type, guid):
    if not guid:
        return None

    row = Tombstone(
        entity_type=entity_type,
        guid=guid,
        deleted_at=datetime.now(timezone.utc).isoformat()
    )
    db.add(row)

    return row


def record_question_tombstones(db, question_ids):
    # Called before the questions are deleted so the guids are still readable.
    question_ids = [
        question_id for question_id in question_ids if question_id is not None
    ]

    if not question_ids:
        return []

    guids = [
        guid
        for (guid,) in (
            db.query(Question.guid)
            .filter(Question.id.in_(question_ids))
            .all()
        )
        if guid
    ]

    return [record_tombstone(db, "question", guid) for guid in guids]
