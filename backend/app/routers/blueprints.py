import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import BlueprintSubscription
from ..schemas import BlueprintCatalogSettings, BlueprintExportRequest
from ..services.blueprint_catalog import (
    BlueprintCatalogError,
    search_blueprint_catalog
)
from ..services.blueprints import (
    export_blueprint,
    import_blueprint,
    unsubscribe_blueprint,
    update_blueprint
)
from ..services.settings import (
    get_blueprint_catalog_settings,
    save_blueprint_catalog_settings
)


router = APIRouter()


@router.get("/blueprints")
def list_blueprint_subscriptions(db: Session = Depends(get_db)):
    return [
        {
            "blueprint_guid": subscription.blueprint_guid,
            "installed_version": subscription.installed_version,
            "name": subscription.name,
            "source": subscription.source,
            "subscribed_at": subscription.subscribed_at,
            "updated_at": subscription.updated_at
        }
        for subscription in db.query(BlueprintSubscription).all()
    ]


@router.get("/blueprints/catalog-settings")
def get_blueprint_catalog(db: Session = Depends(get_db)):
    return get_blueprint_catalog_settings(db)


@router.put("/blueprints/catalog-settings")
def update_blueprint_catalog(
    payload: BlueprintCatalogSettings,
    db: Session = Depends(get_db)
):
    result = save_blueprint_catalog_settings(db, payload.url, payload.key)
    db.commit()

    return result


@router.get("/blueprints/catalog/search")
def search_catalog_blueprints(
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
        return search_blueprint_catalog(
            db,
            query=q,
            theme=theme,
            type_group=type,
            status=status,
            sort=sort,
            limit=limit,
            cursor=cursor
        )
    except BlueprintCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/blueprints/{group_id}/export")
def export_group_blueprint(
    group_id: int,
    payload: BlueprintExportRequest,
    db: Session = Depends(get_db)
):
    try:
        zip_path = export_blueprint(
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


@router.post("/blueprints/import")
def import_blueprint_zip(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    with tempfile.TemporaryDirectory() as temp_name:
        upload_path = Path(temp_name) / "import.zip"

        with upload_path.open("wb") as destination:
            while chunk := file.file.read(1024 * 1024):
                destination.write(chunk)

        try:
            result = import_blueprint(db, upload_path, source=file.filename)
        except ValueError as error:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(error)) from error

    return result


@router.post("/blueprints/update")
def update_blueprint_zip(
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
            result = update_blueprint(
                db,
                upload_path,
                source=file.filename,
                delete_removed=delete_removed
            )
        except ValueError as error:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(error)) from error

    return result


@router.post("/blueprints/{blueprint_guid}/unsubscribe")
def unsubscribe_blueprint_subscription(
    blueprint_guid: str,
    delete_content: bool = False,
    db: Session = Depends(get_db)
):
    try:
        result = unsubscribe_blueprint(
            db, blueprint_guid, delete_content=delete_content
        )
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error

    return result
