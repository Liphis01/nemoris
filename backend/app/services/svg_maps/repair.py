from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from fastapi import HTTPException

from .analyze import (
    GENERATED_ID_RE,
    JETPUNK_STYLE_CLASSES,
    LABEL_TOKEN_RE,
    analyze_svg,
)
from .canonicalize import CanonicalizationError, canonicalize_svg
from .contracts import (
    DRAFT_SHAPE_REF_RE,
    MapImportDiagnostic,
    MapPackageV2,
    MapRepairBranchState,
    MapRepairState,
    MapRepairZoneState,
    MapSourceV2,
    MapZoneProposal,
    MapZoneV2,
)
from .drafts import (
    _atomic_write_bytes,
    _atomic_write_json,
    draft_dir,
    load_draft,
)


MAX_HISTORY = 200
OPTIONAL_WARNING_CODE = "svg.repair_optional_unresolved"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _repair_path(directory: Path):
    return directory / "repair.json"


def _load_analysis(directory: Path):
    try:
        payload = json.loads((directory / "analysis.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise HTTPException(
            status_code=409, detail={"code": "svg.repair_analysis_missing"}
        ) from error
    inventory = payload.get("inventory")
    if not isinstance(inventory, dict) or not isinstance(inventory.get("shapes"), list):
        raise HTTPException(
            status_code=409, detail={"code": "svg.repair_analysis_invalid"}
        )
    return payload


def _load_state(directory: Path):
    try:
        return MapRepairState.model_validate_json(
            _repair_path(directory).read_text(encoding="utf-8")
        )
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404, detail={"code": "svg.repair_not_initialized"}
        ) from error
    except (OSError, ValueError) as error:
        raise HTTPException(
            status_code=409, detail={"code": "svg.repair_state_invalid"}
        ) from error


def _shape_maps(inventory):
    shapes = sorted(
        (
            shape
            for shape in inventory.get("shapes", [])
            if shape.get("visible") and not shape.get("in_defs")
        ),
        key=lambda shape: int(shape.get("index", 0)),
    )
    ref_by_index = {
        int(shape["index"]): f"p{position:06d}"
        for position, shape in enumerate(shapes, start=1)
    }
    shape_by_ref = {
        ref_by_index[int(shape["index"])]: shape for shape in shapes
    }
    return ref_by_index, shape_by_ref


def _shape_signature(shape):
    raw = "|".join((
        str(shape.get("tag") or ""),
        str(shape.get("fill") or "").strip().lower(),
        str(shape.get("stroke") or "").strip().lower(),
    ))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def _meaningful_identifier(value, duplicate_ids):
    value = str(value or "").strip()
    return bool(
        value
        and value not in duplicate_ids
        and value not in JETPUNK_STYLE_CLASSES
        and not GENERATED_ID_RE.fullmatch(value)
        and not LABEL_TOKEN_RE.search(value)
    )


