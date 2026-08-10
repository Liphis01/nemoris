from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import SetGroupUpdate
from ..services.set_groups import get_set_group, save_set_group

router = APIRouter()


@router.get("/set-groups/{group_id}")
def get_group(group_id: int, db: Session = Depends(get_db)):
    return get_set_group(db, group_id)


@router.patch("/set-groups/{group_id}")
def update_group(group_id: int, payload: SetGroupUpdate, db: Session = Depends(get_db)):
    return save_set_group(db, group_id, payload)
