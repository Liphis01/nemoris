from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from datetime import date
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from fastapi.staticfiles import StaticFiles
from fastapi import UploadFile, File
import shutil
import os

from .database import engine, SessionLocal
from .models import Base, QuestionGroup, Question, Progress, Collection
from .scheduler import update_progress
from .schemas import (
    QuestionCreate, 
    QuestionUpdate, 
    QuestionOut,
    GroupCreate,
    GroupUpdate,
    GroupOut,
    GroupMini,
    SetCollections,
    CollectionCreate,
    AnswerRequest,
    MapZoneUpdate
)
from .serializers import (
    serialize_progress,
    serialize_review_question,
    serialize_map_group,
    serialize_map_item
)

GROUP_COMPATIBILITY = {
    "map": ["map"],
    "timeline": ["timeline_item"],
    "diagram": ["diagram_label"]
}

def ensure_progress_schema():
    """
    Keep local SQLite databases usable after Progress model changes.
    create_all() creates missing tables, but it does not add columns.
    """
    with engine.begin() as connection:
        existing_columns = {
            row[1]
            for row in connection.exec_driver_sql(
                "PRAGMA table_info(progress)"
            )
        }

        columns = {
            "stability": "FLOAT",
            "difficulty": "FLOAT",
            "reps": "INTEGER",
            "lapses": "INTEGER",
            "last_review": "DATE",
            "history": "JSON"
        }

        for column_name, column_type in columns.items():
            if column_name not in existing_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE progress ADD COLUMN {column_name} {column_type}"
                )


def create_initial_progress(question_id: int):
    return Progress(
        question_id=question_id,
        stability=1.0,
        difficulty=5.0,
        reps=0,
        lapses=0,
        interval=0,
        next_review=date.today(),
        history=[]
    )


def record_answer_history(progress: Progress, quality: int, scheduling: dict):
    history = list(progress.history or [])

    history.append({
        "reviewed_on": scheduling["last_review"].isoformat(),
        "quality": quality,
        "stability": scheduling["stability"],
        "difficulty": scheduling["difficulty"],
        "reps": scheduling["reps"],
        "lapses": scheduling["lapses"],
        "interval": scheduling["interval"],
        "next_review": scheduling["next_review"].isoformat()
    })

    progress.history = history


def apply_scheduling(progress: Progress, quality: int):
    scheduling = update_progress(progress, quality)

    progress.stability = scheduling["stability"]
    progress.difficulty = scheduling["difficulty"]
    progress.reps = scheduling["reps"]
    progress.lapses = scheduling["lapses"]
    progress.interval = scheduling["interval"]
    progress.last_review = scheduling["last_review"]
    progress.next_review = scheduling["next_review"]

    record_answer_history(progress, quality, scheduling)

    return scheduling


# Création des tables
Base.metadata.create_all(bind=engine)
ensure_progress_schema()

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

# =====================================================
# QUESTIONS CRUD
# =====================================================

# ➕ Ajouter une question
@app.post("/questions")
def create_question(
    payload: QuestionCreate,
    db: Session = Depends(get_db)
):
    # =====================================================
    # REQUIRED FIELDS
    # =====================================================

    type_q = payload.type_q

    # =====================================================
    # OPTIONAL GROUP
    # =====================================================

    group = None
    group_id = payload.group_id

    if group_id:

        group = (
            db.query(QuestionGroup)
            .filter(QuestionGroup.id == group_id)
            .first()
        )

        if not group:
            raise HTTPException(
                status_code=404,
                detail="Group not found"
            )

        # ================================================
        # TYPE COMPATIBILITY
        # ================================================

        allowed = GROUP_COMPATIBILITY.get(
            group.type_group,
            []
        )

        if type_q not in allowed:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{type_q} incompatible "
                    f"with group type "
                    f"{group.type_group}"
                )
            )

    # =====================================================
    # CREATE QUESTION
    # =====================================================

    question = Question(
        type_q=type_q,

        question=payload.question,

        answer=payload.answer,

        media=payload.media,

        tags=payload.tags,

        data=payload.data,

        group_id=group_id
    )

    db.add(question)
    db.flush()

    # =====================================================
    # CREATE PROGRESS
    # =====================================================

    progress = create_initial_progress(question.id)

    db.add(progress)

    # =====================================================
    # COLLECTIONS
    # =====================================================

    if payload.collection_ids:

        collections = (
            db.query(Collection)
            .filter(Collection.id.in_(payload.collection_ids))
            .all()
        )

        question.collections = collections

    db.commit()
    db.refresh(question)

    return question