def _base_branch(result, interpretation, inventory):
    ref_by_index, shape_by_ref = _shape_maps(inventory)
    duplicate_ids = set(inventory.get("duplicate_ids") or ())
    assigned_indices = {
        index
        for zone in interpretation.zones
        for index in zone.source_shape_indices
    }
    assigned_signatures = {
        _shape_signature(shape)
        for ref, shape in shape_by_ref.items()
        if int(shape["index"]) in assigned_indices and not shape.get("label_path")
    }
    probable_label_indices = {
        int(value)
        for diagnostic in result.diagnostics
        if diagnostic.code == "svg.probable_path_labels"
        for value in diagnostic.parameters.get("source_shape_indices", [])
    }

    zones = []
    assignments = {}
    known_codes = set()
    for position, proposal in enumerate(interpretation.zones, start=1):
        zone_id = f"d{position:06d}"
        code = proposal.code
        if code in known_codes:
            continue
        known_codes.add(code)
        refs = [
            ref_by_index[index]
            for index in proposal.source_shape_indices
            if index in ref_by_index
            and not shape_by_ref[ref_by_index[index]].get("label_path")
        ]
        if not refs:
            continue
        zones.append(MapRepairZoneState(
            zone_id=zone_id,
            code=code,
            source_keys=list(dict.fromkeys(proposal.source_keys)),
            proposed_answer=proposal.proposed_answer,
            proposed_aliases=list(proposal.proposed_aliases),
            proposal_verified=proposal.proposal_verified,
            proposal_source=proposal.proposal_source,
        ))
        assignments.update({shape_ref: zone_id for shape_ref in refs})

    roles = {}
    required = []
    optional = []
    for shape_ref, shape in shape_by_ref.items():
        if shape_ref in assignments:
            continue
        index = int(shape["index"])
        if shape.get("label_path"):
            roles[shape_ref] = "label"
            continue

        fill = str(shape.get("fill") or "").strip().lower()
        classes = {
            str(value).strip().lower()
            for value in (
                *(shape.get("classes") or ()),
                *(shape.get("ancestry_classes") or ()),
            )
            if str(value).strip()
        }
        obvious_decoration = bool(
            not shape.get("bbox")
            or not shape.get("closed")
            or not shape.get("filled")
            or fill in {"", "none", "transparent"}
            or classes.intersection({"border", "borders", "country-border"})
        )
        if obvious_decoration:
            roles[shape_ref] = "decoration"
            continue

        identifiers = [
            shape.get("source_id"),
            *(shape.get("ancestry_ids") or ()),
        ]
        probable_zone = (
            index in probable_label_indices
            or _shape_signature(shape) in assigned_signatures
            or any(
                _meaningful_identifier(value, duplicate_ids)
                for value in identifiers
            )
        )
        roles[shape_ref] = "unresolved"
        if probable_zone:
            required.append(shape_ref)
        else:
            optional.append(shape_ref)

    return MapRepairBranchState(
        interpretation_id=interpretation.id,
        adapter=interpretation.adapter,
        ontology=interpretation.ontology,
        base_zones=zones,
        base_assignments=assignments,
        base_roles=roles,
        required_shape_refs=sorted(required),
        optional_shape_refs=sorted(optional),
        operations=[],
        cursor=0,
    )


def _base_current(branch):
    return {
        "zones": {
            zone.zone_id: zone.model_dump(mode="json")
            for zone in branch.base_zones
        },
        "assignments": dict(branch.base_assignments),
        "roles": dict(branch.base_roles),
    }


def _drop_empty_zones(current):
    used = set(current["assignments"].values())
    current["zones"] = {
        zone_id: zone
        for zone_id, zone in current["zones"].items()
        if zone_id in used
    }


def _apply_operation(current, operation):
    operation_type = operation["type"]
    if operation_type == "reset_branch":
        return None

    if operation_type == "create_zone":
        zone = dict(operation["zone"])
        current["zones"][zone["zone_id"]] = zone
        for shape_ref in operation["shape_refs"]:
            current["roles"].pop(shape_ref, None)
            current["assignments"][shape_ref] = zone["zone_id"]
    elif operation_type == "assign_to_zone":
        for shape_ref in operation["shape_refs"]:
            current["roles"].pop(shape_ref, None)
            current["assignments"][shape_ref] = operation["zone_id"]
    elif operation_type == "set_role":
        for shape_ref in operation["shape_refs"]:
            current["assignments"].pop(shape_ref, None)
            current["roles"][shape_ref] = operation["role"]
    elif operation_type == "merge_zones":
        primary = operation["primary_zone_id"]
        merged = set(operation["zone_ids"]) - {primary}
        current["zones"][primary]["source_keys"] = list(
            operation["source_keys"]
        )
        for shape_ref, zone_id in list(current["assignments"].items()):
            if zone_id in merged:
                current["assignments"][shape_ref] = primary
        for zone_id in merged:
            current["zones"].pop(zone_id, None)
    elif operation_type == "explode_zone":
        zone_id = operation["zone_id"]
        ordered_refs = operation["shape_refs"]
        for shape_ref in ordered_refs:
            current["assignments"].pop(shape_ref, None)
        if ordered_refs:
            current["assignments"][ordered_refs[0]] = zone_id
        for entry in operation["new_zones"]:
            zone = dict(entry["zone"])
            current["zones"][zone["zone_id"]] = zone
            current["assignments"][entry["shape_ref"]] = zone["zone_id"]
    else:
        raise HTTPException(
            status_code=422,
            detail={"code": "svg.repair_action_unknown", "type": operation_type},
        )
    _drop_empty_zones(current)
    return current


