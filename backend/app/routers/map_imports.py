from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import (
    MapImportCommitRequest,
    MapImportPatchRequest,
    MapImportUrlRequest,
    MapRepairActionRequest,
    MapRepairInitializeRequest,
)
from ..services.svg_maps.canonicalize import (
    CanonicalizationError,
    MAX_INPUT_BYTES,
)
from ..services.svg_maps.commit import (
    commit_draft,
    legacy_group_source,
)
from ..services.svg_maps.contracts import MapImportOntology
from ..services.svg_maps.drafts import (
    create_draft,
    delete_draft,
    draft_dir,
    list_drafts,
    load_draft,
    public_draft,
    update_draft,
)
from ..services.svg_maps.repair import (
    apply_repair_action,
    get_repair,
    initialize_repair,
)
from ..services.svg_maps.remote import fetch_svg_url


router = APIRouter()


def _analyze(source, **kwargs):
    try:
        return create_draft(source, **kwargs)
    except CanonicalizationError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": str(error)},
        ) from error


@router.post("/map-imports")
async def upload_map_import(
    file: UploadFile = File(...),
    expected_zone_count: int | None = Form(default=None, ge=1, le=50000),
    name: str | None = Form(default=None, max_length=100),
    ontology: MapImportOntology = Form(default="auto"),
):
    ontology_value = ontology if isinstance(ontology, str) else "auto"
    source = await file.read(MAX_INPUT_BYTES + 1)
    if len(source) > MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail="SVG is larger than 10 MiB")
    return public_draft(_analyze(
        source,
        expected_zone_count=expected_zone_count,
        name=name,
        ontology=ontology_value,
    ))


@router.post("/map-imports/url")
def import_map_url(payload: MapImportUrlRequest):
    source = fetch_svg_url(payload.url)
    return public_draft(_analyze(
        source,
        expected_zone_count=payload.expected_zone_count,
        name=payload.name,
        ontology=payload.ontology,
    ))


@router.get("/map-imports")
def get_map_imports():
    return {"drafts": list_drafts()}


@router.get("/map-imports/{draft_id}")
def get_map_import(draft_id: str):
    return public_draft(load_draft(draft_id))


@router.get("/map-imports/{draft_id}/preview.svg")
def get_map_import_preview(draft_id: str):
    load_draft(draft_id)
    return FileResponse(
        draft_dir(draft_id) / "preview.svg",
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/map-imports/{draft_id}/inspection.svg")
def get_map_import_inspection(draft_id: str):
    get_repair(draft_id)
    return FileResponse(
        draft_dir(draft_id) / "inspection.svg",
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/map-imports/{draft_id}/repair")
def start_map_import_repair(
    draft_id: str, payload: MapRepairInitializeRequest
):
    try:
        return initialize_repair(draft_id, payload.interpretation_id)
    except CanonicalizationError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": str(error)},
        ) from error


@router.get("/map-imports/{draft_id}/repair")
def get_map_import_repair(draft_id: str):
    return get_repair(draft_id)


@router.post("/map-imports/{draft_id}/repair/actions")
def mutate_map_import_repair(
    draft_id: str, payload: MapRepairActionRequest
):
    try:
        return apply_repair_action(
            draft_id,
            payload.base_revision,
            payload.action.model_dump(mode="json"),
        )
    except CanonicalizationError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": str(error)},
        ) from error


@router.patch("/map-imports/{draft_id}")
def patch_map_import(draft_id: str, payload: MapImportPatchRequest):
    try:
        draft = update_draft(
            draft_id,
            expected_zone_count=payload.expected_zone_count,
            expected_count_was_set="expected_zone_count" in payload.model_fields_set,
            ontology=payload.ontology,
            ontology_was_set="ontology" in payload.model_fields_set,
            selected_interpretation_id=payload.selected_interpretation_id,
            selection_was_set=(
                "selected_interpretation_id" in payload.model_fields_set
            ),
            acknowledgements=payload.acknowledgements,
        )
    except CanonicalizationError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": str(error)},
        ) from error
    return public_draft(draft)


@router.delete("/map-imports/{draft_id}")
def cancel_map_import(draft_id: str):
    delete_draft(draft_id)
    return {"status": "cancelled"}


@router.post("/map-imports/{draft_id}/commit")
def commit_map_import(
    draft_id: str,
    payload: MapImportCommitRequest | None = None,
    db: Session = Depends(get_db),
):
    return commit_draft(
        db, draft_id, name=payload.name if payload else None
    )


@router.post("/maps/{group_id}/upgrade-draft")
def create_map_upgrade_draft(
    group_id: int,
    db: Session = Depends(get_db),
):
    group, source = legacy_group_source(db, group_id)
    return public_draft(_analyze(
        source,
        target_group_id=group.id,
        name=group.name,
    ))
