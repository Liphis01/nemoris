from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import MediaGroupItemsBulkUpdate, MediaUrlImport
from ..services.media_groups import (
    list_media_group_items,
    save_media_group_items,
    upload_media_group_media,
    upload_media_group_media_url
)


router = APIRouter()


@router.get("/media-groups/{group_id}/items")
def get_items(group_id: int, db: Session = Depends(get_db)):
    return list_media_group_items(db, group_id)


@router.patch("/media-groups/{group_id}/items")
def update_items_bulk(
    group_id: int,
    payload: MediaGroupItemsBulkUpdate,
    db: Session = Depends(get_db)
):
    return save_media_group_items(db, group_id, payload)


@router.post("/media-groups/{group_id}/upload")
def upload_group_media(
    group_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    return upload_media_group_media(db, group_id, file)


@router.post("/media-groups/{group_id}/upload/url")
def upload_group_media_from_url(
    group_id: int,
    payload: MediaUrlImport,
    db: Session = Depends(get_db)
):
    return upload_media_group_media_url(db, group_id, payload.url)