def _current_branch(branch):
    current = _base_current(branch)
    for operation in branch.operations[:branch.cursor]:
        applied = _apply_operation(current, operation)
        if applied is None:
            current = _base_current(branch)
    return current


def _ordered_refs(shape_by_ref, refs):
    return sorted(
        dict.fromkeys(refs),
        key=lambda ref: int(shape_by_ref[ref]["index"]),
    )


def _validate_refs(shape_by_ref, refs):
    ordered = []
    for shape_ref in dict.fromkeys(refs):
        if (
            not isinstance(shape_ref, str)
            or not DRAFT_SHAPE_REF_RE.fullmatch(shape_ref)
            or shape_ref not in shape_by_ref
        ):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "svg.repair_shape_not_found",
                    "shape_ref": shape_ref,
                },
            )
        ordered.append(shape_ref)
    if not ordered:
        raise HTTPException(
            status_code=422, detail={"code": "svg.repair_empty_selection"}
        )
    return _ordered_refs(shape_by_ref, ordered)


def _next_identity(current, prefix, field):
    used = {
        value[field] for value in current["zones"].values()
    }
    for position in range(1, 1_000_000):
        candidate = f"{prefix}{position:06d}"
        if candidate not in used:
            return candidate
    raise HTTPException(
        status_code=422, detail={"code": "svg.repair_identity_limit"}
    )


def _new_zone(current):
    zone_id = _next_identity(current, "d", "zone_id")
    code = _next_identity(current, "z", "code")
    return {
        "zone_id": zone_id,
        "code": code,
        "source_keys": [f"repair-zone:{code}"],
        "proposed_answer": "",
        "proposed_aliases": [],
        "proposal_verified": False,
        "proposal_source": None,
    }


def _materialize_action(branch, current, shape_by_ref, action):
    action_type = action["type"]
    if action_type == "create_zone":
        refs = _validate_refs(shape_by_ref, action.get("shape_refs", []))
        return {"type": action_type, "shape_refs": refs, "zone": _new_zone(current)}
    if action_type == "assign_to_zone":
        zone_id = action.get("zone_id")
        if zone_id not in current["zones"]:
            raise HTTPException(
                status_code=422,
                detail={"code": "svg.repair_zone_not_found", "zone_id": zone_id},
            )
        return {
            "type": action_type,
            "shape_refs": _validate_refs(
                shape_by_ref, action.get("shape_refs", [])
            ),
            "zone_id": zone_id,
        }
    if action_type == "set_role":
        role = action.get("role")
        if role not in {"unresolved", "decoration", "label", "excluded"}:
            raise HTTPException(
                status_code=422, detail={"code": "svg.repair_role_invalid"}
            )
        return {
            "type": action_type,
            "shape_refs": _validate_refs(
                shape_by_ref, action.get("shape_refs", [])
            ),
            "role": role,
        }
    if action_type == "merge_zones":
        zone_ids = list(dict.fromkeys(action.get("zone_ids") or ()))
        primary = action.get("primary_zone_id")
        if len(zone_ids) < 2 or primary not in zone_ids:
            raise HTTPException(
                status_code=422, detail={"code": "svg.repair_merge_invalid"}
            )
        missing = [zone_id for zone_id in zone_ids if zone_id not in current["zones"]]
        if missing:
            raise HTTPException(
                status_code=422,
                detail={"code": "svg.repair_zone_not_found", "zone_ids": missing},
            )
        ordered_zone_ids = sorted(
            zone_ids,
            key=lambda candidate: min(
                (
                    int(shape_by_ref[shape_ref]["index"])
                    for shape_ref, assigned_zone_id
                    in current["assignments"].items()
                    if assigned_zone_id == candidate
                ),
                default=10**9,
            ),
        )
        source_keys = list(dict.fromkeys(
            source_key
            for zone_id in ordered_zone_ids
            for source_key in current["zones"][zone_id]["source_keys"]
        ))
        return {
            "type": action_type,
            "zone_ids": zone_ids,
            "primary_zone_id": primary,
            "source_keys": source_keys,
        }
    if action_type == "explode_zone":
        zone_id = action.get("zone_id")
        if zone_id not in current["zones"]:
            raise HTTPException(
                status_code=422,
                detail={"code": "svg.repair_zone_not_found", "zone_id": zone_id},
            )
        refs = _ordered_refs(
            shape_by_ref,
            [
                shape_ref
                for shape_ref, assigned_zone_id in current["assignments"].items()
                if assigned_zone_id == zone_id
            ],
        )
        if len(refs) < 2:
            raise HTTPException(
                status_code=422,
                detail={"code": "svg.repair_zone_not_multipart", "zone_id": zone_id},
            )
        working = {
            "zones": dict(current["zones"]),
            "assignments": dict(current["assignments"]),
            "roles": dict(current["roles"]),
        }
        new_zones = []
        for shape_ref in refs[1:]:
            zone = _new_zone(working)
            working["zones"][zone["zone_id"]] = zone
            new_zones.append({"shape_ref": shape_ref, "zone": zone})
        return {
            "type": action_type,
            "zone_id": zone_id,
            "shape_refs": refs,
            "new_zones": new_zones,
        }
    if action_type == "reset_branch":
        return {"type": action_type}
    raise HTTPException(
        status_code=422,
        detail={"code": "svg.repair_action_unknown", "type": action_type},
    )


