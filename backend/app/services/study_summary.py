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
from .map_eligibility import question_has_training_content, question_is_reviewable
from .media import media_kind_from_name
from .media_pool import read_media_pool
from .progress import progress_has_started, progress_is_new
from .tag_hierarchy import (
    descendants,
    ensure_stored_tag_ids,
    label_for_tag,
    load_tag_hierarchy,
    parent_map,
    resolve_tag_id
)
from .training import (
    MODE_GROUP_TYPES,
    collection_training_fingerprint,
    group_training_fingerprint,
    question_in_tag_subtree,
    serialize_previous_training_record,
    serialize_previous_training_records,
    serialize_training_record,
    serialize_training_records,
    training_fingerprints_for_groups
)
from .type_contracts import (
    group_type_contract,
    question_type_contract
)


LOAD_WINDOW_DAYS = 30
RECENT_MISS_WINDOW_DAYS = 14
FRAGILE_MAX_STABILITY_DAYS = 7
STABLE_MIN_STABILITY_DAYS = 21
STABLE_MIN_REPS = 2
MASTERED_MIN_STABILITY_DAYS = 60
MASTERED_MIN_REPS = 3
WEAK_ITEM_LIMIT = 20
CONFUSION_LIMIT = 20
LEARN_ITEM_LIMIT = 500
PRACTICE_ITEM_LIMIT = 120
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


def _next_review(progress):
    if not progress_has_started(progress):
        return None

    return progress.next_review if progress else None


def _is_due(progress, today):
    if not progress_has_started(progress):
        return False

    next_review = progress.next_review if progress else None

    return next_review is None or next_review <= today


def _question_identity(question):
    group = question.group

    return {
        "id": question.id,
        "guid": question.guid,
        "type_q": question.type_q,
        "question": question.question,
        "answer": question.answer,
        "media": question.media,
        "tags": question.tags or [],
        "group_id": question.group_id,
        "group": (
            {
                "id": group.id,
                "guid": group.guid,
                "name": group.name,
                "type_group": group.type_group
            }
            if group else None
        )
    }


def _question_learn_identity(question, today):
    data = question.data or {}
    item = {
        **_question_identity(question),
        "aliases": data.get("aliases", []),
        "signals": _question_signals(question, today)
    }

    if question.type_q == "map":
        item["code"] = data.get("code")

    if question.type_q == "media":
        media_pool = read_media_pool(question.media, data)
        item["media_pool"] = media_pool
        item["media_kind"] = media_kind_from_name(media_pool[0]) if media_pool else ""

    return item


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


def _learn_for_scope(scope_type, source, questions, today):
    if scope_type != "group" or source.type_group not in {"map", "media"}:
        return {
            "supported": False,
            "family": None,
            "items": [],
            "item_count": 0,
            "truncated": False,
            "reason": "Learn is available for map and media groups first."
        }

    family = source.type_group
    learnable_questions = [
        question
        for question in questions
        if (
            question.type_q == family and
            question_has_training_content(question)
        )
    ]
    items = [
        _question_learn_identity(question, today)
        for question in learnable_questions[:LEARN_ITEM_LIMIT]
    ]

    return {
        "supported": True,
        "family": family,
        "group": {
            "id": source.id,
            "guid": source.guid,
            "name": source.name,
            "type_group": source.type_group,
            "media": source.media
        },
        "item_count": len(learnable_questions),
        "truncated": len(learnable_questions) > LEARN_ITEM_LIMIT,
        "items": items,
        "hints": [
            "first_letter",
            "category",
            "narrow_choices",
            "related_items",
            "reveal_answer"
        ]
    }


def _weak_sort_key(item):
    signals = item["signals"]
    next_review = signals["next_review"] or "9999-12-31"

    return (
        0 if signals["recent_misses"] else 1,
        -signals["recent_misses"],
        -signals["lapses"],
        signals["stability"],
        next_review,
        item["id"]
    )


def _practice_sort_key(question, today):
    signals = _question_signals(question, today)
    return _weak_sort_key({
        **_question_identity(question),
        "signals": signals
    })


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


def _safe_policy(policy):
    return dict(policy) if isinstance(policy, dict) else None


