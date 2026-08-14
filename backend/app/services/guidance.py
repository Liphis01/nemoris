from datetime import date, timedelta

from sqlalchemy.orm import joinedload

from ..models import Question
from ..scheduler import parse_history_date
from .map_eligibility import question_is_reviewable
from .study_summary import classify_mastery_bucket, recent_miss_count
from .tag_hierarchy import (
    ancestors,
    ensure_stored_tag_ids,
    label_for_tag,
    load_tag_hierarchy,
    parent_map
)


GROUP_CARD_LIMIT = 5
MIN_GROUP_SAMPLE = 3
MIN_TREND_REVIEWS = 3
TREND_WINDOW_DAYS = 14
RUNWAY_WINDOW_DAYS = 14
UPCOMING_LOAD_DAYS = 7
TAG_RETENTION_WINDOW_DAYS = 90


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


def _window_success_stats(history, start, end):
    reviews = 0
    successes = 0

    for entry in history or []:
        reviewed_on = _history_date(entry)

        if not reviewed_on or reviewed_on < start or reviewed_on > end:
            continue

        quality = _history_quality(entry)

        if quality is None:
            continue

        reviews += 1

        if quality > 0:
            successes += 1

    return reviews, successes


def _first_history_date(history):
    dates = [
        reviewed_on
        for reviewed_on in (_history_date(entry) for entry in history or [])
        if reviewed_on
    ]

    return min(dates) if dates else None


def _load_active_questions(db):
    return (
        db.query(Question)
        .options(joinedload(Question.progress), joinedload(Question.group))
        .all()
    )


def _empty_group_entry(group):
    return {
        "id": group.id,
        "guid": group.guid,
        "name": group.name,
        "type_group": group.type_group,
        "total": 0,
        "buckets": {
            "unseen": 0,
            "learning": 0,
            "fragile": 0,
            "stable": 0,
            "mastered": 0
        },
        "recent_miss_items": 0,
        "upcoming_load": 0,
        "recent_reviews": 0,
        "recent_successes": 0,
        "previous_reviews": 0,
        "previous_successes": 0
    }


def _group_scope(entry):
    return {
        "type": "group",
        "id": entry["id"],
        "guid": entry["guid"],
        "name": entry["name"],
        "type_group": entry["type_group"]
    }


def _root_tag_ids(hierarchy):
    nodes = hierarchy.get("nodes") or {}

    return {
        tag_id
        for tag_id, node in nodes.items()
        if not (node or {}).get("parents")
    }


def _touched_root_tags(question_tags, root_ids, parents):
    touched = set()

    for tag in question_tags or []:
        for tag_ancestor in ancestors(tag, parents):
            if tag_ancestor in root_ids:
                touched.add(tag_ancestor)

    return touched