def _compact_branch(branch, current):
    branch.base_zones = [
        MapRepairZoneState.model_validate(zone)
        for zone in current["zones"].values()
    ]
    branch.base_assignments = dict(current["assignments"])
    branch.base_roles = dict(current["roles"])
    branch.operations = []
    branch.cursor = 0


def _append_operation(branch, current, operation):
    branch.operations = list(branch.operations[:branch.cursor])
    if len(branch.operations) >= MAX_HISTORY:
        _compact_branch(branch, current)
    branch.operations.append(operation)
    branch.cursor = len(branch.operations)


def _repair_counts(branch, current):
    optional = set(branch.optional_shape_refs)
    unresolved = {
        shape_ref
        for shape_ref, role in current["roles"].items()
        if role == "unresolved"
    }
    optional_unresolved = unresolved.intersection(optional)
    required_unresolved = unresolved - optional
    role_counts = defaultdict(int)
    for role in current["roles"].values():
        role_counts[role] += 1
    multipart = defaultdict(int)
    for zone_id in current["assignments"].values():
        multipart[zone_id] += 1
    return {
        "zone_count": len(current["zones"]),
        "assigned_shape_count": len(current["assignments"]),
        "required_unresolved_count": len(required_unresolved),
        "optional_unresolved_count": len(optional_unresolved),
        "decoration_count": role_counts["decoration"],
        "label_count": role_counts["label"],
        "excluded_count": role_counts["excluded"],
        "multipart_zone_count": sum(count > 1 for count in multipart.values()),
    }


def audit_repairability(result):
    """Return deterministic, source-free M3A readiness metrics for audits."""
    if result.route == "manual" or not result.inventory:
        return {
            "available": False,
            "interpretations": [],
            "reason_codes": ["repair.manual_geometry_required"],
        }

    _, shape_by_ref = _shape_maps(result.inventory)
    entries = []
    for interpretation in result.interpretations:
        if not interpretation.selectable:
            continue
        branch = _base_branch(result, interpretation, result.inventory)
        current = _current_branch(branch)
        counts = _repair_counts(branch, current)
        required_refs = {
            shape_ref
            for shape_ref, role in current["roles"].items()
            if role == "unresolved"
            and shape_ref not in set(branch.optional_shape_refs)
        }
        candidates = []
        for selection_set in _selection_sets(shape_by_ref):
            refs = set(selection_set["shape_refs"])
            if refs and refs.issubset(required_refs):
                candidates.append(refs)
        remaining = set(required_refs)
        bulk_action_count = 0
        while remaining:
            best = max(
                candidates,
                key=lambda refs: len(refs.intersection(remaining)),
                default=set(),
            )
            covered = best.intersection(remaining)
            if not covered:
                covered = {next(iter(sorted(remaining)))}
            remaining.difference_update(covered)
            bulk_action_count += 1
        blockers = []
        if not counts["zone_count"]:
            blockers.append("repair.no_zones")
        if counts["required_unresolved_count"]:
            blockers.append("repair.required_unresolved")
        if counts["optional_unresolved_count"]:
            blockers.append("repair.optional_acknowledgement")
        entries.append({
            "interpretation_id": interpretation.id,
            "zone_count": counts["zone_count"],
            "assigned_shape_count": counts["assigned_shape_count"],
            "required_unresolved_count": counts["required_unresolved_count"],
            "optional_unresolved_count": counts["optional_unresolved_count"],
            "multipart_zone_count": counts["multipart_zone_count"],
            "suggested_bulk_action_count": bulk_action_count,
            "blocker_codes": blockers,
        })
    return {
        "available": bool(entries),
        "interpretations": entries,
        "reason_codes": [] if entries else ["repair.no_selectable_interpretation"],
    }


