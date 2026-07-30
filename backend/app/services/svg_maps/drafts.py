from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
from uuid import UUID, uuid4

from fastapi import HTTPException

from ...config import MAP_IMPORT_DRAFT_DIR
from .analyze import analyze_svg
from .contracts import MapImportDraft, MapImportInterpretationSummary
from .ontologies import ONTOLOGY_OPTIONS


DRAFT_TTL = timedelta(days=7)


def _now():
    return datetime.now(timezone.utc)


def _draft_root(root=None):
    return Path(root or MAP_IMPORT_DRAFT_DIR)


def _validated_id(draft_id):
    try:
        return str(UUID(str(draft_id)))
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Map import draft not found") from error


def draft_dir(draft_id, root=None):
    return _draft_root(root) / _validated_id(draft_id)


def _atomic_write_json(path, payload):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _atomic_write_bytes(path, payload):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def _is_expired(draft):
    try:
        last_activity = datetime.fromisoformat(draft.updated_at or draft.created_at)
    except ValueError:
        return True
    return _now() - last_activity > DRAFT_TTL


def expire_drafts(root=None):
    base = _draft_root(root)
    if not base.exists():
        return []

    removed = []
    for child in sorted(base.iterdir()):
        if not child.is_dir():
            continue
        if child.name == "commit-receipts":
            for receipt in child.glob("*.json"):
                if (
                    datetime.fromtimestamp(
                        receipt.stat().st_mtime, timezone.utc
                    ) < _now() - DRAFT_TTL
                ):
                    receipt.unlink(missing_ok=True)
            continue
        try:
            draft = MapImportDraft.model_validate_json(
                (child / "draft.json").read_text(encoding="utf-8")
            )
            expired = _is_expired(draft)
        except (OSError, ValueError):
            expired = True
        if expired:
            shutil.rmtree(child, ignore_errors=True)
            removed.append(child.name)
    return removed


def _build_draft(
    *,
    draft_id,
    result,
    target_group_id,
    name,
    expected_zone_count,
    ontology,
    acknowledgements,
    created_at,
):
    acknowledged = set(acknowledgements or [])
    required = {
        item.code
        for item in result.diagnostics
        if item.requires_acknowledgement
    }
    has_errors = any(item.severity == "error" for item in result.diagnostics)
    now = _now().isoformat()
    manifest = result.manifest

    return MapImportDraft(
        draft_id=draft_id,
        route=result.route,
        target_group_id=target_group_id,
        name=name,
        preview_url=f"/map-imports/{draft_id}/preview.svg",
        summary=result.summary,
        analysis_version=1,
        ontology=ontology,
        selection_required=result.selection_required,
        selected_interpretation_id=result.selected_interpretation_id,
        available_ontologies=ONTOLOGY_OPTIONS,
        interpretations=[
            MapImportInterpretationSummary.model_validate(
                item.model_dump(mode="json", exclude={"zones"})
            )
            for item in result.interpretations
        ],
        zones=result.zones,
        diagnostics=result.diagnostics,
        can_commit=bool(
            manifest
            and result.selected_interpretation_id
            and not result.selection_required
            and result.route != "manual"
            and not has_errors
            and required.issubset(acknowledged)
        ),
        acknowledgements=sorted(acknowledged),
        expected_zone_count=expected_zone_count,
        source_sha256=(
            manifest.source.sha256 if manifest
            else result.inventory.get("source_sha256", "")
        ),
        asset_sha256=(
            manifest.asset_sha256 if manifest
            else hashlib.sha256(result.canonical_svg).hexdigest()
        ),
        manifest=manifest,
        question_defaults=result.question_defaults,
        created_at=created_at or now,
        updated_at=now,
    )


def create_draft(
    source,
    *,
    expected_zone_count=None,
    ontology="auto",
    target_group_id=None,
    name=None,
    root=None,
):
    expire_drafts(root)
    result = analyze_svg(
        source,
        expected_zone_count,
        ontology=ontology,
    )
    draft_id = str(uuid4())
    directory = draft_dir(draft_id, root)
    directory.mkdir(parents=True, exist_ok=False)
    draft = _build_draft(
        draft_id=draft_id,
        result=result,
        target_group_id=target_group_id,
        name=name,
        expected_zone_count=expected_zone_count,
        ontology=ontology,
        acknowledgements=[],
        created_at=None,
    )
    try:
        (directory / "source.svg").write_bytes(source)
        (directory / "preview.svg").write_bytes(result.canonical_svg)
        _atomic_write_json(
            directory / "analysis.json",
            {
                "analysis_version": 1,
                "inventory": result.inventory,
                "interpretations": [
                    item.model_dump(mode="json")
                    for item in result.interpretations
                ],
            },
        )
        _atomic_write_json(
            directory / "draft.json", draft.model_dump(mode="json")
        )
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return draft


