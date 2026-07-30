from datetime import date
import random

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload

from ..models import Progress, Question, QuestionGroup
from ..serializers import (
    serialize_map_review_group,
    serialize_map_review_zone,
    serialize_media_review_group,
    serialize_media_review_item,
    serialize_review_question_item,
    serialize_sequence_anchor,
    serialize_sequence_review_group,
    serialize_sequence_review_item,
    serialize_text_review_group,
    serialize_text_review_item
)
from .timeline import (
    build_mastered_timeline_anchors,
    date_center_value,
    serialize_timeline_review_group,
    serialize_timeline_review_item,
    validate_timeline_data
)
from .image_modes import (
    IMAGE_MULTIPLE_CHOICE_MODES,
    choose_image_review_mode,
    image_mode_difficulty
)
from .map_modes import (
    MAP_MODE_MULTIPLE_CHOICE,
    choose_map_review_mode,
    map_mode_difficulty
)
from .text_modes import (
    TEXT_MODE_MATCH,
    choose_text_review_mode,
    text_mode_difficulty
)
from .sequence import dense_positions
from .sequence_modes import (
    SEQUENCE_MODE_MULTIPLE_CHOICE,
    SEQUENCE_MODE_REORDER,
    choose_sequence_review_mode,
    sequence_mode_difficulty
)
from .mode_selection import (
    MODE_AFFINITIES,
    question_mode_affinity
)
from .media import media_kind_from_name
from .map_eligibility import map_question_is_ready, reviewable_question_filter
from .progress import progress_has_started, progress_is_new
from .settings import get_review_settings, load_scheduler_tuning_settings


REVIEW_GROUP_MAX_CHUNK_SIZE = 30
REVIEW_IMAGE_MAX_CHUNK_SIZE = REVIEW_GROUP_MAX_CHUNK_SIZE


def _balanced_chunks(items, max_size):
    items = list(items or [])

    if len(items) <= max_size:
        return [items]

    chunk_count = (len(items) + max_size - 1) // max_size
    base_size = len(items) // chunk_count
    extra = len(items) % chunk_count
    chunks = []
    start = 0

    for index in range(chunk_count):
        size = base_size + (1 if index < extra else 0)
        chunks.append(items[start:start + size])
        start += size

    return chunks


def _shuffled(items):
    shuffled = list(items or [])
    random.shuffle(shuffled)
    return shuffled


def _question_ids(items):
    return [
        item.id
        for item in items or []
        if item is not None
    ]


def _shuffled_context_questions(context_questions, active_questions):
    context_questions = list(context_questions or [])
    active_questions = list(active_questions or [])
    context_ids = _question_ids(context_questions)
    active_ids = _question_ids(active_questions)

    if (
        len(context_ids) == len(active_ids) and
        set(context_ids) == set(active_ids)
    ):
        return active_questions

    return _shuffled(context_questions)


def _affinity_chunks(items, max_size):
    items = list(items or [])

    if len(items) <= max_size:
        return [items]

    buckets = {affinity: [] for affinity in MODE_AFFINITIES}

    for item in items:
        buckets[question_mode_affinity(item)].append(item)

    chunks = []

    for affinity in MODE_AFFINITIES:
        bucket = buckets[affinity]

        if bucket:
            chunks.extend(_balanced_chunks(bucket, max_size))

    return chunks


def _group_review_chunks(items, scheduled_review):
    items = list(items or [])

    if not scheduled_review:
        return [_shuffled(items)]

    return [
        _shuffled(chunk)
        for chunk in _affinity_chunks(items, REVIEW_GROUP_MAX_CHUNK_SIZE)
    ]


def _unique_sorted_questions(*question_groups):
    by_id = {}

    for questions in question_groups:
        for question in questions or []:
            if question and question.id not in by_id:
                by_id[question.id] = question

    return sorted(by_id.values(), key=lambda item: item.id)


def _visual_review_contexts(
    chunk_questions,
    all_group_questions,
    scheduled_review
):
    active_context_questions = (
        chunk_questions
        if scheduled_review
        else all_group_questions
    )

    if not scheduled_review:
        return active_context_questions, active_context_questions

    started_group_questions = [
        question
        for question in all_group_questions
        if progress_has_started(question.progress)
    ]

    return active_context_questions, _unique_sorted_questions(
        chunk_questions,
        started_group_questions
    )


