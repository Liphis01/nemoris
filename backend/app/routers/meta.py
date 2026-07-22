from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..migrations import MIGRATIONS


router = APIRouter()


@router.get("/meta/schema-version")
def schema_version(db: Session = Depends(get_db)):
    # The sync server (sync-roadmap 0.7/M2) compares these to refuse clients
    # whose schema is older than the collection they would pull, instead of
    # corrupting it.
    applied = [
        row[0]
        for row in db.execute(
            text("SELECT version FROM schema_migrations ORDER BY version")
        )
    ]

    return {
        "code_version": MIGRATIONS[-1].version,
        "database_version": applied[-1] if applied else None,
        "pending": len(MIGRATIONS) - len(applied)
    }
