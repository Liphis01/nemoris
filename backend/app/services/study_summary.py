from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import (
    Collection,
    PackSubscription,
    Question,
    QuestionGroup
)
from ..scheduler import parse_history_date
from .collections import resolve_collection_questions
from .map_eligibility import question_is_reviewable
from .media import media_kind_from_name
from .progress import progress_has_started, progress_is_new
from .tag_hierarchy import (
    descendants,
    ensure_stored_tag_ids,
    label_for_tag,
    load_tag_hierarchy,
    parent_map,
    resolve_tag_id
)
from .training import question_in_tag_subtree


RECENT_MISS_WINDOW_DAYS = 14
FRAGILE_MAX_STABILITY_DAYS = 7
STABLE_MIN_STABILITY_DAYS = 21
STABLE_MIN_REPS = 2
MASTERED_MIN_STABILITY_DAYS = 60
MASTERED_MIN_REPS = 3
DUE_SOON_DAYS = 7
LOW_SUCCESS_MIN_ATTEMPTS = 2
LOW_SUCCESS_MAX_RATE = 0.65

BUCKET_THRESHOLDS = {
    "recent_miss_days": RECENT_MISS_WINDOW_DAYS,
    "fragile_max_stability_days": FRAGILE_MAX_STABILITY_DAYS,
    "stable_min_stability_days": STABLE_MIN_STABILITY_DAYS,
    "stable_min_reps": STABLE_MIN_REPS,
    "mastered_min_stability_days": MASTERED_MIN_STABILITY_DAYS,
    "mastered_min_reps": MASTERED_MIN_REPS,
    "due_soon_days": DUE_SOON_DAYS,
    "low_success_min_attempts": LOW_SUCCESS_MIN_ATTEMPTS,
    "low_success_max_rate": LOW_SUCCESS_MAX_RATE
}


def _history_quality(entry):
    try:
        quality = int(entry.get("quality"))
    except (TypeError, ValueError, AttributeError):
        return None

    return quality if 0 <= quality <= 3 else None


def _history_date(entry):
    if not isinstance(entry, dict):
        return None

    return parse_history_date(entry.get("reviewed_on"))


def _recent_history_count(progress, today, quality):
    if not progress:
        return 0

    start = today - timedelta(days=RECENT_MISS_WINDOW_DAYS - 1)
    count = 0

    for entry in progress.history or []:
        reviewed_on = _history_date(entry)

        if not reviewed_on or reviewed_on < start or reviewed_on > today:
            continue

        if _history_quality(entry) == quality:
            count += 1

    return count


def recent_miss_count(progress, today=None):
    today = today or date.today()
    return _recent_history_count(progress, today, 0)


def classify_mastery_bucket(question, today=None):
    """Conservative learner-facing bucket for one atomic question.

    Buckets are derived from existing progress only. They do not own or update
    scheduling state.
    """
    today = today or date.today()

    if question is None:
        return "unavailable"

    if bool(getattr(question, "suspended", False)):
        return "suspended"

    if not question_is_reviewable(question):
        return "unavailable"

    progress = getattr(question, "progress", None)

    if progress_is_new(progress):
        return "unseen"

    reps = int((getattr(progress, "reps", None) or 0))
    stability = float((getattr(progress, "stability", None) or 0))

    if (
        recent_miss_count(progress, today) > 0 or
        stability < FRAGILE_MAX_STABILITY_DAYS
    ):
        return "fragile"

    if (
        stability >= MASTERED_MIN_STABILITY_DAYS and
        reps >= MASTERED_MIN_REPS
    ):
        return "mastered"

    if stability >= STABLE_MIN_STABILITY_DAYS and reps >= STABLE_MIN_REPS:
        return "stable"

    return "learning"


def _question_query(db):
    return (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .order_by(Question.id)
    )


def _questions_by_ids(db, question_ids):
    question_ids = list(dict.fromkeys(question_ids or []))

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


def _media_group_audio_only(questions):
    kinds = {
        media_kind_from_name(question.media)
        for question in questions
        if question.type_q == "media" and question.media
    }

    return bool(kinds) and kinds == {"audio"}


def _group_scope(db, group_id):
    if group_id is None:
        raise HTTPException(
            status_code=400,
            detail="group_id is required for group study summary"
        )

    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    questions = (
        _question_query(db)
        .filter(Question.group_id == group.id)
        .all()
    )
    audio_only = group.type_group == "media" and _media_group_audio_only(
        questions
    )

    return {
        "scope": {
            "type": "group",
            "id": group.id,
            "guid": group.guid,
            "name": group.name,
            "type_group": group.type_group,
            "media": group.media,
            "pack_guid": group.pack_guid,
            "question_count": len(questions),
            "audio_only": audio_only
        },
        "source": group,
        "questions": questions
    }


