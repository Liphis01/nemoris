from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import date
from pydantic import BaseModel
from typing import Optional, Dict, Any
from fastapi.staticfiles import StaticFiles
from fastapi import UploadFile, File
import shutil
import os

from .database import engine, SessionLocal
from .models import Base, Question, Progress
from .scheduler import update_progress

# Création des tables
Base.metadata.create_all(bind=engine)

app = FastAPI()

# Autoriser le frontend (React)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # OK pour dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir les fichiers statiques (images)
app.mount("/static", StaticFiles(directory="static"), name="static")

# 🔌 DB dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class QuestionCreate(BaseModel):
    question: str
    answer: Optional[str] = None
    theme: str
    type_q: str
    image_url: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

class AnswerRequest(BaseModel):
    question_id: int
    quality: int

class QuestionUpdate(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    theme: Optional[str] = None
    type_q: Optional[str] = None
    image_url: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

@app.put("/questions/{question_id}")
def update_question(question_id: int, data: QuestionUpdate, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).first()

    if not q:
        return {"error": "Question not found"}

    update_data = data.dict(exclude_unset=True)

    for key, value in update_data.items():
        setattr(q, key, value)

    db.commit()
    return {"status": "ok"}

@app.delete("/questions/{question_id}")
def delete_question(question_id: int, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).first()

    if not q:
        return {"error": "Question not found"}

    # supprimer aussi le progress associé
    db.query(Progress).filter(Progress.question_id == question_id).delete()

    db.delete(q)
    db.commit()

    return {"status": "deleted"}

@app.delete("/questions/{question_id}/image")
def delete_image(question_id: int, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).first()

    if not q:
        return {"error": "Question not found"}
    
    if not q.image_url.startswith("http://127.0.0.1:8000/static/"):
        return {"error": "External image"}

    if q.image_url:
        # extraire le chemin local
        file_path = q.image_url.replace("http://127.0.0.1:8000/", "")

        if "static/" not in file_path:
            return {"error": "wrong file path"}

        if os.path.exists(file_path):
            os.remove(file_path)

    # supprimer dans la DB
    q.image_url = None
    q.type_q = "text"

    db.commit()

    return {"status": "image deleted"}

# ➕ Ajouter une question
@app.post("/questions")
def create_question(data: QuestionCreate, db: Session = Depends(get_db)):
    q = Question(
        question=data.question,
        answer=data.answer,
        theme=data.theme,
        type_q=data.type_q,
        image_url=data.image_url,
        data=data.data
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return q

@app.post("/upload")
def upload_image(file: UploadFile = File(...)):
    file_path = f"static/{file.filename}"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"url": f"http://127.0.0.1:8000/{file_path}"}

# 📥 Récupérer toutes les questions
@app.get("/questions")
def get_questions(db: Session = Depends(get_db)):
    questions = db.query(Question).all()

    result = []
    for q in questions:
        progress = db.query(Progress).filter(Progress.question_id == q.id).first()

        result.append({
            "id": q.id,
            "question": q.question,
            "answer": q.answer,
            "theme": q.theme,
            "type_q": q.type_q,
            "image_url": q.image_url,
            "data": q.data,
            "next_review": progress.next_review if progress else None
        })

    return result


@app.get("/review")
def get_review(
    theme: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    from datetime import date
    today = date.today()

    questions = []

    # Filtre de thème
    def theme_filter(query):
        if theme and theme != "global":
            return query.filter(Question.theme == theme)
        return query

    # 1. Questions à revoir
    due_progress = db.query(Progress).filter(Progress.next_review <= today).all()

    for p in due_progress:
        q = db.query(Question).filter(Question.id == p.question_id).first()
        if not q:
            continue

        if theme and theme != "global" and q.theme != theme:
            continue

        questions.append({
            "question_id": q.id,
            "question": q.question,
            "answer": q.answer,
            "theme": q.theme,
            "interval": p.interval,
            "ease": p.ease_factor,
            "type_q": q.type_q,
            "image_url": q.image_url,
            "data": q.data
        })

    # 2. Nouvelles questions
    seen_ids = [p.question_id for p in db.query(Progress).all()]

    new_query = db.query(Question)
    new_query = theme_filter(new_query)

    new_questions = new_query.filter(~Question.id.in_(seen_ids)).all()

    for q in new_questions:
        questions.append({
            "question_id": q.id,
            "question": q.question,
            "answer": q.answer,
            "theme": q.theme,
            "interval": 1,
            "ease": 2.5,
            "type_q": q.type_q,
            "image_url": q.image_url,
            "data": q.data
        })

    # 3. Limite
    return questions[:limit]


@app.post("/answer")
def answer_question(data: AnswerRequest, db: Session = Depends(get_db)):
    progress = db.query(Progress).filter(Progress.question_id == data.question_id).first()

    if not progress:
        progress = Progress(question_id=data.question_id)
        db.add(progress)
        db.commit()
        db.refresh(progress)

    interval, ease, next_review = update_progress(
        progress.interval,
        progress.ease_factor,
        data.quality
    )

    progress.interval = interval
    progress.ease_factor = ease
    progress.next_review = next_review

    db.commit()

    return {
        "interval": interval,
        "next_review": next_review
    }

@app.get("/hard")
def get_test(db: Session = Depends(get_db)):
    return db.query(Progress).filter(Progress.ease_factor < 2.5).all()