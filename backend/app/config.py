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
FRONTEND_DIST_DIR = BUNDLED_DIR / "frontend" / "dist"
