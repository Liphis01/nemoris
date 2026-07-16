from pathlib import Path
import os
import socket
import sys
import threading
import time
import webbrowser

import uvicorn


DEFAULT_PORT = 8000
PORT_SCAN_ATTEMPTS = 10
SERVER_STARTUP_TIMEOUT_SECONDS = 30
WINDOW_TITLE = "Nemoris"
BUNDLED_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
ICON_FILE = BUNDLED_DIR / "assets" / "nemoris.png"


def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent

    return Path(__file__).resolve().parent


def port_is_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False

    return True


def pick_port():
    env_port = os.environ.get("QUIZ_APP_PORT")

    if env_port:
        return int(env_port)

    # Prefer a stable port so the app keeps the same origin (and localStorage)
    # across runs, but step aside when something else already owns it, e.g. a
    # dev server on 8000.
    for offset in range(PORT_SCAN_ATTEMPTS + 1):
        candidate = DEFAULT_PORT + offset

        if port_is_free(candidate):
            return candidate

    raise RuntimeError(
        f"No free port between {DEFAULT_PORT} "
        f"and {DEFAULT_PORT + PORT_SCAN_ATTEMPTS}."
    )


def start_server(application, port):
    config = uvicorn.Config(application, host="127.0.0.1", port=port)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + SERVER_STARTUP_TIMEOUT_SECONDS

    while not server.started:
        if not thread.is_alive():
            raise RuntimeError("Server exited before finishing startup.")

        if time.monotonic() > deadline:
            raise RuntimeError("Server did not start in time.")

        time.sleep(0.05)

    return server, thread


def apply_wsl_rendering_fix():
    # Under WSLg, WebKitGTK's DMA-BUF GPU transport is broken (Vulkan device
    # unavailable) and halves the frame rate (measured 26 fps vs 54 fps).
    # Real Linux desktops keep full acceleration.
    try:
        is_wsl = "microsoft" in Path("/proc/version").read_text().lower()
    except OSError:
        is_wsl = False

    if is_wsl:
        os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")


def open_native_window(url):
    apply_wsl_rendering_fix()

    import webview

    # The database export downloads a zip through an anchor click; without
    # this flag pywebview drops downloads silently.
    webview.settings["ALLOW_DOWNLOADS"] = True

    webview.create_window(
        WINDOW_TITLE,
        url,
        width=1280,
        height=850,
        min_size=(1024, 700),
    )

    from app.config import APP_DATA_DIR

    # private_mode=False keeps localStorage across runs; storage_path keeps
    # the engine profile with the rest of the app data (installed builds
    # cannot write next to the executable). The icon only applies to GTK/QT;
    # the Windows build gets its icon from the exe.
    webview.start(
        private_mode=False,
        storage_path=str(APP_DATA_DIR / "webview-data"),
        icon=str(ICON_FILE) if ICON_FILE.exists() else None,
    )


def serve_in_browser(url, thread):
    # Previous behavior, kept for machines without a webview runtime
    # (missing WebView2 or webkit2gtk): a tab in the default browser.
    webbrowser.open(url)

    try:
        thread.join()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    os.chdir(app_dir())

    from app.main import app

    port = pick_port()
    server, thread = start_server(app, port)
    url = f"http://127.0.0.1:{port}"

    try:
        try:
            open_native_window(url)
        except Exception as error:
            print(f"Native window unavailable ({error}); using the browser.")
            serve_in_browser(url, thread)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
