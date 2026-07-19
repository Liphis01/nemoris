"""Backend entry point when running as a Tauri sidecar.

Tauri owns the window; this process is purely the FastAPI/uvicorn server.
The port is chosen by the Rust host and passed in QUIZ_APP_PORT. Data storage
(APP_DATA_DIR) and first-run seeding are handled by app.config / app.bootstrap
exactly as in the standalone build, since sys.frozen is set here too.
"""

from pathlib import Path
import os
import sys

import uvicorn


def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent

    return Path(__file__).resolve().parent


if __name__ == "__main__":
    os.chdir(app_dir())

    # A frozen console sidecar keeps real stdout/stderr pipes (Tauri reads
    # them), but guard against a windowed build where they would be None and
    # crash uvicorn's log formatter.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")

    if sys.stderr is None:
        sys.stderr = sys.stdout

    from app.main import app

    port = int(os.environ.get("QUIZ_APP_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
