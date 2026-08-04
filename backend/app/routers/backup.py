import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..bootstrap import init_database
from ..database import engine
from ..services.backups import create_backup, reset_collection, restore_backup
from ..services.startup import run_startup_rebalance_with_session


router = APIRouter()


@router.get("/backup/export")
def export_database():
    # The backup zip bundles the SQLite snapshot, all uploaded media and a
    # manifest, so a single download captures the whole database.
    result = create_backup(reason="export")

    return FileResponse(
        result.path,
        media_type="application/zip",
        filename=result.path.name
    )


@router.post("/backup/import")
def import_database(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as temp_name:
        upload_path = Path(temp_name) / "import.zip"

        with upload_path.open("wb") as destination:
            while chunk := file.file.read(1024 * 1024):
                destination.write(chunk)

        # Release the SQLite file handle so the database file can be swapped on
        # every platform (Windows refuses to replace an open file).
        engine.dispose()

        try:
            result = restore_backup(upload_path)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    # Upgrade an older imported database and refresh review scheduling state.
    init_database()
    run_startup_rebalance_with_session()

    return {"status": "imported", "included": result["included"]}


@router.post("/data/reset")
def reset_data():
    # Same file-swap dance as the import above: release the SQLite handle
    # before the database file is deleted, then rebuild the empty schema.
    engine.dispose()
    result = reset_collection()
    init_database()
    run_startup_rebalance_with_session()

    return {"status": "reset", "backup": result["backup"]}
