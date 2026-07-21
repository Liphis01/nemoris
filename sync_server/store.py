"""Sync-server storage logic (M2 slice 1 — the local fake / reference server).

This is the reference implementation of the sync protocol the per-device
backend's client talks to. It is deliberately minimal and stdlib-only, and the
logic lives here as plain methods (not FastAPI routes) so it is directly
unit-testable and so a test can drive it in-process without any HTTP layer.

Per account it holds exactly one collection: a zip (a whole-DB backup) plus a
monotonic version counter. Push is accepted only if the caller's base_version
matches the server's current version — that version check is the entire
conflict-detection mechanism (one side wins wholesale, the Anki fallback), and
it means clock skew can never corrupt anything.
"""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
from uuid import uuid4


class SyncNotFoundError(Exception):
    """Raised when a requested media blob does not exist."""


class SyncConflict(Exception):
    """Raised when a push's base_version is behind the server's version."""

    def __init__(self, server_version):
        super().__init__("Collection version conflict")
        self.server_version = server_version


class SyncAuthError(Exception):
    """Raised for an unknown/invalid token or a bad verification code."""


def _account_slug(email):
    # A stable, filesystem-safe directory name per account without leaking the
    # raw email into a path.
    normalized = str(email or "").strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


class SyncStore:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # In-memory auth: fine for a local fake / reference server. A real
        # backend replaces this with magic-link + real JWTs.
        self._codes = {}
        self._tokens = {}

    # --- auth ---------------------------------------------------------------

    def request_code(self, email):
        normalized = str(email or "").strip().lower()

        if not normalized:
            raise SyncAuthError("Email required")

        code = f"{uuid4().int % 1000000:06d}"
        self._codes[normalized] = code

        return code

    def verify(self, email, code):
        normalized = str(email or "").strip().lower()

        if not code or self._codes.get(normalized) != code:
            raise SyncAuthError("Invalid code")

        del self._codes[normalized]
        token = uuid4().hex
        self._tokens[token] = normalized

        return token

    def account_for_token(self, token):
        email = self._tokens.get(token)

        if not email:
            raise SyncAuthError("Invalid token")

        return email

    # --- collection ---------------------------------------------------------

    def _account_dir(self, email):
        path = self.data_dir / _account_slug(email)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _meta_path(self, email):
        return self._account_dir(email) / "meta.json"

    def _zip_path(self, email):
        return self._account_dir(email) / "collection.zip"

    def get_meta(self, email):
        meta_path = self._meta_path(email)

        if not meta_path.exists():
            return {
                "version": 0,
                "schema_version": None,
                "updated_at": None,
                "media_hashes": []
            }

        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta.setdefault("media_hashes", [])

        return meta

    def _write_meta(self, email, meta):
        self._meta_path(email).write_text(
            json.dumps(meta, indent=2, sort_keys=True),
            encoding="utf-8"
        )

    def push(
        self,
        email,
        *,
        base_version,
        schema_version,
        zip_bytes,
        device_id=None,
        force=False
    ):
        current_meta = self.get_meta(email)
        current = current_meta["version"]

        if not force and int(base_version) != int(current):
            raise SyncConflict(current)

        new_version = current + 1
        self._zip_path(email).write_bytes(zip_bytes)
        self._write_meta(email, {
            "version": new_version,
            "schema_version": schema_version,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "last_device_id": device_id,
            # Preserved until the client's follow-up set_media_hashes() call;
            # a push that never reaches that call just leaves the manifest
            # stale, self-healing on the next push's diff.
            "media_hashes": current_meta.get("media_hashes", [])
        })

        return {"version": new_version}

    def pull(self, email):
        meta = self.get_meta(email)

        if meta["version"] == 0:
            return None

        return {
            "version": meta["version"],
            "schema_version": meta["schema_version"],
            "zip_bytes": self._zip_path(email).read_bytes()
        }

    # --- media blobs (content-addressed, idempotent) -------------------------

    def _media_dir(self, email):
        path = self._account_dir(email) / "media"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def upload_media_blob(self, email, sha256, data):
        (self._media_dir(email) / sha256).write_bytes(data)

    def download_media_blob(self, email, sha256):
        blob_path = self._media_dir(email) / sha256

        if not blob_path.exists():
            raise SyncNotFoundError(sha256)

        return blob_path.read_bytes()

    def set_media_hashes(self, email, hashes):
        meta = self.get_meta(email)
        meta["media_hashes"] = list(hashes)
        self._write_meta(email, meta)

    # --- account lifecycle ----------------------------------------------------

    def delete_account_data(self, email):
        account_dir = self._account_dir(email)

        if account_dir.exists():
            shutil.rmtree(account_dir)
