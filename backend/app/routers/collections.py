from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, func, or_
from sqlalchemy.orm import Session, aliased, joinedload

from ..dependencies import get_db
from ..models import Collection, Question, QuestionGroup, question_collection
from ..schemas import CollectionCreate, CollectionPreview, CollectionUpdate
from ..services.tombstones import record_tombstone
from ..services.tag_hierarchy import (
    descendants,
    ensure_stored_tag_ids,
    load_tag_hierarchy,
    parent_map,
    resolve_tag_id
)
from ..services.collections import (
    EXCLUDED_FIELD,
    PINNED_FIELD,
    RULES_FIELD,
    canonicalize_collection_rules,
    clause_match_count,
    collection_data,
    generated_collection_response_fields,
    is_generated_collection,
    resolve_playlist_data,
    sync_all_collection_memberships,
    sync_collection_membership,
    sync_generated_hard_collection
)


router = APIRouter()


def _collection_response(collection):
    question_ids = sorted(
        question.id
        for question in (collection.questions or [])
        if question.id is not None
    )
    data = collection_data(collection)

    return {
        "id": collection.id,
        "name": collection.name,
        "data": data,
        # The rule and its manual overrides are what the builder edits;
        # question_ids is the resolved result of applying them.
        "rules": data.get(RULES_FIELD) or {"match": "any", "clauses": []},
        "pinned_question_ids": data.get(PINNED_FIELD) or [],
        "excluded_question_ids": data.get(EXCLUDED_FIELD) or [],
        "question_ids": question_ids,
        "question_count": len(question_ids),
        **generated_collection_response_fields(collection)
    }


def _text_preview(value, max_length=120):
    text = " ".join(str(value or "").split())

    if len(text) <= max_length:
        return text

    return f"{text[:max_length - 3].rstrip()}..."


def _question_title(question):
    if question.type_q in {"map", "media"}:
        return (
            question.answer
            or question.question
            or f"Question #{question.id}"
        )

    return (
        question.question
        or question.answer
        or f"Question #{question.id}"
    )


def _question_candidate_response(question):
    group = question.group

    return {
        "id": question.id,
        "type_q": question.type_q,
        "group_id": question.group_id,
        "title": _question_title(question),
        "question": _text_preview(question.question),
        "answer_preview": _text_preview(question.answer),
        "tags": question.tags or [],
        "has_media": bool(question.media),
        "group": (
            {
                "id": group.id,
                "name": group.name,
                "type_group": group.type_group
            }
            if group
            else None
        )
    }


def _clean_collection_name(name):
    cleaned = str(name or "").strip()

    if not cleaned:
        raise HTTPException(status_code=400, detail="Collection name is required")

    return cleaned


def _ensure_unique_collection_name(db, name, collection_id=None):
    query = db.query(Collection).filter(
        func.lower(Collection.name) == name.lower()
    )

    if collection_id is not None:
        query = query.filter(Collection.id != collection_id)

    if query.first():
        raise HTTPException(
            status_code=409,
            detail="Collection name already exists"
        )


def _dedupe_question_ids(question_ids):
    ids = []
    seen = set()

    for question_id in question_ids or []:
        normalized = int(question_id)

        if normalized in seen:
            continue

        seen.add(normalized)
        ids.append(normalized)

    return ids


def _questions_for_ids(db, question_ids):
    ids = _dedupe_question_ids(question_ids)

    if not ids:
        return []

    questions = (
        db.query(Question)
        .filter(Question.id.in_(ids))
        .all()
    )
    questions_by_id = {
        question.id: question
        for question in questions
    }
    missing_ids = [
        question_id
        for question_id in ids
        if question_id not in questions_by_id
    ]

    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Questions not found: {missing_ids}"
        )

    return [
        questions_by_id[question_id]
        for question_id in ids
    ]


