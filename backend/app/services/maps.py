from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_progress, serialize_question_for_manage
from .progress import create_initial_progress


def get_group(db, group_id: int):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    if group.type_group != "map":
        raise HTTPException(400, "Group is not a map")

    return group


def serialize_zone(question):
    return {
        "id": question.id,
        "type_q": question.type_q,
        "code": question.data.get("code") if question.data else None,
        "question": question.question,
        "answer": question.answer,
        "label": question.answer,
        "media": question.media,
        "tags": question.tags or [],
        "group_id": question.group_id,
        "data": question.data or {},
        "aliases": question.data.get("aliases", []) if question.data else [],
        "progress": serialize_progress(question.progress)
    }


def list_zones(db, group_id: int):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions).joinedload(Question.progress))
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    return [
        serialize_zone(question)
        for question in group.questions
        if question.type_q == "map"
    ]


def save_zones(db, group_id: int, payload):
    group = get_group(db, group_id)

    if payload.group:
        group_updates = payload.group.model_dump(exclude_unset=True)

        for field in ["name", "media"]:
            if field in group_updates:
                setattr(group, field, group_updates[field])

    existing_zones = (
        db.query(Question)
        .filter(
            Question.group_id == group_id,
            Question.type_q == "map"
        )
        .all()
    )

    existing_by_id = {
        zone.id: zone
        for zone in existing_zones
    }
    existing_by_code = {
        zone.data.get("code"): zone
        for zone in existing_zones
        if zone.data and zone.data.get("code")
    }

    touched_ids = []
    created_ids = []
    updated_ids = []
    created_codes = []
    updated_codes = []

    try:
        for zone_payload in payload.zones:
            code = zone_payload.code.strip()

            if not code:
                raise HTTPException(400, "Zone code is required")

            aliases = [
                alias
                for alias in zone_payload.aliases
                if alias
            ]

            zone = None

            if zone_payload.id:
                zone = existing_by_id.get(zone_payload.id)

                if not zone:
                    raise HTTPException(404, f"Zone {zone_payload.id} not found")

            if not zone:
                zone = existing_by_code.get(code)

            if not zone:
                zone = Question(
                    type_q="map",
                    question=f"{group.name} - {code}",
                    answer=zone_payload.answer or "",
                    media="",
                    tags=[],
                    data={
                        "code": code,
                        "aliases": aliases
                    },
                    group_id=group_id
                )

                db.add(zone)
                db.flush()
                db.add(create_initial_progress(zone.id))

                existing_by_id[zone.id] = zone
                existing_by_code[code] = zone
                created_ids.append(zone.id)
                created_codes.append(code)
            else:
                zone.answer = zone_payload.answer or ""
                zone.question = f"{group.name} - {code}"
                zone.data = {
                    "code": code,
                    "aliases": aliases
                }
                updated_ids.append(zone.id)
                updated_codes.append(code)

            touched_ids.append(zone.id)

        db.commit()
    except Exception:
        db.rollback()
        raise

    saved_zones = []

    if touched_ids:
        saved_zones = (
            db.query(Question)
            .options(
                joinedload(Question.progress),
                joinedload(Question.group),
                joinedload(Question.collections)
            )
            .filter(Question.id.in_(touched_ids))
            .all()
        )

    question_count = (
        db.query(Question)
        .filter(
            Question.group_id == group_id,
            Question.type_q == "map"
        )
        .count()
    )

    return {
        "group": {
            "id": group.id,
            "type_group": group.type_group,
            "name": group.name,
            "media": group.media,
            "question_count": question_count
        },
        "zones": [
            serialize_question_for_manage(zone)
            for zone in saved_zones
        ],
        "createdQuestionIds": created_ids,
        "createdZoneCodes": created_codes,
        "updatedQuestionIds": updated_ids,
        "updatedZoneCodes": updated_codes,
        "question_count": question_count
    }
