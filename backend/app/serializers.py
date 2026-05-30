from .scheduler import preview_intervals


def serialize_progress(progress):
    # Frontend components expect a complete progress object even for old rows
    # that do not yet have a Progress record.
    if not progress:
        return {
            "interval": 0,
            "stability": 1.0,
            "difficulty": 5.0,
            "reps": 0,
            "lapses": 0,
            "last_review": None,
            "next_review": None,
            "fsrs_state": None,
            "fsrs_version": None,
            "history": []
        }

    fsrs_state = (
        progress.fsrs_card.get("state")
        if isinstance(progress.fsrs_card, dict)
        else None
    )

    return {
        "interval": progress.interval,
        "stability": progress.stability,
        "difficulty": progress.difficulty,
        "reps": progress.reps,
        "lapses": progress.lapses,
        "last_review": (
            progress.last_review.isoformat()
            if progress.last_review
            else None
        ),
        "next_review": (
            progress.next_review.isoformat()
            if progress.next_review
            else None
        ),
        "fsrs_state": fsrs_state,
        "fsrs_version": progress.fsrs_version,
        "history": progress.history or []
    }


def serialize_manage_question(question):
    # Manage needs the richest question shape: editable fields, progress, group
    # metadata, and collection memberships in one payload.
    return {
        "id": question.id,
        "type_q": question.type_q,
        "question": question.question,
        "answer": question.answer,
        "media": question.media,
        "tags": question.tags or [],
        "data": question.data or {},
        "group_id": question.group_id,
        "progress": serialize_progress(question.progress),
        "group":
            {
                "id": question.group.id,
                "type_group": question.group.type_group,
                "name": question.group.name,
                "media": question.group.media
            }
            if question.group else None,
        "collections": [
            {
                "id": collection.id,
                "name": collection.name
            }
            for collection in question.collections
        ]
    }


def serialize_review_question_item(question):
    # Text review sessions only need the prompt, answer, media, tags, and
    # progress state for one atomic item.
    return {
        "type_q": question.type_q,

        "question_id": question.id,

        "question": question.question,

        "answer": question.answer,

        "media": question.media,

        "tags": question.tags or [],

        "progress": serialize_progress(
            question.progress
        )
    }


def serialize_map_review_group(group):
    # Runtime aggregation object: this is intentionally not a database question
    # type. It groups due map-zone questions for a single review screen.
    return {
        "group_id": group.id,
        
        "type_q": "map",

        "name": group.name,

        "media": group.media,

        "items": []
    }


def serialize_map_review_zone(question):
    # A map zone is still one Question row. The review UI uses code/aliases to
    # match typed answers and projected_intervals to label recap choices.
    return {

        "question_id": question.id,

        "code": question.data.get("code") if question.data else None,

        "label": question.answer,

        "aliases": question.data.get("aliases", []) if question.data else [],

        "progress": serialize_progress(
            question.progress
        ),

        "projected_intervals": preview_intervals(
            question.progress
        )
    }
