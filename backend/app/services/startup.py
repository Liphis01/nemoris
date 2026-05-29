import logging

from ..database import SessionLocal
from .progress import rebalance_progress_calendar
from .settings import save_startup_rebalance_notice


logger = logging.getLogger(__name__)


def run_startup_rebalance(db):
    result = rebalance_progress_calendar(db)
    notice = save_startup_rebalance_notice(db, result)

    return {
        "rebalance": result,
        "notice": notice
    }


def run_startup_rebalance_with_session():
    db = SessionLocal()

    try:
        outcome = run_startup_rebalance(db)
        db.commit()
        return outcome
    except Exception:
        db.rollback()
        logger.exception("Startup review calendar rebalance failed")
        return None
    finally:
        db.close()
