from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db
from ..models import Question, QuestionGroup
from ..schemas import GroupCreate, GroupOut, GroupUpdate, GroupSuspend
from ..services.map_zones import merge_tags
from ..services.media import delete_unreferenced_media_file, media_points_to_same_static_file
from ..services.progress import rebalance_progress_calendar
from ..services.questions import delete_question_dependents
from ..services.tombstones import record_tombstone


router = APIRouter()


@router.post("/groups", response_model=GroupOut)
def create_group(payload: GroupCreate, db: Session = Depends(get_db)):
    # Groups describe shared visual context. They do not replace atomic
    # questions and do not own progress.
    group = QuestionGroup(
        type_group=payload.type_group,
        name=payload.name,
        media=payload.media,
        data=payload.data
    )

    db.add(group)
    db.commit()
    db.refresh(group)

    return group


@router.get("/groups")
def get_groups(db: Session = Depends(get_db)):
    # Include question_count for Manage without loading every question in the
    # sidebar/group list.
    groups = (
        db.query(
            QuestionGroup,
            func.count(Question.id).label("question_count")
        )
        .outerjoin(Question)
        .group_by(QuestionGroup.id)
        .all()
    )
    group_ids = [group.id for group, _ in groups]
    grouped_tag_rows = (
        db.query(Question.group_id, Question.tags)
        .filter(
            Question.group_id.in_(group_ids),
            Question.type_q.in_(["map", "media", "text", "cloze", "grid", "set", "sequence"])
        )
        .all()
        if group_ids else []
    )
    tags_by_group_id = {}

    for group_id, tags in grouped_tag_rows:
        tags_by_group_id[group_id] = merge_tags(
            tags_by_group_id.get(group_id, []),
            tags or []
        )

    return [
        {
            "id": group.id,
            "type_group": group.type_group,
            "name": group.name,
            "media": group.media,
            "data": group.data or {},
            "tags": tags_by_group_id.get(group.id, []),
            "question_count": question_count
        }
        for group, question_count in groups
    ]


@router.get("/groups/{group_id}")
def get_group(group_id: int, db: Session = Depends(get_db)):
    # Detailed group view includes its atomic questions for inspection/editing.
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions))
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    return {
        "id": group.id,
        "name": group.name,
        "type_group": group.type_group,
        "media": group.media,
        "tags": merge_tags(*[
            question.tags or []
            for question in group.questions
            if question.type_q in {"map", "media", "text", "cloze", "grid", "set", "sequence"}
        ]),
        "data": group.data or {},
        "questions": [
            {
                "id": question.id,
                "type_q": question.type_q,
                "question": question.question,
                "answer": question.answer,
                "media": question.media,
                "tags": question.tags or [],
                "data": question.data or {}
            }
            for question in group.questions
        ]
    }


@router.put("/groups/{group_id}", response_model=GroupOut)
def update_group(
    group_id: int,
    payload: GroupUpdate,
    db: Session = Depends(get_db)
):
    # Group type is intentionally not mutable here; changing presentation type
    # would require validating all child questions.
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    updates = payload.model_dump(exclude_unset=True)
    old_media = group.media

    for field in ["name", "media", "data"]:
        if field in updates:
            setattr(group, field, updates[field])

    db.commit()
    db.refresh(group)

    if (
        "media" in updates and
        not media_points_to_same_static_file(old_media, group.media)
    ):
        delete_unreferenced_media_file(db, old_media)

    return group


@router.post("/groups/{group_id}/suspend")
def suspend_group(
    group_id: int,
    payload: GroupSuspend,
    db: Session = Depends(get_db)
):
    """Suspend or resume every question in a group in one statement.

    Groups can hold hundreds of questions, so this is a single bulk UPDATE
    rather than a request per question. Suspension lives on the questions
    themselves -- there is no group-level flag -- so there is only ever one
    source of truth about what is eligible for review.
    """
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    updated = (
        db.query(Question)
        .filter(Question.group_id == group_id)
        .update(
            {Question.suspended: payload.suspended},
            synchronize_session=False
        )
    )
    rebalance = rebalance_progress_calendar(db)
    db.commit()

    return {
        "group_id": group_id,
        "suspended": payload.suspended,
        "updated_count": updated,
        "rebalance": rebalance
    }


@router.delete("/groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    question_ids = [
        question_id
        for (question_id,) in (
            db.query(Question.id)
            .filter(Question.group_id == group.id)
            .all()
        )
    ]
    media_values = [
        media
        for (media,) in (
            db.query(Question.media)
            .filter(Question.group_id == group.id)
            .all()
        )
    ]
    media_values.append(group.media)

    delete_question_dependents(db, question_ids)

    if question_ids:
        db.query(Question).filter(Question.id.in_(question_ids)).delete(
            synchronize_session=False
        )

    record_tombstone(db, "question_group", group.guid)
    db.delete(group)
    db.commit()

    for media in media_values:
        delete_unreferenced_media_file(db, media)

    return {"status": "deleted"}
