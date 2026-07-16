import shutil

from .config import (
    APP_DATA_DIR,
    DATABASE_FILE,
    INSTALL_DIR,
    IS_FROZEN,
    SEED_DIR,
    STATIC_DIR,
)
from .migrations import run_migrations


def _adopt_initial_data():
    # First run of an installed build: app data lives in the user profile,
    # so nothing exists there yet. Prefer data from the old layout (next to
    # the executable, pre-installer builds) over the bundled seed.
    if not IS_FROZEN or DATABASE_FILE.exists():
        return

    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

    legacy_db = INSTALL_DIR / "questions.db"
    source_dir = INSTALL_DIR if legacy_db.exists() else SEED_DIR
    source_db = source_dir / "questions.db"

    if source_db.exists():
        shutil.copy2(source_db, DATABASE_FILE)

    source_static = source_dir / "static"

    if source_static.is_dir() and not STATIC_DIR.exists():
        shutil.copytree(source_static, STATIC_DIR)


def init_database():
    _adopt_initial_data()
    return run_migrations()
