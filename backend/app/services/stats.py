from datetime import date, timedelta

from sqlalchemy.orm import joinedload

from ..models import Question
from ..scheduler import parse_history_date
from .guidance import build_profile_guidance
from .progress import progress_is_new


KNOWN_TYPES = ("text", "numeric", "cloze", "grid", "set", "enumeration", "map", "timeline", "media", "sequence")
LOAD_WINDOW_DAYS = 30
RETENTION_WINDOW_DAYS = 90
HARD_QUESTION_LIMIT = 12
FAVORITE_QUESTION_LIMIT = 20
WEAK_SPOT_LIMIT = 10
# Measured in FSRS stability, not `interval`: interval is the smoothed value the
# calendar rebalancer shifts around to level daily load, so keying off it would
# make "maîtrisée" flicker with scheduling rather than with memory. See the note
# on WIP_RELEASE_MIN_STABILITY_DAYS in services/progress.py.
MASTERED_MIN_STABILITY_DAYS = 60
MASTERED_MIN_REPS = 3


def _question_type(question):
    return question.type_q or "unknown"


def _empty_type_count():
    return {
        "total": 0,
        "due": 0,
        "overdue": 0,
        "due_today": 0,
        "new": 0,
        "mastered": 0
    }


def _empty_retention():
    return {
        "reviews": 0,
        "success": 0,
        "failed": 0,
        "hard": 0,
        "retention": None
    }


def _ensure_type(mapping, type_q, factory):
    if type_q not in mapping:
        mapping[type_q] = factory()

    return mapping[type_q]


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


def _is_new(progress):
    return progress_is_new(progress)


def _is_mastered(progress):
    if not progress or _is_new(progress):
        return False

    return (
        (progress.stability or 0) >= MASTERED_MIN_STABILITY_DAYS and
        (progress.reps or 0) >= MASTERED_MIN_REPS
    )


def _next_review(progress, today):
    if not progress or not progress.next_review:
        return today

    return progress.next_review


def _is_favorite(question):
    return bool((question.data or {}).get("favorite"))


def _group_summary(question):
    if not question.group:
        return None

    return {
        "id": question.group.id,
        "name": question.group.name,
        "type_group": question.group.type_group
    }


def _quality_counts_from_history(history):
    stats = {
        "reviews": 0,
        "success": 0,
        "failed": 0,
        "hard": 0
    }

    for entry in history or []:
        quality = _history_quality(entry)

        if quality is None:
            continue

        stats["reviews"] += 1

        if quality > 0:
            stats["success"] += 1

        if quality == 0:
            stats["failed"] += 1

        if quality == 1:
            stats["hard"] += 1

    return stats


def _question_review_stats(question):
    progress = question.progress
    history = progress.history if progress else []
    stats = _quality_counts_from_history(history)

    if stats["reviews"] == 0 and progress and (progress.reps or 0) > 0:
        reps = progress.reps or 0
        lapses = progress.lapses or 0
        stats = {
            "reviews": reps,
            "success": max(0, reps - lapses),
            "failed": lapses,
            "hard": 0
        }

    retention = (
        round((stats["success"] / stats["reviews"]) * 100)
        if stats["reviews"] > 0
        else None
    )

    return {
        **stats,
        "retention": retention
    }


def _question_summary(question, today):
    progress = question.progress
    stats = _question_review_stats(question)

    return {
        "id": question.id,
        "type_q": _question_type(question),
        "question": question.question,
        "answer": question.answer,
        "media": question.media,
        "tags": question.tags or [],
        "data": question.data or {},
        "group_id": question.group_id,
        "group": _group_summary(question),
        "favorite": _is_favorite(question),
        "reviews": stats["reviews"],
        "success_count": stats["success"],
        "failed_count": stats["failed"],
        "hard_count": stats["hard"],
        "retention": stats["retention"],
        "difficulty": progress.difficulty if progress else 5.0,
        "lapses": progress.lapses if progress else 0,
        "reps": progress.reps if progress else 0,
        "last_review": (
            progress.last_review.isoformat()
            if progress and progress.last_review
            else None
        ),
        "next_review": _next_review(progress, today).isoformat()
    }


def _ranking_key(summary):
    retention = summary["retention"] if summary["retention"] is not None else 101
    pressure = (summary["failed_count"] * 2) + summary["hard_count"]

    return (
        retention,
        -pressure,
        -(summary["difficulty"] or 0),
        -(summary["lapses"] or 0),
        summary["id"]
    )


