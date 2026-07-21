"""Supabase adapter for the sync protocol (M2 slice 2).

Same interface as HttpSyncClient (services/sync_client.py), so the engine in
services/sync.py is unchanged. Differences handled here:

- Auth is Supabase email OTP: request_code() triggers their /auth/v1/otp email
  (the 6-digit code arrives by e-mail, never in the response), verify() trades
  it for a JWT session. The opaque "token" the engine stores is a dict
  {access_token, refresh_token, user_id} instead of a plain string.
- Access tokens expire (~1h) and refresh tokens ROTATE on use, so every authed
  operation retries once through _refresh(), which persists the rotated pair
  via on_tokens_updated (the router wires that to sync_state).
- The version counter lives in the `collections` table (Data API / PostgREST),
  the zip in the `sync-collections` storage bucket. Conflict safety: the zip is
  uploaded to a VERSIONED object name first ({uid}/v{n}.zip — an orphan if we
  lose the race), then the version is claimed atomically with a guarded PATCH
  (WHERE version = current). A lost claim never touches the winner's data.
  The previous version's zip is kept as a safety net; older ones are pruned.

Everything is stdlib urllib, matching the app's outbound-HTTP posture.
"""

from datetime import datetime, timezone
import json
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from .sync_client import (
    AUTH_TIMEOUT,
    TRANSFER_TIMEOUT,
    SyncClientAuthError,
    SyncClientConflict,
    SyncClientError
)


BUCKET = "sync-collections"


def _normalize_project_url(url):
    base = str(url or "").strip().rstrip("/")

    # Users often paste an endpoint variant; normalize to the project root.
    for suffix in ("/rest/v1", "/auth/v1", "/storage/v1"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]

    return base.rstrip("/")


def _error_message(body):
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None

    if isinstance(payload, dict):
        return (
            payload.get("error_description")
            or payload.get("msg")
            or payload.get("message")
            or payload.get("error")
        )

    return None


