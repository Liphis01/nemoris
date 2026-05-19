import os
import shutil

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from ..config import STATIC_DIR
from ..dependencies import get_db
from ..models import Question


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

    if not question.media:
        return {"error": "No image"}

    is_local_static = (
        question.media.startswith("/static/") or
        question.media.startswith("http://127.0.0.1:8000/static/")
    )

    # Only delete files that this app owns. External URLs may be referenced by
    # media but should never be removed from disk.
    if not is_local_static:
        return {"error": "External image"}

    file_path = STATIC_DIR / os.path.basename(question.media)

    if os.path.exists(file_path):
        os.remove(file_path)

    question.media = None
    question.type_q = "text"

    db.commit()

    return {"status": "image deleted"}


@router.post("/upload")
def upload_image(file: UploadFile = File(...)):
    # Keep the stored URL relative so it works from both dev and packaged builds.
    filename = os.path.basename(file.filename)
    file_path = STATIC_DIR / filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"url": f"/static/{filename}"}
