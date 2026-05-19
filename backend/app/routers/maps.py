from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import MapZonesBulkUpdate
from ..services.map_zones import list_map_group_zones, save_map_group_zones


router = APIRouter()


@router.get("/maps/{group_id}/zones")
def get_zones(group_id: int, db: Session = Depends(get_db)):
    # Returns the atomic map questions for one visual map group.
    return list_map_group_zones(db, group_id)


@router.patch("/maps/{group_id}/zones")
def update_zones_bulk(
    group_id: int,
    payload: MapZonesBulkUpdate,
    db: Session = Depends(get_db)
):
    # Bulk save keeps the SVG-zone editor fast: one request can create/update
    # many atomic map questions and the group metadata.
    return save_map_group_zones(db, group_id, payload)
