from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import date
from pydantic import BaseModel
from typing import Optional

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

# 🔌 DB dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class QuestionCreate(BaseModel):
    question: str
    answer: str
    theme: str

class AnswerRequest(BaseModel):
    question_id: int
    quality: int

class QuestionUpdate(BaseModel):
    question: str
    answer: str
    theme: str

@app.put("/questions/{question_id}")
def update_question(question_id: int, data: QuestionUpdate, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).first()

    if not q:
        return {"error": "Question not found"}

    q.question = data.question
    q.answer = data.answer
    q.theme = data.theme

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

# ➕ Ajouter une question
@app.post("/questions")
def create_question(data: QuestionCreate, db: Session = Depends(get_db)):
    q = Question(
        question=data.question,
        answer=data.answer,
        theme=data.theme
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


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
            "ease": p.ease_factor
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
            "ease": 2.5
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
    return db.query(Progress).filter(Progress.ease_factor != 2.5).all()