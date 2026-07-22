import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import PackSubscription
from ..schemas import PackCatalogSettings, PackExportRequest
from ..services.pack_catalog import (
    PackCatalogError,
    check_pack_catalog_health,
    search_pack_catalog
)
from ..services.packs import (
    export_pack,
    import_pack,
    unsubscribe_pack,
    update_pack
)
from ..services.settings import (
    get_pack_catalog_settings,
    save_pack_catalog_settings
)


router = APIRouter()


@router.get("/blueprints", include_in_schema=False)
@router.get("/packs")
def list_pack_subscriptions(db: Session = Depends(get_db)):
    return [
        {
            "pack_guid": subscription.pack_guid,
            "installed_version": subscription.installed_version,
            "name": subscription.name,
            "source": subscription.source,
            "subscribed_at": subscription.subscribed_at,
            "updated_at": subscription.updated_at
        }
        for subscription in db.query(PackSubscription).all()
    ]


@router.get("/blueprints/catalog-settings", include_in_schema=False)
@router.get("/packs/catalog-settings")
def get_pack_catalog(db: Session = Depends(get_db)):
    return get_pack_catalog_settings(db)


@router.put("/blueprints/catalog-settings", include_in_schema=False)
@router.put("/packs/catalog-settings")
def update_pack_catalog(
    payload: PackCatalogSettings,
    db: Session = Depends(get_db)
):
    result = save_pack_catalog_settings(db, payload.url, payload.key)
    db.commit()

    return result


@router.get("/blueprints/catalog/diagnostics", include_in_schema=False)
@router.get("/packs/catalog/diagnostics")
def diagnose_pack_catalog(db: Session = Depends(get_db)):
    return check_pack_catalog_health(db)


@router.get("/blueprints/catalog/search", include_in_schema=False)
@router.get("/packs/catalog/search")
def search_catalog_packs(
    q: str = "",
    theme: str = "",
    type: str = "",
    status: str = "all",
    sort: str = "pertinence",
    limit: int = 24,
    cursor: str | None = None,
    db: Session = Depends(get_db)
):
    try:
        return search_pack_catalog(
            db,
            query=q,
            theme=theme,
            type_group=type,
            status=status,
            sort=sort,
            limit=limit,
            cursor=cursor
        )
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/blueprints/{group_id}/export", include_in_schema=False)
@router.post("/packs/{group_id}/export")
def export_group_pack(
    group_id: int,
    payload: PackExportRequest,
    db: Session = Depends(get_db)
):
    try:
        zip_path = export_pack(
            db,
            group_id,
            version=payload.version,
            name=payload.name,
            description=payload.description,
            license=payload.license
        )
    except ValueError as error:
        status_code = 404 if str(error) == "Question group not found" else 400
        raise HTTPException(status_code=status_code, detail=str(error)) from error

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=zip_path.name
    )


@router.post("/blueprints/import", include_in_schema=False)
@router.post("/packs/import")
def import_pack_zip(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    with tempfile.TemporaryDirectory() as temp_name:
        upload_path = Path(temp_name) / "import.zip"

        with upload_path.open("wb") as destination:
            while chunk := file.file.read(1024 * 1024):
                destination.write(chunk)

        try:
            result = import_pack(db, upload_path, source=file.filename)
        except ValueError as error:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(error)) from error

    return result


@router.post("/blueprints/update", include_in_schema=False)
@router.post("/packs/update")
def update_pack_zip(
    file: UploadFile = File(...),
    delete_removed: bool = False,
    db: Session = Depends(get_db)
):
    # Safe to call twice: once with delete_removed=False to preview what
    # would be removed while applying everything else, again with
    # delete_removed=True once a caller/UI has confirmed the deletion.
    with tempfile.TemporaryDirectory() as temp_name:
        upload_path = Path(temp_name) / "update.zip"

        with upload_path.open("wb") as destination:
            while chunk := file.file.read(1024 * 1024):
                destination.write(chunk)

        try:
            result = update_pack(
                db,
                upload_path,
                source=file.filename,
                delete_removed=delete_removed
            )
        except ValueError as error:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(error)) from error

    return result


@router.post("/blueprints/{pack_guid}/unsubscribe", include_in_schema=False)
@router.post("/packs/{pack_guid}/unsubscribe")
def unsubscribe_pack_subscription(
    pack_guid: str,
    delete_content: bool = False,
    db: Session = Depends(get_db)
):
    try:
        result = unsubscribe_pack(
            db, pack_guid, delete_content=delete_content
        )
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error

    return result
