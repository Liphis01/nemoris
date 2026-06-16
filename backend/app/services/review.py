from copy import deepcopy
from datetime import date, timedelta
from types import SimpleNamespace

from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload

from ..scheduler import (
    assign_smoothed_schedules,
    apply_favorite_review_frequency,
    candidate_review_dates,
    new_fsrs_card_data,
    update_progress
)
from ..models import Progress, Question, QuestionGroup
from ..serializers import (
    serialize_image_review_group,
    serialize_image_review_item,
    serialize_map_review_group,
    serialize_map_review_zone,
    serialize_review_question_item
)
from .timeline import (
    serialize_timeline_review_group,
    serialize_timeline_review_item
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
from .mode_selection import (
    MODE_AFFINITIES,
    MULTIPLE_CHOICE_MIN_CONTEXT,
    question_mode_affinity
)
from .progress import progress_has_started, progress_is_new
from .settings import get_review_settings, load_scheduler_tuning_settings


REVIEW_GROUP_MAX_CHUNK_SIZE = 30
REVIEW_IMAGE_MAX_CHUNK_SIZE = REVIEW_GROUP_MAX_CHUNK_SIZE
BONUS_REVIEW_FORECAST_DAYS = 14
BONUS_REVIEW_LOW_RATIO = 0.5
BONUS_REVIEW_FULL_RATIO = 0.9
BONUS_FORECAST_QUALITY = 2


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
        return [items]

    return _affinity_chunks(items, REVIEW_GROUP_MAX_CHUNK_SIZE)


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

    if (
        not scheduled_review or
        len(chunk_questions) >= MULTIPLE_CHOICE_MIN_CONTEXT
    ):
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

    total_questions = db.query(func.count(Question.id)).scalar() or 0
    started_rows = started_rows if started_rows is not None else (
        _started_progress_rows(db)
    )
    started_count = sum(
        1
        for row in started_rows
        if _progress_row_has_started(row)
    )

    return max(0, total_questions - started_count)


def _forecast_progress_snapshot(row):
    return SimpleNamespace(
        question_id=row.question_id,
        stability=row.stability or 1.0,
        difficulty=row.difficulty or 5.0,
        reps=row.reps or 0,
        lapses=row.lapses or 0,
        interval=row.interval or 0,
        ideal_interval=row.ideal_interval,
        last_review=row.last_review,
        next_review=row.next_review,
        ideal_next_review=row.ideal_next_review,
        fsrs_card=deepcopy(row.fsrs_card),
        fsrs_version=row.fsrs_version,
        history=deepcopy(row.history or []),
        type_q=row.type_q,
        favorite=bool((row.question_data or {}).get("favorite"))
    )


def _new_bonus_progress_snapshot(today):
    return SimpleNamespace(
        question_id=0,
        stability=1.0,
        difficulty=5.0,
        reps=0,
        lapses=0,
        interval=0,
        ideal_interval=None,
        last_review=None,
        next_review=today,
        ideal_next_review=None,
        fsrs_card=new_fsrs_card_data(0, due=today),
        fsrs_version=None,
        history=[],
        type_q="text",
        favorite=False
    )


def _write_forecast_scheduling(progress, scheduling):
    ideal_interval = scheduling.get("ideal_interval", scheduling["interval"])
    ideal_next_review = scheduling.get(
        "ideal_next_review",
        scheduling["next_review"]
    )

    progress.stability = scheduling["stability"]
    progress.difficulty = scheduling["difficulty"]
    progress.reps = scheduling["reps"]
    progress.lapses = scheduling["lapses"]
    progress.interval = scheduling["interval"]
    progress.ideal_interval = ideal_interval
    progress.last_review = scheduling["last_review"]
    progress.next_review = scheduling["next_review"]
    progress.ideal_next_review = ideal_next_review
    progress.fsrs_card = scheduling.get("fsrs_card")
    progress.fsrs_version = scheduling.get("fsrs_version")


def _load_day(progress, today):
    next_review = progress.next_review or today

    return today if next_review < today else next_review


def _bucket_forecast_cards(progresses, today):
    buckets = {}

    for progress in progresses:
        buckets.setdefault(_load_day(progress, today), []).append(progress)

    return buckets


def _loads_for_candidate_dates(buckets, candidate_dates):
    daily_loads = {}
    daily_type_loads = {}

    for day in candidate_dates:
        cards = buckets.get(day, [])

        if not cards:
            continue

        daily_loads[day] = len(cards)
        type_counts = daily_type_loads.setdefault(day, {})

        for card in cards:
            type_key = card.type_q or "unknown"
            type_counts[type_key] = type_counts.get(type_key, 0) + 1

    return daily_loads, daily_type_loads


def _forecast_review_load(progresses, today, forecast_days, daily_target):
    end_day = today + timedelta(days=forecast_days - 1)
    buckets = _bucket_forecast_cards(progresses, today)
    daily_counts = {
        today + timedelta(days=offset): 0
        for offset in range(forecast_days)
    }
    static_scheduled_total = sum(
        1
        for progress in progresses
        if today <= _load_day(progress, today) <= end_day
    )

    for offset in range(forecast_days):
        day = today + timedelta(days=offset)
        due_cards = buckets.pop(day, [])
        daily_counts[day] = len(due_cards)

        if not due_cards:
            continue

        schedulings = []

        for progress in due_cards:
            scheduling = update_progress(
                progress,
                BONUS_FORECAST_QUALITY,
                today=day,
                enable_fuzzing=False
            )
            scheduling["type_q"] = progress.type_q
            scheduling = apply_favorite_review_frequency(
                scheduling,
                favorite=progress.favorite
            )
            scheduling["ideal_interval"] = scheduling["interval"]
            scheduling["ideal_next_review"] = scheduling["next_review"]
            schedulings.append(scheduling)

        candidate_dates = set()

        for scheduling in schedulings:
            candidate_dates.update(
                candidate_review_dates(
                    scheduling["last_review"],
                    scheduling["next_review"],
                    scheduling["interval"]
                )
            )

        daily_loads, daily_type_loads = _loads_for_candidate_dates(
            buckets,
            candidate_dates
        )
        smoothed_schedules = assign_smoothed_schedules(
            schedulings,
            daily_loads,
            daily_type_loads=daily_type_loads,
            daily_target=daily_target
        )

        for progress, scheduling in zip(due_cards, smoothed_schedules):
            _write_forecast_scheduling(progress, scheduling)

            if progress.next_review and progress.next_review > day:
                buckets.setdefault(progress.next_review, []).append(progress)

    total = sum(daily_counts.values())

    return {
        "window_days": forecast_days,
        "forecast_days": forecast_days,
        "scheduled_total": total,
        "scheduled_average": round(total / forecast_days, 1),
        "forecast_total": total,
        "forecast_average": round(total / forecast_days, 1),
        "static_scheduled_total": static_scheduled_total,
        "daily_counts": [
            {
                "date": day.isoformat(),
                "total": daily_counts[day]
            }
            for day in sorted(daily_counts)
        ]
    }


def _estimated_bonus_card_cost(today, forecast_days, daily_target):
    progress = _new_bonus_progress_snapshot(today)
    scheduling = update_progress(
        progress,
        BONUS_FORECAST_QUALITY,
        today=today,
        enable_fuzzing=False
    )
    scheduling["type_q"] = progress.type_q
    scheduling = apply_favorite_review_frequency(
        scheduling,
        favorite=False
    )
    scheduling["ideal_interval"] = scheduling["interval"]
    scheduling["ideal_next_review"] = scheduling["next_review"]
    _write_forecast_scheduling(progress, scheduling)

    if not progress.next_review or progress.next_review <= today:
        return 1

    forecast = _forecast_review_load(
        [progress],
        today,
        forecast_days,
        daily_target
    )

    return max(1, forecast["forecast_total"])


def get_bonus_review_status(db, today=None, group_ids=None):
    today = today or date.today()
    scoped_group_ids = _normalized_group_ids(group_ids)
    same_group_filter_applied = scoped_group_ids is not None
    settings = get_review_settings(db)
    daily_target = settings["catchup_daily_target"]
    due_count = _due_question_count(db, today)
    started_rows = _started_progress_rows(db)
    new_count = _new_question_count(db, started_rows=started_rows)
    same_group_new_count = (
        _new_question_count(db, group_ids=scoped_group_ids)
        if same_group_filter_applied
        else new_count
    )
    started_progresses = [
        _forecast_progress_snapshot(row)
        for row in started_rows
        if _progress_row_has_started(row)
    ]
    load = _forecast_review_load(
        started_progresses,
        today,
        BONUS_REVIEW_FORECAST_DAYS,
        daily_target
    )
    estimated_bonus_card_cost = _estimated_bonus_card_cost(
        today,
        BONUS_REVIEW_FORECAST_DAYS,
        daily_target
    )
    window_capacity = daily_target * BONUS_REVIEW_FORECAST_DAYS
    low_threshold = max(1, int(window_capacity * BONUS_REVIEW_LOW_RATIO))
    full_threshold = max(1, int(window_capacity * BONUS_REVIEW_FULL_RATIO))
    remaining_forecast_event_capacity = max(
        0,
        full_threshold - load["forecast_total"]
    )
    bonus_question_capacity = (
        remaining_forecast_event_capacity // estimated_bonus_card_cost
    )
    available_bonus_question_count = min(
        same_group_new_count,
        bonus_question_capacity
    )
    schedule_is_low = load["forecast_total"] < low_threshold
    status = {
        **load,
        "daily_target": daily_target,
        "new_count": new_count,
        "same_group_new_count": same_group_new_count,
        "available_bonus_question_count": available_bonus_question_count,
        "same_group_bonus_question_count": available_bonus_question_count,
        "same_group_filter_applied": same_group_filter_applied,
        "same_group_ids": scoped_group_ids or [],
        "due_count": due_count,
        "low_threshold": low_threshold,
        "full_threshold": full_threshold,
        "schedule_is_low": schedule_is_low,
        "forecast_fill_ratio": round(load["forecast_total"] / window_capacity, 3),
        "estimated_bonus_card_cost": estimated_bonus_card_cost,
        "bonus_question_capacity": bonus_question_capacity
    }

    if due_count > 0:
        return {
            **status,
            "state": "due_first",
            "allowed": False,
            "message": "Termine d'abord les questions dues avant d'ajouter des bonus."
        }

    if same_group_new_count == 0:
        if schedule_is_low:
            create_action = "Crée de nouvelles questions"

            if same_group_filter_applied:
                create_scope = (
                    "dans le même groupe"
                    if len(scoped_group_ids) == 1
                    else "dans les mêmes groupes"
                )
                create_action = f"{create_action} {create_scope}"

            return {
                **status,
                "state": "no_new",
                "allowed": False,
                "message": (
                    "Le planning prévu est léger "
                    f"({load['scheduled_average']}/jour sur "
                    f"{BONUS_REVIEW_FORECAST_DAYS} jours, cible "
                    f"{daily_target}/jour). {create_action} pour alimenter "
                    "les prochaines révisions."
                )
            }

        message = (
            "Aucune question bonus du même groupe disponible."
            if same_group_filter_applied
            else "Aucune nouvelle question disponible."
        )

        return {
            **status,
            "state": "no_new",
            "allowed": False,
            "message": message
        }

    if (
        load["forecast_total"] >= full_threshold or
        bonus_question_capacity < 1
    ):
        return {
            **status,
            "state": "full",
            "allowed": False,
            "message": (
                "Le planning prévu est déjà rempli "
                f"({load['scheduled_average']}/jour sur "
                f"{BONUS_REVIEW_FORECAST_DAYS} jours, cible "
                f"{daily_target}/jour). Augmente la cible quotidienne dans "
                "les réglages pour débloquer les bonus."
            )
        }

    if schedule_is_low:
        return {
            **status,
            "state": "low",
            "allowed": True,
            "message": (
                "Le planning prévu est léger "
                f"({load['scheduled_average']}/jour sur "
                f"{BONUS_REVIEW_FORECAST_DAYS} jours, cible "
                f"{daily_target}/jour). Ajoute quelques questions bonus pour "
                "alimenter les prochaines révisions."
            )
        }

    return {
        **status,
        "state": "available",
        "allowed": True,
        "message": "Tu peux ajouter quelques questions bonus au planning."
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
    scheduled_review=False
):
    review_items = []
    map_grouped_items = {}
    image_grouped_items = {}
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

        if question.group and question.group.type_group == "image":
            group_id = question.group.id

            if group_id not in image_grouped_items:
                image_grouped_items[group_id] = {
                    "group": question.group,
                    "tags": question.tags or [],
                    "questions": []
                }

            image_grouped_items[group_id]["questions"].append(question)
            continue

        if question.type_q == "timeline":
            # Timeline questions stay atomic in storage/manage/calendar, but
            # review presents every due item in one combined timeline screen.
            timeline_items.append(serialize_timeline_review_item(question))
            continue

        review_items.append(serialize_review_question_item(question))

    # Mixed sessions can contain normal questions and runtime map groups.
    if timeline_items:
        review_items.append(serialize_timeline_review_group(timeline_items))

    map_review_groups = []

    for group_data in map_grouped_items.values():
        group = group_data["group"]
        due_questions = sorted(group_data["questions"], key=lambda item: item.id)
        all_group_questions = sorted(
            [
                item
                for item in (group.questions or [])
                if item.type_q == "map"
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
                for item in context_questions
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

    image_review_groups = []

    for group_data in image_grouped_items.values():
        group = group_data["group"]
        due_questions = sorted(group_data["questions"], key=lambda item: item.id)
        all_group_questions = sorted(
            [
                item
                for item in (group.questions or [])
                if item.type_q == "image"
            ],
            key=lambda item: item.id
        )
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
                require_click_prompt_min=scheduled_review,
                discouraged_modes=(
                    [previous_mode]
                    if scheduled_review and previous_mode
                    else None
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
                serialize_image_review_item(
                    item,
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in context_questions
            ]
            image_group = serialize_image_review_group(
                group,
                group_data["tags"],
                mode=mode,
                context_items=context_items
            )
            image_group["items"] = [
                serialize_image_review_item(
                    item,
                    mode_difficulty=mode_difficulty,
                    scheduler_tuning=scheduler_tuning
                )
                for item in chunk_questions
            ]
            image_review_groups.append(image_group)
            previous_mode = mode

    return review_items + map_review_groups + image_review_groups


def serialize_review_items(
    questions,
    scheduler_tuning=None,
    scheduled_review=False
):
    return _serialize_review_items(
        questions,
        scheduler_tuning=scheduler_tuning,
        scheduled_review=scheduled_review
    )


def get_review_items(db, include_new=False, bonus_status=None, group_ids=None):
    today = date.today()
    scheduler_tuning = load_scheduler_tuning_settings(db)
    due_questions = _due_questions(db, today)

    if due_questions or not include_new:
        return serialize_review_items(
            due_questions,
            scheduler_tuning=scheduler_tuning,
            scheduled_review=True
        )

    bonus_status = bonus_status or get_bonus_review_status(
        db,
        today=today,
        group_ids=group_ids
    )
    remaining_bonus_slots = max(
        0,
        bonus_status.get(
            "available_bonus_question_count",
            bonus_status["bonus_question_capacity"]
        )
    )

    return serialize_review_items(
        _new_questions(
            db,
            limit=remaining_bonus_slots,
            group_ids=group_ids
        ),
        scheduler_tuning=scheduler_tuning,
        scheduled_review=True
    )