def _diagnostic(code, severity, *, parameters=None, acknowledgement=False):
    return MapImportDiagnostic(
        code=code,
        severity=severity,
        stage="validate",
        parameters=parameters or {},
        shape_ids=[],
        requires_acknowledgement=acknowledgement,
    )


def _compile(directory, draft, state, branch, current):
    analysis = _load_analysis(directory)
    inventory = analysis["inventory"]
    ref_by_index, shape_by_ref = _shape_maps(inventory)
    index_by_ref = {shape_ref: index for index, shape_ref in ref_by_index.items()}
    source = (directory / "source.svg").read_bytes()

    assignments = {
        index_by_ref[shape_ref]: current["zones"][zone_id]["code"]
        for shape_ref, zone_id in current["assignments"].items()
        if shape_ref in index_by_ref and zone_id in current["zones"]
    }
    removed = {
        index_by_ref[shape_ref]
        for shape_ref, role in current["roles"].items()
        if shape_ref in index_by_ref and role in {"label", "excluded"}
    }
    compiled = canonicalize_svg(
        source,
        draft.expected_zone_count,
        shape_assignments=assignments,
        removed_shape_indices=removed,
    )
    counts = _repair_counts(branch, current)
    diagnostics = [
        item for item in compiled.diagnostics
        if item.code != "svg.no_usable_data_code"
    ]
    if not current["zones"]:
        diagnostics.append(_diagnostic("svg.repair_no_zones", "error"))
    if counts["required_unresolved_count"]:
        diagnostics.append(_diagnostic(
            "svg.repair_required_unresolved",
            "error",
            parameters={"count": counts["required_unresolved_count"]},
        ))
    if counts["optional_unresolved_count"]:
        diagnostics.append(_diagnostic(
            OPTIONAL_WARNING_CODE,
            "warning",
            parameters={"count": counts["optional_unresolved_count"]},
            acknowledgement=True,
        ))

    manifest = compiled.manifest
    zones_by_code = {
        zone["code"]: zone for zone in current["zones"].values()
    }
    if manifest:
        manifest_zones = []
        for zone in manifest.zones:
            metadata = zones_by_code[zone.code]
            manifest_zones.append(MapZoneV2(
                code=zone.code,
                shape_ids=zone.shape_ids,
                hit_shape_ids=zone.hit_shape_ids,
                source_keys=list(dict.fromkeys(metadata["source_keys"])),
            ))
        warning_codes = list(dict.fromkeys(
            diagnostic.code
            for diagnostic in diagnostics
            if diagnostic.severity == "warning"
        ))
        manifest = MapPackageV2(
            asset_sha256=compiled.manifest.asset_sha256,
            zones=manifest_zones,
            source=MapSourceV2(
                sha256=draft.source_sha256,
                adapter=branch.adapter,
                expected_zone_count=draft.expected_zone_count,
                warning_codes=warning_codes,
            ),
        )

    acknowledged = set(draft.acknowledgements)
    required_acknowledgements = {
        diagnostic.code
        for diagnostic in diagnostics
        if diagnostic.requires_acknowledgement
    }
    has_errors = any(
        diagnostic.severity == "error" for diagnostic in diagnostics
    )
    can_commit = bool(
        manifest
        and not has_errors
        and not counts["required_unresolved_count"]
        and required_acknowledgements.issubset(acknowledged)
    )

    proposals = []
    question_defaults = {}
    manifest_by_code = {
        zone.code: zone for zone in manifest.zones
    } if manifest else {}
    for zone in sorted(
        current["zones"].values(),
        key=lambda item: min(
            (
                int(shape_by_ref[shape_ref]["index"])
                for shape_ref, zone_id in current["assignments"].items()
                if zone_id == item["zone_id"]
            ),
            default=10**9,
        ),
    ):
        manifest_zone = manifest_by_code.get(zone["code"])
        if manifest_zone is None:
            continue
        source_indices = [
            int(shape_by_ref[shape_ref]["index"])
            for shape_ref, zone_id in current["assignments"].items()
            if zone_id == zone["zone_id"]
        ]
        proposals.append(MapZoneProposal(
            **manifest_zone.model_dump(mode="json"),
            source_shape_indices=source_indices,
            proposed_answer=zone["proposed_answer"],
            proposed_aliases=list(zone["proposed_aliases"]),
            proposal_verified=bool(zone["proposal_verified"]),
            proposal_source=zone["proposal_source"],
            evidence=[],
        ))
        question_defaults[zone["code"]] = {
            "answer": zone["proposed_answer"] if zone["proposal_verified"] else "",
            "aliases": (
                list(zone["proposed_aliases"])
                if zone["proposal_verified"] else []
            ),
        }

    updated_at = _now()
    updated_draft = draft.model_copy(update={
        "route": "assisted",
        "selection_required": False,
        "selected_interpretation_id": state.active_interpretation_id,
        "zones": proposals,
        "diagnostics": diagnostics,
        "can_commit": can_commit,
        "asset_sha256": hashlib.sha256(compiled.canonical_svg).hexdigest(),
        "manifest": manifest,
        "question_defaults": question_defaults,
        "summary": compiled.summary,
        "updated_at": updated_at,
    })
    state.updated_at = updated_at
    return updated_draft, compiled.canonical_svg, counts


