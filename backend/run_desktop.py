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
MIN_WINDOW_SIZE = (1024, 700)
BUNDLED_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
ICON_FILE = BUNDLED_DIR / "assets" / "nemoris.png"


class WindowBridge:
    # Exposed to the page as window.pywebview.api: the window is frameless,
    # so the frontend's custom title bar drives the chrome actions. Only
    # underscore-prefixed attributes stay out of the generated JS API —
    # pywebview walks public ones recursively.
    def __init__(self):
        self._window = None
        self._maximized = False

    def minimize(self):
        self._window.minimize()

    def toggle_maximize(self):
        if self._maximized:
            if not self._gtk_unmaximize():
                self._window.restore()
        else:
            self._window.maximize()

        self._maximized = not self._maximized
        return self._maximized

    def _gtk_unmaximize(self):
        # pywebview's GTK restore() only deiconifies and never leaves the
        # maximized state; reach the Gtk window directly. The import fails
        # wherever GTK isn't the backend, so Windows uses plain restore().
        try:
            from webview.platforms.gtk import BrowserView, glib
        except Exception:
            return False

        view = BrowserView.instances.get(self._window.uid)

        if not view:
            return False

        glib.idle_add(view.window.unmaximize)
        return True

    def resize_to(self, width, height):
        # Frameless windows lose the OS resize borders; the frontend's
        # corner grip calls this instead.
        self._window.resize(
            max(int(width), MIN_WINDOW_SIZE[0]),
            max(int(height), MIN_WINDOW_SIZE[1]),
        )

    def close(self):
        self._window.destroy()


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


def redirect_windowed_io():
    # PyInstaller --windowed builds have no console, so sys.stdout/stderr are
    # None and anything touching them crashes (uvicorn's log formatter calls
    # sys.stdout.isatty() during startup). Route output to a log file in the
    # app data dir so installed builds also leave a debugging trail.
    if sys.stdout is not None and sys.stderr is not None:
        return

    from app.config import APP_DATA_DIR

    try:
        APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
        stream = open(
            APP_DATA_DIR / "nemoris.log", "a", buffering=1, encoding="utf-8"
        )
    except OSError:
        stream = open(os.devnull, "w", encoding="utf-8")

    if sys.stdout is None:
        sys.stdout = stream

    if sys.stderr is None:
        sys.stderr = stream


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

    bridge = WindowBridge()

    # frameless: the frontend renders its own title bar (DesktopTitleBar)
    # with a pywebview drag region and the WindowBridge controls. The query
    # flag makes the title bar render deterministically — the pywebview JS
    # bridge injects at a backend-dependent moment (after NavigationCompleted
    # on WebView2), too late to be the render signal.
    bridge._window = webview.create_window(
        WINDOW_TITLE,
        f"{url}/?shell=desktop",
        width=1280,
        height=850,
        min_size=MIN_WINDOW_SIZE,
        frameless=True,
        easy_drag=False,
        js_api=bridge,
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
        # NEMORIS_DEBUG=1 opens the engine devtools in the installed app —
        # the only way to inspect the page in a --windowed build.
        debug=os.environ.get("NEMORIS_DEBUG") == "1",
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

    redirect_windowed_io()

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
