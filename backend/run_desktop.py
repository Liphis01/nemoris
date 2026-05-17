from pathlib import Path
import os
import sys
import threading
import webbrowser

import uvicorn


def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent

    return Path(__file__).resolve().parent


def open_browser(port):
    webbrowser.open(f"http://127.0.0.1:{port}")


if __name__ == "__main__":
    os.chdir(app_dir())

    from app.main import app

    port = int(os.environ.get("QUIZ_APP_PORT", "8000"))

    threading.Timer(1.0, open_browser, args=(port,)).start()
    uvicorn.run(app, host="127.0.0.1", port=port)
