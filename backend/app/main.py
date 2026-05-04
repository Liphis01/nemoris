from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import date
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
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
    answer: Optional[str] = ""
    tags: Optional[List[str]] = []
    type_q: str
    fichier: Optional[str] = ""
    data: Optional[Dict[str, Any]] = None

class AnswerRequest(BaseModel):
    question_id: int
    quality: int

class QuestionUpdate(BaseModel):
    question: Optional[str] = ""
    answer: Optional[str] = ""
    tags: Optional[List[str]] = []
    type_q: Optional[str] = ""
    fichier: Optional[str] = ""
    data: Optional[Dict[str, Any]] = None

class MapAnswerRequest(BaseModel):
    question_id: int
    items: Dict[str, int]  # code -> quality
    
class MapZoneUpdate(BaseModel):
    svg: str
    code: str
    label: str
    aliases: List[str] = []

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
    
    if not q.fichier.startswith("http://127.0.0.1:8000/static/"):
        return {"error": "External image"}

    if q.fichier:
        # extraire le chemin local
        file_path = q.fichier.replace("http://127.0.0.1:8000/", "")

        if "static/" not in file_path:
            return {"error": "wrong file path"}

        if os.path.exists(file_path):
            os.remove(file_path)

    # supprimer dans la DB
    q.fichier = None
    q.type_q = "text"

    db.commit()

    return {"status": "image deleted"}

# ➕ Ajouter une question
@app.post("/questions")
def create_question(data: QuestionCreate, db: Session = Depends(get_db)):
    q = Question(
        question=data.question,
        answer=data.answer,
        tags=data.tags,
        type_q=data.type_q,
        fichier=data.fichier,
        data=data.data,
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
            "tags": q.tags,
            "type_q": q.type_q,
            "fichier": q.fichier,
            "data": q.data,
            "next_review": progress.next_review if progress else None
        })

    return result


@app.get("/review")
def get_review(
    tags: Optional[List[str]] = [],
    limit: int = 200,
    db: Session = Depends(get_db)
):
    today = date.today()

    normal_questions = []
    map_groups = {}

    # 🔹 récupérer toutes les progress dues
    due_progress = db.query(Progress).filter(
        Progress.next_review <= today
    ).all()

    for p in due_progress:
        q = db.query(Question).filter(Question.id == p.question_id).first()
        if not q:
            continue

        # 🔹 filtre tags
        if tags and tags != ["global"] and not set(tags).intersection(set(q.tags or [])):
            continue

        # 🔥 MAP → GROUP
        if q.type_q == "map":
            svg = q.svg

            if svg not in map_groups:
                map_groups[svg] = []

            map_groups[svg].append({
                "id": q.id,
                "label": q.question,
                "code": q.code,
                "aliases": q.data.get("aliases", []) if q.data else [],
                "interval": p.interval,
                "ease": p.ease_factor
            })

        # 🔹 NORMAL
        else:
            normal_questions.append({
                "question_id": q.id,
                "question": q.question,
                "answer": q.answer,
                "tags": q.tags,
                "interval": p.interval,
                "ease": p.ease_factor,
                "type_q": q.type_q,
                "fichier": q.fichier
            })

    # 🔹 transformer groupes map → questions
    map_questions = []
    for svg, items in map_groups.items():
        map_questions.append({
            "type_q": "map",
            "svg": svg,
            "items": items
        })

    # 🔹 nouvelles questions (pas encore vues)
    seen_ids = [p.question_id for p in db.query(Progress).all()]

    new_query = db.query(Question)
    if tags and tags != ["global"]:
        new_query = new_query.filter(Question.tags.overlap(tags))

    new_questions = new_query.filter(~Question.id.in_(seen_ids)).all()

    for q in new_questions:
        if q.type_q == "map":
            # 🔥 regrouper aussi les nouvelles maps
            svg = q.svg

            if svg not in map_groups:
                map_groups[svg] = []

            map_groups[svg].append({
                "id": q.id,
                "label": q.question,
                "code": q.code,
                "aliases": q.data.get("aliases", []) if q.data else [],
                "interval": 1,
                "ease": 2.5
            })
        else:
            normal_questions.append({
                "question_id": q.id,
                "question": q.question,
                "answer": q.answer,
                "tags": q.tags,
                "interval": 1,
                "ease": 2.5,
                "type_q": q.type_q,
                "fichier": q.fichier
            })

    # 🔹 reconstruire map_questions (avec nouvelles incluses)
    map_questions = []
    for svg, items in map_groups.items():
        map_questions.append({
            "type_q": "map",
            "svg": svg,
            "items": items
        })

    return (normal_questions + map_questions)[:limit]


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

class MapAnswerRequest(BaseModel):
    items: Dict[int, int]  # question_id → quality


@app.post("/answer_map")
def answer_map(data: MapAnswerRequest, db: Session = Depends(get_db)):

    for q_id, quality in data.items.items():

        progress = db.query(Progress).filter(
            Progress.question_id == q_id
        ).first()

        if not progress:
            progress = Progress(question_id=q_id)
            db.add(progress)
            db.commit()
            db.refresh(progress)

        interval, ease, next_review = update_progress(
            progress.interval,
            progress.ease_factor,
            quality
        )

        progress.interval = interval
        progress.ease_factor = ease
        progress.next_review = next_review

    db.commit()

    return {"status": "ok"}

@app.post("/map_zone")
def upsert_map_zone(data: MapZoneUpdate, db: Session = Depends(get_db)):

    q = db.query(Question).filter(
        Question.type_q == "map",
        Question.svg == data.svg,
        Question.code == data.code
    ).first()

    if not q:
        q = Question(
            question=data.label,
            answer=data.label,
            type_q="map",
            svg=data.svg,
            code=data.code,
            data={
                "aliases": data.aliases
            }
        )
        db.add(q)
    else:
        q.question = data.label
        q.answer = data.label
        q.data = {"aliases": data.aliases}

    db.commit()
    db.refresh(q)

    return q

@app.get("/hard")
def get_test(db: Session = Depends(get_db)):
    return db.query(Progress).filter(Progress.ease_factor < 2.5).all()