def _inspection_bytes(directory):
    analysis = _load_analysis(directory)
    inventory = analysis["inventory"]
    ref_by_index, _ = _shape_maps(inventory)
    source = (directory / "source.svg").read_bytes()
    result = canonicalize_svg(
        source,
        shape_assignments={},
        draft_shape_refs=ref_by_index,
    )
    return result.canonical_svg


def _write_compiled(directory, draft, state, preview, *, inspection=None):
    if inspection is not None:
        _atomic_write_bytes(directory / "inspection.svg", inspection)
    _atomic_write_bytes(directory / "preview.svg", preview)
    _atomic_write_json(
        directory / "repair.json", state.model_dump(mode="json")
    )
    _atomic_write_json(
        directory / "draft.json", draft.model_dump(mode="json")
    )


def initialize_repair(draft_id, interpretation_id, *, root=None):
    draft = load_draft(draft_id, root=root)
    if draft.target_group_id is not None:
        raise HTTPException(
            status_code=409, detail={"code": "svg.repair_upgrade_deferred"}
        )
    if draft.route == "manual":
        raise HTTPException(
            status_code=409, detail={"code": "svg.repair_manual_geometry_required"}
        )
    directory = draft_dir(draft_id, root)
    try:
        state = _load_state(directory)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        state = None

    if state is None or interpretation_id not in state.branches:
        source = (directory / "source.svg").read_bytes()
        result = analyze_svg(
            source,
            draft.expected_zone_count,
            ontology=draft.ontology,
            selected_interpretation_id=interpretation_id,
        )
        interpretation = next(
            (
                item for item in result.interpretations
                if item.id == interpretation_id and item.selectable
            ),
            None,
        )
        if interpretation is None or result.inventory_model is None:
            raise HTTPException(
                status_code=422,
                detail={"code": "svg.interpretation_not_found"},
            )
        branch = _base_branch(
            result, interpretation, result.inventory
        )
        if state is None:
            now = _now()
            state = MapRepairState(
                revision=0,
                active_interpretation_id=interpretation_id,
                branches={interpretation_id: branch},
                created_at=now,
                updated_at=now,
            )
        else:
            state.branches[interpretation_id] = branch

    state.active_interpretation_id = interpretation_id
    state.revision += 1
    branch = state.branches[interpretation_id]
    current = _current_branch(branch)
    updated_draft, preview, _ = _compile(
        directory, draft, state, branch, current
    )
    inspection = (
        _inspection_bytes(directory)
        if not (directory / "inspection.svg").exists()
        else None
    )
    _write_compiled(
        directory, updated_draft, state, preview, inspection=inspection
    )
    return public_repair(updated_draft, state, directory)


