#!/usr/bin/env python3
"""Sign this Pi in to AnkiWeb and download her collection (run on the Pi).

The Pi becomes one more Anki device, like her MacBook and iMac: it keeps its
own copy in data/synced/ and syncs changes both ways with AnkiWeb.

  .venv/bin/python scripts/sync_setup.py            # sign in + first download
  .venv/bin/python scripts/sync_setup.py --logout   # forget the saved sign-in

Stop the app first (the collection can only be open once). The password is
typed here, on the Pi, and is not stored: only AnkiWeb's sync key is kept, in
data/synced/sync.json (readable by this user only). Changing the AnkiWeb
password revokes it.

This device never uploads a whole collection to AnkiWeb. If AnkiWeb is empty,
sync from Anki desktop first.
"""

from __future__ import annotations

import argparse
import getpass
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from anki.collection import Collection  # noqa: E402
from anki.errors import DBError, SyncError  # noqa: E402

import service  # noqa: E402
from api import sync_store  # noqa: E402
from safety import synced_dir  # noqa: E402


def ask(prompt: str, default: bool) -> bool:
    suffix = " [Y/n] " if default else " [y/N] "
    answer = input(prompt + suffix).strip().lower()
    return default if not answer else answer in ("y", "yes")


def mb(n: int) -> str:
    return f"{n / 1_048_576:.1f} MB"


def download(col: Collection, state: sync_store.SyncState, media_usn: int, backups: Path) -> None:
    errors: list[BaseException] = []

    def work() -> None:
        try:
            service.sync.full_download(col, state.creds, media_usn, backups)
        except BaseException as err:  # noqa: BLE001 - re-raised below
            errors.append(err)

    t = threading.Thread(target=work)
    t.start()
    while t.is_alive():
        progress = service.sync.full_sync_progress(col)
        if progress and progress[1]:
            done, total = progress
            print(f"\r  Downloading… {mb(done)} of {mb(total)} ({done * 100 // total}%)   ", end="", flush=True)
        time.sleep(0.3)
    print()
    if errors:
        raise errors[0]


def wait_for_media(col: Collection) -> None:
    print("  Syncing media (images and audio)… Ctrl+C to leave it for later.")
    try:
        while True:
            state = service.sync.media_state(col)
            if state.error:
                print(f"\n  Media sync stopped: {state.error}")
                return
            print(f"\r  {state.summary or 'Checking…'}          ", end="", flush=True)
            if not state.active:
                break
            time.sleep(0.5)
        print("\n  Media is up to date.")
    except KeyboardInterrupt:
        print("\n  OK. Media will finish syncing in the background next time the app syncs.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--logout", action="store_true", help="forget the saved AnkiWeb sign-in")
    ap.add_argument("--relogin", action="store_true", help="sign in again even if a key is saved")
    ap.add_argument("--endpoint", help="self-hosted sync server URL (default: AnkiWeb)")
    args = ap.parse_args()

    folder = synced_dir()
    if args.logout:
        sync_store.delete(folder)
        print("Signed out. The collection in data/synced/ was left as it is.")
        return

    folder.mkdir(parents=True, exist_ok=True)
    col_path = folder / "collection.anki2"
    try:
        col = Collection(str(col_path))
    except DBError:
        sys.exit(
            "The collection is open in the running app. Stop it first "
            "(Ctrl+C in dev.sh, or `sudo systemctl stop rounds`) and try again."
        )

    try:
        state = sync_store.load(folder)
        if state is None or args.relogin:
            print("Sign in to AnkiWeb (the password is sent to AnkiWeb once and not stored).")
            username = input("  AnkiWeb email: ").strip()
            password = getpass.getpass("  Password: ")
            try:
                creds = service.sync.login(col, username, password, args.endpoint)
            except SyncError as err:
                sys.exit(f"Sign-in failed: {err}")
            state = sync_store.SyncState(creds=creds)
            sync_store.save(folder, state)
            print("  Signed in.\n")

        backups = folder / "backups"
        print("Checking AnkiWeb…")
        result = service.sync.sync(col, state.creds, backups)
        state.host_number = result.host_number
        if result.new_endpoint:
            state.creds.endpoint = result.new_endpoint
        if result.server_message:
            print(f"  Message from AnkiWeb: {result.server_message}")

        if result.required == "server_empty":
            sync_store.save(folder, state)
            sys.exit(
                "AnkiWeb has no collection for this account yet. Open Anki on the Mac and "
                "sync there first; this device never uploads a whole collection."
            )

        if result.required in ("full_download", "full_sync"):
            cards = col.card_count()
            if result.required == "full_sync":
                print(
                    "  AnkiWeb and this Pi's copy have changes that can't be merged.\n"
                    "  The safe fix is to replace this Pi's copy with AnkiWeb's. AnkiWeb and her\n"
                    f"  other devices are not changed. ({cards:,} cards here will be replaced; a backup is kept.)"
                )
                ok = ask("  Download AnkiWeb's collection to this Pi?", default=False)
            elif cards:
                ok = ask(f"  Replace the {cards:,} cards on this Pi with AnkiWeb's collection? A backup is kept.", default=False)
            else:
                ok = ask("  Download the collection from AnkiWeb to this Pi?", default=True)
            if not ok:
                sync_store.save(folder, state)
                sys.exit("Nothing changed.")
            download(col, state, result.server_media_usn, backups)
            print(f"  Downloaded {col.card_count():,} cards.")

        state.last_synced_at = time.time()
        sync_store.save(folder, state)
        print("Collection is in sync.")
        wait_for_media(col)
    finally:
        col.close()

    print("\nRun the app on the synced collection:")
    print("  ./scripts/install_pi.sh          # as a service, at boot (restarts it if running)")
    print("  ./scripts/dev.sh --synced        # or just for now, in this terminal")


if __name__ == "__main__":
    main()