def load_draft(draft_id, *, root=None):
    expire_drafts(root)
    directory = draft_dir(draft_id, root)
    try:
        draft = MapImportDraft.model_validate_json(
            (directory / "draft.json").read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Map import draft not found") from error
    if _is_expired(draft):
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(status_code=404, detail="Map import draft expired")
    return draft


def update_draft(
    draft_id,
    *,
    expected_zone_count=None,
    expected_count_was_set=False,
    ontology=None,
    ontology_was_set=False,
    selected_interpretation_id=None,
    selection_was_set=False,
    acknowledgements=None,
    root=None,
):
    current = load_draft(draft_id, root=root)
    directory = draft_dir(draft_id, root)
    expected = (
        expected_zone_count
        if expected_count_was_set
        else current.expected_zone_count
    )
    acknowledged = (
        acknowledgements
        if acknowledgements is not None
        else current.acknowledgements
    )
    selected_ontology = ontology if ontology_was_set else current.ontology
    if selection_was_set:
        selected = selected_interpretation_id
    elif ontology_was_set and selected_ontology != current.ontology:
        selected = None
    else:
        selected = current.selected_interpretation_id
    if (directory / "repair.json").is_file():
        if ontology_was_set or selection_was_set:
            raise CanonicalizationError(
                "svg.repair_setting_locked",
                "Switch repair interpretations through the repair workspace",
                status_code=409,
            )
        from .repair import refresh_repair_settings

        updated = current.model_copy(update={
            "expected_zone_count": expected,
            "acknowledgements": sorted(set(acknowledged or [])),
        })
        return refresh_repair_settings(updated, root=root)

    source = (directory / "source.svg").read_bytes()
    result = analyze_svg(
        source,
        expected,
        ontology=selected_ontology,
        selected_interpretation_id=selected,
    )
    draft = _build_draft(
        draft_id=current.draft_id,
        result=result,
        target_group_id=current.target_group_id,
        name=current.name,
        expected_zone_count=expected,
        ontology=selected_ontology,
        acknowledgements=acknowledged,
        created_at=current.created_at,
    )
    _atomic_write_bytes(directory / "preview.svg", result.canonical_svg)
    _atomic_write_json(
        directory / "analysis.json",
        {
            "analysis_version": 1,
            "inventory": result.inventory,
            "interpretations": [
                item.model_dump(mode="json")
                for item in result.interpretations
            ],
        },
    )
    _atomic_write_json(directory / "draft.json", draft.model_dump(mode="json"))
    return draft


def delete_draft(draft_id, *, root=None):
    directory = draft_dir(draft_id, root)
    if not directory.exists():
        raise HTTPException(status_code=404, detail="Map import draft not found")
    shutil.rmtree(directory)


def public_draft(draft, *, root=None):
    payload = {
        "draft_id": draft.draft_id,
        "status": draft.status,
        "route": draft.route,
        "target_group_id": draft.target_group_id,
        "preview_url": draft.preview_url,
        "summary": draft.summary.model_dump(mode="json"),
        "analysis_version": draft.analysis_version,
        "ontology": draft.ontology,
        "selection_required": draft.selection_required,
        "selected_interpretation_id": draft.selected_interpretation_id,
        "available_ontologies": [
            option.model_dump(mode="json")
            for option in draft.available_ontologies
        ],
        "interpretations": [
            interpretation.model_dump(mode="json")
            for interpretation in draft.interpretations
        ],
        "zones": [
            zone.model_dump(mode="json")
            for zone in draft.zones
        ],
        "diagnostics": [
            diagnostic.model_dump(mode="json")
            for diagnostic in draft.diagnostics
        ],
        "can_commit": draft.can_commit,
        "expected_zone_count": draft.expected_zone_count,
        "acknowledgements": draft.acknowledgements,
        "preview_manifest": (
            {
                "schema_version": draft.manifest.schema_version,
                "zones": [
                    zone.model_dump(mode="json")
                    for zone in draft.manifest.zones
                ],
            }
            if draft.manifest else None
        ),
    }
    directory = draft_dir(draft.draft_id, root)
    try:
        from .repair import compact_repair_payload

        payload.update(compact_repair_payload(directory, draft))
    except HTTPException:
        payload.update({
            "repair_available": False,
            "repair_revision": None,
            "repair_summary": None,
            "readiness_blockers": ["repair.state_invalid"],
        })
    return payload


def list_drafts(*, root=None):
    expire_drafts(root)
    base = _draft_root(root)
    if not base.exists():
        return []
    drafts = []
    for child in base.iterdir():
        if not child.is_dir() or child.name == "commit-receipts":
            continue
        try:
            draft = MapImportDraft.model_validate_json(
                (child / "draft.json").read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            continue
        if draft.status != "analyzed" or draft.target_group_id is not None:
            continue
        payload = public_draft(draft, root=root)
        drafts.append({
            "draft_id": payload["draft_id"],
            "name": draft.name or "",
            "route": payload["route"],
            "updated_at": draft.updated_at,
            "expected_zone_count": payload["expected_zone_count"],
            "summary": payload["summary"],
            "can_commit": payload["can_commit"],
            "repair_available": payload["repair_available"],
            "repair_revision": payload["repair_revision"],
            "repair_summary": payload["repair_summary"],
            "readiness_blockers": payload["readiness_blockers"],
        })
    return sorted(
        drafts, key=lambda item: item["updated_at"], reverse=True
    )


def save_commit_receipt(draft_id, response, *, root=None):
    receipts = _draft_root(root) / "commit-receipts"
    receipts.mkdir(parents=True, exist_ok=True)
    _atomic_write_json(
        receipts / f"{_validated_id(draft_id)}.json",
        {
            "committed_at": _now().isoformat(),
            "response": response,
        },
    )


def load_commit_receipt(draft_id, *, root=None):
    expire_drafts(root)
    path = (
        _draft_root(root)
        / "commit-receipts"
        / f"{_validated_id(draft_id)}.json"
    )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    response = payload.get("response")
    return response if isinstance(response, dict) else None
