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

# Win32 non-client hit codes: posting WM_NCLBUTTONDOWN with these hands the
# mouse to the OS move/size loop — native drag, including Aero Snap.
WM_NCLBUTTONDOWN = 0x00A1
HTCAPTION = 2
HTBOTTOMRIGHT = 17


class WindowBridge:
    # Drives the frameless window for the frontend's custom title bar. The
    # frontend reaches these methods over plain HTTP (see
    # register_shell_routes): the pywebview JS bridge proved unreliable in
    # frozen Windows builds, while HTTP is the same channel the whole app
    # already depends on.
    def __init__(self, maximized=False):
        self._window = None
        self._maximized = maximized

    def is_maximized(self):
        return self._maximized

    def minimize(self):
        if self._window is None:
            return

        self._window.minimize()

    def toggle_maximize(self):
        if self._window is None:
            return self._maximized

        if self._maximized:
            if not self._gtk_unmaximize():
                self._window.restore()
        else:
            self._window.maximize()

        self._maximized = not self._maximized
        return self._maximized

    def close(self):
        if self._window is None:
            return

        self._window.destroy()

    def start_drag(self):
        self._start_system_loop(resize=False)

    def start_resize(self):
        self._start_system_loop(resize=True)

    def _start_system_loop(self, resize):
        # Called from a mousedown in the page while the button is still held:
        # the OS takes over the move/size loop from the current pointer state.
        if self._window is None:
            return

        if not self._winforms_nc_hit(HTBOTTOMRIGHT if resize else HTCAPTION):
            self._gtk_begin_drag(resize)

    def _winforms_nc_hit(self, hit_code):
        try:
            import ctypes

            from webview.platforms.winforms import BrowserView
        except Exception:
            return False

        form = BrowserView.instances.get(self._window.uid)

        if not form:
            return False

        user32 = ctypes.windll.user32
        user32.ReleaseCapture()
        user32.PostMessageW(form.Handle.ToInt64(), WM_NCLBUTTONDOWN, hit_code, 0)
        return True

    def _gtk_begin_drag(self, resize):
        try:
            from gi.repository import Gdk, Gtk
            from webview.platforms.gtk import BrowserView, glib
        except Exception:
            return False

        view = BrowserView.instances.get(self._window.uid)

        if not view:
            return False

        def begin():
            win = view.window
            seat = win.get_display().get_default_seat()
            _screen, x, y = seat.get_pointer().get_position()
            timestamp = Gtk.get_current_event_time()

            if resize:
                win.begin_resize_drag(
                    Gdk.WindowEdge.SOUTH_EAST, 1, x, y, timestamp
                )
            else:
                win.begin_move_drag(1, x, y, timestamp)

        glib.idle_add(begin)
        return True

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

    def _on_shown(self, *args):
        self._apply_windows_maximized_bounds()

    def _apply_windows_maximized_bounds(self):
        # A borderless WinForms window maximizes over the taskbar (Windows
        # treats it as fullscreen); clamp its maximize bounds to the work
        # area. The import fails outside the winforms backend.
        try:
            from webview.platforms.winforms import BrowserView, WinForms
        except Exception:
            return

        form = BrowserView.instances.get(self._window.uid)

        if not form:
            return

        def clamp():
            form.MaximizedBounds = WinForms.Screen.FromControl(form).WorkingArea

            # Re-apply the maximized state so the clamp takes effect on the
            # already-maximized startup window.
            if form.WindowState == WinForms.FormWindowState.Maximized:
                form.WindowState = WinForms.FormWindowState.Normal
                form.WindowState = WinForms.FormWindowState.Maximized

        form.Invoke(WinForms.MethodInvoker(clamp))


def register_shell_routes(application, bridge):
    # Window controls for the desktop title bar, served over HTTP so they
    # work whenever the page itself does — no injected JS bridge involved.
    @application.get("/shell/window/state")
    def shell_window_state():
        return {"maximized": bridge.is_maximized()}

    @application.post("/shell/window/minimize")
    def shell_window_minimize():
        bridge.minimize()
        return {"ok": True}

    @application.post("/shell/window/toggle-maximize")
    def shell_window_toggle_maximize():
        return {"maximized": bridge.toggle_maximize()}

    @application.post("/shell/window/start-drag")
    def shell_window_start_drag():
        bridge.start_drag()
        return {"ok": True}

    @application.post("/shell/window/start-resize")
    def shell_window_start_resize():
        bridge.start_resize()
        return {"ok": True}

    @application.post("/shell/window/close")
    def shell_window_close():
        bridge.close()
        return {"ok": True}

    # The SPA catch-all (GET /{full_path:path}) is registered during app
    # creation, before these routes, and would swallow the GET state route.
    # Starlette matches in order, so move the shell routes to the front.
    shell_routes = [
        route
        for route in application.router.routes
        if getattr(route, "path", "").startswith("/shell/window/")
    ]

    for route in shell_routes:
        application.router.routes.remove(route)

    application.router.routes[:0] = shell_routes


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


def open_native_window(bridge, url):
    apply_wsl_rendering_fix()

    import webview

    # The database export downloads a zip through an anchor click; without
    # this flag pywebview drops downloads silently.
    webview.settings["ALLOW_DOWNLOADS"] = True

    # frameless: the frontend renders its own title bar (DesktopTitleBar).
    # The query flag makes the title bar render deterministically; all its
    # actions go through the /shell/window HTTP routes.
    bridge._window = webview.create_window(
        WINDOW_TITLE,
        f"{url}/?shell=desktop",
        width=1280,
        height=850,
        min_size=MIN_WINDOW_SIZE,
        maximized=True,
        frameless=True,
        easy_drag=False,
    )

    bridge._window.events.shown += bridge._on_shown

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

    bridge = WindowBridge(maximized=True)
    register_shell_routes(app, bridge)

    port = pick_port()
    server, thread = start_server(app, port)
    url = f"http://127.0.0.1:{port}"

    try:
        try:
            open_native_window(bridge, url)
        except Exception as error:
            print(f"Native window unavailable ({error}); using the browser.")
            serve_in_browser(url, thread)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
