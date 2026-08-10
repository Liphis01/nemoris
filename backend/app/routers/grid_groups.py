from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import GridGroupUpdate
from ..services.grid import get_grid_group, save_grid_group


router = APIRouter()


@router.get("/grid-groups/{group_id}")
def get_group(group_id: int, db: Session = Depends(get_db)):
    return get_grid_group(db, group_id)


@router.patch("/grid-groups/{group_id}")
def update_group(group_id: int, payload: GridGroupUpdate, db: Session = Depends(get_db)):
    return save_grid_group(db, group_id, payload)
