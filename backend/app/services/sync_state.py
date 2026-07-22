"""Per-device sync state: account, token, device id, last synced version.

Persisted to SYNC_STATE_FILE (a sibling of questions.db), deliberately OUTSIDE
the database so the auth token never rides along in a synced/backed-up
collection. Plaintext + user-scoped, like everything else under APP_DATA_DIR —
adequate for this slice; OS-keychain hardening is a follow-up for when a real
cloud backend is wired.
"""

from datetime import datetime, timezone
import json
import re
from uuid import uuid4

from ..config import SYNC_STATE_FILE


DEFAULT_STATE = {
    "server_url": "",
    # Publishable API key (Supabase). Safe to store/expose to the local UI —
    # security comes from RLS + the user's auth token, never from this key.
    "server_key": "",
    "account_email": None,
    "token": None,
    "device_id": None,
    "last_server_version": 0,
    "auto_sync_enabled": False,
    "local_change_seq": 0,
    "last_synced_change_seq": 0,
    "last_local_change_reason": None,
    "last_auto_sync_at": None,
    "last_auto_sync_status": None,
    "last_auto_sync_error": None
}

COLLECTION_MUTATION_RULES = [
    ("POST", re.compile(r"^/questions/?$")),
    ("POST", re.compile(r"^/questions/bulk/?$")),
    ("PUT", re.compile(r"^/questions/\d+/?$")),
    ("DELETE", re.compile(r"^/questions/\d+/?$")),
    ("PUT", re.compile(r"^/questions/\d+/collections/?$")),
    ("DELETE", re.compile(r"^/questions/\d+/image/?$")),
    ("POST", re.compile(r"^/groups/?$")),
    ("PUT", re.compile(r"^/groups/\d+/?$")),
    ("DELETE", re.compile(r"^/groups/\d+/?$")),
    ("POST", re.compile(r"^/collections/?$")),
    ("PUT", re.compile(r"^/collections/\d+/?$")),
    ("DELETE", re.compile(r"^/collections/\d+/?$")),
    ("PUT", re.compile(r"^/tags/hierarchy/?$")),
    ("POST", re.compile(r"^/upload/?$")),
    ("POST", re.compile(r"^/upload/url/?$")),
    ("PATCH", re.compile(r"^/maps/\d+/zones/?$")),
    ("PATCH", re.compile(r"^/media-groups/\d+/items/?$")),
    ("POST", re.compile(r"^/media-groups/\d+/upload/?$")),
    ("POST", re.compile(r"^/media-groups/\d+/upload/url/?$")),
    ("PATCH", re.compile(r"^/text-groups/\d+/items/?$")),
    ("PATCH", re.compile(r"^/sequence-groups/\d+/items/?$")),
    ("PUT", re.compile(r"^/review/settings/?$")),
    ("POST", re.compile(r"^/answer/?$")),
    ("POST", re.compile(r"^/answer/revise/?$")),
    ("POST", re.compile(r"^/answer/relearning_graduate/?$")),
    ("POST", re.compile(r"^/answer_map/?$")),
    ("POST", re.compile(r"^/answer_media/?$")),
    ("POST", re.compile(r"^/answer_text/?$")),
    ("POST", re.compile(r"^/answer_timeline/?$")),
    ("POST", re.compile(r"^/answer_sequence/?$")),
    ("POST", re.compile(r"^/backup/import/?$")),
    ("POST", re.compile(r"^/packs/import/?$")),
    ("POST", re.compile(r"^/blueprints/import/?$")),
    ("POST", re.compile(r"^/packs/update/?$")),
    ("POST", re.compile(r"^/blueprints/update/?$")),
    ("POST", re.compile(r"^/packs/[^/]+/unsubscribe/?$")),
    ("POST", re.compile(r"^/blueprints/[^/]+/unsubscribe/?$")),
]


def _now_utc_iso():
    return datetime.now(timezone.utc).isoformat()


def _int_state_value(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


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


def collection_is_dirty(state=None, path=None):
    state = state or load_sync_state(path)
    return (
        _int_state_value(state.get("local_change_seq")) >
        _int_state_value(state.get("last_synced_change_seq"))
    )


def mark_collection_changed(reason=None, path=None):
    state = load_sync_state(path)
    state["local_change_seq"] = _int_state_value(
        state.get("local_change_seq")
    ) + 1
    state["last_local_change_reason"] = str(reason) if reason else None
    save_sync_state(state, path)

    return state


def mark_collection_clean(version=None, path=None):
    state = load_sync_state(path)

    if version is not None:
        state["last_server_version"] = _int_state_value(version)

    state["last_synced_change_seq"] = _int_state_value(
        state.get("local_change_seq")
    )
    save_sync_state(state, path)

    return state


def save_auto_sync_preferences(auto_sync_enabled, path=None):
    state = load_sync_state(path)
    state["auto_sync_enabled"] = bool(auto_sync_enabled)
    save_sync_state(state, path)

    return state


def save_auto_sync_result(status, error=None, path=None):
    state = load_sync_state(path)
    state["last_auto_sync_at"] = _now_utc_iso()
    state["last_auto_sync_status"] = status
    state["last_auto_sync_error"] = str(error) if error else None
    save_sync_state(state, path)

    return state


def should_mark_collection_changed(method, path, status_code=200):
    try:
        status = int(status_code)
    except (TypeError, ValueError):
        status = 0

    if status < 200 or status >= 300:
        return False

    normalized_method = str(method or "").upper()
    normalized_path = (str(path or "").split("?", 1)[0].rstrip("/") or "/")

    return any(
        rule_method == normalized_method and pattern.match(normalized_path)
        for rule_method, pattern in COLLECTION_MUTATION_RULES
    )
