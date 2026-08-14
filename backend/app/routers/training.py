from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import Question
from ..schemas import (
    ClozeAnswerRequest,
    GridAnswerRequest,
    SetAnswerRequest,
    EnumerationAnswerRequest,
    NumericAnswerRequest,
    SequenceAnswerRequest,
    TimelineAnswerRequest,
    TrainingAttemptRecordRequest
)
from ..services.training import (
    get_training_items,
    grade_training_timeline,
    list_training_scopes,
    record_collection_training_attempt,
    record_training_attempt
)
from ..services.sequence_answers import grade_sequence_answer
from ..services.cloze import grade_cloze_answer
from ..services.numeric import grade_numeric_answer
from ..services.grid import grade_grid_answers
from ..services.set_groups import grade_set_answers
from ..services.enumeration import grade_enumeration_answers


router = APIRouter()


@router.get("/training/scopes")
def get_scopes(db: Session = Depends(get_db)):
    return list_training_scopes(db)


@router.get("/training")
def get_training(
    scope_type: Literal["group", "tag", "collection", "questions"],
    group_id: Optional[int] = None,
    collection_id: Optional[int] = None,
    tag: Optional[str] = None,
    question_ids: Optional[list[int]] = Query(default=None, alias="question_id"),
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
        question_ids=question_ids,
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
    return grade_sequence_answer(db, data, schedule=False)


@router.post("/training/grade_cloze")
def grade_cloze_training(
    data: ClozeAnswerRequest,
    db: Session = Depends(get_db)
):
    return grade_cloze_answer(db, data, schedule=False)


@router.post("/training/grade_numeric")
def grade_numeric_training(
    data: NumericAnswerRequest,
    db: Session = Depends(get_db)
):
    return grade_numeric_answer(db, data)


@router.post("/training/grade_grid")
def grade_grid_training(
    data: GridAnswerRequest,
    db: Session = Depends(get_db)
):
    graded = grade_grid_answers(db, data)
    return {"group_id": data.group_id, "items": [{key: value for key, value in result.items() if key != "question"} for result in graded["items"]]}


@router.post("/training/grade_set")
def grade_set_training(data: SetAnswerRequest, db: Session = Depends(get_db)):
    graded = grade_set_answers(db, data)
    return {
        "group_id": data.group_id,
        "items": [{key: value for key, value in result.items() if key != "question"} for result in graded["items"]],
        "recognized": graded["recognized"], "unmatched": graded["unmatched"],
    }


@router.post("/training/grade_enumeration")
def grade_enumeration_training(data: EnumerationAnswerRequest, db: Session = Depends(get_db)):
    question = db.query(Question).filter(Question.id == data.question_id, Question.type_q == "enumeration").first()
    if not question:
        raise HTTPException(status_code=404, detail="Enumeration card not found")
    result = grade_enumeration_answers(question, data.answers)
    return {key: value for key, value in result.items() if key not in {"enumeration", "answer_policy"}}


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
