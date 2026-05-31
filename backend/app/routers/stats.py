from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..services.stats import build_stats


router = APIRouter()


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    return build_stats(db)