def _collection_scope(db, collection_id):
    if collection_id is None:
        raise HTTPException(
            status_code=400,
            detail="collection_id is required for collection study summary"
        )

    collection = (
        db.query(Collection)
        .options(joinedload(Collection.questions).joinedload(Question.group))
        .filter(Collection.id == collection_id)
        .first()
    )

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    questions = _questions_by_ids(
        db,
        [question.id for question in resolve_collection_questions(db, collection)]
    )

    return {
        "scope": {
            "type": "collection",
            "id": collection.id,
            "guid": collection.guid,
            "name": collection.name
        },
        "source": collection,
        "questions": questions
    }


def _tag_scope(db, tag):
    ensure_stored_tag_ids(db)
    hierarchy = load_tag_hierarchy(db)
    normalized_tag = resolve_tag_id(hierarchy, tag)

    if not normalized_tag:
        raise HTTPException(
            status_code=400,
            detail="tag is required for tag study summary"
        )

    tag_keys = descendants(normalized_tag, parent_map(hierarchy))
    questions = [
        question
        for question in _question_query(db).all()
        if question_in_tag_subtree(question, tag_keys)
    ]

    return {
        "scope": {
            "type": "tag",
            "id": normalized_tag,
            "key": normalized_tag,
            "name": label_for_tag(hierarchy, normalized_tag),
            "label": label_for_tag(hierarchy, normalized_tag),
            "descendant_tag_ids": sorted(tag_keys)
        },
        "source": None,
        "questions": questions
    }


def _pack_scope(db, pack_guid):
    clean_guid = str(pack_guid or "").strip()

    if not clean_guid:
        raise HTTPException(
            status_code=400,
            detail="pack_guid is required for pack study summary"
        )

    subscription = (
        db.query(PackSubscription)
        .filter(PackSubscription.pack_guid == clean_guid)
        .first()
    )

    if not subscription:
        raise HTTPException(status_code=404, detail="Pack not installed")

    questions = (
        _question_query(db)
        .filter(Question.pack_guid == clean_guid)
        .all()
    )

    return {
        "scope": {
            "type": "pack",
            "id": subscription.pack_guid,
            "pack_guid": subscription.pack_guid,
            "name": subscription.name,
            "installed_version": subscription.installed_version,
            "source": subscription.source,
            "subscribed_at": subscription.subscribed_at,
            "updated_at": subscription.updated_at
        },
        "source": subscription,
        "questions": questions
    }


def resolve_study_scope(
    db,
    scope_type,
    *,
    group_id=None,
    collection_id=None,
    tag=None,
    pack_guid=None
):
    scope_type = str(scope_type or "").strip()

    if scope_type == "group":
        return _group_scope(db, group_id)

    if scope_type == "collection":
        return _collection_scope(db, collection_id)

    if scope_type == "tag":
        return _tag_scope(db, tag)

    if scope_type == "pack":
        return _pack_scope(db, pack_guid)

    raise HTTPException(status_code=400, detail="Invalid study scope")


def _is_due(progress, today):
    if not progress_has_started(progress):
        return False

    next_review = progress.next_review if progress else None

    return next_review is None or next_review <= today


def _question_signals(question, today):
    progress = question.progress
    recent_misses = recent_miss_count(progress, today)
    recent_hard = _recent_history_count(progress, today, 1)

    return {
        "bucket": classify_mastery_bucket(question, today),
        "due": (
            question_is_reviewable(question) and
            not bool(question.suspended) and
            _is_due(progress, today)
        ),
        "recent_misses": recent_misses,
        "recent_hard": recent_hard,
        "lapses": int((progress.lapses if progress else 0) or 0),
        "reps": int((progress.reps if progress else 0) or 0),
        "stability": float((progress.stability if progress else 0) or 0),
        "last_review": (
            progress.last_review.isoformat()
            if progress and progress.last_review
            else None
        ),
        "next_review": (
            progress.next_review.isoformat()
            if progress and progress.next_review
            else None
        )
    }


def _coerce_question_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_question_ids(values):
    ids = []

    for value in values or []:
        coerced = _coerce_question_id(value)

        if coerced is not None:
            ids.append(coerced)

    return ids


