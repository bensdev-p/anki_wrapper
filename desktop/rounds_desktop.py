"""Rounds desktop app: the study server, on this computer, in a native window.

Double-clicking Rounds.app / Rounds.exe runs this. It

* keeps the collection in the app's own folder (never Anki desktop's):
  ~/Library/Application Support/Rounds, %APPDATA%\\Rounds, ~/.local/share/rounds;
* runs the same FastAPI server as the Pi, bound to this computer only;
* shows it in a native window (Safari's engine on macOS, Edge WebView2 on
  Windows, Qt WebEngine on Linux);
* on close, lets the server take a backup and close the collection cleanly.

  python desktop/rounds_desktop.py             # from a checkout (development)
  python desktop/rounds_desktop.py --browser   # use the default browser instead of a window
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import logging.handlers
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import IO, Any

APP = "Rounds"
DEFAULT_PORT = 8765
FROZEN = getattr(sys, "frozen", False)
# Bundled files (PyInstaller) or the repo checkout.
RESOURCES = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))

log = logging.getLogger("rounds")


def data_dir() -> Path:
    """The app's own folder. Deliberately not Anki desktop's (…/Anki2)."""
    if override := os.environ.get("ROUNDS_DATA_DIR"):
        return Path(override).expanduser().resolve()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP
    if os.name == "nt":
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / APP
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "rounds"


# Settings kept next to the collection (not in it: they're per computer).
##########################################################################


def load_settings(folder: Path) -> dict[str, Any]:
    try:
        return json.loads((folder / "settings.json").read_text())
    except (OSError, ValueError):
        return {}


def save_settings(folder: Path, settings: dict[str, Any]) -> None:
    tmp = folder / "settings.json.tmp"
    tmp.write_text(json.dumps(settings, indent=2))
    os.replace(tmp, folder / "settings.json")


# One running copy per data folder (the collection can only be open once).
##########################################################################


def acquire_lock(path: Path) -> IO[str] | None:
    f = open(path, "a+")  # noqa: SIM115 - held open for the app's lifetime
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def port_free(port: int) -> bool:
    with socket.socket() as s:
        # Like the server itself: a port still in TIME_WAIT from the last run is reusable.
        if os.name != "nt":
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def pick_port(settings: dict[str, Any]) -> int:
    """Keep the same port between runs: the window's saved settings (theme etc.) are per address."""
    preferred = int(settings.get("port") or DEFAULT_PORT)
    if port_free(preferred):
        return preferred
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# The server, on its own thread and event loop.
##########################################################################


class Server:
    def __init__(self, port: int) -> None:
        import uvicorn

        from api.main import app

        self.port = port
        self.url = f"http://127.0.0.1:{port}/"
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, lifespan="on", workers=1)
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._run, name="rounds-server", daemon=True)
        self.error: BaseException | None = None

    def _run(self) -> None:
        try:
            asyncio.run(self._server.serve())
        except BaseException as err:  # reported by start()
            self.error = err
            log.exception("server stopped with an error")

    def start(self, timeout: float = 120) -> None:
        """Start and wait until it's answering (opening a big collection takes a moment)."""
        self._thread.start()
        deadline = time.monotonic() + timeout
        while not self._server.started:
            if not self._thread.is_alive() or time.monotonic() > deadline:
                raise RuntimeError(f"The study server didn’t start: {self.error or 'timed out'}")
            time.sleep(0.05)

    def stop(self) -> None:
        """Stop serving; the server's shutdown takes a backup and closes the collection."""
        self._server.should_exit = True
        self._thread.join(timeout=180)


# The window
##########################################################################


class JsApi:
    """Called from the UI as window.pywebview.api.<name>(…). Keep it small."""

    def __init__(self, folder: Path) -> None:
        self._folder = folder

    def open_external(self, url: str) -> None:
        if isinstance(url, str) and url.startswith(("https://", "http://")):
            webbrowser.open(url)

    def open_folder(self, which: str) -> None:
        """Show the data, backups or logs folder in Finder / Explorer / the file manager."""
        sub = {"data": "", "backups": "synced/backups", "logs": "logs"}.get(which)
        if sub is None:
            return
        path = self._folder / sub
        path.mkdir(parents=True, exist_ok=True)
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        elif os.name == "nt":
            os.startfile(str(path))  # type: ignore[attr-defined]  # noqa: S606
        else:
            subprocess.Popen(["xdg-open", str(path)])


