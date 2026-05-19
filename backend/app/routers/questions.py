from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import QuestionCreate, QuestionOut, QuestionUpdate, SetCollections
from ..serializers import serialize_question_for_manage
from ..services.questions import (
    create_question_record,
    create_questions_bulk_records,
    delete_question_record,
    get_manage_questions,
    set_question_collections,
    update_question_record
)


router = APIRouter()


@router.post("/questions")
def create_question(payload: QuestionCreate, db: Session = Depends(get_db)):
    question = create_question_record(db, payload)
    db.commit()
    db.refresh(question)
    return serialize_question_for_manage(question)


@router.post("/questions/bulk")
def create_questions_bulk(
    questions: list[QuestionCreate],
    db: Session = Depends(get_db)
):
    created = create_questions_bulk_records(db, questions)
    return [serialize_question_for_manage(question) for question in created]


@router.get("/questions")
def get_questions(db: Session = Depends(get_db)):
    return get_manage_questions(db)


@router.put("/questions/{question_id}", response_model=QuestionOut)
def update_question(
    question_id: int,
    payload: QuestionUpdate,
    db: Session = Depends(get_db)
):
    return update_question_record(db, question_id, payload)


@router.put("/questions/{question_id}/collections")
def set_collections(
    question_id: int,
    data: SetCollections,
    db: Session = Depends(get_db)
):
    set_question_collections(db, question_id, data.collection_ids)
    return {"status": "ok"}


@router.delete("/questions/{question_id}")
def delete_question(question_id: int, db: Session = Depends(get_db)):
    delete_question_record(db, question_id)
    return {"status": "deleted"}