def _event_selected_question_id(event, candidate_ids):
    selected_id = _coerce_question_id(event.get("resolved_response_id"))

    if selected_id is not None:
        return selected_id

    context = event.get("context")

    if isinstance(context, dict):
        for key in (
            "selected_candidate_id",
            "selected_question_id",
            "response_question_id"
        ):
            selected_id = _coerce_question_id(context.get(key))

            if selected_id is not None:
                return selected_id

    selected_id = _coerce_question_id(event.get("raw_response"))

    if selected_id is not None and selected_id in set(candidate_ids):
        return selected_id

    return None


def _confusion_counts_for_questions(questions, today):
    """Count recent mis-picks inside a scope.

    Only the totals survive: the pair details used to feed the Study screen's
    "Confusions" panel went away with that panel, and the distractor picker
    reads mis-picks straight off each question's own history instead.
    """
    start = today - timedelta(days=RECENT_MISS_WINDOW_DAYS - 1)
    pairs = set()
    event_count = 0

    for question in questions:
        progress = question.progress

        if not progress:
            continue

        for entry in progress.history or []:
            if not isinstance(entry, dict):
                continue

            reviewed_on = _history_date(entry)

            if not reviewed_on or reviewed_on < start or reviewed_on > today:
                continue

            event = entry.get("answer_event")

            if not isinstance(event, dict):
                continue

            candidate_ids = _coerce_question_ids(event.get("candidate_ids"))
            expected_id = (
                _coerce_question_id(event.get("expected_card_id")) or
                question.id
            )
            selected_id = _event_selected_question_id(event, candidate_ids)

            if selected_id is None or selected_id == expected_id:
                continue

            pairs.add((expected_id, selected_id))
            event_count += 1

    return {
        "window_days": RECENT_MISS_WINDOW_DAYS,
        "pair_count": len(pairs),
        "event_count": event_count
    }


def _counts_for_questions(questions, today):
    buckets = {
        "unseen": 0,
        "learning": 0,
        "fragile": 0,
        "stable": 0,
        "mastered": 0
    }
    counts = {
        "total_atomic_questions": len(questions),
        "active_questions": 0,
        "suspended": 0,
        "unavailable": 0,
        "due_now": 0,
        "recent_miss_items": 0,
        "recent_miss_events": 0,
        "lapsed_items": 0,
        "lapse_total": 0
    }
    for question in questions:
        bucket = classify_mastery_bucket(question, today)
        signals = _question_signals(question, today)

        if bucket == "suspended":
            counts["suspended"] += 1
            continue

        if bucket == "unavailable":
            counts["unavailable"] += 1
            continue

        counts["active_questions"] += 1
        buckets[bucket] += 1

        if signals["due"]:
            counts["due_now"] += 1

        if signals["recent_misses"]:
            counts["recent_miss_items"] += 1
            counts["recent_miss_events"] += signals["recent_misses"]

        if signals["lapses"]:
            counts["lapsed_items"] += 1
            counts["lapse_total"] += signals["lapses"]

    return counts, buckets


def build_study_scope_summary(
    db,
    scope_type,
    *,
    group_id=None,
    collection_id=None,
    tag=None,
    pack_guid=None,
    today=None
):
    """Progress rollup for one study scope.

    Its only consumer is the installed-pack progress panel
    (frontend/src/features/packs/components/BrowsePacks.jsx), so the payload is
    just what that panel and studyRecommendation.js read: totals, mastery
    buckets, and two recent-difficulty counts.
    """
    today = today or date.today()
    resolved = resolve_study_scope(
        db,
        scope_type,
        group_id=group_id,
        collection_id=collection_id,
        tag=tag,
        pack_guid=pack_guid
    )
    scope = resolved["scope"]
    questions = list(resolved["questions"])
    counts, buckets = _counts_for_questions(questions, today)
    confusions = _confusion_counts_for_questions(questions, today)

    return {
        "generated_on": today.isoformat(),
        "scope": scope,
        "thresholds": BUCKET_THRESHOLDS,
        "counts": counts,
        "buckets": buckets,
        "recent_misses": {
            "window_days": RECENT_MISS_WINDOW_DAYS,
            "item_count": counts["recent_miss_items"],
            "event_count": counts["recent_miss_events"]
        },
        "lapses": {
            "item_count": counts["lapsed_items"],
            "total": counts["lapse_total"]
        },
        "confusions": confusions
    }
