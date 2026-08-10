from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import ClozeGroupUpdate
from ..services.cloze import get_cloze_group, save_cloze_group


router = APIRouter()


@router.get("/cloze-groups/{group_id}")
def get_group(group_id: int, db: Session = Depends(get_db)):
    return get_cloze_group(db, group_id)


@router.patch("/cloze-groups/{group_id}")
def update_group(group_id: int, payload: ClozeGroupUpdate, db: Session = Depends(get_db)):
    return save_cloze_group(db, group_id, payload)