def _load_questions(db):
    return (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .all()
    )


def build_stats(db, today=None):
    today = today or date.today()
    questions = _load_questions(db)
    retention_start = today - timedelta(days=RETENTION_WINDOW_DAYS - 1)
    load_dates = [
        today + timedelta(days=offset)
        for offset in range(LOAD_WINDOW_DAYS)
    ]
    load_by_date = {
        day: {
            "date": day.isoformat(),
            "total": 0,
            "types": {type_q: 0 for type_q in KNOWN_TYPES}
        }
        for day in load_dates
    }
    counts = {
        "total": len(questions),
        "due_total": 0,
        "overdue": 0,
        "due_today": 0,
        "new": 0,
        "mastered": 0,
        "by_type": {type_q: _empty_type_count() for type_q in KNOWN_TYPES}
    }
    retention_by_type = {
        type_q: _empty_retention()
        for type_q in KNOWN_TYPES
    }
    summaries = []

    for question in questions:
        type_q = _question_type(question)
        type_counts = _ensure_type(counts["by_type"], type_q, _empty_type_count)
        summary = _question_summary(question, today)
        summaries.append(summary)

        type_counts["total"] += 1
        progress = question.progress
        is_new = _is_new(progress)
        next_review = _next_review(progress, today)

        if is_new:
            counts["new"] += 1
            type_counts["new"] += 1
            continue

        if _is_mastered(progress):
            counts["mastered"] += 1
            type_counts["mastered"] += 1

        if next_review <= today:
            counts["due_total"] += 1
            type_counts["due"] += 1

            if next_review < today:
                counts["overdue"] += 1
                type_counts["overdue"] += 1
            else:
                counts["due_today"] += 1
                type_counts["due_today"] += 1

        load_date = today if next_review < today else next_review

        if today <= load_date <= load_dates[-1]:
            day_load = load_by_date[load_date]
            _ensure_type(day_load["types"], type_q, lambda: 0)
            day_load["types"][type_q] += 1
            day_load["total"] += 1

        type_retention = _ensure_type(
            retention_by_type,
            type_q,
            _empty_retention
        )

        history = (progress.history or []) if progress else []

        for entry in history:
            reviewed_on = _history_date(entry)

            if not reviewed_on or reviewed_on < retention_start or reviewed_on > today:
                continue

            quality = _history_quality(entry)

            if quality is None:
                continue

            type_retention["reviews"] += 1

            if quality > 0:
                type_retention["success"] += 1

            if quality == 0:
                type_retention["failed"] += 1

            if quality == 1:
                type_retention["hard"] += 1

    for stats in retention_by_type.values():
        if stats["reviews"] > 0:
            stats["retention"] = round(
                (stats["success"] / stats["reviews"]) * 100
            )

    reviewed_summaries = [
        summary
        for summary in summaries
        if summary["reviews"] > 0
    ]
    ranked_reviewed = sorted(reviewed_summaries, key=_ranking_key)

    return {
        "generated_on": today.isoformat(),
        "windows": {
            "load_days": LOAD_WINDOW_DAYS,
            "retention_days": RETENTION_WINDOW_DAYS,
            "retention_start": retention_start.isoformat()
        },
        "counts": counts,
        "load_by_type": [load_by_date[day] for day in load_dates],
        "retention_by_type": retention_by_type,
        "hard_questions": ranked_reviewed[:HARD_QUESTION_LIMIT],
        "favorite_questions": [
            summary
            for summary in sorted(summaries, key=lambda item: item["id"])
            if summary["favorite"]
        ][:FAVORITE_QUESTION_LIMIT],
        "weak_spots": {
            "map": [
                summary
                for summary in ranked_reviewed
                if summary["type_q"] == "map"
            ][:WEAK_SPOT_LIMIT],
            "timeline": [
                summary
                for summary in ranked_reviewed
                if summary["type_q"] == "timeline"
            ][:WEAK_SPOT_LIMIT],
            "media": [
                summary
                for summary in ranked_reviewed
                if summary["type_q"] == "media"
            ][:WEAK_SPOT_LIMIT],
            "sequence": [
                summary
                for summary in ranked_reviewed
                if summary["type_q"] == "sequence"
            ][:WEAK_SPOT_LIMIT]
        },
        "guidance": build_profile_guidance(db, today)
    }
