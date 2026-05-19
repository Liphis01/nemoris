from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import Collection
from ..schemas import CollectionCreate


router = APIRouter()


@router.post("/collections")
def create_collection(data: CollectionCreate, db: Session = Depends(get_db)):
    # Collections are lightweight labels/lists that can filter review sessions.
    collection = Collection(name=data.name)
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return collection


@router.get("/collections")
def get_collections(db: Session = Depends(get_db)):
    # The frontend keeps collection state simple and loads the full list when
    # entering review/manage flows.
    return db.query(Collection).all()
