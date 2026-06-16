from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import Question
from ..schemas import MediaUrlImport
from ..services.media import (
    delete_unreferenced_media_file,
    store_remote_image,
    store_uploaded_image
)


router = APIRouter()


@router.delete("/questions/{question_id}/image")
def delete_image(question_id: int, db: Session = Depends(get_db)):
    question = (
        db.query(Question)
        .filter(Question.id == question_id)
        .first()
    )

    if not question:
        return {"error": "Question not found"}

    old_media = question.media

    if not old_media:
        return {"error": "No image"}

    question.media = None
    db.commit()
    delete_unreferenced_media_file(db, old_media)

    return {"status": "image deleted"}


@router.post("/upload")
def upload_image(file: UploadFile = File(...)):
    return store_uploaded_image(file)


@router.post("/upload/url")
def upload_image_from_url(payload: MediaUrlImport):
    return store_remote_image(payload.url)