def _question_query(db):
    return (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group)
            .joinedload(QuestionGroup.questions)
            .joinedload(Question.progress)
        )
        .filter(reviewable_question_filter())
        .order_by(Question.id)
    )


def _due_questions(db, today):
    # Only started cards are part of the scheduled daily workload. Unstarted
    # progress rows are legacy/new rows and are handled as bonus questions.
    return [
        question
        for question in _question_query(db)
        .join(Progress, Question.id == Progress.question_id)
        .filter(
            or_(
                Progress.next_review == None,
                Progress.next_review <= today
            )
        )
        .all()
        if progress_has_started(question.progress)
    ]


def _progress_row_has_started(row):
    return (
        (row.reps or 0) > 0 or
        bool(row.last_review) or
        len(row.history or []) > 0
    )


def _started_progress_rows(db):
    return (
        db.query(
            Progress.question_id,
            Progress.stability,
            Progress.difficulty,
            Progress.reps,
            Progress.lapses,
            Progress.interval,
            Progress.ideal_interval,
            Progress.last_review,
            Progress.next_review,
            Progress.ideal_next_review,
            Progress.fsrs_card,
            Progress.fsrs_version,
            Progress.history,
            Question.type_q,
            Question.data.label("question_data")
        )
        .join(Question, Question.id == Progress.question_id)
        .filter(reviewable_question_filter())
        .all()
    )


def _normalized_group_ids(group_ids):
    if group_ids is None:
        return None

    if isinstance(group_ids, str):
        group_ids = [
            raw_id.strip()
            for raw_id in group_ids.split(",")
            if raw_id.strip()
        ]

    normalized = []
    seen = set()

    for group_id in group_ids:
        group_id = int(group_id)

        if group_id in seen:
            continue

        normalized.append(group_id)
        seen.add(group_id)

    return normalized


def _new_question_ids(db, limit=None, group_ids=None):
    group_ids = _normalized_group_ids(group_ids)

    if group_ids is not None and not group_ids:
        return []

    ids = []
    query = (
        db.query(
            Question.id,
            Progress.reps,
            Progress.last_review,
            Progress.history
        )
        .outerjoin(Progress, Question.id == Progress.question_id)
        .filter(reviewable_question_filter())
    )

    if group_ids is not None:
        query = query.filter(Question.group_id.in_(group_ids))

    rows = (
        query
        .order_by(Question.id)
        .all()
    )

    for row in rows:
        if _progress_row_has_started(row):
            continue

        ids.append(row.id)

        if limit is not None and len(ids) >= limit:
            break

    return ids


def _questions_by_ids(db, question_ids):
    if not question_ids:
        return []

    questions = (
        _question_query(db)
        .filter(Question.id.in_(question_ids))
        .all()
    )
    by_id = {question.id: question for question in questions}

    return [
        by_id[question_id]
        for question_id in question_ids
        if question_id in by_id
    ]


def _new_questions(db, limit=None, group_ids=None):
    return _questions_by_ids(
        db,
        _new_question_ids(db, limit=limit, group_ids=group_ids)
    )


def _due_question_count(db, today):
    rows = (
        db.query(
            Progress.question_id,
            Progress.reps,
            Progress.last_review,
            Progress.history
        )
        .join(Question, Question.id == Progress.question_id)
        .filter(
            reviewable_question_filter(),
            or_(
                Progress.next_review == None,
                Progress.next_review <= today
            )
        )
        .all()
    )

    return sum(1 for row in rows if _progress_row_has_started(row))


def _new_question_count(db, started_rows=None, group_ids=None):
    group_ids = _normalized_group_ids(group_ids)

    if group_ids is not None:
        return len(_new_question_ids(db, group_ids=group_ids))

    total_questions = (
        db.query(func.count(Question.id))
        .filter(reviewable_question_filter())
        .scalar()
        or 0
    )
    started_rows = started_rows if started_rows is not None else (
        _started_progress_rows(db)
    )
    started_count = sum(
        1
        for row in started_rows
        if _progress_row_has_started(row)
    )

    return max(0, total_questions - started_count)


