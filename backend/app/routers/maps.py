from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import MapZonesBulkUpdate
from ..services.map_zones import list_map_group_zones, save_map_group_zones


router = APIRouter()


@router.get("/maps/{group_id}/zones")
def get_zones(group_id: int, db: Session = Depends(get_db)):
    return list_map_group_zones(db, group_id)


@router.patch("/maps/{group_id}/zones")
def update_zones_bulk(
    group_id: int,
    payload: MapZonesBulkUpdate,
    db: Session = Depends(get_db)
):
    return save_map_group_zones(db, group_id, payload)
