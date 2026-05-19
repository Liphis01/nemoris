from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import Collection
from ..schemas import CollectionCreate


router = APIRouter()


@router.post("/collections")
def create_collection(data: CollectionCreate, db: Session = Depends(get_db)):
    collection = Collection(name=data.name)
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return collection


@router.get("/collections")
def get_collections(db: Session = Depends(get_db)):
    return db.query(Collection).all()