def _confusions_for_questions(db, questions, today):
    start = today - timedelta(days=RECENT_MISS_WINDOW_DAYS - 1)
    questions_by_id = {question.id: question for question in questions}
    pairs = {}
    selected_ids = set()

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

            selected_ids.add(selected_id)
            key = (expected_id, selected_id)
            pair = pairs.setdefault(key, {
                "expected_id": expected_id,
                "selected_id": selected_id,
                "count": 0,
                "last_reviewed_on": None,
                "raw_response": None,
                "type_q": event.get("type_q") or question.type_q,
                "presentation_kind": event.get("presentation_kind"),
                "mode": event.get("mode"),
                "direction": event.get("direction"),
                "candidate_ids": set(),
                "answer_policy": _safe_policy(event.get("answer_policy"))
            })
            pair["count"] += 1
            pair["raw_response"] = event.get("raw_response")
            pair["candidate_ids"].update(candidate_ids)

            if pair["answer_policy"] is None:
                pair["answer_policy"] = _safe_policy(
                    event.get("answer_policy")
                )

            if (
                pair["last_reviewed_on"] is None or
                reviewed_on.isoformat() > pair["last_reviewed_on"]
            ):
                pair["last_reviewed_on"] = reviewed_on.isoformat()

    missing_selected_ids = selected_ids - set(questions_by_id)

    if missing_selected_ids:
        questions_by_id.update({
            question.id: question
            for question in (
                _question_query(db)
                .filter(Question.id.in_(missing_selected_ids))
                .all()
            )
        })

    items = []

    for pair in pairs.values():
        expected = questions_by_id.get(pair["expected_id"])
        selected = questions_by_id.get(pair["selected_id"])
        items.append({
            **{
                **pair,
                "candidate_ids": sorted(pair["candidate_ids"])
            },
            "expected": (
                _question_identity(expected)
                if expected else {"id": pair["expected_id"]}
            ),
            "selected": (
                _question_identity(selected)
                if selected else {"id": pair["selected_id"]}
            )
        })

    items = sorted(
        items,
        key=lambda item: (
            -item["count"],
            -(
                parse_history_date(item["last_reviewed_on"]).toordinal()
                if item["last_reviewed_on"]
                else 0
            ),
            item["expected_id"],
            item["selected_id"]
        )
    )

    return {
        "window_days": RECENT_MISS_WINDOW_DAYS,
        "pair_count": len(items),
        "event_count": sum(item["count"] for item in items),
        "items": items[:CONFUSION_LIMIT]
    }


def _progress_success_stats(progress):
    attempts = []

    if progress:
        for entry in progress.history or []:
            quality = _history_quality(entry)

            if quality is not None:
                attempts.append(quality)

    if not attempts and progress and (progress.reps or 0) > 0:
        reps = int(progress.reps or 0)
        lapses = int(progress.lapses or 0)
        successes = max(0, reps - lapses)
        attempts = [2] * successes + [0] * min(lapses, reps)

    total = len(attempts)
    successes = sum(1 for quality in attempts if quality > 0)

    return {
        "attempts": total,
        "successes": successes,
        "success_rate": (successes / total) if total else None
    }


def _date_on_or_before(value, limit_day):
    parsed = parse_history_date(value)

    return parsed is not None and parsed <= limit_day


def _unique_limited_ids(question_ids, limit=PRACTICE_ITEM_LIMIT):
    ids = []
    seen = set()

    for value in question_ids or []:
        question_id = _coerce_question_id(value)

        if question_id is None or question_id in seen:
            continue

        seen.add(question_id)
        ids.append(question_id)

    return ids[:limit], len(ids) > limit


def _practice_entry(entry_id, label, description, question_ids):
    ids, truncated = _unique_limited_ids(question_ids)

    return {
        "id": entry_id,
        "label": label,
        "description": description,
        "question_ids": ids,
        "count": len(ids),
        "enabled": len(ids) > 0,
        "truncated": truncated
    }


