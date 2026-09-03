from datetime import date

from fastapi import HTTPException
from sqlalchemy import case, func, or_

from ..models import Progress, Question
from .cloze import cloze_is_buried
from .intake import compute_intake_quota


def intake_order_sort_expressions():
    return (
        case((Question.intake_order == None, 1), else_=0),
        Question.intake_order,
        Question.id,
    )


def _map_ready_filter():
    return or_(
        Question.type_q != "map",
        func.trim(func.coalesce(Question.answer, "")) != "",
    )


def _progress_row_has_started(row):
    return (
        (row.reps or 0) > 0 or
        bool(row.last_review) or
        len(row.history or []) > 0
    )


def _unseen_ids_by_suspension(db, *, suspended, today=None):
    today = today or date.today()
    rows = (
        db.query(
            Question.id,
            Question.type_q,
            Question.data,
            Question.suspended,
            Progress.reps,
            Progress.last_review,
            Progress.history,
        )
        .outerjoin(Progress, Question.id == Progress.question_id)
        .filter(
            _map_ready_filter(),
            func.coalesce(Question.suspended, False) == suspended,
        )
        .order_by(*intake_order_sort_expressions())
        .all()
    )

    return [
        row.id
        for row in rows
        if (
            not _progress_row_has_started(row)
            and not cloze_is_buried(row, today)
        )
    ]


def _active_unseen_ids(db, today=None):
    return _unseen_ids_by_suspension(db, suspended=False, today=today)


def _suspended_unseen_ids(db, today=None):
    return _unseen_ids_by_suspension(db, suspended=True, today=today)


def _ensure_unique_ids(question_ids):
    if len(question_ids) != len(set(question_ids)):
        raise HTTPException(
            status_code=400,
            detail="question_ids must not contain duplicates",
        )


def get_intake_queue(db, today=None):
    today = today or date.today()
    quota = compute_intake_quota(db, today=today)["quota"]
    active_ids = _active_unseen_ids(db, today=today)
    suspended_ids = _suspended_unseen_ids(db, today=today)
    today_ids = active_ids[:quota]

    return {
        "quota": quota,
        "today_ids": today_ids,
        "active_ids": active_ids,
        "suspended_ids": suspended_ids,
        "counts": {
            "today": len(today_ids),
            "active": len(active_ids),
            "suspended": len(suspended_ids),
            "total": len(active_ids) + len(suspended_ids),
        },
    }


def set_intake_order(db, question_ids, today=None):
    question_ids = list(question_ids or [])
    _ensure_unique_ids(question_ids)

    active_ids = _active_unseen_ids(db, today=today)

    if len(question_ids) != len(active_ids) or set(question_ids) != set(active_ids):
        raise HTTPException(
            status_code=409,
            detail="Queue order is stale or incomplete",
        )

    by_id = {
        question.id: question
        for question in (
            db.query(Question)
            .filter(Question.id.in_(active_ids))
            .all()
        )
    }

    for index, question_id in enumerate(question_ids, start=1):
        by_id[question_id].intake_order = index

    db.flush()
    return get_intake_queue(db, today=today)


def set_intake_suspension(db, question_ids, suspended, today=None):
    question_ids = list(question_ids or [])
    _ensure_unique_ids(question_ids)

    active_ids = set(_active_unseen_ids(db, today=today))
    suspended_ids = set(_suspended_unseen_ids(db, today=today))
    eligible_ids = active_ids | suspended_ids
    requested_ids = set(question_ids)

    if requested_ids - eligible_ids:
        raise HTTPException(
            status_code=400,
            detail="Only unseen reviewable questions can be updated",
        )

    questions = (
        db.query(Question)
        .filter(Question.id.in_(requested_ids))
        .all()
    )

    for question in questions:
        question.suspended = suspended

    db.flush()
    return get_intake_queue(db, today=today)