def get_repair(draft_id, *, root=None):
    draft = load_draft(draft_id, root=root)
    directory = draft_dir(draft_id, root)
    state = _load_state(directory)
    return public_repair(draft, state, directory)


def apply_repair_action(draft_id, base_revision, action, *, root=None):
    draft = load_draft(draft_id, root=root)
    directory = draft_dir(draft_id, root)
    state = _load_state(directory)
    if base_revision != state.revision:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "svg.repair_revision_conflict",
                "current_revision": state.revision,
            },
        )
    branch = state.branches[state.active_interpretation_id]
    analysis = _load_analysis(directory)
    _, shape_by_ref = _shape_maps(analysis["inventory"])
    current = _current_branch(branch)
    action_type = action["type"]
    if action_type == "undo":
        if branch.cursor > 0:
            branch.cursor -= 1
    elif action_type == "redo":
        if branch.cursor < len(branch.operations):
            branch.cursor += 1
    else:
        operation = _materialize_action(branch, current, shape_by_ref, action)
        _append_operation(branch, current, operation)

    state.revision += 1
    current = _current_branch(branch)
    updated_draft, preview, _ = _compile(
        directory, draft, state, branch, current
    )
    _write_compiled(directory, updated_draft, state, preview)
    return public_repair(updated_draft, state, directory)


def refresh_repair_settings(draft, *, root=None):
    directory = draft_dir(draft.draft_id, root)
    state = _load_state(directory)
    branch = state.branches[state.active_interpretation_id]
    current = _current_branch(branch)
    state.revision += 1
    updated_draft, preview, _ = _compile(
        directory, draft, state, branch, current
    )
    _write_compiled(directory, updated_draft, state, preview)
    return updated_draft


def _selection_sets(shape_by_ref):
    buckets = defaultdict(list)
    labels = {}
    for shape_ref, shape in shape_by_ref.items():
        style_id = f"style:{_shape_signature(shape)}"
        buckets[style_id].append(shape_ref)
        labels[style_id] = "Même style de peinture"
        for value in dict.fromkeys(shape.get("ancestry_ids") or ()):
            key = "layer:" + hashlib.sha256(
                str(value).encode("utf-8")
            ).hexdigest()[:12]
            buckets[key].append(shape_ref)
            labels[key] = f"Même calque · {value}"
        for value in dict.fromkeys((
            *(shape.get("classes") or ()),
            *(shape.get("ancestry_classes") or ()),
        )):
            key = "class:" + hashlib.sha256(
                str(value).encode("utf-8")
            ).hexdigest()[:12]
            buckets[key].append(shape_ref)
            labels[key] = f"Même classe · {value}"
    return [
        {
            "id": key,
            "kind": key.split(":", 1)[0],
            "label": labels[key],
            "shape_refs": sorted(set(refs)),
        }
        for key, refs in sorted(buckets.items())
        if len(set(refs)) >= 2
    ][:500]


