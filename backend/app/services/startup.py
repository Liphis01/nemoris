import logging

from ..config import BACKUP_DIR, DATABASE_FILE, STATIC_DIR
from ..database import SessionLocal
from ..models import Progress
from .backups import create_backup
from .fsrs_migration import (
    has_fsrs_v6_migration_run,
    migrate_progress_to_fsrs_v6
)
from .progress import rebalance_progress_calendar
from .settings import save_startup_rebalance_notice


logger = logging.getLogger(__name__)


def run_startup_rebalance(db):
    migration = migrate_progress_to_fsrs_v6(db)
    result = rebalance_progress_calendar(db)
    notice = save_startup_rebalance_notice(db, result)

    return {
        "migration": migration,
        "rebalance": result,
        "notice": notice
    }


def run_startup_rebalance_with_session():
    db = SessionLocal()

    try:
        if (
            DATABASE_FILE.exists()
            and not has_fsrs_v6_migration_run(db)
            and db.query(Progress.id).first() is not None
        ):
            create_backup(
                database_file=DATABASE_FILE,
                static_dir=STATIC_DIR,
                backup_dir=BACKUP_DIR,
                reason="startup-data-migration",
                label="before-fsrs-v6",
                extra_manifest={"migration": "fsrs_v6"}
            )

        outcome = run_startup_rebalance(db)
        db.commit()
        return outcome
    except Exception:
        db.rollback()
        logger.exception("Startup review scheduler maintenance failed")
        return None
    finally:
        db.close()
