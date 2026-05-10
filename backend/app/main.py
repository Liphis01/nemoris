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
from .models import Base, Question, Progress, Collection, Map
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
    type_q: str = "text"

    media: Optional[str] = None
    code: Optional[str] = None
    aliases: Optional[List[str]] = []
    map_id: Optional[int] = None

class AnswerRequest(BaseModel):
    question_id: int
    quality: int

class QuestionUpdate(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    tags: Optional[List[str]] = None
    type_q: Optional[str] = None

    media: Optional[str] = None
    code: Optional[str] = None
    aliases: Optional[List[str]] = None
    map_id: Optional[int] = None

class MapAnswerRequest(BaseModel):
    items: Dict[int, int]
    
class MapZoneUpdate(BaseModel):
    map_id: int
    code: str
    label: str
    aliases: List[str] = []

class CollectionCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    
class SetCollections(BaseModel):
    collection_ids: list[int]

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

@app.put("/questions/{question_id}/collections")
def set_collections(question_id: int, data: SetCollections, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).first()

    if not q:
        return {"error": "not found"}

    collections = db.query(Collection).filter(Collection.id.in_(data.collection_ids)).all()

    q.collections = collections

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

    if not q.media:
        return {"error": "No image"}

    if not q.media.startswith("http://127.0.0.1:8000/static/"):
        return {"error": "External image"}

    file_path = q.media.replace("http://127.0.0.1:8000/", "")

    if os.path.exists(file_path):
        os.remove(file_path)

    q.media = None
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
        media=data.media,
        code=data.code,
        aliases=data.aliases,
        map_id=data.map_id
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
            "media": q.media,
            "code": q.code,
            "aliases": q.aliases,
            "map_id": q.map_id,
            "map_svg": q.map.svg if q.map else None,
            "collections": [c.id for c in q.collections],
            "next_review": progress.next_review if progress else None
        })

    return result


from sqlalchemy.orm import joinedload

@app.get("/review")
def get_review(
    tags: Optional[List[str]] = None,
    limit: int = 200,
    collection_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    today = date.today()

    normal_questions = []
    map_groups = {}

    # 🔹 1. DUE QUESTIONS (JOIN direct)
    due = (
        db.query(Question, Progress)
        .join(Progress, Progress.question_id == Question.id)
        .options(
            joinedload(Question.collections),
            joinedload(Question.map)
        )
        .filter(Progress.next_review <= today)
        .all()
    )

    seen_ids = set()

    for q, p in due:
        seen_ids.add(q.id)

        # 🔹 filter collection
        if collection_id:
            if not any(c.id == collection_id for c in q.collections):
                continue

        # 🔹 filter tags
        if tags:
            if not set(tags).intersection(set(q.tags or [])):
                continue

        # 🔥 MAP
        if q.type_q == "map" and q.map:
            map_id = q.map_id

            if map_id not in map_groups:
                map_groups[map_id] = {
                    "type_q": "map",
                    "map_id": map_id,
                    "media": q.map.svg,
                    "items": []
                }

            map_groups[map_id]["items"].append({
                "id": q.id,
                "label": q.question,
                "code": q.code,
                "aliases": q.aliases or [],
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
                "media": q.media
            })

    # 🔹 2. NEW QUESTIONS (1 seule query)
    new_questions = (
        db.query(Question)
        .options(
            joinedload(Question.collections),
            joinedload(Question.map)
        )
        .filter(~Question.id.in_(seen_ids))
        .all()
    )

    for q in new_questions:

        # 🔹 filter collection
        if collection_id:
            if not any(c.id == collection_id for c in q.collections):
                continue

        # 🔹 filter tags
        if tags:
            if not set(tags).intersection(set(q.tags or [])):
                continue

        # 🔥 MAP
        if q.type_q == "map" and q.map:
            map_id = q.map_id

            if map_id not in map_groups:
                map_groups[map_id] = {
                    "type_q": "map",
                    "map_id": map_id,
                    "media": q.map.svg,
                    "items": []
                }

            map_groups[map_id]["items"].append({
                "id": q.id,
                "label": q.question,
                "code": q.code,
                "aliases": q.aliases or [],
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
                "media": q.media
            })

    return (normal_questions + list(map_groups.values()))[:limit]

@app.get("/collections")
def get_collections(db: Session = Depends(get_db)):
    return db.query(Collection).all()

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
        Question.map_id == data.map_id,
        Question.code == data.code
    ).first()

    if not q:
        q = Question(
            question=data.label,
            answer=data.label,
            type_q="map",
            code=data.code,
            aliases=data.aliases,
            map_id=data.map_id
        )
        db.add(q)
    else:
        q.question = data.label
        q.answer = data.label
        q.aliases = data.aliases

    db.commit()
    db.refresh(q)

    return q

@app.post("/collections")
def create_collection(data: CollectionCreate, db: Session = Depends(get_db)):
    c = Collection(name=data.name, description=data.description)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c

@app.get("/hard")
def get_test(db: Session = Depends(get_db)):
    return db.query(Progress).filter(Progress.ease_factor < 2.5).all()