def build_profile_guidance(db, today=None):
    """Learner-facing rollups over existing progress: weak/improving/close-to-
    mastery groups, fragile load, new-material runway, and tag retention.

    Read-only. Never touches Progress or scheduling state.
    """
    today = today or date.today()
    questions = _load_active_questions(db)

    trend_recent_start = today - timedelta(days=TREND_WINDOW_DAYS - 1)
    trend_previous_start = trend_recent_start - timedelta(days=TREND_WINDOW_DAYS)
    trend_previous_end = trend_recent_start - timedelta(days=1)
    runway_start = today - timedelta(days=RUNWAY_WINDOW_DAYS - 1)
    tag_retention_start = today - timedelta(days=TAG_RETENTION_WINDOW_DAYS - 1)

    ensure_stored_tag_ids(db)
    hierarchy = load_tag_hierarchy(db)
    parents = parent_map(hierarchy)
    root_ids = _root_tag_ids(hierarchy)
    tag_stats = {tag_id: {"reviews": 0, "successes": 0} for tag_id in root_ids}

    groups = {}
    unseen_total = 0
    recent_new_seen = 0

    for question in questions:
        if bool(question.suspended) or not question_is_reviewable(question):
            continue

        bucket = classify_mastery_bucket(question, today)
        progress = question.progress
        history = progress.history if progress else []

        if bucket == "unseen":
            unseen_total += 1

        first_seen = _first_history_date(history)

        if first_seen and runway_start <= first_seen <= today:
            recent_new_seen += 1

        group = question.group

        if group is not None:
            entry = groups.setdefault(group.id, _empty_group_entry(group))
            entry["total"] += 1
            entry["buckets"][bucket] = entry["buckets"].get(bucket, 0) + 1

            if recent_miss_count(progress, today) > 0:
                entry["recent_miss_items"] += 1

            next_review = progress.next_review if progress else None

            if next_review and next_review <= today + timedelta(days=UPCOMING_LOAD_DAYS):
                entry["upcoming_load"] += 1

            recent_reviews, recent_successes = _window_success_stats(
                history, trend_recent_start, today
            )
            previous_reviews, previous_successes = _window_success_stats(
                history, trend_previous_start, trend_previous_end
            )
            entry["recent_reviews"] += recent_reviews
            entry["recent_successes"] += recent_successes
            entry["previous_reviews"] += previous_reviews
            entry["previous_successes"] += previous_successes

        touched_roots = _touched_root_tags(question.tags, root_ids, parents)

        if touched_roots:
            reviews, successes = _window_success_stats(
                history, tag_retention_start, today
            )

            for root in touched_roots:
                tag_stats[root]["reviews"] += reviews
                tag_stats[root]["successes"] += successes

    weakest_groups = []
    improving_groups = []
    close_to_mastery_groups = []
    fragile_upcoming_load_groups = []

    for entry in groups.values():
        total = entry["total"]

        if total < MIN_GROUP_SAMPLE:
            continue

        fragile = entry["buckets"]["fragile"]
        mastered = entry["buckets"]["mastered"]
        stable = entry["buckets"]["stable"]
        fragile_ratio = fragile / total
        mastered_ratio = mastered / total
        near_mastery_ratio = (stable + mastered) / total

        if fragile_ratio > 0:
            weakest_groups.append({
                **_group_scope(entry),
                "total": total,
                "fragile_count": fragile,
                "fragile_ratio": round(fragile_ratio, 3),
                "recent_miss_items": entry["recent_miss_items"]
            })

        if (
            entry["recent_reviews"] >= MIN_TREND_REVIEWS and
            entry["previous_reviews"] >= MIN_TREND_REVIEWS
        ):
            recent_rate = entry["recent_successes"] / entry["recent_reviews"]
            previous_rate = entry["previous_successes"] / entry["previous_reviews"]
            delta = recent_rate - previous_rate

            if delta > 0:
                improving_groups.append({
                    **_group_scope(entry),
                    "recent_retention": round(recent_rate * 100),
                    "previous_retention": round(previous_rate * 100),
                    "delta": round(delta * 100)
                })

        if mastered_ratio < 1 and near_mastery_ratio > 0:
            close_to_mastery_groups.append({
                **_group_scope(entry),
                "total": total,
                "mastered": mastered,
                "stable": stable,
                "near_mastery_ratio": round(near_mastery_ratio, 3),
                "mastered_ratio": round(mastered_ratio, 3)
            })

        if fragile > 0 and entry["upcoming_load"] > 0:
            fragile_upcoming_load_groups.append({
                **_group_scope(entry),
                "fragile_count": fragile,
                "upcoming_load": entry["upcoming_load"]
            })

    weakest_groups.sort(
        key=lambda item: (
            -item["fragile_ratio"],
            -item["recent_miss_items"],
            item["id"]
        )
    )
    improving_groups.sort(key=lambda item: (-item["delta"], item["id"]))
    close_to_mastery_groups.sort(
        key=lambda item: (
            -item["near_mastery_ratio"],
            -item["mastered_ratio"],
            item["id"]
        )
    )
    fragile_upcoming_load_groups.sort(
        key=lambda item: (
            -item["upcoming_load"],
            -item["fragile_count"],
            item["id"]
        )
    )

    retention_by_tag = []

    for tag_id, stats in tag_stats.items():
        if stats["reviews"] == 0:
            continue

        retention_by_tag.append({
            "tag": tag_id,
            "label": label_for_tag(hierarchy, tag_id),
            "reviews": stats["reviews"],
            "retention": round((stats["successes"] / stats["reviews"]) * 100)
        })

    retention_by_tag.sort(key=lambda item: item["label"].lower())

    daily_rate = recent_new_seen / RUNWAY_WINDOW_DAYS
    days_remaining = round(unseen_total / daily_rate) if daily_rate > 0 else None

    return {
        "generated_on": today.isoformat(),
        "windows": {
            "trend_days": TREND_WINDOW_DAYS,
            "runway_days": RUNWAY_WINDOW_DAYS,
            "upcoming_load_days": UPCOMING_LOAD_DAYS,
            "tag_retention_days": TAG_RETENTION_WINDOW_DAYS
        },
        "weakest_groups": weakest_groups[:GROUP_CARD_LIMIT],
        "improving_groups": improving_groups[:GROUP_CARD_LIMIT],
        "close_to_mastery_groups": close_to_mastery_groups[:GROUP_CARD_LIMIT],
        "fragile_upcoming_load_groups": fragile_upcoming_load_groups[:GROUP_CARD_LIMIT],
        "new_material_runway": {
            "unseen_total": unseen_total,
            "recent_new_seen": recent_new_seen,
            "window_days": RUNWAY_WINDOW_DAYS,
            "daily_rate": round(daily_rate, 2),
            "days_remaining": days_remaining
        },
        "retention_by_tag": retention_by_tag
    }
