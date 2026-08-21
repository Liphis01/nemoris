"""Backend entry point when running as a Tauri sidecar.

Tauri owns the window; this process is purely the FastAPI/uvicorn server.
The port is chosen by the Rust host and passed in QUIZ_APP_PORT. Data storage
(APP_DATA_DIR) is handled by app.config / app.bootstrap exactly as in the
standalone build, since sys.frozen is set here too.
"""

from pathlib import Path
import ctypes
import os
import sys
import threading
import time

import uvicorn


def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent

    return Path(__file__).resolve().parent


def process_is_alive(pid):
    if pid <= 0:
        return False

    if sys.platform == "win32":
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        synchronize = 0x00100000
        wait_timeout = 0x00000102
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        handle = kernel32.OpenProcess(synchronize, False, pid)

        if not handle:
            return ctypes.get_last_error() == 5

        try:
            return kernel32.WaitForSingleObject(handle, 0) == wait_timeout
        finally:
            kernel32.CloseHandle(handle)

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

    return True


def start_parent_watchdog():
    try:
        parent_pid = int(os.environ.get("NEMORIS_PARENT_PID", "0"))
    except ValueError:
        return

    if parent_pid <= 0:
        return

    def watch():
        while True:
            time.sleep(1)
            if not process_is_alive(parent_pid):
                os._exit(0)

    threading.Thread(target=watch, name="nemoris-parent-watchdog", daemon=True).start()


if __name__ == "__main__":
    os.chdir(app_dir())
    start_parent_watchdog()

    # A frozen console sidecar keeps real stdout/stderr pipes (Tauri reads
    # them), but guard against a windowed build where they would be None and
    # crash uvicorn's log formatter.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")

    if sys.stderr is None:
        sys.stderr = sys.stdout

    from app.services.tls import configure_https_ca_bundle

    configure_https_ca_bundle()

    from app.main import app

    port = int(os.environ.get("QUIZ_APP_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
