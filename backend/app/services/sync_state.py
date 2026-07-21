"""Per-device sync state: account, token, device id, last synced version.

Persisted to SYNC_STATE_FILE (a sibling of questions.db), deliberately OUTSIDE
the database so the auth token never rides along in a synced/backed-up
collection. Plaintext + user-scoped, like everything else under APP_DATA_DIR —
adequate for this slice; OS-keychain hardening is a follow-up for when a real
cloud backend is wired.
"""

import json
from uuid import uuid4

from ..config import SYNC_STATE_FILE


DEFAULT_STATE = {
    "server_url": "",
    "account_email": None,
    "token": None,
    "device_id": None,
    "last_server_version": 0
}


def load_sync_state(path=None):
    path = path or SYNC_STATE_FILE

    if not path.exists():
        return dict(DEFAULT_STATE)

    try:
        stored = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return dict(DEFAULT_STATE)

    state = dict(DEFAULT_STATE)
    state.update({key: stored[key] for key in DEFAULT_STATE if key in stored})

    return state


def save_sync_state(state, path=None):
    path = path or SYNC_STATE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(state, indent=2, sort_keys=True),
        encoding="utf-8"
    )

    return state


def ensure_device_id(path=None):
    # A device id is minted once per install and reused, so the server can tell
    # which device last pushed.
    state = load_sync_state(path)

    if not state.get("device_id"):
        state["device_id"] = uuid4().hex
        save_sync_state(state, path)

    return state["device_id"]


def is_signed_in(state):
    return bool(state.get("token") and state.get("account_email"))
