from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import TextGroupItemsBulkUpdate
from ..services.text_groups import (
    list_text_group_items,
    save_text_group_items
)


router = APIRouter()


@router.get("/text-groups/{group_id}/items")
def get_items(group_id: int, db: Session = Depends(get_db)):
    return list_text_group_items(db, group_id)


@router.patch("/text-groups/{group_id}/items")
def update_items_bulk(
    group_id: int,
    payload: TextGroupItemsBulkUpdate,
    db: Session = Depends(get_db)
):
    return save_text_group_items(db, group_id, payload)
