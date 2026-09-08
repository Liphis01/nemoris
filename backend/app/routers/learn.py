from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..schemas import LearnConfusionBatch
from ..services.learn import record_learn_confusions


router = APIRouter()


@router.post("/learn/confusions")
def post_learn_confusions(
    payload: LearnConfusionBatch,
    db: Session = Depends(get_db)
):
    """Persist the pairs a learner mixed up during one Learn drill.

    This is the only thing a Learn session writes: no Progress row is created
    and no card is scheduled, so binge-learning a group stays a scratchpad.
    """
    return record_learn_confusions(
        db,
        [entry.model_dump() for entry in payload.entries]
    )
