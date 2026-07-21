"""Whole-collection sync engine (M2 slice 1 — the "Anki fallback").

Push = snapshot the whole collection (reuse create_backup) and upload it to the
account, accepted only if this device's base version matches the server's
(one side wins wholesale). Pull = download the account's collection and restore
it (reuse the exact restore+migrate+rebalance path from routers/backup.py).

Everything is path-parametrized and the one step coupled to the global engine
(dispose → restore → init_database → rebalance) is isolated behind an
injectable `finalize`, so two simulated devices can be driven against explicit
DB/static paths in a test without touching the live engine.
"""

import tempfile
from pathlib import Path

from ..config import BACKUP_DIR, DATABASE_FILE, STATIC_DIR
from ..migrations import MIGRATIONS
from .backups import create_backup, restore_backup
from .sync_client import SyncClientConflict
from .sync_state import (
    ensure_device_id,
    is_signed_in,
    load_sync_state,
    save_sync_state
)


def code_schema_version():
    return MIGRATIONS[-1].version


def _production_finalize(zip_path, database_file, static_dir):
    # The live-engine path: release the SQLite handle, swap the DB in, migrate
    # an older incoming collection up, and refresh scheduling — exactly what
    # routers/backup.py's import does. Imported lazily so tests that inject
    # their own finalize never touch the global engine.
    from ..bootstrap import init_database
    from ..database import engine
    from ..services.startup import run_startup_rebalance_with_session

    engine.dispose()
    restore_backup(zip_path, database_file=database_file, static_dir=static_dir)
    init_database()
    run_startup_rebalance_with_session()


def sign_in_request_code(client, email):
    return client.request_code(email)


def sign_in_verify(client, email, code, *, sync_state_path=None):
    result = client.verify(email, code)
    state = load_sync_state(sync_state_path)
    state["account_email"] = str(email or "").strip().lower()
    state["token"] = result["token"]
    save_sync_state(state, sync_state_path)

    return state


def sign_out(sync_state_path=None):
    state = load_sync_state(sync_state_path)
    state["account_email"] = None
    state["token"] = None
    # Keep device_id and last_server_version so re-signing-in on this device is
    # not treated as a brand-new device.
    save_sync_state(state, sync_state_path)

    return state


def push(
    client,
    *,
    database_file=None,
    static_dir=None,
    backup_dir=None,
    sync_state_path=None,
    force=False
):
    database_file = database_file or DATABASE_FILE
    static_dir = static_dir or STATIC_DIR
    backup_dir = backup_dir or BACKUP_DIR

    state = load_sync_state(sync_state_path)

    if not is_signed_in(state):
        raise ValueError("Not signed in")

    device_id = ensure_device_id(sync_state_path)
    state = load_sync_state(sync_state_path)
    schema = code_schema_version()

    backup = create_backup(
        database_file=database_file,
        static_dir=static_dir,
        backup_dir=backup_dir,
        reason="sync",
        extra_manifest={"schema_version": schema, "device_id": device_id}
    )
    zip_bytes = Path(backup.path).read_bytes()

    pushed = client.push(
        state["token"],
        base_version=state["last_server_version"],
        schema_version=schema,
        device_id=device_id,
        zip_bytes=zip_bytes,
        force=force
    )

    state["last_server_version"] = pushed["version"]
    save_sync_state(state, sync_state_path)

    return {"status": "pushed", "version": pushed["version"]}


def pull(
    client,
    *,
    database_file=None,
    static_dir=None,
    sync_state_path=None,
    finalize=None
):
    database_file = database_file or DATABASE_FILE
    static_dir = static_dir or STATIC_DIR
    finalize = finalize or _production_finalize

    state = load_sync_state(sync_state_path)

    if not is_signed_in(state):
        raise ValueError("Not signed in")

    pulled = client.pull(state["token"])

    if pulled is None:
        return {"status": "empty"}

    incoming_schema = pulled.get("schema_version")

    if incoming_schema and incoming_schema > code_schema_version():
        raise ValueError(
            "This collection was synced from a newer app version. Update the "
            "app before pulling."
        )

    with tempfile.TemporaryDirectory() as temp_name:
        zip_path = Path(temp_name) / "pull.zip"
        zip_path.write_bytes(pulled["zip_bytes"])
        finalize(zip_path, database_file, static_dir)

    state["last_server_version"] = pulled["version"]
    save_sync_state(state, sync_state_path)

    return {"status": "pulled", "version": pulled["version"]}
