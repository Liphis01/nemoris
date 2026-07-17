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
    time.sleep(0.2)

    for i in range(1, steps + 1):
        send_mouse(
            0,
            x1 + (x2 - x1) * i / steps,
            y1 + (y2 - y1) * i / steps,
        )
        time.sleep(0.02)

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

    def check(name, condition, detail):
        if condition:
            print(f"PASS {name} ({detail})")
        else:
            print(f"FAIL {name} ({detail})")
            failures.append(name)

    # 1. Drag the title bar: press left of center (away from the buttons),
    #    move, and the window must follow.
    left, top, right, bottom = window_rect(hwnd)
    drag_pointer(left + 150, top + 18, left + 150 + 140, top + 18 + 90)
    new = window_rect(hwnd)
    check(
        "drag-titlebar",
        abs(new[0] - left) >= 80 and abs(new[1] - top) >= 50,
        f"moved by ({new[0] - left}, {new[1] - top})",
    )

    # 2. Right edge resize.
    left, top, right, bottom = window_rect(hwnd)
    drag_pointer(right - 2, (top + bottom) // 2, right - 2 + 80, (top + bottom) // 2)
    new = window_rect(hwnd)
    check(
        "resize-right-edge",
        (new[2] - new[0]) - (right - left) >= 50,
        f"width {right - left} -> {new[2] - new[0]}",
    )

    # 3. Left edge resize (window must both move and grow).
    left, top, right, bottom = window_rect(hwnd)
    drag_pointer(left + 2, (top + bottom) // 2, left + 2 - 80, (top + bottom) // 2)
    new = window_rect(hwnd)
    check(
        "resize-left-edge",
        (new[2] - new[0]) - (right - left) >= 50,
        f"width {right - left} -> {new[2] - new[0]}",
    )

    # 4. Bottom edge resize.
    left, top, right, bottom = window_rect(hwnd)
    drag_pointer((left + right) // 2, bottom - 2, (left + right) // 2, bottom - 2 + 70)
    new = window_rect(hwnd)
    check(
        "resize-bottom-edge",
        (new[3] - new[1]) - (bottom - top) >= 40,
        f"height {bottom - top} -> {new[3] - new[1]}",
    )

    # 5. Corner resize (bottom-right, both dimensions at once).
    left, top, right, bottom = window_rect(hwnd)
    drag_pointer(right - 3, bottom - 3, right - 3 + 60, bottom - 3 + 60)
    new = window_rect(hwnd)
    check(
        "resize-corner",
        (new[2] - new[0]) - (right - left) >= 30
        and (new[3] - new[1]) - (bottom - top) >= 30,
        f"size {right - left}x{bottom - top} -> "
        f"{new[2] - new[0]}x{new[3] - new[1]}",
    )

    if failures:
        print(f"GESTURES FAILED: {', '.join(failures)}")
        return 1

    print("ALL GESTURES PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
