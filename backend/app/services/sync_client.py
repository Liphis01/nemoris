"""Client for the sync protocol (M2 slice 1).

This is the adapter boundary: `services/sync.py` depends only on this small
interface, so the backend behind it can change without touching the sync
engine. `HttpSyncClient` (stdlib urllib) talks to the fake/self-hosted server;
a future managed backend (Supabase) is a different implementation of the same
methods. Tests use an in-process client wrapping the store directly.

Transfers use raw-binary zip bodies with metadata in the query/headers (not
multipart), which keeps this on stdlib urllib — no new dependency, consistent
with the app's existing outbound-HTTP posture (services/media.py).
"""

import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


AUTH_TIMEOUT = 15
TRANSFER_TIMEOUT = 180


class SyncClientError(Exception):
    pass


class SyncClientAuthError(SyncClientError):
    pass


class SyncClientConflict(SyncClientError):
    def __init__(self, server_version):
        super().__init__("Collection version conflict")
        self.server_version = server_version


class HttpSyncClient:
    def __init__(self, server_url):
        self.base = str(server_url or "").rstrip("/")

        if not self.base:
            raise SyncClientError("No sync server configured")

    def _json_request(self, path, *, method="GET", token=None, payload=None):
        headers = {}
        data = None

        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        if token:
            headers["Authorization"] = f"Bearer {token}"

        request = Request(
            f"{self.base}{path}",
            data=data,
            headers=headers,
            method=method
        )

        try:
            with urlopen(request, timeout=AUTH_TIMEOUT) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            self._raise_http_error(error)
        except (URLError, TimeoutError, ValueError) as error:
            raise SyncClientError(
                "Sync server unreachable"
            ) from error

    def _raise_http_error(self, error):
        if error.code == 401:
            raise SyncClientAuthError("Not signed in") from error

        detail = None
        try:
            detail = json.loads(error.read().decode("utf-8")).get("detail")
        except (ValueError, OSError):
            pass

        if error.code == 409:
            server_version = 0
            if isinstance(detail, dict):
                server_version = detail.get("server_version", 0)
            raise SyncClientConflict(server_version) from error

        raise SyncClientError(
            detail if isinstance(detail, str) else f"Sync failed ({error.code})"
        ) from error

    # --- auth ---------------------------------------------------------------

    def request_code(self, email):
        return self._json_request(
            "/auth/request-code", method="POST", payload={"email": email}
        )

    def verify(self, email, code):
        return self._json_request(
            "/auth/verify", method="POST", payload={"email": email, "code": code}
        )

    def get_meta(self, token):
        return self._json_request("/collection/meta", token=token)

    # --- media blobs (content-addressed, idempotent) ------------------------

    def upload_media_blob(self, token, sha256, data):
        request = Request(
            f"{self.base}/collection/media/{sha256}",
            data=data,
            headers={
                "Content-Type": "application/octet-stream",
                "Authorization": f"Bearer {token}"
            },
            method="PUT"
        )

        try:
            with urlopen(request, timeout=TRANSFER_TIMEOUT):
                return
        except HTTPError as error:
            self._raise_http_error(error)
        except (URLError, TimeoutError, ValueError) as error:
            raise SyncClientError("Sync server unreachable") from error

    def download_media_blob(self, token, sha256):
        request = Request(
            f"{self.base}/collection/media/{sha256}",
            headers={"Authorization": f"Bearer {token}"}
        )

        try:
            with urlopen(request, timeout=TRANSFER_TIMEOUT) as response:
                return response.read()
        except HTTPError as error:
            self._raise_http_error(error)
        except (URLError, TimeoutError, ValueError) as error:
            raise SyncClientError("Sync server unreachable") from error

    def _set_media_manifest(self, token, media_hashes):
        self._json_request(
            "/collection/media-manifest",
            method="PUT",
            token=token,
            payload={"hashes": list(media_hashes)}
        )

    # --- collection ---------------------------------------------------------

    def push(
        self, token, *, base_version, schema_version, device_id, zip_bytes,
        media_hashes=(), force=False
    ):
        query = urlencode({
            "base_version": base_version,
            "schema_version": schema_version,
            "device_id": device_id or "",
            "force": "true" if force else "false"
        })
        request = Request(
            f"{self.base}/collection?{query}",
            data=zip_bytes,
            headers={
                "Content-Type": "application/zip",
                "Authorization": f"Bearer {token}"
            },
            method="POST"
        )

        try:
            with urlopen(request, timeout=TRANSFER_TIMEOUT) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            self._raise_http_error(error)
        except (URLError, TimeoutError, ValueError) as error:
            raise SyncClientError("Sync server unreachable") from error

        # Best-effort ordering note: the version claim above already
        # succeeded by the time we get here, so a failure setting the
        # manifest leaves it briefly stale — self-healing, since the next
        # push recomputes the diff against whatever the manifest currently
        # says and resends it.
        self._set_media_manifest(token, media_hashes)

        return result

    def pull(self, token):
        request = Request(
            f"{self.base}/collection",
            headers={"Authorization": f"Bearer {token}"}
        )

        try:
            with urlopen(request, timeout=TRANSFER_TIMEOUT) as response:
                return {
                    "version": int(response.headers.get("X-Collection-Version", 0)),
                    "schema_version": response.headers.get("X-Schema-Version") or None,
                    "zip_bytes": response.read()
                }
        except HTTPError as error:
            if error.code == 404:
                return None
            self._raise_http_error(error)
        except (URLError, TimeoutError, ValueError) as error:
            raise SyncClientError("Sync server unreachable") from error

    def delete_account_data(self, token):
        self._json_request(
            "/collection/account-data", method="DELETE", token=token
        )
