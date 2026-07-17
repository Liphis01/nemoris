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
WINDOWS_RESIZE_HIT_CODES = {
    "w": 10, "e": 11, "n": 12, "nw": 13,
    "ne": 14, "s": 15, "sw": 16, "se": 17,
}


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
        # Native gestures (caption drag-restore, Aero Snap) change the state
        # without going through toggle_maximize, so ask the real window and
        # keep the flag as a fallback for the pre-window gap.
        real = self._query_real_maximized()

        if real is not None:
            self._maximized = real

        return self._maximized

    def _query_real_maximized(self):
        if self._window is None:
            return None

        try:
            from webview.platforms.winforms import BrowserView, WinForms

            form = BrowserView.instances.get(self._window.uid)

            if form:
                return (
                    form.WindowState == WinForms.FormWindowState.Maximized
                )
        except Exception:
            pass

        try:
            from webview.platforms.gtk import BrowserView

            view = BrowserView.instances.get(self._window.uid)

            if view:
                return bool(view.window.is_maximized())
        except Exception:
            pass

        return None

    def minimize(self):
        if self._window is None:
            return

        self._window.minimize()

    def toggle_maximize(self):
        if self._window is None:
            return self._maximized

        if self.is_maximized():
            if not self._gtk_unmaximize():
                self._window.restore()

            self._maximized = False
        else:
            self._window.maximize()
            self._maximized = True

        return self._maximized

    def close(self):
        if self._window is None:
            return

        self._window.destroy()

    def start_drag(self):
        self._start_system_loop(resize=False)

    def start_resize(self, edge="se"):
        self._start_system_loop(resize=True, edge=edge)

    def _start_system_loop(self, resize, edge="se"):
        # Called from a mousedown in the page while the button is still held:
        # the OS takes over the move/size loop from the current pointer state.
        # On Windows this is only a fallback — the native caption regions
        # (app-region: drag) and WS_THICKFRAME borders handle it at OS level.
        if self._window is None:
            return

        # GTK only: dragging a maximized window restores it first, like a
        # native caption would. On Windows the native caption handles this
        # itself, and the state flip breaks the synthetic fallback loop.
        if not resize and self._maximized and sys.platform != "win32":
            self.toggle_maximize()

        if resize:
            hit_code = WINDOWS_RESIZE_HIT_CODES.get(edge, 17)
        else:
            hit_code = HTCAPTION

        if not self._winforms_nc_hit(hit_code):
            self._gtk_begin_drag(resize, edge)

    def _winforms_nc_hit(self, hit_code):
        try:
            import ctypes

            from webview.platforms.winforms import BrowserView, WinForms
        except Exception:
            return False

        form = BrowserView.instances.get(self._window.uid)

        if not form:
            return False

        user32 = ctypes.windll.user32
        handle = ctypes.c_void_p(form.Handle.ToInt64())

        def begin():
            # Both calls must run on the UI thread: the WebView2 control owns
            # the mouse capture there (ReleaseCapture is per-thread), and the
            # modal move/size loop runs on the thread that sends the message.
            user32.ReleaseCapture()
            user32.SendMessageW(handle, WM_NCLBUTTONDOWN, hit_code, 0)

        # BeginInvoke, not Invoke: the move loop blocks until mouse-up and
        # this is called from an HTTP worker thread.
        form.BeginInvoke(WinForms.MethodInvoker(begin))
        return True

    def _gtk_begin_drag(self, resize, edge="se"):
        try:
            from gi.repository import Gdk, Gtk
            from webview.platforms.gtk import BrowserView, glib
        except Exception:
            return False

        view = BrowserView.instances.get(self._window.uid)

        if not view:
            return False

        gdk_edges = {
            "n": Gdk.WindowEdge.NORTH,
            "s": Gdk.WindowEdge.SOUTH,
            "e": Gdk.WindowEdge.EAST,
            "w": Gdk.WindowEdge.WEST,
            "ne": Gdk.WindowEdge.NORTH_EAST,
            "nw": Gdk.WindowEdge.NORTH_WEST,
            "se": Gdk.WindowEdge.SOUTH_EAST,
            "sw": Gdk.WindowEdge.SOUTH_WEST,
        }

        def begin():
            win = view.window
            seat = win.get_display().get_default_seat()
            _screen, x, y = seat.get_pointer().get_position()
            timestamp = Gtk.get_current_event_time()

            if resize:
                win.begin_resize_drag(
                    gdk_edges.get(edge, Gdk.WindowEdge.SOUTH_EAST),
                    1, x, y, timestamp,
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
        self._apply_windows_native_frame()

    def _apply_windows_native_frame(self):
        # WS_THICKFRAME restores the native resize borders on the frameless
        # window (grab any edge/corner, snap-compatible); the WM_NCCALCSIZE
        # subclass removes the frame insets so content stays full-bleed.
        try:
            import ctypes
            from ctypes import wintypes

            from webview.platforms.winforms import BrowserView, WinForms
        except Exception:
            return

        form = BrowserView.instances.get(self._window.uid)

        if not form:
            return

        user32 = ctypes.windll.user32
        comctl32 = ctypes.windll.comctl32

        GWL_STYLE = -16
        WS_THICKFRAME = 0x00040000
        WM_NCCALCSIZE = 0x0083
        # NOSIZE | NOMOVE | NOZORDER | FRAMECHANGED
        SWP_FLAGS = 0x0001 | 0x0002 | 0x0004 | 0x0020

        user32.GetWindowLongPtrW.restype = ctypes.c_longlong
        user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.SetWindowLongPtrW.restype = ctypes.c_longlong
        user32.SetWindowLongPtrW.argtypes = [
            wintypes.HWND, ctypes.c_int, ctypes.c_longlong,
        ]
        comctl32.DefSubclassProc.restype = ctypes.c_longlong
        comctl32.DefSubclassProc.argtypes = [
            wintypes.HWND, ctypes.c_uint, ctypes.c_ulonglong,
            ctypes.c_longlong,
        ]

        SUBCLASSPROC = ctypes.WINFUNCTYPE(
            ctypes.c_longlong,
            wintypes.HWND, ctypes.c_uint,
            ctypes.c_ulonglong, ctypes.c_longlong,
            ctypes.c_ulonglong, ctypes.c_ulonglong,
        )

        def subclass_proc(hwnd, msg, wparam, lparam, _subclass_id, _ref):
            if msg == WM_NCCALCSIZE and wparam:
                return 0

            return comctl32.DefSubclassProc(hwnd, msg, wparam, lparam)

        # The callback must outlive the window or the process crashes when
        # Windows calls a garbage-collected function pointer.
        self._subclass_proc = SUBCLASSPROC(subclass_proc)

        def apply():
            # BeginInvoke swallows exceptions; print them or failures here
            # are invisible in nemoris.log.
            try:
                handle = wintypes.HWND(form.Handle.ToInt64())
                style = user32.GetWindowLongPtrW(handle, GWL_STYLE)
                user32.SetWindowLongPtrW(
                    handle, GWL_STYLE, style | WS_THICKFRAME
                )
                comctl32.SetWindowSubclass(handle, self._subclass_proc, 1, 0)
                user32.SetWindowPos(handle, None, 0, 0, 0, 0, SWP_FLAGS)
                print("Native frame applied (thickframe + subclass).", flush=True)
            except Exception as error:
                print(f"Native frame setup failed ({error}).", flush=True)

        form.BeginInvoke(WinForms.MethodInvoker(apply))

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
            # BeginInvoke/Invoke swallow exceptions; print them or failures
            # here are invisible in nemoris.log.
            try:
                form.MaximizedBounds = (
                    WinForms.Screen.FromControl(form).WorkingArea
                )

                # Re-apply the maximized state so the clamp takes effect on
                # the already-maximized startup window.
                if form.WindowState == WinForms.FormWindowState.Maximized:
                    form.WindowState = WinForms.FormWindowState.Normal
                    form.WindowState = WinForms.FormWindowState.Maximized
            except Exception as error:
                print(f"Maximized bounds clamp failed ({error}).", flush=True)

        form.Invoke(WinForms.MethodInvoker(clamp))


def enable_native_caption_regions():
    # WebView2's official custom-titlebar support: elements with the CSS
    # app-region: drag become a real caption (OS drag with Aero Snap,
    # double-click max/restore, right-click system menu). It must be on
    # before navigation, so wrap pywebview's settings hook. The import
    # fails outside Windows.
    try:
        from webview.platforms import edgechromium
    except Exception:
        return

    original = edgechromium.EdgeChrome.on_webview_ready

    def on_webview_ready(self, sender, args):
        original(self, sender, args)

        try:
            if args.IsSuccess:
                settings = sender.CoreWebView2.Settings
                settings.IsNonClientRegionSupportEnabled = True
        except Exception as error:
            # Old fixed-version runtime: the frontend's HTTP drag fallback
            # still applies.
            print(f"Native caption regions unavailable ({error}).")

    edgechromium.EdgeChrome.on_webview_ready = on_webview_ready


def register_shell_routes(application, bridge):
    # Window controls for the desktop title bar, served over HTTP so they
    # work whenever the page itself does — no injected JS bridge involved.
    @application.get("/shell/window/state")
    def shell_window_state():
        return {
            "maximized": bridge.is_maximized(),
            "platform": "windows" if sys.platform == "win32" else "gtk",
        }

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
    def shell_window_start_resize(edge: str = "se"):
        bridge.start_resize(edge)
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

    enable_native_caption_regions()

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
