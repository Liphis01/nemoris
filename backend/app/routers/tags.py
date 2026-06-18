from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import TagHierarchyUpdate
from ..services.tag_hierarchy import load_tag_hierarchy, save_tag_hierarchy


router = APIRouter()


@router.get("/tags/hierarchy")
def get_hierarchy(db: Session = Depends(get_db)):
    hierarchy = load_tag_hierarchy(db)
    db.commit()

    return hierarchy


@router.put("/tags/hierarchy")
def update_hierarchy(
    data: TagHierarchyUpdate,
    db: Session = Depends(get_db)
):
    hierarchy = save_tag_hierarchy(db, data.model_dump())
    db.commit()

    return hierarchy
