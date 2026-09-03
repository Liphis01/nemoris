from datetime import date
import random

from fastapi import HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import joinedload

from ..models import Progress, Question, QuestionGroup
from ..serializers import (
    serialize_map_review_group,
    serialize_map_review_zone,
    serialize_media_review_group,
    serialize_media_review_item,
    serialize_review_question_item,
    serialize_sequence_review_group,
    serialize_sequence_review_item,
    serialize_text_review_group,
    serialize_text_review_item,
    serialize_cloze_review_group
)
from .timeline import (
    build_mastered_timeline_anchors,
    date_center_value,
    serialize_timeline_review_group,
    serialize_timeline_review_item,
    validate_timeline_data
)
from .image_modes import (
    IMAGE_MODES,
    IMAGE_MULTIPLE_CHOICE_MODES,
    canonical_image_mode,
    choose_image_review_mode,
    image_mode_difficulty
)
from .map_modes import (
    MAP_MODE_MULTIPLE_CHOICE,
    MAP_MODES,
    choose_map_review_mode,
    map_mode_difficulty
)
from .text_modes import (
    TEXT_MODE_MATCH,
    TEXT_MODES,
    choose_text_review_mode,
    text_mode_difficulty
)
from .cloze import cloze_is_buried
from .cloze_modes import DEFAULT_CLOZE_MODE, cloze_mode_difficulty
from .grid_modes import GRID_MODE_FILL_CELL, GRID_MODE_FILL_ROW
from .grid import grid_presentation
from .set_groups import set_presentation
from .set_modes import SET_MODE_COLLECT_MEMBERS
from .sequence import dense_positions
from .sequence_rail import (
    build_rail,
    build_recitation_presentations,
    rail_window_for,
    sequence_decoy_count
)
from .sequence_modes import (
    SEQUENCE_MODE_MULTIPLE_CHOICE,
    SEQUENCE_MODES,
    SEQUENCE_MODE_RECITE,
    SEQUENCE_MODE_REORDER,
    choose_sequence_review_mode,
    normalize_sequence_mode,
    sequence_review_goal,
    sequence_mode_difficulty
)
from .mode_selection import (
    MODE_AFFINITIES,
    has_recall_proof_since_latest_miss,
    latest_relearning_history_mode,
    question_mode_affinity
)
from .media import media_kind_from_name
from .map_eligibility import (
    question_has_training_content,
    question_is_reviewable,
    reviewable_question_filter
)
from .intake import compute_intake_quota
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


def _affinity_chunks(items, max_size, force=False):
    items = list(items or [])

    if len(items) <= max_size and not force:
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


def _review_chunk(
    questions,
    *,
    forced_mode=None,
    recall_only=False,
    support_only=False
):
    return {
        "questions": _shuffled(questions),
        "forced_mode": forced_mode,
        "recall_only": recall_only,
        "support_only": support_only
    }


def _review_chunks_for_bucket(
    questions,
    *,
    forced_mode=None,
    recall_only=False,
    support_only=False
):
    return [
        _review_chunk(
            chunk,
            forced_mode=forced_mode,
            recall_only=recall_only,
            support_only=support_only
        )
        for chunk in _balanced_chunks(questions, REVIEW_GROUP_MAX_CHUNK_SIZE)
        if chunk
    ]


def _relearning_failed_mode(
    question,
    history_key,
    valid_modes,
    today,
    mode_normalizer=None
):
    if not history_key or not valid_modes:
        return None

    key, mode = latest_relearning_history_mode(
        getattr(question, "progress", None),
        today=today
    )

    if key != history_key or not mode:
        return None

    if mode_normalizer:
        normalized = mode_normalizer(mode)
    else:
        value = str(mode or "").strip()
        normalized = value if value in valid_modes else None

    return normalized if normalized in valid_modes else None


