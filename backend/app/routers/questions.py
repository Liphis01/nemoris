from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import QuestionCreate, QuestionOut, QuestionUpdate, SetCollections
from ..serializers import serialize_manage_question
from ..services.questions import (
    create_question as create_question_service,
    create_questions_bulk as create_questions_bulk_service,
    delete_question as delete_question_service,
    list_questions_for_manage,
    set_question_collections,
    update_question as update_question_service
)


router = APIRouter()


@router.post("/questions")
def create_question(payload: QuestionCreate, db: Session = Depends(get_db)):
    question = create_question_service(db, payload)
    db.commit()
    db.refresh(question)
    return serialize_manage_question(question)


@router.post("/questions/bulk")
def create_questions_bulk(
    questions: list[QuestionCreate],
    db: Session = Depends(get_db)
):
    created = create_questions_bulk_service(db, questions)
    return [serialize_manage_question(question) for question in created]


@router.get("/questions")
def get_questions(db: Session = Depends(get_db)):
    return list_questions_for_manage(db)


@router.put("/questions/{question_id}", response_model=QuestionOut)
def update_question(
    question_id: int,
    payload: QuestionUpdate,
    db: Session = Depends(get_db)
):
    return update_question_service(db, question_id, payload)


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
    delete_question_service(db, question_id)
    return {"status": "deleted"}