def _practice_for_questions(questions, recent_miss_items, confusions, today):
    sorted_questions = sorted(
        questions,
        key=lambda question: _practice_sort_key(question, today)
    )
    new_ids = []
    high_lapse_ids = []
    low_success_ids = []
    due_soon_fragile_ids = []
    almost_mastered_ids = []
    before_tomorrow_ids = []

    for question in sorted_questions:
        if bool(question.suspended) or not question_is_reviewable(question):
            continue

        bucket = classify_mastery_bucket(question, today)
        signals = _question_signals(question, today)
        progress = question.progress
        next_review = signals["next_review"]

        if bucket == "unseen":
            new_ids.append(question.id)

        if signals["lapses"] >= 2:
            high_lapse_ids.append(question.id)

        stats = _progress_success_stats(progress)

        if (
            stats["attempts"] >= LOW_SUCCESS_MIN_ATTEMPTS and
            stats["success_rate"] is not None and
            stats["success_rate"] <= LOW_SUCCESS_MAX_RATE
        ):
            low_success_ids.append(question.id)

        if (
            bucket == "fragile" and
            (
                signals["due"] or
                _date_on_or_before(
                    next_review,
                    today + timedelta(days=DUE_SOON_DAYS)
                )
            )
        ):
            due_soon_fragile_ids.append(question.id)

        if (
            bucket == "stable" and
            (
                signals["reps"] >= MASTERED_MIN_REPS - 1 or
                signals["stability"] >= STABLE_MIN_STABILITY_DAYS
            )
        ):
            almost_mastered_ids.append(question.id)

        if signals["due"] or _date_on_or_before(
            next_review,
            today + timedelta(days=1)
        ):
            before_tomorrow_ids.append(question.id)

    recent_miss_ids = [item["id"] for item in recent_miss_items]
    confusion_ids = []

    for item in confusions.get("items", []):
        confusion_ids.extend([item.get("expected_id"), item.get("selected_id")])

    selectors = {
        "recent_misses": _practice_entry(
            "recent_misses",
            "Travailler les erreurs récentes",
            "Items ratés dans la fenêtre récente.",
            recent_miss_ids
        ),
        "high_lapses": _practice_entry(
            "high_lapses",
            "Lapses élevés",
            "Items avec plusieurs oublis cumulés.",
            high_lapse_ids
        ),
        "low_success": _practice_entry(
            "low_success",
            "Réussite basse",
            "Items avec un taux de réussite faible dans ce scope.",
            low_success_ids
        ),
        "due_soon_fragile": _practice_entry(
            "due_soon_fragile",
            "Fragiles bientôt dus",
            "Items fragiles à stabiliser avant la prochaine charge.",
            due_soon_fragile_ids
        ),
        "commonly_confused_pairs": _practice_entry(
            "commonly_confused_pairs",
            "Travailler les confusions",
            "Items attendus et items choisis dans les confusions récentes.",
            confusion_ids
        ),
        "new_only": _practice_entry(
            "new_only",
            "Nouveaux uniquement",
            "Items encore jamais travaillés en review.",
            new_ids
        ),
        "almost_mastered": _practice_entry(
            "almost_mastered",
            "Presque maîtrisés",
            "Items stables qui ne sont pas encore maîtrisés.",
            almost_mastered_ids
        ),
        "before_tomorrow": _practice_entry(
            "before_tomorrow",
            "À revoir avant demain",
            "Items dus maintenant ou demain dans ce scope.",
            before_tomorrow_ids
        )
    }
    entry_ids = [
        "recent_misses",
        "commonly_confused_pairs",
        "new_only",
        "almost_mastered",
        "before_tomorrow"
    ]

    return {
        "item_limit": PRACTICE_ITEM_LIMIT,
        "selectors": selectors,
        "entry_points": [selectors[entry_id] for entry_id in entry_ids]
    }


def _load_by_day(questions, today):
    dates = [
        today + timedelta(days=offset)
        for offset in range(1, LOAD_WINDOW_DAYS + 1)
    ]
    counts = {day: 0 for day in dates}

    for question in questions:
        if bool(question.suspended) or not question_is_reviewable(question):
            continue

        next_review = _next_review(question.progress)

        if next_review and dates[0] <= next_review <= dates[-1]:
            counts[next_review] += 1

    return [
        {
            "date": day.isoformat(),
            "total": counts[day]
        }
        for day in dates
    ]


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
    weak_items = []
    recent_miss_items = []

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
            recent_miss_items.append({
                **_question_identity(question),
                "signals": signals
            })

        if signals["lapses"]:
            counts["lapsed_items"] += 1
            counts["lapse_total"] += signals["lapses"]

        if (
            bucket == "fragile" or
            signals["recent_misses"] or
            signals["lapses"]
        ):
            weak_items.append({
                **_question_identity(question),
                "signals": signals
            })

    return counts, buckets, weak_items, recent_miss_items


def _available_modes_for_group(group):
    contract = group_type_contract(group.type_group)

    if not contract:
        return []

    return [{
        "scope": "group",
        "type_group": group.type_group,
        "type_q": contract.question_type,
        "presentation_kind": contract.runtime_presentation,
        "review_modes": list(contract.modes),
        "training_modes": list(contract.modes),
        "training_support": contract.training_support
    }]


def _available_modes_for_questions(questions):
    by_type = {}

    for question in questions:
        contract = question_type_contract(question.type_q)

        if not contract:
            continue

        by_type.setdefault(question.type_q, contract)

    return [
        {
            "scope": "question_type",
            "type_q": type_q,
            "presentation_kinds": list(contract.runtime_presentations),
            "review_modes": list(contract.modes),
            "training_modes": (
                list(contract.modes)
                if contract.training_support != "none"
                else []
            ),
            "training_support": contract.training_support
        }
        for type_q, contract in sorted(by_type.items())
    ]


