from .scheduler import (
    preview_intervals,
    progress_in_relearning,
    relearning_graduate_interval
)
from .services.image_modes import (
    DEFAULT_IMAGE_MODE,
    normalize_image_mode
)
from .services.media_pool import read_media_pool
from .services.map_modes import (
    DEFAULT_MAP_MODE,
    normalize_map_mode
)
from .services.sequence_modes import (
    DEFAULT_SEQUENCE_MODE,
    normalize_sequence_mode,
    sequence_review_goal
)
from .services.text_modes import (
    DEFAULT_TEXT_MODE,
    normalize_text_mode
)
from .services.cloze_modes import (
    DEFAULT_CLOZE_MODE,
    normalize_cloze_mode,
)
from .services.numeric_modes import DEFAULT_NUMERIC_MODE
from .services.enumeration_modes import ENUMERATION_MODE_COLLECT_QUOTA
from .services.type_contracts import (
    PRESENTATION_MAP_GROUP,
    PRESENTATION_MEDIA_GROUP,
    PRESENTATION_SEQUENCE_GROUP,
    PRESENTATION_SINGLE_CARD,
    PRESENTATION_TEXT_GROUP,
    PRESENTATION_CLOZE_GROUP
)
from .services.answer_policy import effective_answer_policy


def serialize_progress(progress, today=None):
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
            "relearning": False,
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
        # Derived, not stored: a card that lapsed today and is still due today is
        # in the in-session relearning loop. Lets the frontend show the binary
        # Encore/Acquis controls even after a refresh.
        "relearning": progress_in_relearning(progress, today),
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

        "numeric": (
            (question.data or {}).get("numeric")
            if question.type_q == "numeric" else None
        ),
        "media": question.media,
        "media_pool": read_media_pool(question.media, question.data),
        "answer_media": question.answer_media,
        "tags": question.tags or [],
        "data": question.data or {},
        "group_id": question.group_id,

        "answer_policy": effective_answer_policy(question=question),

        "suspended": bool(question.suspended),
        "intake_order": question.intake_order,
        "progress": serialize_progress(question.progress),
        "group":
            {
                "id": question.group.id,
                "type_group": question.group.type_group,
                "name": question.group.name,
                "media": question.group.media,
                "data": question.group.data or {},
                "map": (question.group.data or {}).get("map"),
                "tags": (
                    question.tags or []
                    if question.group.type_group in {
                        "map",
                        "media",
                        "text",
                        "cloze",
                        "grid",
                        "set",
                        "sequence"
                    }
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
    payload = {
        "type_q": question.type_q,

        "presentation_kind": PRESENTATION_SINGLE_CARD,

        "question_id": question.id,

        "question": question.question,

        "answer": question.answer,

        "media": question.media,

        "media_pool": read_media_pool(question.media, question.data),

        "answer_media": question.answer_media,

        "answer_policy": effective_answer_policy(question=question),

        "tags": question.tags or [],

        "progress": serialize_progress(
            question.progress
        ),

        "projected_intervals": preview_intervals(
            question.progress,
            favorite=bool((question.data or {}).get("favorite"))
        ),

        "relearning_interval": relearning_graduate_interval(question.progress)
    }

    if question.type_q == "numeric":
        payload["numeric"] = (question.data or {}).get("numeric")
        payload["mode"] = DEFAULT_NUMERIC_MODE
    if question.type_q == "enumeration":
        payload["enumeration"] = (question.data or {}).get("enumeration")
        payload["mode"] = ENUMERATION_MODE_COLLECT_QUOTA

    return payload


def serialize_map_review_group(group, tags=None, mode=None, context_items=None):
    # Runtime aggregation object: this is intentionally not a database question
    # type. It groups due map-zone questions for a single review screen.
    return {
        "group_id": group.id,
        
        "type_q": "map",

        "presentation_kind": PRESENTATION_MAP_GROUP,

        "name": group.name,

        "media": group.media,

        "map": (group.data or {}).get("map"),

        "answer_policy": effective_answer_policy(group=group, type_q="map"),

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

        "answer_policy": effective_answer_policy(question=question),

        "progress": serialize_progress(
            question.progress
        ),

        "projected_intervals": preview_intervals(
            question.progress,
            favorite=bool((question.data or {}).get("favorite")),
            mode_difficulty=mode_difficulty,
            scheduler_tuning=scheduler_tuning
        ),

        "relearning_interval": relearning_graduate_interval(question.progress)
    }


def serialize_media_review_group(group, tags=None, mode=None, context_items=None):
    # Runtime aggregation object: media rows stay independently scheduled, but
    # review can keep related due media items in one focused screen.
    return {
        "group_id": group.id,

        "type_q": "media",

        "presentation_kind": PRESENTATION_MEDIA_GROUP,

        "name": group.name,

        "media": group.media,

        "tags": tags or [],

        "answer_policy": effective_answer_policy(group=group, type_q="media"),

        "mode": normalize_image_mode(mode or DEFAULT_IMAGE_MODE),

        "context_items": context_items or [],

        "items": []
    }


def serialize_media_review_item(
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

        "media_pool": read_media_pool(question.media, question.data),

        "tags": question.tags or [],

        "aliases": question.data.get("aliases", []) if question.data else [],

        "answer_policy": effective_answer_policy(question=question),

        "progress": serialize_progress(
            question.progress
        ),

        "projected_intervals": preview_intervals(
            question.progress,
            favorite=bool((question.data or {}).get("favorite")),
            mode_difficulty=mode_difficulty,
            scheduler_tuning=scheduler_tuning
        ),

        "relearning_interval": relearning_graduate_interval(question.progress)
    }


def serialize_text_review_group(group, tags=None, mode=None, context_items=None):
    # Runtime aggregation object for a text-to-text association group. Items stay
    # independently scheduled; review presents the whole set on one screen.
    return {
        "group_id": group.id,

        "type_q": "text",

        "presentation_kind": PRESENTATION_TEXT_GROUP,

        "name": group.name,

        "media": group.media,

        "tags": tags or [],

        "answer_policy": effective_answer_policy(group=group, type_q="text"),

        "mode": normalize_text_mode(mode or DEFAULT_TEXT_MODE),

        "context_items": context_items or [],

        "items": []
    }


def serialize_text_review_item(
    question,
    mode_difficulty=None,
    scheduler_tuning=None
):
    return {
        "question_id": question.id,

        "question": question.question,

        "answer": question.answer,

        "label": question.answer,

        "tags": question.tags or [],

        "aliases": question.data.get("aliases", []) if question.data else [],

        "answer_policy": effective_answer_policy(question=question),

        "progress": serialize_progress(
            question.progress
        ),

        "projected_intervals": preview_intervals(
            question.progress,
            favorite=bool((question.data or {}).get("favorite")),
            mode_difficulty=mode_difficulty,
            scheduler_tuning=scheduler_tuning
        ),

        "relearning_interval": relearning_graduate_interval(question.progress)
    }


def serialize_cloze_review_group(group, question, mode=None, mode_difficulty=None, scheduler_tuning=None):
    from .services.cloze import render_cloze_source
    source = ((group.data or {}).get("cloze") or {}).get("source", "")
    key = ((question.data or {}).get("cloze") or {}).get("key")
    return {
        "group_id": group.id,
        "type_q": "cloze",
        "presentation_kind": PRESENTATION_CLOZE_GROUP,
        "name": group.name,
        "source": source,
        "masked_source": render_cloze_source(source, key) if key else source,
        "cloze_key": key,
        "answer_policy": effective_answer_policy(question=question, group=group, type_q="cloze"),
        "mode": normalize_cloze_mode(mode or DEFAULT_CLOZE_MODE),
        "items": [{
            "question_id": question.id,
            "answer": question.answer,
            "progress": serialize_progress(question.progress),
            "projected_intervals": preview_intervals(
                question.progress,
                favorite=bool((question.data or {}).get("favorite")),
                mode_difficulty=mode_difficulty,
                scheduler_tuning=scheduler_tuning
            ),
            "relearning_interval": relearning_graduate_interval(question.progress)
        }]
    }


def serialize_sequence_review_group(
    group,
    tags=None,
    mode=None,
    context_items=None,
    rail=None,
    length=0,
    recitation=None
):
    # Runtime aggregation object for one ordered list. `length` is the full list
    # size, so the rail can report "n° X / N" even when it only draws a window.
    # `rail` is the slot list the client renders and posts back -- it is the one
    # statement of what was on screen, and grading an ordering is impossible
    # without it, since the answer endpoint cannot reconstruct which slots were
    # anchors once a chunk has already written progress. `context_items` count
    # is what the client posts back as context_count and must match the pool the
    # mode difficulty was computed on.
    return {
        "group_id": group.id,

        "type_q": "sequence",

        "presentation_kind": PRESENTATION_SEQUENCE_GROUP,

        "name": group.name,

        "media": group.media,

        "tags": tags or [],

        "mode": normalize_sequence_mode(mode or DEFAULT_SEQUENCE_MODE),

        "review_goal": sequence_review_goal(group),

        "answer_policy": effective_answer_policy(group=group, type_q="sequence"),

        "length": length,

        "rail": rail or [],

        "context_items": context_items or [],

        "recitation": recitation,

        "items": []
    }


def serialize_sequence_review_item(
    question,
    position=None,
    mode_difficulty=None,
    scheduler_tuning=None
):
    return {
        "question_id": question.id,

        "question": question.question,

        "answer": question.answer,

        "label": question.answer,

        "position": position,

        "tags": question.tags or [],

        "aliases": question.data.get("aliases", []) if question.data else [],

        "answer_policy": effective_answer_policy(question=question),

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