@app.post("/questions/bulk")
def create_questions_bulk(
    questions: List[QuestionCreate],
    db: Session = Depends(get_db)
):
    created = []

    try:

        for data in questions:

            # =================================================
            # GROUP VALIDATION
            # =================================================

            group = None

            if data.group_id:

                group = (
                    db.query(QuestionGroup)
                    .filter(
                        QuestionGroup.id == data.group_id
                    )
                    .first()
                )

                if not group:
                    raise HTTPException(
                        404,
                        f"Group {data.group_id} not found"
                    )

                allowed = GROUP_COMPATIBILITY.get(
                    group.type_group,
                    []
                )

                if data.type_q not in allowed:
                    raise HTTPException(
                        400,
                        (
                            f"{data.type_q} incompatible "
                            f"with group type "
                            f"{group.type_group}"
                        )
                    )

            # =================================================
            # CREATE QUESTION
            # =================================================

            q = Question(
                type_q=data.type_q,

                question=data.question,

                answer=data.answer,

                media=data.media,

                tags=data.tags or [],

                data=data.data,

                group_id=data.group_id
            )

            db.add(q)
            db.flush()

            progress = create_initial_progress(q.id)

            db.add(progress)

            if data.collection_ids:
                collections = (
                    db.query(Collection)
                    .filter(Collection.id.in_(data.collection_ids))
                    .all()
                )
                q.collections = collections

            created.append(q)

        db.commit()

    except:
        db.rollback()
        raise

    return created

# 📥 Récupérer toutes les questions
@app.get("/questions")
def get_questions(db: Session = Depends(get_db)):

    questions = (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .all()
    )

    result = []

    for q in questions:
        result.append({
            "id": q.id,

            "type_q": q.type_q,

            "question": q.question,
            "answer": q.answer,

            "media": q.media,

            "tags": q.tags or [],

            "data": q.data or {},

            "progress": serialize_progress(q.progress),

            "group":
                {
                    "id": q.group.id,
                    "type_group": q.group.type_group,
                    "name": q.group.name,
                    "media": q.group.media
                }
                if q.group else None,

            "collections": [
                {
                    "id": c.id,
                    "name": c.name
                }
                for c in q.collections
            ]
        })

    return result

@app.put(
    "/questions/{question_id}",
    response_model=QuestionOut
)
def update_question(
    question_id: int,
    payload: QuestionUpdate,
    db: Session = Depends(get_db)
):

    question = (
        db.query(Question)
        .options(
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .filter(Question.id == question_id)
        .first()
    )

    if not question:
        raise HTTPException(
            status_code=404,
            detail="Question not found"
        )

    # =====================================================
    # ONLY SENT FIELDS
    # =====================================================

    updates = payload.model_dump(
        exclude_unset=True
    )

    # =====================================================
    # FUTURE TYPE
    # =====================================================

    future_type = updates.get(
        "type_q",
        question.type_q
    )

    # =====================================================
    # FUTURE GROUP
    # =====================================================

    future_group_id = updates.get(
        "group_id",
        question.group_id
    )

    if future_group_id:

        future_group = (
            db.query(QuestionGroup)
            .filter(
                QuestionGroup.id == future_group_id
            )
            .first()
        )

        if not future_group:
            raise HTTPException(
                status_code=404,
                detail="Group not found"
            )

        allowed = GROUP_COMPATIBILITY.get(
            future_group.type_group,
            []
        )

        if future_type not in allowed:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{future_type} incompatible "
                    f"with group type "
                    f"{future_group.type_group}"
                )
            )

    # =====================================================
    # SIMPLE FIELDS
    # =====================================================

    editable_fields = [
        "type_q",
        "question",
        "answer",
        "media",
        "tags",
        "data",
        "group_id"
    ]

    for field in editable_fields:

        if field in updates:

            setattr(
                question,
                field,
                updates[field]
            )

    # =====================================================
    # COLLECTIONS
    # =====================================================

    if "collection_ids" in updates:

        collections = (
            db.query(Collection)
            .filter(
                Collection.id.in_(
                    updates["collection_ids"]
                )
            )
            .all()
        )

        question.collections = collections

    db.commit()
    db.refresh(question)

    return question

@app.put("/questions/{question_id}/collections")
def set_collections(question_id: int, data: SetCollections, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).first()

    if not q:
        raise HTTPException(
            status_code=404,
            detail="Question not found"
        )

    collections = db.query(Collection).filter(Collection.id.in_(data.collection_ids)).all()

    q.collections = collections

    db.commit()
    return {"status": "ok"}

