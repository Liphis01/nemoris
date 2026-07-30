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
MAP_IMPORT_DRAFT_DIR = APP_DATA_DIR / "map-import-drafts"
# Sync account/token/state (M2). Deliberately a sibling of questions.db, NOT
# inside it: create_backup only bundles questions.db + static/, so an auth
# token here never rides along in a synced/backed-up collection.
SYNC_STATE_FILE = APP_DATA_DIR / "sync_state.json"
# Catalogue publishing account/token/state. Kept next to sync_state.json, not
# inside questions.db, so Supabase auth tokens never enter backups or sync.
PACK_PUBLISH_STATE_FILE = APP_DATA_DIR / "pack_publish_state.json"
FRONTEND_DIST_DIR = BUNDLED_DIR / "frontend" / "dist"

# The Nemoris cloud. Sync and the pack catalogue are one shared Supabase
# project: there is exactly one correct value for these, so they ship with the
# app instead of being typed in by every user. CLOUD_KEY is a *publishable*
# key — safety comes from RLS plus the user's auth token, never from keeping
# it secret — so bundling it is safe by design.
# Self-hosters (see sync_server/) override both through the environment; an
# empty CLOUD_KEY selects the reference protocol instead of the Supabase one.
CLOUD_URL = os.environ.get(
    "NEMORIS_SUPABASE_URL", "https://apauxfgsthjmowjimcwn.supabase.co"
).strip().rstrip("/")
CLOUD_KEY = os.environ.get(
    "NEMORIS_SUPABASE_KEY", "sb_publishable_MMicstgbU4UpPCHYJvTSZQ_FP2gTkFh"
).strip()
