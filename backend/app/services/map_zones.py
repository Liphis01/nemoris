from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Question, QuestionGroup
from ..serializers import serialize_manage_question, serialize_progress
from .tag_hierarchy import ensure_tag_ids


def merge_tags(*tag_lists):
    tags_by_key = {}

    for tag_list in tag_lists:
        for tag in tag_list or []:
            value = str(tag or "").strip()
            key = value

            if value and key not in tags_by_key:
                tags_by_key[key] = value

    return list(tags_by_key.values())


def derive_map_group_tags(questions):
    return merge_tags(*[
        question.tags or []
        for question in questions or []
        if question.type_q == "map"
    ])


def get_map_group_or_404(db, group_id: int):
    # Map-zone bulk editing is only valid for groups whose presentation type is
    # map. The individual rows inside are still normal Question rows.
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


def serialize_map_zone_for_editor(question):
    # The editor wants both the generic Question shape and direct code/alias
    # fields for fast rendering and form binding.
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


def list_map_group_zones(db, group_id: int):
    # Load progress beside questions so the editor can show review state without
    # issuing one query per zone.
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions).joinedload(Question.progress))
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise HTTPException(404, "Group not found")

    return [
        serialize_map_zone_for_editor(question)
        for question in group.questions
        if question.type_q == "map"
    ]


def save_map_group_zones(db, group_id: int, payload):
    group = get_map_group_or_404(db, group_id)
    group_updates = {}
    shared_tags_provided = False
    shared_tags = None

    if payload.group:
        # Group edits travel with zone saves so map title/media changes and zone
        # labels can be committed from one editor action.
        group_updates = payload.group.model_dump(exclude_unset=True)

        for field in ["name", "media"]:
            if field in group_updates:
                setattr(group, field, group_updates[field])

        if "tags" in group_updates:
            shared_tags_provided = True
            shared_tags = ensure_tag_ids(db, group_updates.get("tags"))

    existing_zones = (
        db.query(Question)
        .filter(
            Question.group_id == group_id,
            Question.type_q == "map"
        )
        .all()
    )

    # Existing zones can be matched by database id or by SVG code. Matching by
    # code lets the frontend create temporary rows before the database id exists.
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
        if shared_tags_provided:
            for zone in existing_zones:
                zone.tags = shared_tags
                touched_ids.append(zone.id)

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
                # A new SVG code becomes a new atomic map question. Progress is
                # created lazily when that zone is first answered.
                zone = Question(
                    type_q="map",
                    question=f"{group.name} - {code}",
                    answer=zone_payload.answer or "",
                    media="",
                    tags=shared_tags if shared_tags_provided else [],
                    data={
                        "code": code,
                        "aliases": aliases
                    },
                    group_id=group_id
                )

                db.add(zone)
                db.flush()

                existing_by_id[zone.id] = zone
                existing_by_code[code] = zone
                created_ids.append(zone.id)
                created_codes.append(code)
            else:
                # Updating answer/aliases preserves the existing question id and
                # progress history for that zone.
                desired_data = dict(zone.data or {})
                desired_data.update({
                    "code": code,
                    "aliases": aliases
                })

                zone.answer = zone_payload.answer or ""
                zone.question = f"{group.name} - {code}"
                if shared_tags_provided:
                    zone.tags = shared_tags
                zone.data = desired_data
                updated_ids.append(zone.id)
                updated_codes.append(code)

            if zone.id not in touched_ids:
                touched_ids.append(zone.id)

        db.commit()
    except Exception:
        db.rollback()
        raise

    saved_zones = []

    if touched_ids:
        # Re-read saved zones with relationships so the response can patch the
        # frontend Manage cache using the normal question serializer.
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
    response_tags = shared_tags if shared_tags_provided else derive_map_group_tags(
        existing_zones
    )

    return {
        "group": {
            "id": group.id,
            "type_group": group.type_group,
            "name": group.name,
            "media": group.media,
            "data": group.data or {},
            "tags": response_tags,
            "question_count": question_count
        },
        "zones": [
            serialize_manage_question(zone)
            for zone in saved_zones
        ],
        "createdQuestionIds": created_ids,
        "createdZoneCodes": created_codes,
        "updatedQuestionIds": updated_ids,
        "updatedZoneCodes": updated_codes,
        "question_count": question_count
    }
