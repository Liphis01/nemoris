"""Per-device Supabase catalogue publishing state.

This is intentionally separate from AppSetting/database-backed preferences:
the publishable key is safe to store in settings, but the user's Supabase
session token should stay out of backups and sync payloads.
"""

import json

from ..config import PACK_PUBLISH_STATE_FILE


DEFAULT_STATE = {
    "account_email": None,
    "token": None
}


def load_pack_publish_state(path=None):
    path = path or PACK_PUBLISH_STATE_FILE

    if not path.exists():
        return dict(DEFAULT_STATE)

    try:
        stored = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return dict(DEFAULT_STATE)

    state = dict(DEFAULT_STATE)
    state.update({key: stored[key] for key in DEFAULT_STATE if key in stored})

    return state


def save_pack_publish_state(state, path=None):
    path = path or PACK_PUBLISH_STATE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(state, indent=2, sort_keys=True),
        encoding="utf-8"
    )

    return state


def is_pack_publisher_signed_in(state):
    return bool(state.get("token") and state.get("account_email"))
