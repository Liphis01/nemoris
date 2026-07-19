from typing import Literal, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import (
    SequenceAnswerRequest,
    TimelineAnswerRequest,
    TrainingAttemptRecordRequest
)
from ..services.training import (
    get_training_items,
    grade_training_sequence,
    grade_training_timeline,
    list_training_scopes,
    record_collection_training_attempt,
    record_training_attempt
)


router = APIRouter()


@router.get("/training/scopes")
def get_scopes(db: Session = Depends(get_db)):
    return list_training_scopes(db)


@router.get("/training")
def get_training(
    scope_type: Literal["group", "tag", "collection"],
    group_id: Optional[int] = None,
    collection_id: Optional[int] = None,
    tag: Optional[str] = None,
    map_mode: Optional[str] = None,
    image_mode: Optional[str] = None,
    text_mode: Optional[str] = None,
    sequence_mode: Optional[str] = None,
    db: Session = Depends(get_db)
):
    return get_training_items(
        db,
        scope_type=scope_type,
        group_id=group_id,
        collection_id=collection_id,
        tag=tag,
        map_mode=map_mode,
        image_mode=image_mode,
        text_mode=text_mode,
        sequence_mode=sequence_mode
    )


@router.post("/training/grade_timeline")
def grade_timeline_training(
    data: TimelineAnswerRequest,
    db: Session = Depends(get_db)
):
    return grade_training_timeline(db, data.items)


@router.post("/training/grade_sequence")
def grade_sequence_training(
    data: SequenceAnswerRequest,
    db: Session = Depends(get_db)
):
    return grade_training_sequence(db, data.items)


@router.post("/training/groups/{group_id}/attempt_record")
def save_group_attempt_record(
    group_id: int,
    data: TrainingAttemptRecordRequest,
    db: Session = Depends(get_db)
):
    return record_training_attempt(db, group_id, data)


@router.post("/training/collections/{collection_id}/attempt_record")
def save_collection_attempt_record(
    collection_id: int,
    data: TrainingAttemptRecordRequest,
    db: Session = Depends(get_db)
):
    return record_collection_training_attempt(db, collection_id, data)
