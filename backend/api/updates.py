""""Is there a newer Rounds?" from GitHub Releases (desktop app only).

Checked at most every few hours; any failure (offline, private repo, rate
limit) just means no notice. Nothing about the user is sent.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import urllib.request
from dataclasses import dataclass

from version import REPO, __version__

CHECK_EVERY_SECS = 6 * 3600


@dataclass
class UpdateInfo:
    current: str
    latest: str | None
    available: bool
    url: str | None
    """Release page to download from."""


def _parse(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3])


class UpdateChecker:
    def __init__(self) -> None:
        self._checked_at = 0.0
        self._latest: tuple[str, str] | None = None

    async def info(self) -> UpdateInfo:
        if time.monotonic() - self._checked_at > CHECK_EVERY_SECS or not self._checked_at:
            self._checked_at = time.monotonic()
            self._latest = await asyncio.to_thread(self._fetch)
        latest = self._latest
        available = bool(latest) and _parse(latest[0]) > _parse(__version__)  # type: ignore[index]
        return UpdateInfo(
            current=__version__,
            latest=latest[0] if latest else None,
            available=available,
            url=latest[1] if latest else None,
        )

    def _fetch(self) -> tuple[str, str] | None:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/releases/latest",
            headers={"Accept": "application/vnd.github+json", "User-Agent": f"Rounds/{__version__}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=6) as res:  # noqa: S310 - fixed https URL
                data = json.load(res)
            return str(data["tag_name"]).lstrip("v"), str(data["html_url"])
        except Exception:
            return None
