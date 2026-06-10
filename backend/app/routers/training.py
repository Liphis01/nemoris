from typing import Literal, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import TimelineAnswerRequest, TrainingAttemptRecordRequest
from ..services.training import (
    get_training_items,
    grade_training_timeline,
    list_training_scopes,
    record_training_attempt
)


router = APIRouter()


@router.get("/training/scopes")
def get_scopes(db: Session = Depends(get_db)):
    return list_training_scopes(db)


@router.get("/training")
def get_training(
    scope_type: Literal["group", "tag"],
    group_id: Optional[int] = None,
    tag: Optional[str] = None,
    map_mode: Optional[str] = None,
    image_mode: Optional[str] = None,
    db: Session = Depends(get_db)
):
    return get_training_items(
        db,
        scope_type=scope_type,
        group_id=group_id,
        tag=tag,
        map_mode=map_mode,
        image_mode=image_mode
    )


@router.post("/training/grade_timeline")
def grade_timeline_training(
    data: TimelineAnswerRequest,
    db: Session = Depends(get_db)
):
    return grade_training_timeline(db, data.items)


@router.post("/training/groups/{group_id}/attempt_record")
def save_group_attempt_record(
    group_id: int,
    data: TrainingAttemptRecordRequest,
    db: Session = Depends(get_db)
):
    return record_training_attempt(db, group_id, data)
