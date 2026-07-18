"""Gesture-level smoke test for the Nemoris desktop window on Windows.

Runs on the release runner against the already-launched exe: simulates REAL
mouse input with SendInput (press on the title bar, drag, grab edges) and
asserts the window actually moved/resized. This is the only way to prove
the native caption regions and WS_THICKFRAME borders work — HTTP calls
can't exercise OS hit-testing.

Usage: python scripts/windows_gesture_test.py <port>
Exits non-zero with a FAIL line naming the gesture that broke.
"""

import ctypes
import json
import sys
import time
import urllib.request
from ctypes import wintypes

user32 = ctypes.windll.user32

INPUT_MOUSE = 0
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
SM_CXSCREEN = 0
SM_CYSCREEN = 1


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("mi", MOUSEINPUT)]

    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _U)]


SCREEN_W = user32.GetSystemMetrics(SM_CXSCREEN)
SCREEN_H = user32.GetSystemMetrics(SM_CYSCREEN)


def send_mouse(flags, x=None, y=None):
    inp = INPUT()
    inp.type = INPUT_MOUSE

    if x is not None:
        inp.mi.dx = int(x * 65535 / (SCREEN_W - 1))
        inp.mi.dy = int(y * 65535 / (SCREEN_H - 1))
        flags |= MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE

    inp.mi.dwFlags = flags
    user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def drag_pointer(x1, y1, x2, y2, steps=20):
    send_mouse(0, x1, y1)
    time.sleep(0.2)
    send_mouse(MOUSEEVENTF_LEFTDOWN)
    # Hold before moving: the resize strips reach the OS loop over HTTP
    # (~100ms); moving immediately loses the first part of the gesture.
    time.sleep(0.4)

    for i in range(1, steps + 1):
        send_mouse(
            0,
            x1 + (x2 - x1) * i / steps,
            y1 + (y2 - y1) * i / steps,
        )
        time.sleep(0.03)

    time.sleep(0.2)
    send_mouse(MOUSEEVENTF_LEFTUP)
    time.sleep(0.8)


def window_rect(hwnd):
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return rect.left, rect.top, rect.right, rect.bottom


def shell(port, action, method="POST"):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/shell/window/{action}", method=method
    )

    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def main(port):
    failures = []

    # The server comes up well before WebView2 finishes rendering the page;
    # gesturing before the title bar and strips exist tests a blank window.
    for _ in range(60):
        if shell(port, "state", "GET").get("client_ready"):
            break

        time.sleep(1)
    else:
        print("FAIL client-ready: page never reported the title bar mounted")
        return 1

    time.sleep(1)

    # A restored (non-maximized) window is needed to move and resize it.
    if shell(port, "state", "GET")["maximized"]:
        shell(port, "toggle-maximize")
        time.sleep(1.5)

    hwnd = user32.FindWindowW(None, "Nemoris")

    if not hwnd:
        print("FAIL find-window: no window titled 'Nemoris'")
        return 1

    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)

    # The window rect and the page's pixels can disagree by a few pixels
    # per edge (frame insets); aim at the page, which the frontend reports
    # after every resize. Wait until the metrics reflect the restored size.
    metrics = None

    for _ in range(15):
        metrics = shell(port, "state", "GET").get("client_metrics")

        if metrics and metrics["inner_w"] * metrics.get("dpr", 1) < SCREEN_W - 50:
            break

        time.sleep(1)

    if not metrics:
        print("FAIL client-metrics: page never reported its geometry")
        return 1

    dpr = metrics.get("dpr") or 1
    rect = window_rect(hwnd)
    page_left = int(metrics["screen_x"] * dpr)
    page_top = int(metrics["screen_y"] * dpr)
    page_right = page_left + int(metrics["inner_w"] * dpr)
    page_bottom = page_top + int(metrics["inner_h"] * dpr)

    # Constant offsets: valid as the window moves/resizes during the test.
    off_l = page_left - rect[0]
    off_t = page_top - rect[1]
    off_r = rect[2] - page_right
    off_b = rect[3] - page_bottom
    print(
        f"GEOMETRY window={rect} page=({page_left},{page_top},"
        f"{page_right},{page_bottom}) offsets l={off_l} t={off_t} "
        f"r={off_r} b={off_b} dpr={dpr}"
    )

    def edges(r):
        return (r[0] + off_l, r[1] + off_t, r[2] - off_r, r[3] - off_b)

    def check(name, condition, detail):
        if condition:
            print(f"PASS {name} ({detail})")
        else:
            print(f"FAIL {name} ({detail})")
            failures.append(name)

    # 1. Drag the title bar: press left of center (away from the buttons),
    #    move, and the window must follow.
    rect = window_rect(hwnd)
    pl, pt, pr, pb = edges(rect)
    drag_pointer(pl + 150, pt + 18, pl + 150 + 140, pt + 18 + 90)
    new = window_rect(hwnd)
    check(
        "drag-titlebar",
        abs(new[0] - rect[0]) >= 80 and abs(new[1] - rect[1]) >= 50,
        f"moved by ({new[0] - rect[0]}, {new[1] - rect[1]})",
    )

    # 2. Right edge resize.
    rect = window_rect(hwnd)
    pl, pt, pr, pb = edges(rect)
    drag_pointer(pr - 3, (pt + pb) // 2, pr - 3 + 80, (pt + pb) // 2)
    new = window_rect(hwnd)
    check(
        "resize-right-edge",
        (new[2] - new[0]) - (rect[2] - rect[0]) >= 50,
        f"width {rect[2] - rect[0]} -> {new[2] - new[0]}",
    )

    # 3. Left edge resize (window must both move and grow).
    rect = window_rect(hwnd)
    pl, pt, pr, pb = edges(rect)
    drag_pointer(pl + 3, (pt + pb) // 2, pl + 3 - 80, (pt + pb) // 2)
    new = window_rect(hwnd)
    check(
        "resize-left-edge",
        (new[2] - new[0]) - (rect[2] - rect[0]) >= 50,
        f"width {rect[2] - rect[0]} -> {new[2] - new[0]}",
    )

    # 4. Bottom edge resize.
    rect = window_rect(hwnd)
    pl, pt, pr, pb = edges(rect)
    drag_pointer((pl + pr) // 2, pb - 3, (pl + pr) // 2, pb - 3 + 70)
    new = window_rect(hwnd)
    check(
        "resize-bottom-edge",
        (new[3] - new[1]) - (rect[3] - rect[1]) >= 40,
        f"height {rect[3] - rect[1]} -> {new[3] - new[1]}",
    )

    # 5. Corner resize (bottom-right, both dimensions at once).
    rect = window_rect(hwnd)
    pl, pt, pr, pb = edges(rect)
    drag_pointer(pr - 4, pb - 4, pr - 4 + 60, pb - 4 + 60)
    new = window_rect(hwnd)
    check(
        "resize-corner",
        (new[2] - new[0]) - (rect[2] - rect[0]) >= 30
        and (new[3] - new[1]) - (rect[3] - rect[1]) >= 30,
        f"size {rect[2] - rect[0]}x{rect[3] - rect[1]} -> "
        f"{new[2] - new[0]}x{new[3] - new[1]}",
    )

    if failures:
        print(f"GESTURES FAILED: {', '.join(failures)}")
        return 1

    print("ALL GESTURES PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