ERROR_PAGE = """<!doctype html><meta charset=utf-8><title>{app}</title>
<body style="font:15px -apple-system,system-ui,sans-serif;padding:40px;max-width:560px;color:#222">
<h2>{app} couldn’t start</h2><p>{message}</p>
<p style="color:#666">Details are in the log file:<br><code>{log}</code></p></body>"""


def show_window(url: str | None, storage: Path, folder: Path, error_html: str | None = None) -> None:
    import webview

    webview.create_window(
        APP,
        url=url,
        html=error_html,
        js_api=JsApi(folder),
        width=1240,
        height=860,
        min_size=(420, 560),
        text_select=True,
    )
    # A persistent profile keeps the UI's settings (theme, etc.) between runs.
    # Linux builds bundle Qt WebEngine; skip pywebview's GTK probe there.
    gui = "qt" if sys.platform.startswith("linux") else None
    webview.start(gui=gui, private_mode=False, storage_path=str(storage))


def handle_termination() -> None:
    """Log-out / shutdown sends SIGTERM: close the window so the normal shutdown runs."""

    def on_term(signum: int, frame: object) -> None:
        log.info("received signal %s; shutting down", signum)
        try:
            import webview

            if webview.windows:
                for w in list(webview.windows):
                    w.destroy()
                return
        except Exception:
            log.exception("couldn't close the window")
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, on_term)


def run_in_browser(url: str) -> None:
    webbrowser.open(url)
    print(f"{APP} is running at {url}. Press Ctrl+C to quit.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass


def setup_logging(folder: Path) -> Path:
    logs = folder / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    path = logs / "rounds.log"
    handler = logging.handlers.RotatingFileHandler(path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    if FROZEN:
        # A windowed app has no console (on Windows, stdout is None): send prints to the log.
        stream = open(logs / "output.log", "a", buffering=1, encoding="utf-8")  # noqa: SIM115
        sys.stdout = sys.stderr = stream
    return path


def configure_environment(folder: Path) -> None:
    """Tell the backend it's the desktop app, where its data lives, and where the UI is."""
    os.environ["ROUNDS_DESKTOP"] = "1"
    os.environ["ROUNDS_DATA_DIR"] = str(folder)
    os.environ.setdefault("ROUNDS_FRONTEND_DIST", str(RESOURCES / "frontend" / "dist"))
    if not FROZEN:
        sys.path.insert(0, str(RESOURCES / "backend"))


def main() -> None:
    ap = argparse.ArgumentParser(description=APP)
    ap.add_argument("--browser", action="store_true", help="open in the default browser instead of a window")
    args = ap.parse_args()

    folder = data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    log_path = setup_logging(folder)
    configure_environment(folder)
    settings = load_settings(folder)
    storage = folder / "webview"

    lock = acquire_lock(folder / "rounds.lock")
    if lock is None:
        # Already running: show another window onto the same server.
        current = load_settings(folder)
        port = current.get("running_port") or current.get("port", DEFAULT_PORT)
        log.info("already running; opening another window on port %s", port)
        url = f"http://127.0.0.1:{port}/"
        run_in_browser(url) if args.browser else show_window(url, storage, folder)
        return

    port = pick_port(settings)
    settings.setdefault("port", port)  # a one-off fallback port doesn't replace the usual one
    settings["running_port"] = port
    save_settings(folder, settings)
    log.info("starting %s on port %s with data in %s", APP, port, folder)

    try:
        server = Server(port)
        server.start()
    except Exception as err:
        log.exception("startup failed")
        page = ERROR_PAGE.format(app=APP, message=str(err), log=log_path)
        if args.browser:
            print(f"{APP} couldn’t start: {err}", file=sys.__stderr__)
        else:
            show_window(None, storage, folder, error_html=page)
        return

    handle_termination()
    try:
        if args.browser:
            run_in_browser(server.url)
        else:
            try:
                show_window(server.url, storage, folder)
            except Exception:
                # No usable web view on this system (rare; e.g. Linux without Qt): fall back.
                log.exception("couldn't open a window; using the browser")
                run_in_browser(server.url)
    finally:
        log.info("closing: backing up and closing the collection")
        server.stop()
        lock.close()


if __name__ == "__main__":
    main()
