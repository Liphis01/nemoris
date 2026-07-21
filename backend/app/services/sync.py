"""Whole-collection sync engine (M2 — the "Anki fallback").

Push = snapshot the whole collection (reuse create_backup) and upload it to the
account, accepted only if this device's base version matches the server's
(one side wins wholesale). Pull = download the account's collection and restore
it (reuse the exact restore+migrate+rebalance path from routers/backup.py).

Everything is path-parametrized and the one step coupled to the global engine
(dispose → restore → init_database → rebalance) is isolated behind an
injectable `finalize`, so two simulated devices can be driven against explicit
DB/static paths in a test without touching the live engine.

Media (2.1/2.2): the DB always syncs whole (it's cheap, ~6MB even at 1400+
questions; `Progress`/`review_log` are integer-FK'd to `questions.id`, so
excluding blueprint-derived rows would either orphan them or need a whole
guid-relinking step — not worth it). Only `static/` is slimmed, by content
hash via the `media_files` registry (M0 0.5): push uploads blobs the server
doesn't have yet, pull downloads only what's missing locally. This module
owns that orchestration (hashing, diffing, reading/writing static/); adapters
(sync_client.py, supabase_sync_client.py) only move bytes.
"""

import tempfile
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ..config import BACKUP_DIR, DATABASE_FILE, STATIC_DIR
from ..migrations import MIGRATIONS
from ..models import MediaFile
from .backups import create_backup, restore_backup
from .sync_client import SyncClientConflict, SyncClientError
from .sync_state import (
    ensure_device_id,
    is_signed_in,
    load_sync_state,
    save_sync_state
)


def code_schema_version():
    return MIGRATIONS[-1].version


def _local_media_files(database_file):
    # An ad-hoc engine scoped to this exact file (not the app's global one):
    # push/pull are exercised in tests against arbitrary device paths, and in
    # pull's case this runs AFTER finalize() has already released/reopened
    # the global engine, so a second short-lived connection is safe — it's
    # disposed immediately after this one read.
    engine = create_engine(f"sqlite:///{database_file}")

    try:
        session = sessionmaker(bind=engine)()
        try:
            return [(row.sha256, row.path) for row in session.query(MediaFile)]
        finally:
            session.close()
    finally:
        engine.dispose()


def _upload_missing_media(client, token, database_file, static_dir, server_hashes):
    local_files = _local_media_files(database_file)
    local_hashes = {sha256 for sha256, _ in local_files}

    for sha256, path in local_files:
        if sha256 in server_hashes:
            continue

        blob_path = static_dir / path

        if blob_path.exists():
            client.upload_media_blob(token, sha256, blob_path.read_bytes())

    return local_hashes


def _reconcile_media(client, token, database_file, static_dir):
    # Driven entirely by the just-restored DB's own media_files registry —
    # whatever it references is what's needed, regardless of what any
    # server-side manifest says. A missing/unreachable blob is skipped, never
    # fails the pull (same posture as the adapter's best-effort zip cleanup).
    for sha256, path in _local_media_files(database_file):
        dest = static_dir / path

        if dest.exists():
            continue

        try:
            data = client.download_media_blob(token, sha256)
        except SyncClientError:
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)


def _production_finalize(zip_path, database_file, static_dir):
    # The live-engine path: release the SQLite handle, swap the DB in, migrate
    # an older incoming collection up, and refresh scheduling — exactly what
    # routers/backup.py's import does. Imported lazily so tests that inject
    # their own finalize never touch the global engine. replace_media=False:
    # this zip is DB-only (2.1); media reconciliation is a separate step in
    # pull() below, additive-only against whatever's already in static_dir.
    from ..bootstrap import init_database
    from ..database import engine
    from ..services.startup import run_startup_rebalance_with_session

    engine.dispose()
    restore_backup(
        zip_path,
        database_file=database_file,
        static_dir=static_dir,
        replace_media=False
    )
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

    meta = client.get_meta(state["token"])
    local_hashes = _upload_missing_media(
        client, state["token"], database_file, static_dir,
        set(meta.get("media_hashes") or [])
    )

    backup = create_backup(
        database_file=database_file,
        static_dir=static_dir,
        backup_dir=backup_dir,
        reason="sync",
        extra_manifest={"schema_version": schema, "device_id": device_id},
        include_media=False
    )
    zip_bytes = Path(backup.path).read_bytes()

    pushed = client.push(
        state["token"],
        base_version=state["last_server_version"],
        schema_version=schema,
        device_id=device_id,
        zip_bytes=zip_bytes,
        media_hashes=sorted(local_hashes),
        force=force
    )

    # Re-load before saving: an adapter may have rotated auth tokens during
    # the operation (persisting them via its callback), and saving the stale
    # in-memory copy would clobber them.
    state = load_sync_state(sync_state_path)
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

    _reconcile_media(client, state["token"], database_file, static_dir)

    # Re-load before saving (see push: adapters may rotate tokens mid-op).
    state = load_sync_state(sync_state_path)
    state["last_server_version"] = pulled["version"]
    save_sync_state(state, sync_state_path)

    return {"status": "pulled", "version": pulled["version"]}


def delete_account_data(client, sync_state_path=None):
    state = load_sync_state(sync_state_path)

    if not is_signed_in(state):
        raise ValueError("Not signed in")

    client.delete_account_data(state["token"])

    return sign_out(sync_state_path)
