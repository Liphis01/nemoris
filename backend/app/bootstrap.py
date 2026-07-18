import shutil

from .config import (
    APP_DATA_DIR,
    DATABASE_FILE,
    IS_FROZEN,
    SEED_SOURCE_DIRS,
    STATIC_DIR,
)
from .migrations import run_migrations


def _adopt_initial_data():
    # First run of an installed build: app data lives in the user profile,
    # so nothing exists there yet. Seed it from the first candidate source
    # that has a database (see SEED_SOURCE_DIRS for the priority order).
    if not IS_FROZEN or DATABASE_FILE.exists():
        return

    source_dir = next(
        (d for d in SEED_SOURCE_DIRS if (d / "questions.db").exists()),
        None,
    )

    if source_dir is None:
        return

    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_dir / "questions.db", DATABASE_FILE)

    source_static = source_dir / "static"

    if source_static.is_dir() and not STATIC_DIR.exists():
        shutil.copytree(source_static, STATIC_DIR)


def init_database():
    _adopt_initial_data()
    return run_migrations()
