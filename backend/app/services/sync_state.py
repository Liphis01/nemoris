"""Per-device sync state: account, token, device id, last synced version.

Persisted to SYNC_STATE_FILE (a sibling of questions.db), deliberately OUTSIDE
the database so the auth token never rides along in a synced/backed-up
collection. Most fields are plaintext JSON, user-scoped like everything else
under APP_DATA_DIR — fine, since none of them are secret (the Supabase key is
a publishable key; safety comes from RLS). The one exception is `token`
(the session access/refresh token pair), which is kept out of the JSON file
and stored via the OS keychain (`keyring`) instead, when a real backend is
available. Where no backend exists (headless Linux with no Secret Service
daemon, this project's own dev/CI environment included), `keyring` resolves
to its "fail" backend and every call below transparently falls back to the
old plaintext-in-JSON behavior — so this file works unchanged in both cases,
callers never need to know which one is active.
"""

from datetime import datetime, timezone
import hashlib
import json
import re
from uuid import uuid4

from ..config import SYNC_STATE_FILE

try:
    import keyring
except ImportError:  # pragma: no cover - keyring is a pinned dependency
    keyring = None

KEYRING_SERVICE = "quiz-app-sync-token"

# Test seam: point this at a fake backend (get_password/set_password/
# delete_password) to verify keychain behavior without touching a real OS
# credential store. Defaults to the real `keyring` module.
_keyring_backend = keyring


def _keyring_account(path):
    # Namespaced by the resolved state-file path so distinct installs (or
    # distinct temp dirs in tests) never share a keychain entry.
    return hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()


def _token_get(path):
    if _keyring_backend is None:
        return None

    try:
        raw = _keyring_backend.get_password(
            KEYRING_SERVICE, _keyring_account(path)
        )
    except Exception:
        return None

    if not raw:
        return None

    try:
        return json.loads(raw)
    except ValueError:
        return None


def _token_set(path, token):
    if _keyring_backend is None:
        return False

    try:
        _keyring_backend.set_password(
            KEYRING_SERVICE, _keyring_account(path), json.dumps(token)
        )
        return True
    except Exception:
        return False


def _token_delete(path):
    if _keyring_backend is None:
        return

    try:
        _keyring_backend.delete_password(KEYRING_SERVICE, _keyring_account(path))
    except Exception:
        # Best-effort: nothing to clean up, or no backend to clean up with.
        pass


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

    if not state.get("token"):
        keyring_token = _token_get(path)
        if keyring_token:
            state["token"] = keyring_token

    return state


def save_sync_state(state, path=None):
    path = path or SYNC_STATE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)

    to_write = dict(state)
    token = to_write.get("token")

    if token:
        if _token_set(path, token):
            to_write.pop("token", None)
        # else: no backend available, fall back to writing it below like today
    else:
        _token_delete(path)
        to_write.pop("token", None)

    path.write_text(
        json.dumps(to_write, indent=2, sort_keys=True),
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
