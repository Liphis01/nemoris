import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import BlueprintExportRequest
from ..services.blueprints import export_blueprint, import_blueprint


router = APIRouter()


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