@router.get("/collections/question_candidates")
def get_collection_question_candidates(
    search: str = "",
    type_q: str | None = None,
    group_id: int | None = None,
    tag: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sort: str = "recent",
    db: Session = Depends(get_db)
):
    query = (
        db.query(Question)
        .outerjoin(QuestionGroup)
        .options(joinedload(Question.group))
    )

    if type_q:
        query = query.filter(Question.type_q == type_q)

    if group_id is not None:
        query = query.filter(Question.group_id == group_id)

    clean_tag = str(tag or "").strip()

    if clean_tag:
        ensure_stored_tag_ids(db)
        hierarchy = load_tag_hierarchy(db)
        tag_id = resolve_tag_id(hierarchy, clean_tag)
        if tag_id:
            query = query.filter(or_(*[
                Question.tags.cast(String).ilike(f'%"{descendant_id}"%')
                for descendant_id in sorted(descendants(tag_id, parent_map(hierarchy)))
            ]))
        else:
            query = query.filter(Question.id == -1)

    clean_search = str(search or "").strip()

    if clean_search:
        pattern = f"%{clean_search}%"
        query = query.filter(or_(
            Question.question.ilike(pattern),
            Question.answer.ilike(pattern),
            Question.tags.cast(String).ilike(pattern),
            Question.data.cast(String).ilike(pattern),
            QuestionGroup.name.ilike(pattern)
        ))

    total = query.count()

    recent_question = aliased(Question)
    group_recent = (
        db.query(
            recent_question.group_id.label("group_id"),
            func.max(recent_question.id).label("recent_id")
        )
        .filter(recent_question.group_id.isnot(None))
        .group_by(recent_question.group_id)
        .subquery()
    )
    query = query.outerjoin(
        group_recent,
        Question.group_id == group_recent.c.group_id
    )
    recent_rank = func.coalesce(group_recent.c.recent_id, Question.id)

    query = query.order_by(
        recent_rank.desc(),
        Question.group_id.is_(None),
        func.lower(QuestionGroup.name),
        Question.id.desc()
    )

    items = query.offset(offset).limit(limit).all()

    return {
        "items": [
            _question_candidate_response(question)
            for question in items
        ],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.post("/collections/preview")
def preview_collection(
    payload: CollectionPreview,
    db: Session = Depends(get_db)
):
    """Resolve a rule that has not been saved.

    Declared before /collections/{collection_id} so "preview" is not parsed
    as an id.
    """
    rules = canonicalize_collection_rules(
        db,
        payload.rules.model_dump() if payload.rules is not None else {}
    )
    questions = resolve_playlist_data(db, {
        RULES_FIELD: rules,
        PINNED_FIELD: _dedupe_question_ids(payload.question_ids),
        EXCLUDED_FIELD: _dedupe_question_ids(payload.excluded_question_ids)
    })
    by_type = {}
    by_group = set()

    for question in questions:
        by_type[question.type_q] = by_type.get(question.type_q, 0) + 1

        if question.group_id is not None:
            by_group.add(question.group_id)

    return {
        "total": len(questions),
        "group_count": len(by_group),
        "type_counts": by_type,
        # Per-rule contribution, in the order the builder shows them.
        "clause_counts": [
            clause_match_count(db, clause)
            for clause in (rules.get("clauses") or [])
        ],
        "items": [
            _question_candidate_response(question)
            for question in questions[:payload.limit]
        ]
    }


@router.post("/collections")
def create_collection(data: CollectionCreate, db: Session = Depends(get_db)):
    name = _clean_collection_name(data.name)
    _ensure_unique_collection_name(db, name)

    pinned = _dedupe_question_ids(data.question_ids)
    # Existence check only -- membership itself is resolved below, so a
    # pinned id that no longer exists is a 404 rather than a silent drop.
    _questions_for_ids(db, pinned)

    collection = Collection(
        name=name,
        data={
            RULES_FIELD: canonicalize_collection_rules(
                db,
                data.rules.model_dump() if data.rules is not None
                else {"match": "any", "clauses": []}
            ),
            PINNED_FIELD: pinned,
            EXCLUDED_FIELD: _dedupe_question_ids(data.excluded_question_ids)
        },
        questions=[]
    )
    db.add(collection)
    db.flush()
    sync_collection_membership(db, collection)
    db.commit()
    db.refresh(collection)
    return _collection_response(collection)


@router.get("/collections")
def get_collections(db: Session = Depends(get_db)):
    sync_generated_hard_collection(db)
    # Rules are live: a question tagged since the last visit joins its
    # playlist here, without anyone re-opening the builder.
    sync_all_collection_memberships(db)

    return [
        _collection_response(collection)
        for collection in (
            db.query(Collection)
            .options(joinedload(Collection.questions))
            .order_by(Collection.id)
            .all()
        )
    ]


@router.get("/collections/{collection_id}/questions")
def get_collection_questions(collection_id: int, db: Session = Depends(get_db)):
    sync_generated_hard_collection(db)

    collection = (
        db.query(Collection)
        .options(
            joinedload(Collection.questions).joinedload(Question.group)
        )
        .filter(Collection.id == collection_id)
        .first()
    )

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    sync_collection_membership(db, collection, commit=True)

    questions = sorted(
        collection.questions or [],
        key=lambda question: question.id or 0
    )

    return [
        _question_candidate_response(question)
        for question in questions
    ]


@router.get("/collections/{collection_id}")
def get_collection(collection_id: int, db: Session = Depends(get_db)):
    sync_generated_hard_collection(db)

    collection = (
        db.query(Collection)
        .options(joinedload(Collection.questions))
        .filter(Collection.id == collection_id)
        .first()
    )

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    sync_collection_membership(db, collection, commit=True)

    return _collection_response(collection)


@router.put("/collections/{collection_id}")
def update_collection(
    collection_id: int,
    payload: CollectionUpdate,
    db: Session = Depends(get_db)
):
    sync_generated_hard_collection(db)

    collection = (
        db.query(Collection)
        .options(joinedload(Collection.questions))
        .filter(Collection.id == collection_id)
        .first()
    )

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if is_generated_collection(collection):
        raise HTTPException(
            status_code=400,
            detail="Generated collections cannot be modified"
        )

    updates = payload.model_dump(exclude_unset=True)

    if "name" in updates:
        name = _clean_collection_name(updates["name"])
        _ensure_unique_collection_name(db, name, collection_id=collection.id)
        collection.name = name

    data = collection_data(collection)

    if "rules" in updates:
        data[RULES_FIELD] = canonicalize_collection_rules(
            db,
            updates["rules"] or {"match": "any", "clauses": []}
        )

    if "question_ids" in updates:
        pinned = _dedupe_question_ids(updates["question_ids"])
        _questions_for_ids(db, pinned)
        data[PINNED_FIELD] = pinned

    if "excluded_question_ids" in updates:
        data[EXCLUDED_FIELD] = _dedupe_question_ids(
            updates["excluded_question_ids"]
        )

    # Reassigned rather than mutated in place: SQLAlchemy only notices a
    # JSON column changed when the attribute itself is set.
    collection.data = data
    sync_collection_membership(db, collection)
    db.commit()
    db.refresh(collection)

    return _collection_response(collection)


@router.delete("/collections/{collection_id}")
def delete_collection(collection_id: int, db: Session = Depends(get_db)):
    sync_generated_hard_collection(db)

    collection = (
        db.query(Collection)
        .filter(Collection.id == collection_id)
        .first()
    )

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if is_generated_collection(collection):
        raise HTTPException(
            status_code=400,
            detail="Generated collections cannot be deleted"
        )

    record_tombstone(db, "collection", collection.guid)
    db.execute(
        question_collection.delete().where(
            question_collection.c.collection_id == collection.id
        )
    )
    db.delete(collection)
    db.commit()

    return {"status": "deleted"}