def get_bonus_review_status(db, today=None, group_ids=None):
    today = today or date.today()
    scoped_group_ids = _normalized_group_ids(group_ids)
    same_group_filter_applied = scoped_group_ids is not None
    due_count = _due_question_count(db, today)
    started_rows = _started_progress_rows(db)
    new_count = _new_question_count(db, started_rows=started_rows)
    same_group_new_count = (
        _new_question_count(db, group_ids=scoped_group_ids)
        if same_group_filter_applied
        else new_count
    )
    available_bonus_question_count = same_group_new_count

    return {
        "new_count": new_count,
        "same_group_new_count": same_group_new_count,
        "available_bonus_question_count": available_bonus_question_count,
        "same_group_bonus_question_count": available_bonus_question_count,
        "same_group_filter_applied": same_group_filter_applied,
        "same_group_ids": scoped_group_ids or [],
        "due_count": due_count,
        "allowed": due_count == 0 and available_bonus_question_count > 0
    }


def get_review_summary(db, today=None):
    today = today or date.today()
    due_count = _due_question_count(db, today)

    return {
        "due_count": due_count,
        "has_due": due_count > 0
    }


def _serialize_review_items(
    questions,
    scheduler_tuning=None,
    scheduled_review=False,
    timeline_anchors=None
):
    review_items = []
    map_grouped_items = {}
    media_grouped_items = {}
    text_grouped_items = {}
    sequence_grouped_items = {}
    timeline_items = []

    for question in questions:
        if question.group and question.group.type_group == "map":
            # Maps are grouped only at runtime: each zone keeps independent
            # progress, but the UI receives one map review object per group.
            group_id = question.group.id

            if group_id not in map_grouped_items:
                map_grouped_items[group_id] = {
                    "group": question.group,
                    "tags": question.tags or [],
                    "questions": []
                }

            map_grouped_items[group_id]["questions"].append(question)
            continue

        if question.group and question.group.type_group == "media":
            group_id = question.group.id

            if group_id not in media_grouped_items:
                media_grouped_items[group_id] = {
                    "group": question.group,
                    "tags": question.tags or [],
                    "questions": []
                }

            media_grouped_items[group_id]["questions"].append(question)
            continue

        if question.group and question.group.type_group == "text":
            group_id = question.group.id

            if group_id not in text_grouped_items:
                text_grouped_items[group_id] = {
                    "group": question.group,
                    "tags": question.tags or [],
                    "questions": []
                }

            text_grouped_items[group_id]["questions"].append(question)
            continue

        if question.group and question.group.type_group == "sequence":
            group_id = question.group.id

            if group_id not in sequence_grouped_items:
                sequence_grouped_items[group_id] = {
                    "group": question.group,
                    "tags": question.tags or [],
                    "questions": []
                }

            sequence_grouped_items[group_id]["questions"].append(question)
            continue

        if question.type_q == "timeline":
            # Timeline questions stay atomic in storage/manage/calendar, but
            # review presents every due item in one combined timeline screen.
            timeline_items.append(serialize_timeline_review_item(question))
            continue

        review_items.append(serialize_review_question_item(question))

    # Mixed sessions can contain normal questions and runtime map groups.
    if timeline_items:
        review_items.append(
            serialize_timeline_review_group(timeline_items, anchors=timeline_anchors)
        )

    map_review_groups = []

    for group_data in map_grouped_items.values():
        group = group_data["group"]
        due_questions = sorted(group_data["questions"], key=lambda item: item.id)
        all_group_questions = sorted(
            [
                item
                for item in (group.questions or [])
                if item.type_q == "map"
                and map_question_is_ready(item)
            ],
            key=lambda item: item.id
        )
        question_chunks = _group_review_chunks(due_questions, scheduled_review)

        for chunk_questions in question_chunks:
            active_context_questions, choice_context_questions = (
                _visual_review_contexts(
                    chunk_questions,
                    all_group_questions,
                    scheduled_review
                )
            )
            mode = choose_map_review_mode(
                chunk_questions,
                active_context_questions,
                multiple_choice_context_count=len(choice_context_questions)
            )
            context_questions = (
                choice_context_questions
                if mode == MAP_MODE_MULTIPLE_CHOICE
                else active_context_questions
            )
            mode_difficulty = map_mode_difficulty(
                mode,
                context_count=len(context_questions),
                tuning=scheduler_tuning
            )
            context_items = [
                serialize_map_review_zone(
                    item,
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in _shuffled_context_questions(
                    context_questions,
                    chunk_questions
                )
            ]
            map_group = serialize_map_review_group(
                group,
                group_data["tags"],
                mode=mode,
                context_items=context_items
            )
            map_group["items"] = [
                serialize_map_review_zone(
                    item,
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in chunk_questions
            ]
            map_review_groups.append(map_group)

    media_review_groups = []

    for group_data in media_grouped_items.values():
        group = group_data["group"]
        due_questions = sorted(group_data["questions"], key=lambda item: item.id)
        all_group_questions = sorted(
            [
                item
                for item in (group.questions or [])
                if item.type_q == "media"
            ],
            key=lambda item: item.id
        )
        # Audio can't be scanned in parallel, so an audio-only group is limited to
        # the prompt->name modes. Kind is inferred per item from its extension.
        media_kinds = {
            media_kind_from_name(item.media)
            for item in all_group_questions
            if item.media
        }
        audio_only = bool(media_kinds) and media_kinds == {"audio"}
        question_chunks = _group_review_chunks(due_questions, scheduled_review)
        previous_mode = None

        for chunk_questions in question_chunks:
            active_context_questions, choice_context_questions = (
                _visual_review_contexts(
                    chunk_questions,
                    all_group_questions,
                    scheduled_review
                )
            )
            mode = choose_image_review_mode(
                chunk_questions,
                active_context_questions,
                multiple_choice_context_count=len(choice_context_questions),
                discouraged_modes=(
                    [previous_mode]
                    if scheduled_review and previous_mode
                    else None
                ),
                audio_only=audio_only
            )
            context_questions = (
                choice_context_questions
                if mode in IMAGE_MULTIPLE_CHOICE_MODES
                else active_context_questions
            )
            mode_difficulty = image_mode_difficulty(
                mode,
                context_count=len(context_questions),
                tuning=scheduler_tuning
            )
            context_items = [
                serialize_media_review_item(
                    item,
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in _shuffled_context_questions(
                    context_questions,
                    chunk_questions
                )
            ]
            media_group = serialize_media_review_group(
                group,
                group_data["tags"],
                mode=mode,
                context_items=context_items
            )
            media_group["items"] = [
                serialize_media_review_item(
                    item,
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in chunk_questions
            ]
            media_review_groups.append(media_group)
            previous_mode = mode

    text_review_groups = []

    for group_data in text_grouped_items.values():
        group = group_data["group"]
        due_questions = sorted(group_data["questions"], key=lambda item: item.id)
        all_group_questions = sorted(
            [
                item
                for item in (group.questions or [])
                if item.type_q == "text"
            ],
            key=lambda item: item.id
        )
        question_chunks = _group_review_chunks(due_questions, scheduled_review)

        for chunk_questions in question_chunks:
            active_context_questions, choice_context_questions = (
                _visual_review_contexts(
                    chunk_questions,
                    all_group_questions,
                    scheduled_review
                )
            )
            mode = choose_text_review_mode(
                chunk_questions,
                active_context_questions,
                multiple_choice_context_count=len(choice_context_questions)
            )
            context_questions = (
                choice_context_questions
                if mode == TEXT_MODE_MATCH
                else active_context_questions
            )
            mode_difficulty = text_mode_difficulty(
                mode,
                context_count=len(context_questions),
                tuning=scheduler_tuning
            )
            context_items = [
                serialize_text_review_item(
                    item,
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in _shuffled_context_questions(
                    context_questions,
                    chunk_questions
                )
            ]
            text_group = serialize_text_review_group(
                group,
                group_data["tags"],
                mode=mode,
                context_items=context_items
            )
            text_group["items"] = [
                serialize_text_review_item(
                    item,
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in chunk_questions
            ]
            text_review_groups.append(text_group)

    sequence_review_groups = []

    for group_data in sequence_grouped_items.values():
        group = group_data["group"]
        due_questions = sorted(group_data["questions"], key=lambda item: item.id)
        all_group_questions = sorted(
            [
                item
                for item in (group.questions or [])
                if item.type_q == "sequence"
            ],
            key=lambda item: item.id
        )
        positions = dense_positions(all_group_questions)
        by_position = {
            positions[item.id]: item
            for item in all_group_questions
        }

        def previous_label_for(item):
            rank = positions[item.id]
            previous = by_position.get(rank - 1)

            return previous.answer if previous else None

        # Anchors are the peers the player is allowed to see already in place.
        # They must exclude EVERY due item of the group, not just the ones in
        # this chunk: _visual_review_contexts would hand back the other chunk's
        # still-due items, which on a reorder rail is literally showing the
        # answers. Unstarted peers are withheld too -- their slots render locked
        # and blank so a new item is never revealed before its first review.
        due_ids = {item.id for item in due_questions}
        anchors = [
            serialize_sequence_anchor(item, positions[item.id])
            for item in all_group_questions
            if progress_has_started(item.progress) and item.id not in due_ids
        ]

        question_chunks = _group_review_chunks(due_questions, scheduled_review)

        for chunk_questions in question_chunks:
            active_context_questions, choice_context_questions = (
                _visual_review_contexts(
                    chunk_questions,
                    all_group_questions,
                    scheduled_review
                )
            )
            mode = choose_sequence_review_mode(
                chunk_questions,
                active_context_questions,
                multiple_choice_context_count=len(choice_context_questions)
            )

            if mode == SEQUENCE_MODE_MULTIPLE_CHOICE:
                # Distractors are drawn from the peers on screen.
                context_questions = choice_context_questions
            elif mode == SEQUENCE_MODE_REORDER:
                # reorder is graded on the pool of free slots, which is exactly
                # the chunk -- that pool is what click_prompt_base_difficulty
                # expects as its context count.
                context_questions = chunk_questions
            else:
                context_questions = active_context_questions

            mode_difficulty = sequence_mode_difficulty(
                mode,
                context_count=len(context_questions),
                tuning=scheduler_tuning
            )
            context_items = [
                serialize_sequence_review_item(
                    item,
                    position=positions[item.id],
                    previous_label=previous_label_for(item),
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in _shuffled_context_questions(
                    context_questions,
                    chunk_questions
                )
            ]
            sequence_group = serialize_sequence_review_group(
                group,
                group_data["tags"],
                mode=mode,
                context_items=context_items,
                anchors=anchors,
                length=len(all_group_questions)
            )
            sequence_group["items"] = [
                serialize_sequence_review_item(
                    item,
                    position=positions[item.id],
                    previous_label=previous_label_for(item),
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in chunk_questions
            ]
            sequence_review_groups.append(sequence_group)

    return (
        review_items
        + map_review_groups
        + media_review_groups
        + text_review_groups
        + sequence_review_groups
    )


def serialize_review_items(
    questions,
    scheduler_tuning=None,
    scheduled_review=False,
    timeline_anchors=None
):
    return _serialize_review_items(
        questions,
        scheduler_tuning=scheduler_tuning,
        scheduled_review=scheduled_review,
        timeline_anchors=timeline_anchors
    )


def _timeline_anchors_for(db, questions):
    timeline_questions = [
        question for question in questions if question.type_q == "timeline"
    ]

    if not timeline_questions:
        return None

    centers = []

    for question in timeline_questions:
        try:
            timeline = validate_timeline_data(question.data or {})
        except HTTPException:
            continue

        centers.append(date_center_value(timeline["start"]))

    reference_value = (min(centers) + max(centers)) // 2 if centers else None

    return build_mastered_timeline_anchors(
        db,
        exclude_ids=[question.id for question in timeline_questions],
        reference_value=reference_value
    )


def get_review_items(db, include_new=False, bonus_status=None, group_ids=None):
    today = date.today()
    scheduler_tuning = load_scheduler_tuning_settings(db)
    due_questions = _due_questions(db, today)

    if due_questions or not include_new:
        questions = due_questions
    else:
        bonus_status = bonus_status or get_bonus_review_status(
            db,
            today=today,
            group_ids=group_ids
        )
        remaining_bonus_slots = max(
            0,
            bonus_status.get("available_bonus_question_count", 0)
        )
        questions = _new_questions(
            db,
            limit=remaining_bonus_slots,
            group_ids=group_ids
        )

    return serialize_review_items(
        questions,
        scheduler_tuning=scheduler_tuning,
        scheduled_review=True,
        timeline_anchors=_timeline_anchors_for(db, questions)
    )


def get_bonus_group_entries(db, group_ids=None):
    # Lightweight bonus menu: one entry per group / loose question that still has
    # new (unstarted) questions. Reads only the columns the menu needs (no ORM
    # objects, no scheduling math), so listing every available bonus stays cheap;
    # the heavy work (modes, contexts, projected intervals) is deferred to
    # get_bonus_group_items when a single entry is picked.
    new_ids = _new_question_ids(db, group_ids=group_ids)

    if not new_ids:
        return []

    rows = (
        db.query(
            Question.id,
            Question.question,
            Question.type_q,
            Question.tags,
            QuestionGroup.id.label("group_id"),
            QuestionGroup.name.label("group_name"),
            QuestionGroup.type_group.label("group_type")
        )
        .outerjoin(QuestionGroup, QuestionGroup.id == Question.group_id)
        .filter(Question.id.in_(new_ids))
        .order_by(Question.id)
        .all()
    )

    entries = []
    entry_by_key = {}

    def container_entry(key, type_q, name, tags):
        entry = entry_by_key.get(key)

        if entry is None:
            entry = {
                "key": key,
                "type_q": type_q,
                "name": name,
                "tags": list(tags or []),
                "item_count": 0,
                "is_container": True
            }
            entry_by_key[key] = entry
            entries.append(entry)

        return entry

    for row in rows:
        # Mirror the bucketing used by _serialize_review_items so the menu
        # entries line up with what a picked entry will actually render.
        if row.group_id is not None and row.group_type in (
            "map",
            "media",
            "text",
            "sequence"
        ):
            entry = container_entry(
                f"group:{row.group_id}",
                row.group_type,
                row.group_name,
                row.tags
            )
            entry["item_count"] += 1
            continue

        entries.append({
            "key": f"q:{row.id}",
            "type_q": row.type_q,
            "name": row.question,
            "tags": row.tags or [],
            "item_count": 1,
            "is_container": False
        })

    return entries


def _sample_bonus_questions(questions, limit):
    # A picked bonus entry can be capped to a chosen count, drawn at random from
    # the entry's available (new) questions so repeat visits vary. limit=None — or
    # a count at/above the pool size — keeps every question; a non-positive count
    # yields nothing.
    if limit is None:
        return questions

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        return questions

    if limit <= 0:
        return []

    if limit >= len(questions):
        return questions

    return random.sample(list(questions), limit)


def get_bonus_group_items(db, key, limit=None):
    # Full serialization for a single picked bonus entry. Reuses the shared
    # review serializer so modes/contexts/projected intervals stay identical to
    # a scheduled session, just scoped to one group / question. `limit` caps the
    # entry to a randomly drawn subset of its available questions.
    if not key:
        return []

    try:
        if key.startswith("group:"):
            questions = _new_questions(db, group_ids=[int(key[len("group:"):])])
        elif key.startswith("q:"):
            questions = _questions_by_ids(db, [int(key[len("q:"):])])
        else:
            return []
    except ValueError:
        return []

    questions = _sample_bonus_questions(questions, limit)

    scheduler_tuning = load_scheduler_tuning_settings(db)

    return serialize_review_items(
        questions,
        scheduler_tuning=scheduler_tuning,
        scheduled_review=True,
        timeline_anchors=_timeline_anchors_for(db, questions)
    )
