from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ...config import STATIC_DIR
from ...models import Question, QuestionGroup
from ..map_zones import derive_map_group_tags, serialize_map_zone_for_editor
from ..media import (
    delete_unreferenced_media_file,
    static_file_path_from_media,
    store_media_bytes,
)
from .contracts import merge_map_package
from .drafts import (
    delete_draft,
    draft_dir,
    load_commit_receipt,
    load_draft,
    save_commit_receipt,
)


def _trimmed_code(question):
    return str((question.data or {}).get("code") or "").strip()


def _validate_upgrade(group, manifest):
    existing = [
        question for question in group.questions
        if question.type_q == "map"
    ]
    by_code = {}
    missing_codes = []
    duplicate_codes = []

    for question in existing:
        code = _trimmed_code(question)
        if not code:
            missing_codes.append(question.id)
            continue
        if code in by_code:
            duplicate_codes.append(code)
        by_code[code] = question

    manifest_codes = {zone.code for zone in manifest.zones}
    orphan_codes = sorted(set(by_code) - manifest_codes)
    if missing_codes or duplicate_codes or orphan_codes:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "map.upgrade_identity_conflict",
                "missing_code_question_ids": missing_codes,
                "duplicate_codes": sorted(set(duplicate_codes)),
                "orphan_codes": orphan_codes,
            },
        )
    return by_code


def commit_draft(db, draft_id, *, name=None, draft_root=None, static_dir=None):
    try:
        draft = load_draft(draft_id, root=draft_root)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        receipt = load_commit_receipt(draft_id, root=draft_root)
        if receipt is None:
            raise
        return {**receipt, "idempotent_replay": True}
    if not draft.can_commit or not draft.manifest:
        raise HTTPException(status_code=409, detail="Map import draft cannot be committed")

    directory = draft_dir(draft_id, draft_root)
    canonical = (directory / "preview.svg").read_bytes()
    target_static = Path(static_dir or STATIC_DIR)
    created_file = None
    old_media = None

    try:
        stored = store_media_bytes(
            canonical,
            filename="map.svg",
            static_dir=target_static,
            storage_subdir="maps",
            db=db,
            commit=False,
        )
        if stored.get("created_file"):
            created_file = target_static / stored["stored_path"]

        if draft.target_group_id is None:
            group_name = str(name or draft.name or "").strip()
            if not group_name:
                raise HTTPException(status_code=422, detail="Map name is required")
            group = QuestionGroup(
                type_group="map",
                name=group_name,
                media=stored["url"],
                data=merge_map_package({}, draft.manifest),
            )
            db.add(group)
            db.flush()
            existing_by_code = {}
        else:
            group = (
                db.query(QuestionGroup)
                .options(joinedload(QuestionGroup.questions))
                .filter(QuestionGroup.id == draft.target_group_id)
                .first()
            )
            if not group:
                raise HTTPException(status_code=404, detail="Map group not found")
            if group.type_group != "map":
                raise HTTPException(status_code=400, detail="Group is not a map")
            existing_by_code = _validate_upgrade(group, draft.manifest)
            old_media = group.media
            group.media = stored["url"]
            group.data = merge_map_package(group.data, draft.manifest)

        created_ids = []
        for zone in draft.manifest.zones:
            question = existing_by_code.get(zone.code)
            if question:
                current_data = dict(question.data or {})
                current_data["code"] = zone.code
                current_data.setdefault("aliases", [])
                question.data = current_data
                continue

            defaults = draft.question_defaults.get(zone.code, {})
            answer = str(defaults.get("answer") or "").strip()
            aliases = [
                str(value).strip()
                for value in defaults.get("aliases", [])
                if str(value).strip()
            ]
            question = Question(
                type_q="map",
                question=f"{group.name} - {answer or zone.code}",
                answer=answer,
                media="",
                tags=[],
                data={"code": zone.code, "aliases": aliases},
                group_id=group.id,
            )
            db.add(question)
            db.flush()
            created_ids.append(question.id)

        db.commit()
        db.refresh(group)
    except Exception:
        db.rollback()
        if created_file and created_file.exists():
            created_file.unlink()
        raise

    zones = (
        db.query(Question)
        .options(joinedload(Question.progress))
        .filter(Question.group_id == group.id, Question.type_q == "map")
        .order_by(Question.id)
        .all()
    )
    named_count = sum(1 for zone in zones if str(zone.answer or "").strip())
    response = {
        "group": {
            "id": group.id,
            "type_group": group.type_group,
            "name": group.name,
            "media": group.media,
            "data": group.data or {},
            "tags": derive_map_group_tags(zones),
            "question_count": len(zones),
            "named_zone_count": named_count,
        },
        "zones": [serialize_map_zone_for_editor(zone) for zone in zones],
        "createdQuestionIds": created_ids,
    }
    save_commit_receipt(draft_id, response, root=draft_root)
    delete_draft(draft_id, root=draft_root)
    if old_media and old_media != group.media:
        delete_unreferenced_media_file(db, old_media, static_dir=target_static)
    return response


def legacy_group_source(db, group_id, *, static_dir=None):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Map group not found")
    if group.type_group != "map":
        raise HTTPException(status_code=400, detail="Group is not a map")
    if isinstance((group.data or {}).get("map"), dict):
        raise HTTPException(status_code=409, detail="Map already uses package v2")
    file_path = static_file_path_from_media(group.media, static_dir=static_dir)
    if not file_path or not file_path.is_file():
        raise HTTPException(
            status_code=409,
            detail="Legacy external maps must be localized before upgrade",
        )
    return group, file_path.read_bytes()
