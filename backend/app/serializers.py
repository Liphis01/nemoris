from .scheduler import preview_intervals
from .services.image_modes import (
    DEFAULT_IMAGE_MODE,
    normalize_image_mode
)
from .services.map_modes import (
    DEFAULT_MAP_MODE,
    normalize_map_mode
)


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
            "ideal_interval": None,
            "ideal_next_review": None,
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
        "ideal_interval": progress.ideal_interval,
        "ideal_next_review": (
            progress.ideal_next_review.isoformat()
            if progress.ideal_next_review
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
        "answer_media": question.answer_media,
        "tags": question.tags or [],
        "data": question.data or {},
        "group_id": question.group_id,
        "progress": serialize_progress(question.progress),
        "group":
            {
                "id": question.group.id,
                "type_group": question.group.type_group,
                "name": question.group.name,
                "media": question.group.media,
                "tags": (
                    question.tags or []
                    if question.group.type_group in {"map", "image"}
                    else []
                )
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

        "answer_media": question.answer_media,

        "tags": question.tags or [],

        "progress": serialize_progress(
            question.progress
        )
    }


def serialize_map_review_group(group, tags=None, mode=None, context_items=None):
    # Runtime aggregation object: this is intentionally not a database question
    # type. It groups due map-zone questions for a single review screen.
    return {
        "group_id": group.id,
        
        "type_q": "map",

        "name": group.name,

        "media": group.media,

        "tags": tags or [],

        "mode": normalize_map_mode(mode or DEFAULT_MAP_MODE),

        "context_items": context_items or [],

        "items": []
    }


def serialize_map_review_zone(
    question,
    mode_difficulty=None,
    scheduler_tuning=None
):
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
            question.progress,
            favorite=bool((question.data or {}).get("favorite")),
            mode_difficulty=mode_difficulty,
            scheduler_tuning=scheduler_tuning
        )
    }


def serialize_image_review_group(group, tags=None, mode=None, context_items=None):
    # Runtime aggregation object: image rows stay independently scheduled, but
    # review can keep related due images in one focused screen.
    return {
        "group_id": group.id,

        "type_q": "image",

        "name": group.name,

        "media": group.media,

        "tags": tags or [],

        "mode": normalize_image_mode(mode or DEFAULT_IMAGE_MODE),

        "context_items": context_items or [],

        "items": []
    }


def serialize_image_review_item(
    question,
    mode_difficulty=None,
    scheduler_tuning=None
):
    return {
        "question_id": question.id,

        "question": question.question,

        "answer": question.answer,

        "label": question.answer,

        "media": question.media,

        "tags": question.tags or [],

        "aliases": question.data.get("aliases", []) if question.data else [],

        "progress": serialize_progress(
            question.progress
        ),

        "projected_intervals": preview_intervals(
            question.progress,
            favorite=bool((question.data or {}).get("favorite")),
            mode_difficulty=mode_difficulty,
            scheduler_tuning=scheduler_tuning
        )
    }
