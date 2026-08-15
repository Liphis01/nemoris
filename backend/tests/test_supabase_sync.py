import io
import json
import unittest
from urllib.error import HTTPError, URLError

from app.services.supabase_sync_client import SupabaseSyncClient
from app.services.sync_client import (
    AUTH_TIMEOUT,
    OTP_TIMEOUT,
    SyncClientAuthError,
    SyncClientConflict,
    SyncClientError,
    SyncClientTimeout
)


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self.headers = {}
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeTransportClient(SupabaseSyncClient):
    """Routes _http through a scripted handler and records every call."""

    def __init__(self, *args, handler=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.calls = []
        self.timeouts = []
        self.handler = handler

    def _http(self, request, timeout):
        method = request.get_method()
        path = request.full_url[len(self.base):]
        self.calls.append((method, path))
        self.timeouts.append(timeout)
        status, body = self.handler(method, path, request)

        if status >= 400:
            raise HTTPError(
                request.full_url, status, "error", {}, io.BytesIO(body)
            )

        return FakeResponse(status, body)


def json_body(payload):
    return json.dumps(payload).encode("utf-8")


TOKEN = {"access_token": "at-1", "refresh_token": "rt-1", "user_id": "uid-1"}


class SupabaseClientTests(unittest.TestCase):
    def make(self, handler):
        return FakeTransportClient(
            "https://proj.supabase.co", "sb_publishable_x", handler=handler
        )

    def test_url_normalization_strips_endpoint_suffixes(self):
        client = self.make(lambda *a: (200, b"{}"))
        self.assertEqual(client.base, "https://proj.supabase.co")

        client = FakeTransportClient(
            "https://proj.supabase.co/rest/v1/", "k", handler=None
        )
        self.assertEqual(client.base, "https://proj.supabase.co")

    def test_missing_key_rejected(self):
        with self.assertRaises(SyncClientError):
            SupabaseSyncClient("https://proj.supabase.co", "")

    def test_request_code_waits_longer_than_a_normal_auth_call(self):
        # Supabase answers /auth/v1/otp only once the e-mail is sent, which is
        # routinely slower than AUTH_TIMEOUT.
        client = self.make(lambda m, p, r: (200, b"{}"))
        client.request_code("a@b.c")

        self.assertEqual(client.timeouts, [OTP_TIMEOUT])
        self.assertGreater(OTP_TIMEOUT, AUTH_TIMEOUT)

    def test_slow_send_is_reported_as_slow_not_as_unreachable(self):
        def handler(method, path, request):
            raise TimeoutError("timed out")

        with self.assertRaises(SyncClientTimeout) as caught:
            self.make(handler).request_code("a@b.c")

        self.assertIn("trop de temps", str(caught.exception))

    def test_request_code_gateway_timeout_reports_a_failed_send(self):
        # The edge gateway gave up on the mailer: no code was sent.
        def handler(method, path, request):
            return (504, b"upstream request timeout")

        with self.assertRaises(SyncClientError) as caught:
            self.make(handler).request_code("a@b.c")

        self.assertIn("Impossible d'envoyer le code", str(caught.exception))

    def test_request_code_real_rejection_still_fails(self):
        def handler(method, path, request):
            return (422, json_body({"msg": "Signups not allowed for otp"}))

        with self.assertRaises(SyncClientError) as caught:
            self.make(handler).request_code("a@b.c")

        self.assertIn("Signups not allowed", str(caught.exception))

    def test_unreachable_server_is_not_reported_as_a_timeout(self):
        def handler(method, path, request):
            raise URLError("connection refused")

        with self.assertRaises(SyncClientError) as caught:
            self.make(handler).get_meta(TOKEN)

        self.assertNotIsInstance(caught.exception, SyncClientTimeout)

    def test_verify_builds_token_dict(self):
        def handler(method, path, request):
            self.assertEqual(path, "/auth/v1/verify")
            sent = json.loads(request.data.decode("utf-8"))
            self.assertEqual(sent["type"], "email")
            return (200, json_body({
                "access_token": "at",
                "refresh_token": "rt",
                "user": {"id": "uid-9"}
            }))

        result = self.make(handler).verify("a@b.c", "123456")
        self.assertEqual(
            result["token"],
            {"access_token": "at", "refresh_token": "rt", "user_id": "uid-9"}
        )

    def test_verify_accepts_pasted_login_link(self):
        seen = []

        def handler(method, path, request):
            sent = json.loads(request.data.decode("utf-8"))
            seen.append(sent)
            return (200, json_body({
                "access_token": "at",
                "refresh_token": "rt",
                "user": {"id": "uid-9"}
            }))

        link = (
            "https://proj.supabase.co/auth/v1/verify"
            "?token=hash-abc&type=magiclink&redirect_to=http://localhost"
        )
        result = self.make(handler).verify("a@b.c", link)

        self.assertEqual(result["token"]["user_id"], "uid-9")
        self.assertEqual(
            seen[0], {"type": "magiclink", "token_hash": "hash-abc"}
        )

    def test_verify_link_falls_back_to_email_type(self):
        state = {"calls": 0}

        def handler(method, path, request):
            state["calls"] += 1
            if state["calls"] == 1:
                return (403, json_body({"msg": "bad type"}))
            return (200, json_body({
                "access_token": "at",
                "refresh_token": "rt",
                "user": {"id": "uid-9"}
            }))

        link = "https://proj.supabase.co/auth/v1/verify?token=hash-x&type=magiclink"
        result = self.make(handler).verify("a@b.c", link)

        self.assertEqual(result["token"]["access_token"], "at")
        self.assertEqual(state["calls"], 2)

    def test_verify_bad_code_raises_auth_error(self):
        def handler(method, path, request):
            return (403, json_body({"error_description": "Token expired"}))

        with self.assertRaises(SyncClientAuthError):
            self.make(handler).verify("a@b.c", "000000")

    def test_get_meta_empty_means_version_zero(self):
        client = self.make(lambda m, p, r: (200, b"[]"))
        meta = client.get_meta(TOKEN)
        self.assertEqual(meta["version"], 0)

    def test_missing_collections_table_reports_setup_action(self):
        def handler(method, path, request):
            return (404, json_body({
                "code": "PGRST205",
                "message": (
                    "Could not find the table 'public.collections' in the "
                    "schema cache"
                )
            }))

        with self.assertRaises(SyncClientError) as caught:
            self.make(handler).get_meta(TOKEN)

        message = str(caught.exception)
        self.assertIn("Configuration Supabase de sync incomplète", message)
        self.assertIn("docs/supabase-sync-setup.sql", message)

    def test_missing_media_hashes_column_reports_setup_action(self):
        def handler(method, path, request):
            return (400, json_body({
                "code": "PGRST204",
                "message": (
                    "Could not find the 'media_hashes' column of "
                    "'collections' in the schema cache"
                )
            }))

        with self.assertRaises(SyncClientError) as caught:
            self.make(handler).get_meta(TOKEN)

        self.assertIn("docs/supabase-sync-setup.sql", str(caught.exception))

    def test_push_uploads_before_claim_and_bumps_version(self):
        def handler(method, path, request):
            if path.startswith("/rest/v1/collections?select"):
                return (200, json_body([{"version": 1}]))
            if method == "POST" and "/storage/v1/object/" in path:
                self.assertIn("/uid-1/v2.zip", path)
                self.assertEqual(request.headers.get("X-upsert"), "true")
                return (200, b"{}")
            if method == "PATCH":
                self.assertIn("version=eq.1", path)
                return (200, json_body([{"version": 2}]))
            raise AssertionError(f"unexpected {method} {path}")

        client = self.make(handler)
        result = client.push(
            TOKEN, base_version=1, schema_version="0016",
            device_id="d", zip_bytes=b"Z"
        )

        self.assertEqual(result, {"version": 2})
        kinds = [
            "upload" if "/storage/" in path else method
            for method, path in client.calls
        ]
        self.assertLess(kinds.index("upload"), kinds.index("PATCH"))

    def test_push_conflict_on_stale_base_without_upload(self):
        client = self.make(
            lambda m, p, r: (200, json_body([{"version": 5}]))
        )

        with self.assertRaises(SyncClientConflict) as caught:
            client.push(
                TOKEN, base_version=4, schema_version="0016",
                device_id="d", zip_bytes=b"Z"
            )

        self.assertEqual(caught.exception.server_version, 5)
        self.assertFalse(
            any("/storage/" in path for _, path in client.calls)
        )

    def test_push_claim_race_cleans_orphan_and_conflicts(self):
        state = {"meta_reads": 0}

        def handler(method, path, request):
            if path.startswith("/rest/v1/collections?select"):
                state["meta_reads"] += 1
                version = 1 if state["meta_reads"] == 1 else 2
                return (200, json_body([{"version": version}]))
            if method == "POST" and "/storage/" in path:
                return (200, b"{}")
            if method == "PATCH":
                return (200, b"[]")  # guard matched nothing: lost the race
            if method == "DELETE":
                self.assertIn("/uid-1/v2.zip", path)
                return (200, b"{}")
            raise AssertionError(f"unexpected {method} {path}")

        client = self.make(handler)

        with self.assertRaises(SyncClientConflict) as caught:
            client.push(
                TOKEN, base_version=1, schema_version="0016",
                device_id="d", zip_bytes=b"Z"
            )

        self.assertEqual(caught.exception.server_version, 2)
        self.assertTrue(any(m == "DELETE" for m, _ in client.calls))

    def test_push_prunes_two_versions_back(self):
        def handler(method, path, request):
            if path.startswith("/rest/v1/collections?select"):
                return (200, json_body([{"version": 2}]))
            if method == "POST" and "/storage/" in path:
                return (200, b"{}")
            if method == "PATCH":
                return (200, json_body([{"version": 3}]))
            if method == "DELETE":
                self.assertIn("/uid-1/v1.zip", path)
                return (200, b"{}")
            raise AssertionError(f"unexpected {method} {path}")

        client = self.make(handler)
        client.push(
            TOKEN, base_version=2, schema_version="0016",
            device_id="d", zip_bytes=b"Z"
        )
        self.assertTrue(any(m == "DELETE" for m, _ in client.calls))

    def test_first_push_inserts_row(self):
        def handler(method, path, request):
            if path.startswith("/rest/v1/collections?select"):
                return (200, b"[]")
            if method == "POST" and "/storage/" in path:
                return (200, b"{}")
            if method == "POST" and path == "/rest/v1/collections":
                sent = json.loads(request.data.decode("utf-8"))
                self.assertEqual(sent["user_id"], "uid-1")
                self.assertEqual(sent["version"], 1)
                return (201, json_body([sent]))
            raise AssertionError(f"unexpected {method} {path}")

        result = self.make(handler).push(
            TOKEN, base_version=0, schema_version="0016",
            device_id="d", zip_bytes=b"Z"
        )
        self.assertEqual(result, {"version": 1})

    def test_expired_access_token_refreshes_rotates_and_retries(self):
        rotated = []
        state = {"attempts": 0}

        def handler(method, path, request):
            if path.startswith("/rest/v1/collections?select"):
                state["attempts"] += 1
                if state["attempts"] == 1:
                    return (401, json_body({"msg": "JWT expired"}))
                self.assertIn("Bearer at-2", request.headers.get("Authorization"))
                return (200, json_body([{"version": 4}]))
            if path.startswith("/auth/v1/token"):
                return (200, json_body({
                    "access_token": "at-2", "refresh_token": "rt-2"
                }))
            raise AssertionError(f"unexpected {method} {path}")

        client = FakeTransportClient(
            "https://proj.supabase.co", "k",
            handler=handler, on_tokens_updated=rotated.append
        )
        meta = client.get_meta(dict(TOKEN))

        self.assertEqual(meta["version"], 4)
        self.assertEqual(rotated[0]["refresh_token"], "rt-2")
        self.assertEqual(rotated[0]["access_token"], "at-2")

    def test_pull_downloads_current_version(self):
        def handler(method, path, request):
            if path.startswith("/rest/v1/collections?select"):
                return (200, json_body([
                    {"version": 3, "schema_version": "0016"}
                ]))
            if "/storage/" in path:
                self.assertIn("/uid-1/v3.zip", path)
                return (200, b"ZIPBYTES")
            raise AssertionError(f"unexpected {method} {path}")

        pulled = self.make(handler).pull(TOKEN)
        self.assertEqual(pulled["version"], 3)
        self.assertEqual(pulled["zip_bytes"], b"ZIPBYTES")

    def test_pull_empty_collection_returns_none(self):
        client = self.make(lambda m, p, r: (200, b"[]"))
        self.assertIsNone(client.pull(TOKEN))

    def test_meta_defaults_media_hashes_to_empty_list(self):
        client = self.make(lambda m, p, r: (200, b"[]"))
        meta = client.get_meta(TOKEN)
        self.assertEqual(meta["media_hashes"], [])

    def test_upload_media_blob_puts_object_with_upsert(self):
        def handler(method, path, request):
            self.assertEqual(method, "POST")
            self.assertIn("/uid-1/media/abc123", path)
            self.assertEqual(request.headers.get("X-upsert"), "true")
            self.assertEqual(request.data, b"bytes-here")
            return (200, b"{}")

        self.make(handler).upload_media_blob(TOKEN, "abc123", b"bytes-here")

    def test_download_media_blob_returns_bytes(self):
        def handler(method, path, request):
            self.assertIn("/uid-1/media/abc123", path)
            return (200, b"the-bytes")

        result = self.make(handler).download_media_blob(TOKEN, "abc123")
        self.assertEqual(result, b"the-bytes")

    def test_download_media_blob_missing_raises(self):
        client = self.make(lambda m, p, r: (404, b"{}"))
        with self.assertRaises(SyncClientError):
            client.download_media_blob(TOKEN, "missing")

    def test_push_claims_version_with_media_hashes_in_same_patch(self):
        def handler(method, path, request):
            if path.startswith("/rest/v1/collections?select"):
                return (200, json_body([{"version": 1, "media_hashes": []}]))
            if method == "POST" and "/storage/v1/object/" in path:
                return (200, b"{}")
            if method == "PATCH":
                sent = json.loads(request.data.decode("utf-8"))
                self.assertEqual(sent["media_hashes"], ["h1", "h2"])
                return (200, json_body([{"version": 2}]))
            raise AssertionError(f"unexpected {method} {path}")

        client = self.make(handler)
        result = client.push(
            TOKEN, base_version=1, schema_version="0016",
            device_id="d", zip_bytes=b"Z", media_hashes=["h1", "h2"]
        )
        self.assertEqual(result, {"version": 2})

    def test_delete_account_data_removes_zips_media_and_row(self):
        deleted_paths = []

        def handler(method, path, request):
            if path.startswith("/rest/v1/collections?select"):
                return (200, json_body([
                    {"version": 3, "media_hashes": ["h1", "h2"]}
                ]))
            if method == "DELETE" and "/storage/" in path:
                deleted_paths.append(path)
                return (200, b"{}")
            if method == "DELETE" and path.startswith("/rest/v1/collections?user_id"):
                return (200, b"{}")
            raise AssertionError(f"unexpected {method} {path}")

        self.make(handler).delete_account_data(TOKEN)

        joined = "|".join(deleted_paths)
        self.assertIn("/uid-1/v3.zip", joined)
        self.assertIn("/uid-1/v2.zip", joined)
        self.assertIn("/uid-1/media/h1", joined)
        self.assertIn("/uid-1/media/h2", joined)


if __name__ == "__main__":
    unittest.main()
