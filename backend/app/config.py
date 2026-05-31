from pathlib import Path
import sys


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
BUNDLED_DIR = Path(getattr(sys, "_MEIPASS", PROJECT_DIR))
APP_DATA_DIR = (
    Path(sys.executable).resolve().parent
    if getattr(sys, "frozen", False)
    else BACKEND_DIR
)
DATABASE_FILE = APP_DATA_DIR / "questions.db"
STATIC_DIR = APP_DATA_DIR / "static"
BACKUP_DIR = APP_DATA_DIR / "backups"
FRONTEND_DIST_DIR = BUNDLED_DIR / "frontend" / "dist"
