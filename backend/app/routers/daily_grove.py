from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..services.daily_grove import (
    build_daily_grove_status,
    complete_daily_grove
)


router = APIRouter()


@router.get("/daily_grove/status")
def get_daily_grove_status(db: Session = Depends(get_db)):
    status = build_daily_grove_status(db)
    db.commit()

    return status


@router.post("/daily_grove/complete")
def complete_daily_grove_today(db: Session = Depends(get_db)):
    status = complete_daily_grove(db)
    db.commit()

    return status