@app.delete("/questions/{question_id}")
def delete_question(
    question_id: int,
    db: Session = Depends(get_db)
):
    question = (
        db.query(Question)
        .options(
            joinedload(Question.group)
        )
        .filter(Question.id == question_id)
        .first()
    )

    if not question:
        raise HTTPException(
            status_code=404,
            detail="Question not found"
        )

    group = question.group

    db.delete(question)
    db.commit()

    # =====================================================
    # DELETE EMPTY GROUP
    # =====================================================

    if group:

        remaining = (
            db.query(Question)
            .filter(Question.group_id == group.id)
            .count()
        )

        if remaining == 0:
            db.delete(group)
            db.commit()

    return {
        "status": "deleted"
    }

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

# =====================================================
# GROUPS CRUD
# =====================================================

@app.post(
    "/groups",
    response_model=GroupOut
)
def create_group(
    payload: GroupCreate,
    db: Session = Depends(get_db)
):

    new_group = QuestionGroup(

        type_group=payload.type_group,

        name=payload.name,

        media=payload.media,

        data=payload.data
    )

    db.add(new_group)

    db.commit()

    db.refresh(new_group)

    return new_group

@app.get("/groups")
def get_groups(db: Session = Depends(get_db)):

    groups = (
        db.query(QuestionGroup)
        .options(
            joinedload(QuestionGroup.questions)
        )
        .all()
    )

    result = []

    for g in groups:
        result.append({
            "id": g.id,

            "type_group": g.type_group,

            "name": g.name,

            "media": g.media,

            "question_count": len(g.questions)
        })

    return result

@app.get("/groups/{group_id}")
def get_group(
    group_id: int,
    db: Session = Depends(get_db)
):
    group = (
        db.query(QuestionGroup)
        .options(
            joinedload(QuestionGroup.questions)
        )
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    return {
        "id": group.id,
        "name": group.name,
        "type_group": group.type_group,
        "media": group.media,
        "data": group.data or {},
        "questions": [
            {
                "id": q.id,
                "type_q": q.type_q,
                "question": q.question,
                "answer": q.answer,
                "media": q.media,
                "tags": q.tags or [],
                "data": q.data or {}
            }
            for q in group.questions
        ]
    }

@app.put(
    "/groups/{group_id}",
    response_model=GroupOut
)
def update_group(
    group_id: int,
    payload: GroupUpdate,
    db: Session = Depends(get_db)
):

    group = (
        db.query(QuestionGroup)
        .filter(
            QuestionGroup.id == group_id
        )
        .first()
    )

    if not group:
        raise HTTPException(
            status_code=404,
            detail="Group not found"
        )

    updates = payload.model_dump(
        exclude_unset=True
    )

    editable_fields = [
        "name",
        "media",
        "data"
    ]

    for field in editable_fields:

        if field in updates:

            setattr(
                group,
                field,
                updates[field]
            )

    db.commit()

    db.refresh(group)

    return group
    
@app.delete("/groups/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db)
):

    group = (
        db.query(QuestionGroup)
        .filter(
            QuestionGroup.id == group_id
        )
        .first()
    )

    if not group:
        raise HTTPException(
            status_code=404,
            detail="Group not found"
        )

    if group.questions:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot delete group "
                "with existing questions"
            )
        )

    db.delete(group)

    db.commit()

    return {
        "status": "deleted"
    }

# =====================================================
# COLLECTIONS CRUD
# =====================================================

@app.post("/collections")
def create_collection(data: CollectionCreate, db: Session = Depends(get_db)):
    c = Collection(name=data.name, description=data.description)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c

@app.get("/collections")
def get_collections(db: Session = Depends(get_db)):
    return db.query(Collection).all()

# =====================================================
# REVIEW & ANSWERS
# =====================================================

