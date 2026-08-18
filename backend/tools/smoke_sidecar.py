"""Smoke-test the frozen backend sidecar used by Tauri desktop bundles."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def backend_is_ready(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


def terminate(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return

    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", help="Path to the PyInstaller sidecar executable")
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    executable = Path(args.executable).resolve()
    if not executable.is_file():
        raise SystemExit(f"Sidecar executable not found: {executable}")

    support_dir = executable.parent / "_internal"
    if not support_dir.is_dir():
        raise SystemExit(f"PyInstaller onedir support directory is missing: {support_dir}")

    port = pick_free_port()
    with tempfile.TemporaryDirectory(prefix="nemoris-sidecar-smoke-") as data_dir:
        env = os.environ.copy()
        env["QUIZ_APP_PORT"] = str(port)
        env["NEMORIS_PARENT_PID"] = "0"

        if sys.platform == "win32":
            env["APPDATA"] = data_dir
        else:
            env["XDG_DATA_HOME"] = data_dir

        started_at = time.monotonic()
        try:
            process = subprocess.Popen(
                [str(executable)],
                cwd=str(executable.parent),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.STDOUT,
            )
        except OSError as error:
            raise SystemExit(f"Could not start sidecar: {error}") from error

        try:
            deadline = started_at + args.timeout
            while time.monotonic() < deadline:
                exit_code = process.poll()
                if exit_code is not None:
                    raise SystemExit(
                        f"Backend exited before becoming ready (code {exit_code})."
                    )

                if backend_is_ready(port):
                    elapsed = time.monotonic() - started_at
                    print(f"Backend ready after {elapsed:.3f} s")
                    return 0

                time.sleep(0.2)

            raise SystemExit(
                f"Backend did not become ready within {args.timeout:.0f} seconds."
            )
        finally:
            terminate(process)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
