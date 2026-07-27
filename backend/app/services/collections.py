from datetime import datetime, timezone

from sqlalchemy import String, and_, func, or_

from ..models import Collection, Progress, Question


AUTO_COLLECTION_KEY_FIELD = "auto_collection_key"
AUTO_HARD_COLLECTION_KEY = "hard_questions"
AUTO_HARD_COLLECTION_NAME = "Questions difficiles"
AUTO_HARD_COLLECTION_FALLBACK_NAME = "Questions difficiles (auto)"
AUTO_HARD_COLLECTION_THRESHOLD = 9.0

# A playlist is a rule, not a snapshot: membership is recomputed on read so
# a question tagged "drapeaux" tomorrow joins the "drapeaux" playlist without
# anyone re-picking it. Rules live in Collection.data (already a JSON column,
# no migration); pinned/excluded ids are the manual escape hatch on top.
RULES_FIELD = "rules"
PINNED_FIELD = "pinned_question_ids"
EXCLUDED_FIELD = "excluded_question_ids"


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


def _clause_criterion(clause):
    """Translate one rule clause into a SQLAlchemy criterion.

    Unknown or blank clauses return None and are dropped rather than
    silently matching everything -- an empty tag box should select nothing,
    not the whole library.
    """
    if not isinstance(clause, dict):
        return None

    kind = clause.get("kind")

    if kind == "group":
        group_id = clause.get("group_id")

        return None if group_id is None else Question.group_id == int(group_id)

    if kind == "tag":
        tag = str(clause.get("tag") or "").strip()

        # Same JSON-cast match the question_candidates endpoint uses, so a
        # rule preview and the real resolution can never disagree.
        return (
            Question.tags.cast(String).ilike(f'%"{tag}"%') if tag else None
        )

    if kind == "type":
        type_q = str(clause.get("type_q") or "").strip()

        return Question.type_q == type_q if type_q else None

    if kind == "difficulty":
        threshold = clause.get("gte")

        return (
            None if threshold is None
            else Progress.difficulty >= float(threshold)
        )

    return None


def collection_rules(collection):
    data = collection_data(collection)
    rules = data.get(RULES_FIELD)

    return rules if isinstance(rules, dict) else {}


def clause_match_count(db, clause):
    """How many questions one clause matches on its own.

    Lets the builder show a per-rule count next to each row, so "tag =
    drapeaux · 54 questions" is visible before saving anything.
    """
    criterion = _clause_criterion(clause)

    if criterion is None:
        return 0

    query = db.query(func.count(Question.id))

    if isinstance(clause, dict) and clause.get("kind") == "difficulty":
        query = query.outerjoin(Progress, Progress.question_id == Question.id)

    return query.filter(criterion).scalar() or 0


def resolve_playlist_data(db, data):
    """Resolve a rules payload to questions: (rules ∪ pinned) − excluded.

    Takes the raw data dict rather than a Collection so the builder can
    preview a rule that has never been saved.
    """
    rules = data.get(RULES_FIELD)
    rules = rules if isinstance(rules, dict) else {}
    clauses = rules.get("clauses") or []
    match_all = str(rules.get("match") or "any").lower() == "all"

    pinned_ids = data.get(PINNED_FIELD)
    excluded_ids = set(data.get(EXCLUDED_FIELD) or [])

    criteria = [
        criterion
        for criterion in (_clause_criterion(clause) for clause in clauses)
        if criterion is not None
    ]
    resolved = {}

    if criteria:
        query = db.query(Question)

        if any(
            isinstance(clause, dict) and clause.get("kind") == "difficulty"
            for clause in clauses
        ):
            query = query.outerjoin(
                Progress, Progress.question_id == Question.id
            )

        combined = and_(*criteria) if match_all else or_(*criteria)
        resolved = {
            question.id: question
            for question in query.filter(combined).all()
        }

    if pinned_ids:
        resolved.update({
            question.id: question
            for question in (
                db.query(Question)
                .filter(Question.id.in_([int(v) for v in pinned_ids]))
                .all()
            )
        })

    for question_id in excluded_ids:
        resolved.pop(int(question_id), None)

    return [resolved[key] for key in sorted(resolved)]


def resolve_collection_questions(db, collection):
    data = collection_data(collection)

    if not (collection_rules(collection).get("clauses") or []) and (
        data.get(PINNED_FIELD) is None
    ):
        # Written before rules existed: its membership lives only in the
        # association table. Returning that as-is is what keeps resolving a
        # legacy playlist from silently emptying it.
        return list(collection.questions or [])

    return resolve_playlist_data(db, data)


def sync_collection_membership(db, collection, commit=False):
    """Materialize a playlist's resolved membership into the M2M table.

    Writing the result back means every existing consumer -- training
    scopes, question_count, pack export -- keeps reading collection.questions
    and needs no knowledge of rules at all.
    """
    resolved = resolve_collection_questions(db, collection)
    current_ids = sorted(
        question.id
        for question in (collection.questions or [])
        if question.id is not None
    )
    resolved_ids = [
        question.id for question in resolved if question.id is not None
    ]

    if current_ids == resolved_ids:
        return collection

    collection.questions = resolved

    if commit:
        db.commit()
        db.refresh(collection)
    else:
        db.flush()

    return collection


def sync_all_collection_memberships(db, commit=True):
    collections = db.query(Collection).order_by(Collection.id).all()

    for collection in collections:
        if is_generated_collection(collection):
            # Owns its own sync path below.
            continue

        sync_collection_membership(db, collection)

    if commit:
        db.commit()

    return collections


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

    # The built-in "hard questions" collection is just a rule playlist with a
    # difficulty clause. Expressing it that way keeps a single definition of
    # what membership means, instead of a second hand-rolled query.
    data = collection_data(collection)
    data.update({
        "generated": True,
        AUTO_COLLECTION_KEY_FIELD: AUTO_HARD_COLLECTION_KEY,
        "hard_threshold": AUTO_HARD_COLLECTION_THRESHOLD,
        RULES_FIELD: {
            "match": "any",
            "clauses": [
                {
                    "kind": "difficulty",
                    "gte": AUTO_HARD_COLLECTION_THRESHOLD
                }
            ]
        },
        "synced_at": _now_utc_iso()
    })
    collection.data = data

    hard_questions = resolve_collection_questions(db, collection)
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

    changed = True

    if commit and changed:
        db.commit()
        db.refresh(collection)
    elif changed:
        db.flush()

    return collection
