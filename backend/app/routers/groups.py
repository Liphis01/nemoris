from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..dependencies import get_db
from ..models import Question, QuestionGroup
from ..schemas import GroupCreate, GroupOut, GroupUpdate


router = APIRouter()


@router.post("/groups", response_model=GroupOut)
def create_group(payload: GroupCreate, db: Session = Depends(get_db)):
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

    if group.questions:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete group with existing questions"
        )

    db.delete(group)
    db.commit()

    return {"status": "deleted"}
