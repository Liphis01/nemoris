import tempfile
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import PackSubscription
from ..schemas import (
    PackCatalogSettings,
    PackCommentCreateRequest,
    PackInstallRecordRequest,
    PackPublishDraftRequest,
    PackRatingRequest
)
from ..services.pack_catalog import (
    PackCatalogAuthError,
    PackCatalogError,
    add_pack_comment,
    backfill_pack_installs,
    check_pack_catalog_health,
    get_my_pack_status,
    get_pack_publish_status,
    list_pack_comments,
    list_pack_publications,
    publish_pack_publication,
    preview_pack_release,
    rate_pack,
    record_pack_install,
    request_pack_publish_code,
    save_pack_publish_draft,
    save_playlist_publish_draft,
    sign_out_pack_publisher,
    unpublish_pack_publication,
    verify_pack_publish_code,
    search_pack_catalog
)
from ..services.packs import (
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


@router.get("/blueprints/catalog/publish/status", include_in_schema=False)
@router.get("/packs/catalog/publish/status")
def pack_publish_status(db: Session = Depends(get_db)):
    return get_pack_publish_status(db)


@router.post("/blueprints/catalog/publish/request-code", include_in_schema=False)
@router.post("/packs/catalog/publish/request-code")
def pack_publish_request_code(
    payload: dict = Body(...),
    db: Session = Depends(get_db)
):
    try:
        return request_pack_publish_code(db, payload.get("email"))
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/blueprints/catalog/publish/verify", include_in_schema=False)
@router.post("/packs/catalog/publish/verify")
def pack_publish_verify(
    payload: dict = Body(...),
    db: Session = Depends(get_db)
):
    try:
        return verify_pack_publish_code(
            db,
            payload.get("email"),
            payload.get("code")
        )
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/blueprints/catalog/publish/sign-out", include_in_schema=False)
@router.post("/packs/catalog/publish/sign-out")
def pack_publish_sign_out(db: Session = Depends(get_db)):
    sign_out_pack_publisher()

    return get_pack_publish_status(db)


@router.get("/blueprints/catalog/publish/drafts", include_in_schema=False)
@router.get("/packs/catalog/publish/drafts")
def pack_publish_drafts(db: Session = Depends(get_db)):
    try:
        return list_pack_publications(db)
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


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


@router.post("/blueprints/{group_id}/publish/draft", include_in_schema=False)
@router.post("/packs/{group_id}/publish/draft")
def save_group_pack_draft(
    group_id: int,
    payload: PackPublishDraftRequest,
    db: Session = Depends(get_db)
):
    try:
        return save_pack_publish_draft(
            db,
            group_id,
            version=payload.version,
            name=payload.name,
            description=payload.description,
            license=payload.license,
            tags=payload.tags,
            themes=payload.themes
        )
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ValueError as error:
        status_code = 404 if str(error) == "Question group not found" else 400
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.post("/packs/playlists/{collection_id}/publish/draft")
def save_playlist_pack_draft(
    collection_id: int,
    payload: PackPublishDraftRequest,
    db: Session = Depends(get_db)
):
    try:
        return save_playlist_publish_draft(
            db,
            collection_id,
            version=payload.version,
            name=payload.name,
            description=payload.description,
            license=payload.license,
            tags=payload.tags,
            themes=payload.themes
        )
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ValueError as error:
        status_code = 404 if str(error) == "Playlist not found" else 400
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.post("/blueprints/catalog/publish/{pack_guid}", include_in_schema=False)
@router.post("/packs/catalog/publish/{pack_guid}")
def publish_group_pack(pack_guid: str, db: Session = Depends(get_db)):
    try:
        return publish_pack_publication(db, pack_guid)
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/packs/catalog/publish/{pack_guid}/release-preview")
def preview_pack_publication_release(
    pack_guid: str,
    payload: PackPublishDraftRequest,
    db: Session = Depends(get_db)
):
    try:
        return preview_pack_release(
            db,
            pack_guid,
            version=payload.version,
            name=payload.name,
            description=payload.description,
            license=payload.license,
            tags=payload.tags,
            themes=payload.themes
        )
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


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


@router.post("/blueprints/catalog/publish/{pack_guid}/unpublish", include_in_schema=False)
@router.post("/packs/catalog/publish/{pack_guid}/unpublish")
def unpublish_group_pack(pack_guid: str, db: Session = Depends(get_db)):
    try:
        return unpublish_pack_publication(db, pack_guid)
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/blueprints/catalog/{pack_guid}/record-install", include_in_schema=False)
@router.post("/packs/catalog/{pack_guid}/record-install")
def record_pack_install_route(
    pack_guid: str,
    payload: PackInstallRecordRequest,
    db: Session = Depends(get_db)
):
    try:
        return record_pack_install(
            db, pack_guid, installed_version=payload.installed_version
        )
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/blueprints/catalog/backfill-installs", include_in_schema=False)
@router.post("/packs/catalog/backfill-installs")
def backfill_pack_installs_route(db: Session = Depends(get_db)):
    try:
        return backfill_pack_installs(db)
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/blueprints/catalog/{pack_guid}/my-status", include_in_schema=False)
@router.get("/packs/catalog/{pack_guid}/my-status")
def pack_my_status(pack_guid: str, db: Session = Depends(get_db)):
    try:
        return get_my_pack_status(db, pack_guid)
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/blueprints/catalog/{pack_guid}/comments", include_in_schema=False)
@router.get("/packs/catalog/{pack_guid}/comments")
def pack_comments(pack_guid: str, db: Session = Depends(get_db)):
    try:
        return list_pack_comments(db, pack_guid)
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/blueprints/catalog/{pack_guid}/comments", include_in_schema=False)
@router.post("/packs/catalog/{pack_guid}/comments")
def add_pack_comment_route(
    pack_guid: str,
    payload: PackCommentCreateRequest,
    db: Session = Depends(get_db)
):
    try:
        return add_pack_comment(db, pack_guid, payload.body)
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/blueprints/catalog/{pack_guid}/rating", include_in_schema=False)
@router.post("/packs/catalog/{pack_guid}/rating")
def rate_pack_route(
    pack_guid: str,
    payload: PackRatingRequest,
    db: Session = Depends(get_db)
):
    try:
        return rate_pack(db, pack_guid, payload.rating)
    except PackCatalogAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except PackCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