def public_repair(draft, state, directory):
    analysis = _load_analysis(directory)
    _, shape_by_ref = _shape_maps(analysis["inventory"])
    branch = state.branches[state.active_interpretation_id]
    current = _current_branch(branch)
    counts = _repair_counts(branch, current)
    optional = set(branch.optional_shape_refs)
    sets = _selection_sets(shape_by_ref)
    set_ids_by_ref = defaultdict(list)
    for selection_set in sets:
        for shape_ref in selection_set["shape_refs"]:
            set_ids_by_ref[shape_ref].append(selection_set["id"])

    zone_refs = defaultdict(list)
    for shape_ref, zone_id in current["assignments"].items():
        zone_refs[zone_id].append(shape_ref)
    zones = [
        {
            **zone,
            "shape_refs": _ordered_refs(
                shape_by_ref, zone_refs.get(zone_id, [])
            ),
        }
        for zone_id, zone in sorted(
            current["zones"].items(),
            key=lambda item: min(
                (
                    int(shape_by_ref[shape_ref]["index"])
                    for shape_ref in zone_refs.get(item[0], [])
                ),
                default=10**9,
            ),
        )
    ]

    shapes = []
    for shape_ref, shape in shape_by_ref.items():
        zone_id = current["assignments"].get(shape_ref)
        role = "zone" if zone_id else current["roles"].get(shape_ref, "decoration")
        risk = None
        if role == "unresolved":
            risk = "optional" if shape_ref in optional else "required"
        evidence = []
        if shape.get("source_id"):
            evidence.append({"kind": "id", "value": shape["source_id"]})
        for value in shape.get("classes") or ():
            evidence.append({"kind": "class", "value": value})
        for value in shape.get("ancestry_ids") or ():
            evidence.append({"kind": "group", "value": value})
        shapes.append({
            "ref": shape_ref,
            "role": role,
            "zone_id": zone_id,
            "risk": risk,
            "tag": shape.get("tag"),
            "bbox": shape.get("bbox"),
            "style_key": f"style:{_shape_signature(shape)}",
            "selection_set_ids": set_ids_by_ref.get(shape_ref, []),
            "evidence": evidence[:20],
        })

    blockers = []
    if counts["zone_count"] == 0:
        blockers.append("repair.no_zones")
    if counts["required_unresolved_count"]:
        blockers.append("repair.required_unresolved")
    if (
        draft.expected_zone_count is not None
        and counts["zone_count"] != draft.expected_zone_count
    ):
        blockers.append("repair.expected_count")
    blockers.extend(
        diagnostic.code
        for diagnostic in draft.diagnostics
        if diagnostic.severity == "error"
        and diagnostic.code not in {"svg.repair_required_unresolved"}
    )
    required_acknowledgements = {
        diagnostic.code
        for diagnostic in draft.diagnostics
        if diagnostic.requires_acknowledgement
    }
    if not required_acknowledgements.issubset(set(draft.acknowledgements)):
        blockers.append("repair.acknowledgements")

    return {
        "draft_id": draft.draft_id,
        "repair_version": 1,
        "revision": state.revision,
        "active_interpretation_id": state.active_interpretation_id,
        "branch_interpretation_ids": sorted(state.branches),
        "inspection_url": f"/map-imports/{draft.draft_id}/inspection.svg",
        "preview_url": draft.preview_url,
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
        "summary": counts,
        "readiness_blockers": list(dict.fromkeys(blockers)),
        "can_commit": draft.can_commit,
        "can_undo": branch.cursor > 0,
        "can_redo": branch.cursor < len(branch.operations),
        "zones": zones,
        "shapes": shapes,
        "selection_sets": sets,
        "diagnostics": [
            diagnostic.model_dump(mode="json")
            for diagnostic in draft.diagnostics
        ],
        "acknowledgements": list(draft.acknowledgements),
        "expected_zone_count": draft.expected_zone_count,
        "updated_at": draft.updated_at,
    }


def compact_repair_payload(directory, draft):
    if not _repair_path(directory).is_file():
        return {
            "repair_available": False,
            "repair_revision": None,
            "repair_summary": None,
            "readiness_blockers": [],
        }
    state = _load_state(directory)
    branch = state.branches[state.active_interpretation_id]
    counts = _repair_counts(branch, _current_branch(branch))
    blockers = []
    if counts["zone_count"] == 0:
        blockers.append("repair.no_zones")
    if counts["required_unresolved_count"]:
        blockers.append("repair.required_unresolved")
    if (
        draft.expected_zone_count is not None
        and counts["zone_count"] != draft.expected_zone_count
    ):
        blockers.append("repair.expected_count")
    if not draft.can_commit:
        blockers.extend(
            diagnostic.code
            for diagnostic in draft.diagnostics
            if diagnostic.severity == "error"
        )
    required_acknowledgements = {
        diagnostic.code
        for diagnostic in draft.diagnostics
        if diagnostic.requires_acknowledgement
    }
    if not required_acknowledgements.issubset(set(draft.acknowledgements)):
        blockers.append("repair.acknowledgements")
    return {
        "repair_available": True,
        "repair_revision": state.revision,
        "repair_summary": counts,
        "readiness_blockers": list(dict.fromkeys(blockers)),
    }
