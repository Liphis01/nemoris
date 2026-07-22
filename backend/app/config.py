from pathlib import Path
import os
import sys


IS_FROZEN = bool(getattr(sys, "frozen", False))
BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
BUNDLED_DIR = Path(getattr(sys, "_MEIPASS", PROJECT_DIR))
INSTALL_DIR = Path(sys.executable).resolve().parent if IS_FROZEN else BACKEND_DIR
# First-run data shipped by the packaging scripts next to the executable.
SEED_DIR = INSTALL_DIR / "seed"

# Candidate directories that may hold first-run data, in priority order:
# the old next-to-exe layout (questions.db beside the exe), the packaging
# scripts' seed/ folder, and data bundled inside a onefile build (extracted
# to _MEIPASS/seed by the Tauri sidecar build).
SEED_SOURCE_DIRS = [INSTALL_DIR, SEED_DIR, BUNDLED_DIR / "seed"]


def _frozen_app_data_dir():
    # Installed builds must not write next to the executable (Program Files
    # is read-only); follow each platform's user-data convention instead.
    if sys.platform == "win32":
        base = Path(
            os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming"
        )
        return base / "Nemoris"

    base = Path(
        os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    )
    return base / "nemoris"


APP_DATA_DIR = _frozen_app_data_dir() if IS_FROZEN else BACKEND_DIR
DATABASE_FILE = APP_DATA_DIR / "questions.db"
STATIC_DIR = APP_DATA_DIR / "static"
BACKUP_DIR = APP_DATA_DIR / "backups"
PACK_DIR = APP_DATA_DIR / "packs"
# Sync account/token/state (M2). Deliberately a sibling of questions.db, NOT
# inside it: create_backup only bundles questions.db + static/, so an auth
# token here never rides along in a synced/backed-up collection.
SYNC_STATE_FILE = APP_DATA_DIR / "sync_state.json"
# Catalogue publishing account/token/state. Kept next to sync_state.json, not
# inside questions.db, so Supabase auth tokens never enter backups or sync.
PACK_PUBLISH_STATE_FILE = APP_DATA_DIR / "pack_publish_state.json"
FRONTEND_DIST_DIR = BUNDLED_DIR / "frontend" / "dist"
