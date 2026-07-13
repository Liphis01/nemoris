from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import SequenceGroupItemsBulkUpdate
from ..services.sequence_groups import (
    list_sequence_group_items,
    save_sequence_group_items
)


router = APIRouter()


@router.get("/sequence-groups/{group_id}/items")
def get_items(group_id: int, db: Session = Depends(get_db)):
    return list_sequence_group_items(db, group_id)


@router.patch("/sequence-groups/{group_id}/items")
def update_items_bulk(
    group_id: int,
    payload: SequenceGroupItemsBulkUpdate,
    db: Session = Depends(get_db)
):
    return save_sequence_group_items(db, group_id, payload)