class SupabaseSyncClient:
    def __init__(self, project_url, publishable_key, on_tokens_updated=None):
        self.base = _normalize_project_url(project_url)
        self.key = str(publishable_key or "").strip()
        self.on_tokens_updated = on_tokens_updated

        if not self.base:
            raise SyncClientError("No sync server configured")

        if not self.key:
            raise SyncClientError(
                "Clé publique Supabase requise (Settings → Synchronisation)"
            )

    # --- transport (seam for tests) ----------------------------------------

    def _http(self, request, timeout):
        return urlopen(request, timeout=timeout)

    def _request(
        self,
        path,
        *,
        method="GET",
        access_token=None,
        payload=None,
        body=None,
        headers=None,
        timeout=AUTH_TIMEOUT
    ):
        all_headers = {"apikey": self.key}

        if access_token:
            all_headers["Authorization"] = f"Bearer {access_token}"

        data = body

        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            all_headers["Content-Type"] = "application/json"

        if headers:
            all_headers.update(headers)

        request = Request(
            f"{self.base}{path}",
            data=data,
            headers=all_headers,
            method=method
        )

        try:
            with self._http(request, timeout) as response:
                return response.status, dict(response.headers), response.read()
        except HTTPError as error:
            error_body = error.read()

            if error.code in (401,):
                raise SyncClientAuthError(
                    _error_message(error_body) or "Not signed in"
                ) from error

            return error.code, dict(error.headers), error_body
        except (URLError, TimeoutError, ValueError) as error:
            raise SyncClientError("Sync server unreachable") from error

    def _json(self, path, **kwargs):
        status, _, body = self._request(path, **kwargs)

        if status >= 400:
            raise SyncClientError(
                _error_message(body) or f"Sync failed ({status})"
            )

        if not body:
            return {}

        return json.loads(body.decode("utf-8"))

    # --- auth ---------------------------------------------------------------

    def request_code(self, email):
        status, _, body = self._request(
            "/auth/v1/otp",
            method="POST",
            payload={"email": email, "create_user": True}
        )

        if status >= 400:
            raise SyncClientError(
                _error_message(body) or "Impossible d'envoyer le code"
            )

        # The 6-digit code arrives by e-mail (unlike the fake server, which
        # returns it directly for dev convenience).
        return {}

    def _verify_payloads(self, email, value):
        # The user can paste either the 6-digit code OR the full login link
        # from the e-mail (Supabase's built-in sender has fixed templates that
        # may only contain the link — templates are only editable with custom
        # SMTP). A pasted link carries the token hash + type in its query.
        if "://" in value or "verify?" in value:
            query = parse_qs(urlparse(value).query)
            token_hash = (query.get("token") or [None])[0]
            link_type = (query.get("type") or ["magiclink"])[0]

            if not token_hash:
                raise SyncClientAuthError(
                    "Lien invalide — collez le lien complet de l'e-mail"
                )

            return [
                {"type": link_type, "token_hash": token_hash},
                {"type": "email", "token_hash": token_hash}
            ]

        return [{"type": "email", "email": email, "token": value}]

    def verify(self, email, code):
        value = str(code or "").strip()
        last_error = "Invalid code"

        for payload in self._verify_payloads(email, value):
            try:
                status, _, body = self._request(
                    "/auth/v1/verify", method="POST", payload=payload
                )
            except SyncClientAuthError as error:
                last_error = str(error)
                continue

            if status >= 400:
                last_error = _error_message(body) or last_error
                continue

            data = json.loads(body.decode("utf-8"))
            user_id = (data.get("user") or {}).get("id")

            if not data.get("access_token") or not user_id:
                raise SyncClientAuthError("Invalid verification response")

            return {
                "token": {
                    "access_token": data["access_token"],
                    "refresh_token": data.get("refresh_token"),
                    "user_id": user_id
                }
            }

        raise SyncClientAuthError(last_error)

    def _refresh(self, token):
        refresh_token = (token or {}).get("refresh_token")

        if not refresh_token:
            raise SyncClientAuthError("Not signed in")

        data = self._json(
            "/auth/v1/token?grant_type=refresh_token",
            method="POST",
            payload={"refresh_token": refresh_token}
        )

        if not data.get("access_token"):
            raise SyncClientAuthError("Session expirée — reconnectez-vous")

        new_token = {
            **token,
            "access_token": data["access_token"],
            # Rotation: Supabase revokes the old refresh token on use, so the
            # new one MUST be persisted or the next sync is locked out.
            "refresh_token": data.get("refresh_token") or refresh_token
        }

        if self.on_tokens_updated:
            self.on_tokens_updated(new_token)

        return new_token

    def _authed(self, operation, token):
        if not isinstance(token, dict):
            raise SyncClientAuthError("Not signed in")

        try:
            return operation(token)
        except SyncClientAuthError:
            return operation(self._refresh(token))

    # --- meta / version counter (Data API) ----------------------------------

    def _meta_raw(self, token):
        rows = self._json(
            "/rest/v1/collections"
            "?select=version,schema_version,updated_at,last_device_id",
            access_token=token["access_token"]
        )

        if not rows:
            return {"version": 0, "schema_version": None, "updated_at": None}

        return rows[0]

    def get_meta(self, token):
        return self._authed(self._meta_raw, token)

    def _claim_version(
        self, token, *, current, new_version, schema_version, device_id
    ):
        # The atomic step: either insert the first row, or a guarded UPDATE
        # (WHERE version = current). Zero/empty result = someone else won.
        fields = {
            "version": new_version,
            "schema_version": schema_version,
            # Display-only; the version counter is the source of truth, so a
            # skewed client clock here is harmless.
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "last_device_id": device_id
        }

        if current == 0:
            status, _, body = self._request(
                "/rest/v1/collections",
                method="POST",
                access_token=token["access_token"],
                payload={"user_id": token["user_id"], **fields},
                headers={"Prefer": "return=representation"}
            )

            if status == 409:
                return False

            if status >= 400:
                raise SyncClientError(
                    _error_message(body) or f"Sync failed ({status})"
                )

            return True

        status, _, body = self._request(
            f"/rest/v1/collections?user_id=eq.{token['user_id']}"
            f"&version=eq.{current}",
            method="PATCH",
            access_token=token["access_token"],
            payload=fields,
            headers={"Prefer": "return=representation"}
        )

        if status >= 400:
            raise SyncClientError(
                _error_message(body) or f"Sync failed ({status})"
            )

        return bool(json.loads(body.decode("utf-8")))

    # --- storage ------------------------------------------------------------

    def _object_path(self, token, version):
        return f"/storage/v1/object/{BUCKET}/{token['user_id']}/v{version}.zip"

    def _upload_zip(self, token, version, zip_bytes):
        status, _, body = self._request(
            self._object_path(token, version),
            method="POST",
            access_token=token["access_token"],
            body=zip_bytes,
            headers={"Content-Type": "application/zip", "x-upsert": "true"},
            timeout=TRANSFER_TIMEOUT
        )

        if status >= 400:
            raise SyncClientError(
                _error_message(body) or f"Téléversement impossible ({status})"
            )

    def _download_zip(self, token, version):
        status, _, body = self._request(
            self._object_path(token, version),
            access_token=token["access_token"],
            timeout=TRANSFER_TIMEOUT
        )

        if status >= 400:
            raise SyncClientError(
                _error_message(body) or "Collection introuvable sur le cloud"
            )

        return body

    def _delete_zip(self, token, version):
        try:
            self._request(
                self._object_path(token, version),
                method="DELETE",
                access_token=token["access_token"]
            )
        except SyncClientError:
            # Best-effort cleanup only; never fail a sync over it.
            pass

    # --- protocol operations -------------------------------------------------

    def push(
        self, token, *, base_version, schema_version, device_id, zip_bytes,
        force=False
    ):
        def operation(tok):
            current = self._meta_raw(tok)["version"]

            if not force and int(base_version) != int(current):
                raise SyncClientConflict(current)

            new_version = current + 1

            # Upload first, claim second: a lost race leaves only an orphan
            # object, never a corrupted current version.
            self._upload_zip(tok, new_version, zip_bytes)
            claimed = self._claim_version(
                tok,
                current=current,
                new_version=new_version,
                schema_version=schema_version,
                device_id=device_id
            )

            if not claimed:
                self._delete_zip(tok, new_version)
                raise SyncClientConflict(self._meta_raw(tok)["version"])

            # Keep current + previous as a safety net; prune older.
            if new_version >= 3:
                self._delete_zip(tok, new_version - 2)

            return {"version": new_version}

        return self._authed(operation, token)

    def pull(self, token):
        def operation(tok):
            meta = self._meta_raw(tok)

            if meta["version"] == 0:
                return None

            return {
                "version": meta["version"],
                "schema_version": meta.get("schema_version"),
                "zip_bytes": self._download_zip(tok, meta["version"])
            }

        return self._authed(operation, token)
