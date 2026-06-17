from datetime import datetime, timezone

from sqlalchemy import func

from ..models import Collection, Progress, Question


AUTO_COLLECTION_KEY_FIELD = "auto_collection_key"
AUTO_HARD_COLLECTION_KEY = "hard_questions"
AUTO_HARD_COLLECTION_NAME = "Questions difficiles"
AUTO_HARD_COLLECTION_FALLBACK_NAME = "Questions difficiles (auto)"
AUTO_HARD_COLLECTION_THRESHOLD = 9.0


def _now_utc_iso():
    return datetime.now(timezone.utc).isoformat()


def collection_data(collection):
    return dict(collection.data or {})


def is_generated_collection(collection):
    data = collection_data(collection)

    return (
        data.get(AUTO_COLLECTION_KEY_FIELD) == AUTO_HARD_COLLECTION_KEY and
        data.get("generated") is True
    )


def generated_collection_response_fields(collection):
    data = collection_data(collection)
    generated = is_generated_collection(collection)

    return {
        "generated": generated,
        "auto_collection_key": (
            data.get(AUTO_COLLECTION_KEY_FIELD)
            if generated
            else None
        )
    }


def _auto_collection_name(db, collection_id=None):
    manual_default = (
        db.query(Collection)
        .filter(func.lower(Collection.name) == AUTO_HARD_COLLECTION_NAME.lower())
        .first()
    )
    base_name = AUTO_HARD_COLLECTION_NAME

    if (
        manual_default and
        manual_default.id != collection_id and
        not is_generated_collection(manual_default)
    ):
        base_name = AUTO_HARD_COLLECTION_FALLBACK_NAME

    candidate = base_name
    suffix = 2

    while True:
        existing = (
            db.query(Collection)
            .filter(func.lower(Collection.name) == candidate.lower())
            .first()
        )

        if not existing or existing.id == collection_id:
            return candidate

        candidate = f"{base_name} {suffix}"
        suffix += 1


def find_generated_hard_collection(db):
    collections = (
        db.query(Collection)
        .order_by(Collection.id)
        .all()
    )

    for collection in collections:
        if is_generated_collection(collection):
            return collection

    return None


def _hard_questions(db):
    return (
        db.query(Question)
        .join(Progress, Progress.question_id == Question.id)
        .filter(Progress.difficulty >= AUTO_HARD_COLLECTION_THRESHOLD)
        .order_by(Question.id)
        .all()
    )


def sync_generated_hard_collection(db, commit=True):
    collection = find_generated_hard_collection(db)
    changed = False

    if not collection:
        collection = Collection(
            name=_auto_collection_name(db),
            data={},
            questions=[]
        )
        db.add(collection)
        db.flush()
        changed = True

    desired_name = _auto_collection_name(db, collection_id=collection.id)

    if collection.name != desired_name:
        collection.name = desired_name
        changed = True

    hard_questions = _hard_questions(db)
    current_question_ids = sorted(
        question.id
        for question in (collection.questions or [])
        if question.id is not None
    )
    desired_question_ids = [
        question.id
        for question in hard_questions
        if question.id is not None
    ]

    if current_question_ids != desired_question_ids:
        collection.questions = hard_questions
        changed = True

    data = collection_data(collection)
    data.update({
        "generated": True,
        AUTO_COLLECTION_KEY_FIELD: AUTO_HARD_COLLECTION_KEY,
        "hard_threshold": AUTO_HARD_COLLECTION_THRESHOLD,
        "synced_at": _now_utc_iso()
    })
    collection.data = data
    changed = True

    if commit and changed:
        db.commit()
        db.refresh(collection)
    elif changed:
        db.flush()

    return collection