@app.get("/review")
def get_review(
    tags: Optional[List[str]] = None,
    limit: int = 200,
    collection_id: Optional[int] = None,
    db: Session = Depends(get_db)
):

    today = date.today()

    query = (
        db.query(Question)
        .outerjoin(Progress)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .filter(
            or_(
                Progress.id == None,
                Progress.next_review == None,
                Progress.next_review <= today
            )
        )
    )

    questions = query.all()

    review_items = []

    grouped_items = {}

    for q in questions:

        # ================================================
        # COLLECTION FILTER
        # ================================================

        if collection_id:

            if not any(
                c.id == collection_id
                for c in q.collections
            ):
                continue

        # ================================================
        # TAG FILTER
        # ================================================

        if tags:

            if not set(tags).intersection(
                set(q.tags or [])
            ):
                continue

        # ================================================
        # GROUPED TYPES
        # ================================================

        if q.group:

            group_type = q.group.type_group

            # ============================================
            # MAP
            # ============================================

            if group_type == "map":

                gid = q.group.id

                if gid not in grouped_items:

                    grouped_items[gid] = serialize_map_group(q.group)

                grouped_items[gid]["items"].append(serialize_map_item(q))

                continue

        # ================================================
        # NORMAL QUESTION
        # ================================================

        review_items.append(serialize_review_question(q))

    return (
        review_items +
        list(grouped_items.values())
    )[:limit]

@app.post("/answer")
def answer_question(
    data: AnswerRequest,
    db: Session = Depends(get_db)
):
    progress = (
        db.query(Progress)
        .filter(Progress.question_id == data.question_id)
        .first()
    )

    # =========================================================
    # CREATE NEW PROGRESS
    # =========================================================

    if not progress:
        progress = create_initial_progress(data.question_id)

        db.add(progress)

    # =========================================================
    # FSRS UPDATE
    # =========================================================

    apply_scheduling(progress, data.quality)

    db.commit()

    return {
        "stability": progress.stability,
        "difficulty": progress.difficulty,
        "interval": progress.interval,
        "last_review": progress.last_review,
        "next_review": progress.next_review,
        "reps": progress.reps,
        "lapses": progress.lapses,
        "history": progress.history or []
    }


# ============================================================
# MAP ANSWERS
# ============================================================

class MapAnswerRequest(BaseModel):
    items: Dict[int, int]  # question_id -> quality


@app.post("/answer_map")
def answer_map(
    data: MapAnswerRequest,
    db: Session = Depends(get_db)
):

    # =========================================================
    # LOAD ALL EXISTING PROGRESSES IN ONE QUERY
    # =========================================================

    question_ids = list(data.items.keys())

    existing_progresses = (
        db.query(Progress)
        .filter(Progress.question_id.in_(question_ids))
        .all()
    )

    progress_map = {
        p.question_id: p
        for p in existing_progresses
    }

    # =========================================================
    # PROCESS EACH ANSWER
    # =========================================================

    for q_id, quality in data.items.items():

        progress = progress_map.get(q_id)

        # -----------------------------------------------------
        # CREATE NEW PROGRESS
        # -----------------------------------------------------

        if not progress:

            progress = create_initial_progress(q_id)

            db.add(progress)
            progress_map[q_id] = progress

        # -----------------------------------------------------
        # FSRS UPDATE
        # -----------------------------------------------------

        apply_scheduling(progress, quality)

    db.commit()

    return {"status": "ok"}

# =====================================================
# MAPS
# =====================================================

@app.get("/maps/{group_id}/zones")
def get_map_zones(
    group_id: int,
    db: Session = Depends(get_db)
):

    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404)

    return [
        {
            "id": q.id,

            "code": q.data.get("code") if q.data else None,

            "label": q.question,

            "aliases": q.data.get("aliases", []) if q.data else [],

            "progress": serialize_progress(q.progress)
        }
        for q in group.questions
    ]

@app.post("/map_zone")
def upsert_map_zone(data: MapZoneUpdate, db: Session = Depends(get_db)):

    # Find existing zone by group_id and data.code
    code = data.data.get("code") if data.data else None

    # Query all zones for this group and find the matching one
    zones = db.query(Question).filter(
        Question.type_q == "map_zone",
        Question.group_id == data.group_id
    ).all()

    q = None
    if code:
        q = next((z for z in zones if z.data and z.data.get("code") == code), None)

    if not q:
        q = Question(
            question=data.question,
            answer=data.question,
            type_q="map_zone",
            data=data.data,
            group_id=data.group_id
        )
        db.add(q)
        db.flush()
        db.add(create_initial_progress(q.id))
    else:
        q.question = data.question
        q.answer = data.question
        q.data = data.data

    db.commit()
    db.refresh(q)

    return q

# =====================================================
# UPLOAD
# =====================================================

@app.post("/upload")
def upload_image(file: UploadFile = File(...)):
    file_path = f"static/{file.filename}"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"url": f"http://127.0.0.1:8000/{file_path}"}