def _group_review_chunks(
    items,
    scheduled_review,
    *,
    today=None,
    history_key=None,
    valid_modes=None,
    mode_normalizer=None
):
    items = list(items or [])

    if not scheduled_review:
        return [_review_chunk(items)]

    today = today or date.today()
    relearning_buckets = {}
    new_items = []
    recall_proven_items = []
    adaptive_items = []

    for item in items:
        failed_mode = _relearning_failed_mode(
            item,
            history_key,
            valid_modes,
            today,
            mode_normalizer,
        )

        if failed_mode:
            relearning_buckets.setdefault(failed_mode, []).append(item)
        elif progress_is_new(getattr(item, "progress", None)):
            new_items.append(item)
        elif has_recall_proof_since_latest_miss(
            getattr(item, "progress", None)
        ):
            recall_proven_items.append(item)
        else:
            adaptive_items.append(item)

    chunks = []

    for mode, bucket in relearning_buckets.items():
        chunks.extend(_review_chunks_for_bucket(bucket, forced_mode=mode))

    chunks.extend(_review_chunks_for_bucket(new_items, support_only=True))

    force_affinity_split = len(items) > REVIEW_GROUP_MAX_CHUNK_SIZE

    for chunk in _affinity_chunks(
        adaptive_items,
        REVIEW_GROUP_MAX_CHUNK_SIZE,
        force=force_affinity_split
    ):
        if chunk:
            chunks.append(_review_chunk(chunk))

    chunks.extend(_review_chunks_for_bucket(recall_proven_items, recall_only=True))

    return chunks


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
    # progress rows are legacy/new rows; they reach a session through the
    # automatic intake path instead (see services/intake.py).
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
        if progress_has_started(question.progress) and not cloze_is_buried(question, today)
    ]


def _question_is_due(question, today):
    progress = question.progress

    return (
        question_is_reviewable(question) and
        progress_has_started(progress) and
        not cloze_is_buried(question, today) and
        (
            progress.next_review is None or
            progress.next_review <= today
        )
    )


def _progress_row_has_started(row):
    return (
        (row.reps or 0) > 0 or
        bool(row.last_review) or
        len(row.history or []) > 0
    )



def _new_question_ids(db, limit=None):
    # One global pool: manual intake ordering comes first, then the historical
    # creation-order fallback for questions that have never been arranged.
    ids = []
    rows = (
        db.query(
            Question.id,
            Question.type_q,
            Question.data,
            Progress.reps,
            Progress.last_review,
            Progress.history
        )
        .outerjoin(Progress, Question.id == Progress.question_id)
        .filter(reviewable_question_filter())
        .order_by(
            case((Question.intake_order == None, 1), else_=0),
            Question.intake_order,
            Question.id
        )
        .all()
    )

    for row in rows:
        if _progress_row_has_started(row) or cloze_is_buried(row, date.today()):
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


def _new_questions(db, limit=None):
    return _questions_by_ids(db, _new_question_ids(db, limit=limit))


