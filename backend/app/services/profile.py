import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .sync_state import is_signed_in, load_sync_state, save_sync_state


REST_TIMEOUT = 12
USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 20
USERNAME_EXTRA_CHARS = {"_", "-"}
ALLOWED_AVATAR_COLORS = {"violet", "amber", "green", "blue", "teal", "neutral"}


class ProfileError(ValueError):
    pass


class ProfileAuthError(ProfileError):
    pass


class ProfileConflictError(ProfileError):
    pass


def _message_from_body(body):
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None

    if isinstance(payload, dict):
        return (
            payload.get("message") or payload.get("msg")
            or payload.get("error_description") or payload.get("error")
        )

    return None


def _is_unique_violation(status, body):
    if status != 409:
        return False

    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return False

    return isinstance(payload, dict) and payload.get("code") == "23505"


def _supabase_request(
    project_url, key, path, *, method="GET", access_token=None, payload=None,
    timeout=REST_TIMEOUT
):
    headers = {"apikey": key}

    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    data = None

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(f"{project_url}{path}", data=data, headers=headers, method=method)

    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()
    except (TimeoutError, URLError, ValueError) as error:
        raise ProfileError("Service de profil inaccessible.") from error


def _refresh_token(project_url, key, token):
    # Same endpoint/payload/rotation-fallback shape as
    # SupabaseSyncClient._refresh() and pack_catalog._refresh_publish_token().
    refresh_token = (token or {}).get("refresh_token")

    if not refresh_token:
        raise ProfileAuthError("Session expirée : reconnecte-toi.")

    status, body = _supabase_request(
        project_url, key, "/auth/v1/token?grant_type=refresh_token",
        method="POST", payload={"refresh_token": refresh_token}
    )

    if status >= 400:
        raise ProfileAuthError(_message_from_body(body) or "Session expirée : reconnecte-toi.")

    data = json.loads(body.decode("utf-8"))

    if not data.get("access_token"):
        raise ProfileAuthError("Session expirée : reconnecte-toi.")

    return {
        **token,
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or refresh_token
    }


def _signed_in_state():
    # Profil reuses ONLY the sync sign-in (not the separate pack-catalog
    # login) -- sync is the app's real account concept.
    state = load_sync_state()

    if not is_signed_in(state):
        return None

    project_url = str(state.get("server_url") or "").strip().rstrip("/")
    key = str(state.get("server_key") or "").strip()

    if not project_url or not key:
        return None

    return state


def _authed_request(state, path, *, method="GET", payload=None):
    project_url = state["server_url"].rstrip("/")
    key = state["server_key"]
    token = state["token"]

    status, body = _supabase_request(
        project_url, key, path, method=method,
        access_token=token["access_token"], payload=payload
    )

    if status == 401:
        token = _refresh_token(project_url, key, token)
        state["token"] = token
        save_sync_state(state)
        status, body = _supabase_request(
            project_url, key, path, method=method,
            access_token=token["access_token"], payload=payload
        )

    if status == 401:
        raise ProfileAuthError(_message_from_body(body) or "Session expirée : reconnecte-toi.")

    return status, body


def validate_username(username):
    value = str(username or "").strip()

    if len(value) < USERNAME_MIN_LENGTH or len(value) > USERNAME_MAX_LENGTH:
        raise ProfileError(
            f"Le pseudo doit contenir entre {USERNAME_MIN_LENGTH} et "
            f"{USERNAME_MAX_LENGTH} caractères."
        )

    # str.isalnum() is Unicode-aware (accents/non-Latin letters pass), unlike
    # an ASCII-only regex -- matches the project's own "allow accents and
    # special characters" direction (docs/roadmap.md).
    if not all(char.isalnum() or char in USERNAME_EXTRA_CHARS for char in value):
        raise ProfileError(
            "Le pseudo ne peut contenir que des lettres, chiffres, "
            "underscores (_) ou tirets (-)."
        )

    return value


def validate_avatar_color(color):
    value = str(color or "").strip().lower()

    if value not in ALLOWED_AVATAR_COLORS:
        raise ProfileError("Couleur d'avatar invalide.")

    return value


def validate_avatar_emoji(emoji):
    value = str(emoji or "").strip()

    if not value or len(value) > 16:
        raise ProfileError("Avatar invalide.")

    return value


def _row_to_profile(row):
    if isinstance(row, list):
        row = row[0] if row else None

    if not row:
        return None

    return {
        "username": row.get("username"),
        "avatar_emoji": row.get("avatar_emoji"),
        "avatar_color": row.get("avatar_color"),
        "updated_at": row.get("updated_at")
    }


def get_profile_status():
    state = _signed_in_state()

    if not state:
        return {"signed_in": False, "account_email": None, "profile": None}

    user_id = quote(str(state["token"].get("user_id") or ""), safe="")
    status, body = _authed_request(
        state,
        f"/rest/v1/profiles?user_id=eq.{user_id}"
        "&select=username,avatar_emoji,avatar_color,updated_at"
    )

    if status >= 400:
        raise ProfileError(_message_from_body(body) or f"Profil indisponible ({status}).")

    rows = json.loads(body.decode("utf-8")) if body else []

    return {
        "signed_in": True,
        "account_email": state.get("account_email"),
        "profile": _row_to_profile(rows[0] if rows else None)
    }


def save_profile(username, avatar_emoji, avatar_color):
    state = _signed_in_state()

    if not state:
        raise ProfileAuthError("Connexion requise.")

    clean_username = validate_username(username)
    clean_emoji = validate_avatar_emoji(avatar_emoji)
    clean_color = validate_avatar_color(avatar_color)

    status, body = _authed_request(
        state,
        "/rest/v1/rpc/upsert_my_profile",
        method="POST",
        payload={
            "p_username": clean_username,
            "p_avatar_emoji": clean_emoji,
            "p_avatar_color": clean_color
        }
    )

    if _is_unique_violation(status, body):
        raise ProfileConflictError("Ce pseudo est déjà pris.")

    if status >= 400:
        raise ProfileError(_message_from_body(body) or f"Enregistrement impossible ({status}).")

    row = json.loads(body.decode("utf-8")) if body else None

    return {
        "signed_in": True,
        "account_email": state.get("account_email"),
        "profile": _row_to_profile(row)
    }
