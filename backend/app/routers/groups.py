from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db
from ..models import Question, QuestionGroup
from ..schemas import GroupCreate, GroupOut, GroupUpdate
from ..services.questions import delete_question_dependents


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

    return [
        {
            "id": group.id,
            "type_group": group.type_group,
            "name": group.name,
            "media": group.media,
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

    for field in ["name", "media", "data"]:
        if field in updates:
            setattr(group, field, updates[field])

    db.commit()
    db.refresh(group)

    return group


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

    delete_question_dependents(db, question_ids)

    if question_ids:
        db.query(Question).filter(Question.id.in_(question_ids)).delete(
            synchronize_session=False
        )

    db.delete(group)
    db.commit()

    return {"status": "deleted"}
