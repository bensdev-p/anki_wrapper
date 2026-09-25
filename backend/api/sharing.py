"""Use Rounds from a phone or tablet on the same Wi-Fi (desktop app only).

The desktop window talks to the server on 127.0.0.1. When the user turns
sharing on, a second listener serves the same app on the home network
(0.0.0.0:<port>), in the same event loop, so there is still one collection
and one collection thread.

Devices on the network must pair once with a 6-digit code shown on the
computer. Pairing sets a long-lived cookie; the server keeps only a hash of
each device token. Changing the code signs every paired device out.

Card images load inside a sandboxed iframe, which can't send cookies, so
media is served to paired devices under an unguessable token in the URL
(`/api/m/<media_token>/<file>`) instead.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import secrets
import socket
import time
from collections.abc import Generator
from dataclasses import dataclass, field
from pathlib import Path

import uvicorn

log = logging.getLogger("rounds.sharing")

FILENAME = "sharing.json"
DEFAULT_PORT = 8766
COOKIE = "rounds_device"
COOKIE_MAX_AGE = 400 * 24 * 3600  # browsers cap cookies at ~400 days
MAX_FAILURES = 5
LOCKOUT_SECS = 60


class PairingLocked(Exception):
    pass


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


@dataclass
class SharingState:
    enabled: bool = False
    port: int = DEFAULT_PORT
    code: str = field(default_factory=_new_code)
    device_hashes: list[str] = field(default_factory=list)
    media_token: str = field(default_factory=lambda: secrets.token_urlsafe(24))


@dataclass
class SharingStatus:
    enabled: bool
    running: bool
    error: str | None
    port: int
    code: str
    urls: list[str]
    """Addresses to open on the phone (IP first; the .local name may also work)."""
    devices: int


class _QuietServer(uvicorn.Server):
    """A second uvicorn server inside the running app: leave signals to the main one."""

    @contextlib.contextmanager
    def capture_signals(self) -> Generator[None, None, None]:
        yield


class Sharing:
    def __init__(self, folder: Path, app: object) -> None:
        self.folder = folder
        self.app = app
        self.state = self._load()
        self.error: str | None = None
        self._server: _QuietServer | None = None
        self._task: asyncio.Task | None = None
        self._failures: list[float] = []
        self._locked_until = 0.0

    # Persistence (0600: it holds the code and device hashes)
    ######################################################################

    def _load(self) -> SharingState:
        try:
            raw = json.loads((self.folder / FILENAME).read_text())
            return SharingState(**{k: v for k, v in raw.items() if k in SharingState.__dataclass_fields__})
        except (OSError, ValueError, TypeError):
            return SharingState()

    def _save(self) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        path = self.folder / FILENAME
        tmp = path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(self.state.__dict__, f, indent=2)
        os.replace(tmp, path)

    # The network listener
    ######################################################################

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done() and bool(self._server and self._server.started)

    async def start(self) -> None:
        """Start listening on the home network, if sharing is on."""
        if not self.state.enabled or self._task is not None:
            return
        self.error = None
        config = uvicorn.Config(
            self.app, host="0.0.0.0", port=self.state.port, lifespan="off", log_config=None, access_log=False
        )
        self._server = _QuietServer(config)
        self._task = asyncio.create_task(self._server.serve())
        for _ in range(100):
            if self._server.started or self._task.done():
                break
            await asyncio.sleep(0.05)
        if not self._server.started:
            self.error = f"Couldn’t use port {self.state.port} on this network. Is another copy of Rounds running?"
            log.warning("sharing failed to start on port %s", self.state.port)
            await self.stop()

    async def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._task is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._task, timeout=10)
        self._server = None
        self._task = None

    async def set_enabled(self, enabled: bool) -> None:
        self.state.enabled = enabled
        self._save()
        if enabled:
            await self.start()
        else:
            self.error = None
            await self.stop()

    # Pairing
    ######################################################################

    def pair(self, code: str) -> str:
        """Check the code; on success return a new device token (for the cookie)."""
        now = time.monotonic()
        if now < self._locked_until:
            raise PairingLocked("Too many wrong codes. Wait a minute and try again.")
        if not secrets.compare_digest(code.strip(), self.state.code):
            self._failures = [t for t in self._failures if now - t < 600] + [now]
            if len(self._failures) >= MAX_FAILURES:
                self._locked_until = now + LOCKOUT_SECS
                self._failures = []
            raise PermissionError("That code doesn’t match the one on your computer.")
        self._failures = []
        token = secrets.token_urlsafe(32)
        self.state.device_hashes.append(_hash(token))
        self._save()
        return token

    def device_ok(self, token: str | None) -> bool:
        return bool(token) and _hash(token) in self.state.device_hashes  # type: ignore[arg-type]

    def media_ok(self, token: str) -> bool:
        return secrets.compare_digest(token, self.state.media_token)

    def new_code(self) -> None:
        """A fresh code signs out every paired device (and changes the media links)."""
        self.state.code = _new_code()
        self.state.device_hashes = []
        self.state.media_token = secrets.token_urlsafe(24)
        self._save()

    def status(self) -> SharingStatus:
        return SharingStatus(
            enabled=self.state.enabled,
            running=self.running,
            error=self.error,
            port=self.state.port,
            code=self.state.code,
            urls=[f"http://{host}:{self.state.port}/" for host in lan_hosts()],
            devices=len(self.state.device_hashes),
        )


def lan_hosts() -> list[str]:
    """This computer's address on the home network, then its Bonjour name if it has one."""
    hosts: list[str] = []
    with contextlib.suppress(OSError), socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect(("192.0.2.1", 9))  # no packet is sent; this picks the outgoing interface
        ip = s.getsockname()[0]
        if not ip.startswith("127."):
            hosts.append(ip)
    name = socket.gethostname()
    if name and name != "localhost":
        hosts.append(name if name.endswith(".local") else f"{name.split('.')[0]}.local")
    return hosts
