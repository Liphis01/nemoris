from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import ImageGroupItemsBulkUpdate
from ..services.image_groups import list_image_group_items, save_image_group_items


router = APIRouter()


@router.get("/image-groups/{group_id}/items")
def get_items(group_id: int, db: Session = Depends(get_db)):
    return list_image_group_items(db, group_id)


@router.patch("/image-groups/{group_id}/items")
def update_items_bulk(
    group_id: int,
    payload: ImageGroupItemsBulkUpdate,
    db: Session = Depends(get_db)
):
    return save_image_group_items(db, group_id, payload)