def _available_modes(scope_type, source, questions):
    if scope_type == "group":
        return _available_modes_for_group(source)

    return _available_modes_for_questions(questions)


def _media_group_audio_only(questions):
    kinds = {
        media_kind_from_name(question.media)
        for question in questions
        if question.type_q == "media" and question.media
    }

    return bool(kinds) and kinds == {"audio"}


def _group_training_entries(db, questions):
    groups = []
    seen = set()
    questions_by_group_id = {}

    for question in questions:
        group = question.group

        if not group or group.id in seen or group.type_group not in MODE_GROUP_TYPES:
            if group and group.type_group in MODE_GROUP_TYPES:
                questions_by_group_id.setdefault(group.id, []).append(question)
            continue

        seen.add(group.id)
        groups.append(group)
        questions_by_group_id.setdefault(group.id, []).append(question)

    fingerprints = training_fingerprints_for_groups(db, groups)
    result = []

    for group in sorted(groups, key=lambda item: item.id):
        fingerprint = fingerprints.get(group.id)
        group_questions = questions_by_group_id.get(group.id, [])
        result.append({
            "id": group.id,
            "guid": group.guid,
            "name": group.name,
            "type_group": group.type_group,
            "question_count": len(group_questions),
            "audio_only": (
                group.type_group == "media" and
                _media_group_audio_only(group_questions)
            ),
            "training_record": serialize_training_record(
                group.data,
                fingerprint
            ),
            "training_records": serialize_training_records(
                group.data,
                fingerprint,
                group.type_group,
                len(group_questions)
            ),
            "previous_training_record": serialize_previous_training_record(
                group.data,
                fingerprint
            ),
            "previous_training_records": serialize_previous_training_records(
                group.data,
                fingerprint,
                group.type_group,
                len(group_questions)
            )
        })

    return result


def _scope_training_records(db, scope_type, source, questions):
    scope_record = None
    scope_records = {}
    previous_scope_record = None
    previous_scope_records = {}

    if scope_type == "group" and source.type_group in MODE_GROUP_TYPES:
        fingerprint = group_training_fingerprint(db, source)
        scope_record = serialize_training_record(source.data, fingerprint)
        scope_records = serialize_training_records(
            source.data,
            fingerprint,
            source.type_group,
            len(questions)
        )
        previous_scope_record = serialize_previous_training_record(
            source.data,
            fingerprint
        )
        previous_scope_records = serialize_previous_training_records(
            source.data,
            fingerprint,
            source.type_group,
            len(questions)
        )
    elif scope_type == "collection":
        fingerprint = collection_training_fingerprint(db, source)
        scope_record = serialize_training_record(source.data, fingerprint)
        previous_scope_record = serialize_previous_training_record(
            source.data,
            fingerprint
        )

    return {
        "training_record": scope_record,
        "training_records": scope_records,
        "previous_training_record": previous_scope_record,
        "previous_training_records": previous_scope_records,
        "groups": _group_training_entries(db, questions)
    }


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
    source = resolved["source"]
    questions = list(resolved["questions"])
    counts, buckets, weak_items, recent_miss_items = _counts_for_questions(
        questions,
        today
    )
    load_by_day = _load_by_day(questions, today)
    confusions = _confusions_for_questions(db, questions, today)
    practice = _practice_for_questions(
        questions,
        recent_miss_items,
        confusions,
        today
    )

    return {
        "generated_on": today.isoformat(),
        "scope": scope,
        "thresholds": BUCKET_THRESHOLDS,
        "counts": {
            **counts,
            "upcoming_load": sum(item["total"] for item in load_by_day)
        },
        "buckets": buckets,
        "recent_misses": {
            "window_days": RECENT_MISS_WINDOW_DAYS,
            "items": sorted(
                recent_miss_items,
                key=lambda item: _weak_sort_key(item)
            )[:WEAK_ITEM_LIMIT],
            "item_count": counts["recent_miss_items"],
            "event_count": counts["recent_miss_events"]
        },
        "lapses": {
            "item_count": counts["lapsed_items"],
            "total": counts["lapse_total"]
        },
        "confusions": confusions,
        "practice": practice,
        "upcoming_load": {
            "window_days": LOAD_WINDOW_DAYS,
            "total": sum(item["total"] for item in load_by_day),
            "by_day": load_by_day
        },
        "weak_items": sorted(weak_items, key=_weak_sort_key)[:WEAK_ITEM_LIMIT],
        "learn": _learn_for_scope(
            scope["type"],
            source,
            questions,
            today
        ),
        "available_modes": _available_modes(
            scope["type"],
            source,
            questions
        ),
        "training": _scope_training_records(
            db,
            scope["type"],
            source,
            questions
        )
    }