def _due_question_count(db, today):
    rows = (
        db.query(
            Progress.question_id,
            Question.type_q,
            Question.data,
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

    return sum(
        1 for row in rows
        if _progress_row_has_started(row) and not cloze_is_buried(row, today)
    )



def get_review_summary(db, today=None):
    today = today or date.today()
    due_count = _due_question_count(db, today)
    # The menu tile counts the whole session, not just the backlog: without the
    # intake quota it would announce "Session terminée" while new questions are
    # queued to be introduced. The quota is only an allowance, so it is capped
    # by what the pool actually holds — otherwise the tile would promise more
    # questions than exist.
    quota = compute_intake_quota(
        db,
        today=today,
        due_count=due_count
    )["quota"]
    new_count = len(_new_question_ids(db, limit=quota)) if quota else 0

    return {
        "due_count": due_count,
        "has_due": due_count > 0,
        "new_count": new_count,
        "session_count": due_count + new_count
    }


def _serialize_review_items(
    questions,
    scheduler_tuning=None,
    scheduled_review=False,
    timeline_anchors=None,
    forced_sequence_mode=None,
    today=None
):
    review_items = []
    map_grouped_items = {}
    media_grouped_items = {}
    text_grouped_items = {}
    cloze_grouped_items = {}
    grid_grouped_items = {}
    set_grouped_items = {}
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

        if question.group and question.group.type_group == "cloze":
            # One shown deletion reveals the authored context. Other due
            # siblings are deliberately omitted and will be buried on answer.
            group_id = question.group.id
            cloze_grouped_items.setdefault(group_id, question)
            continue

        if question.group and question.group.type_group == "grid":
            grid_grouped_items.setdefault(question.group.id, {"group": question.group, "questions": []})["questions"].append(question)
            continue

        if question.group and question.group.type_group == "set":
            set_grouped_items.setdefault(question.group.id, {"group": question.group, "questions": []})["questions"].append(question)
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
                and question_has_training_content(item)
            ],
            key=lambda item: item.id
        )
        question_chunks = _group_review_chunks(
            due_questions,
            scheduled_review,
            today=today,
            history_key="map_mode",
            valid_modes=MAP_MODES
        )

        for chunk in question_chunks:
            chunk_questions = chunk["questions"]
            active_context_questions, choice_context_questions = (
                _visual_review_contexts(
                    chunk_questions,
                    all_group_questions,
                    scheduled_review
                )
            )
            mode = (
                chunk["forced_mode"] or choose_map_review_mode(
                    chunk_questions,
                    active_context_questions,
                    multiple_choice_context_count=len(choice_context_questions),
                    recall_only=chunk["recall_only"],
                    support_only=chunk["support_only"]
                )
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
        question_chunks = _group_review_chunks(
            due_questions,
            scheduled_review,
            today=today,
            history_key="image_mode",
            valid_modes=IMAGE_MODES,
            mode_normalizer=canonical_image_mode
        )
        previous_mode = None

        for chunk in question_chunks:
            chunk_questions = chunk["questions"]
            active_context_questions, choice_context_questions = (
                _visual_review_contexts(
                    chunk_questions,
                    all_group_questions,
                    scheduled_review
                )
            )
            mode = (
                chunk["forced_mode"] or choose_image_review_mode(
                    chunk_questions,
                    active_context_questions,
                    multiple_choice_context_count=len(choice_context_questions),
                    discouraged_modes=(
                        [previous_mode]
                        if scheduled_review and previous_mode
                        else None
                    ),
                    audio_only=audio_only,
                    recall_only=chunk["recall_only"],
                    support_only=chunk["support_only"]
                )
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
        question_chunks = _group_review_chunks(
            due_questions,
            scheduled_review,
            today=today,
            history_key="text_mode",
            valid_modes=TEXT_MODES
        )

        for chunk in question_chunks:
            chunk_questions = chunk["questions"]
            active_context_questions, choice_context_questions = (
                _visual_review_contexts(
                    chunk_questions,
                    all_group_questions,
                    scheduled_review
                )
            )
            mode = (
                chunk["forced_mode"] or choose_text_review_mode(
                    chunk_questions,
                    active_context_questions,
                    multiple_choice_context_count=len(choice_context_questions),
                    recall_only=chunk["recall_only"],
                    support_only=chunk["support_only"]
                )
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
        review_goal = sequence_review_goal(group)

        # Every visibility decision now lives in build_rail. It must exclude
        # EVERY due item of the group, not just this chunk's: the other chunk's
        # still-due items are answers the learner still owes.
        due_ids = {item.id for item in due_questions}
        window = rail_window_for(len(all_group_questions))

        question_chunks = _group_review_chunks(
            due_questions,
            scheduled_review,
            today=today,
            history_key="sequence_mode",
            valid_modes=SEQUENCE_MODES
        )

        for chunk in question_chunks:
            chunk_questions = chunk["questions"]
            active_context_questions, choice_context_questions = (
                _visual_review_contexts(
                    chunk_questions,
                    all_group_questions,
                    scheduled_review
                )
            )
            mode = (
                normalize_sequence_mode(forced_sequence_mode)
                if forced_sequence_mode is not None
                else chunk["forced_mode"] or choose_sequence_review_mode(
                    chunk_questions,
                    active_context_questions,
                    multiple_choice_context_count=len(choice_context_questions),
                    review_goal=review_goal,
                    recall_only=chunk["recall_only"],
                    support_only=chunk["support_only"]
                )
            )

            if mode == SEQUENCE_MODE_MULTIPLE_CHOICE:
                # Distractors are drawn from the peers on screen.
                context_questions = choice_context_questions
            elif mode == SEQUENCE_MODE_REORDER:
                context_questions = chunk_questions
            else:
                context_questions = active_context_questions

            # Built per chunk, not per group: which slots are blank depends on
            # what this chunk is asking. The decoy/anchor pool still keys off
            # the group-wide due_ids so a later chunk's answers stay off screen.
            rail = build_rail(
                all_group_questions,
                positions,
                due_ids,
                chunk_due_ids={item.id for item in chunk_questions},
                decoy_count=sequence_decoy_count(mode, chunk_questions),
                window=window
            )

            if mode == SEQUENCE_MODE_RECITE:
                questions_by_id = {
                    question.id: question
                    for question in all_group_questions
                }

                for recitation in build_recitation_presentations(rail):
                    target_ids = [
                        target["question_id"]
                        for target in recitation["targets"]
                    ]
                    scheduled_ids = set(recitation["scheduled_ids"])
                    segment_questions = [
                        question
                        for question in chunk_questions
                        if question.id in scheduled_ids
                    ]

                    if not segment_questions:
                        continue

                    mode_difficulty = sequence_mode_difficulty(
                        mode,
                        context_count=len(target_ids),
                        tuning=scheduler_tuning
                    )
                    context_items = [
                        serialize_sequence_review_item(
                            questions_by_id[question_id],
                            position=positions[question_id],
                            mode_difficulty=mode_difficulty,
                            scheduler_tuning=scheduler_tuning
                        )
                        for question_id in target_ids
                    ]
                    sequence_group = serialize_sequence_review_group(
                        group,
                        group_data["tags"],
                        mode=mode,
                        context_items=context_items,
                        rail=[],
                        length=len(all_group_questions),
                        recitation=recitation
                    )
                    sequence_group["items"] = [
                        serialize_sequence_review_item(
                            item,
                            position=positions[item.id],
                            mode_difficulty=mode_difficulty,
                            scheduler_tuning=scheduler_tuning
                        )
                        for item in segment_questions
                    ]
                    sequence_review_groups.append(sequence_group)

                continue

            # Priced from the rail for the modes the rail defines, so the
            # difficulty describes what was actually on screen rather than a
            # count the client asserted.
            mode_difficulty = sequence_mode_difficulty(
                mode,
                context_count=len(context_questions),
                rail=rail,
                tuning=scheduler_tuning
            )
            context_items = [
                serialize_sequence_review_item(
                    item,
                    position=positions[item.id],
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
                rail=rail,
                length=len(all_group_questions)
            )
            sequence_group["items"] = [
                serialize_sequence_review_item(
                    item,
                    position=positions[item.id],
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in chunk_questions
            ]
            sequence_review_groups.append(sequence_group)

    cloze_review_groups = [
        serialize_cloze_review_group(
            question.group,
            question,
            mode=DEFAULT_CLOZE_MODE,
            mode_difficulty=cloze_mode_difficulty(DEFAULT_CLOZE_MODE),
            scheduler_tuning=scheduler_tuning,
        )
        for _group_id, question in sorted(cloze_grouped_items.items())
    ]

    grid_review_groups = []
    for group_data in grid_grouped_items.values():
        by_row = {}
        for question in group_data["questions"]:
            row_key = ((question.data or {}).get("grid") or {}).get("row_key")
            by_row.setdefault(row_key, []).append(question)
        consumed_ids = set()
        for row_questions in by_row.values():
            if len(row_questions) >= 2:
                grid_review_groups.append(grid_presentation(group_data["group"], row_questions, GRID_MODE_FILL_ROW))
                consumed_ids.update(item.id for item in row_questions)
        for question in group_data["questions"]:
            if question.id not in consumed_ids:
                grid_review_groups.append(grid_presentation(group_data["group"], [question], GRID_MODE_FILL_CELL))

    set_review_groups = [
        set_presentation(group_data["group"], group_data["questions"], SET_MODE_COLLECT_MEMBERS)
        for group_data in set_grouped_items.values()
    ]

    return (
        review_items
        + map_review_groups
        + media_review_groups
        + text_review_groups
        + cloze_review_groups
        + grid_review_groups
        + set_review_groups
        + sequence_review_groups
    )


def serialize_review_items(
    questions,
    scheduler_tuning=None,
    scheduled_review=False,
    timeline_anchors=None,
    forced_sequence_mode=None,
    today=None
):
    return _serialize_review_items(
        questions,
        scheduler_tuning=scheduler_tuning,
        scheduled_review=scheduled_review,
        timeline_anchors=timeline_anchors,
        forced_sequence_mode=forced_sequence_mode,
        today=today
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


def spread_new_items(review_items, new_question_ids):
    """Interleave freshly introduced questions through the session.

    _unique_sorted_questions orders by id, which parks new (high-id) questions
    at the tail and makes them read as a separate phase. Placing them at evenly
    spaced positions instead keeps the session one continuous flow. Purely
    positional and deterministic: no shuffling, so sessions stay reproducible.
    """
    new_question_ids = set(new_question_ids or [])

    if not new_question_ids:
        return review_items

    fresh = []
    existing = []

    for item in review_items:
        ids = _item_question_ids(item)
        (fresh if ids & new_question_ids else existing).append(item)

    if not fresh or not existing:
        return review_items

    spread = list(existing)

    for index, item in enumerate(fresh):
        position = round(
            (index + 1) * (len(existing) + 1) / (len(fresh) + 1)
        ) + index
        spread.insert(min(position, len(spread)), item)

    return spread


def _item_question_ids(item):
    if not isinstance(item, dict):
        return set()

    ids = set()

    if item.get("question_id") is not None:
        ids.add(item["question_id"])

    for entry in item.get("items") or []:
        if isinstance(entry, dict) and entry.get("question_id") is not None:
            ids.add(entry["question_id"])

    return ids


def _item_is_relearning(item):
    if not isinstance(item, dict):
        return False

    if (item.get("progress") or {}).get("relearning"):
        return True

    return any(
        isinstance(entry, dict) and (entry.get("progress") or {}).get("relearning")
        for entry in item.get("items") or []
    )


def defer_relearning_items(review_items):
    """Push same-day relearning retries to the end of the session.

    Mid-session, a retry is appended live to the tail of the queue (see
    isRelearningQuestion() / useReviewSession.js). A resumed session re-fetches
    from here instead, so without this it would fall back to whatever
    Question.id happened to sort first, surfacing relearning retries before
    unrelated due cards. Stable sort: order is otherwise unchanged.
    """
    return sorted(review_items, key=_item_is_relearning)


def get_review_items(db, today=None, intake_quota=None):
    today = today or date.today()
    scheduler_tuning = load_scheduler_tuning_settings(db)
    due_questions = _due_questions(db, today)

    if intake_quota is None:
        intake_quota = compute_intake_quota(db, today=today)

    quota = max(0, intake_quota.get("quota", 0))
    new_questions = _new_questions(db, limit=quota) if quota else []
    questions = _unique_sorted_questions(due_questions, new_questions)

    # One serialization pass, not two: a group holding both a due zone and a
    # new one has to render as a single card, and its distractor contexts are
    # computed from the whole group.
    items = serialize_review_items(
        questions,
        scheduler_tuning=scheduler_tuning,
        scheduled_review=True,
        timeline_anchors=_timeline_anchors_for(db, questions),
        today=today
    )

    return defer_relearning_items(spread_new_items(
        items,
        {question.id for question in new_questions}
    ))


def get_scoped_review_items(
    db,
    scope_type,
    *,
    group_id=None,
    collection_id=None,
    tag=None,
    pack_guid=None,
    today=None
):
    today = today or date.today()
    scheduler_tuning = load_scheduler_tuning_settings(db)
    # Local import avoids a module cycle: study_summary imports training, and
    # training imports serialize_review_items from this module.
    from .study_summary import resolve_study_scope

    resolved = resolve_study_scope(
        db,
        scope_type,
        group_id=group_id,
        collection_id=collection_id,
        tag=tag,
        pack_guid=pack_guid
    )
    due_question_ids = [
        question.id
        for question in resolved["questions"]
        if _question_is_due(question, today)
    ]
    questions = _questions_by_ids(db, due_question_ids)
    items = serialize_review_items(
        questions,
        scheduler_tuning=scheduler_tuning,
        scheduled_review=True,
        timeline_anchors=_timeline_anchors_for(db, questions),
        today=today
    )

    return defer_relearning_items(items)
