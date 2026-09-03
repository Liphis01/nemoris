import unittest
from unittest.mock import patch

from app.routers import sync as sync_router
from app.services.sync_client import SyncClientError


TOKEN = {"access_token": "at", "refresh_token": "rt", "user_id": "uid"}


def signed_in_state():
    return {
        "server_url": "https://project.supabase.co",
        "server_key": "sb_publishable_test",
        "account_email": "user@example.com",
        "token": dict(TOKEN),
        "last_server_version": 1,
        "auto_sync_enabled": True,
        "local_change_seq": 1,
        "last_synced_change_seq": 1,
        "last_auto_sync_at": "2026-08-21T10:00:00+00:00",
        "last_auto_sync_status": "skipped",
        "last_auto_sync_error": "Sync server unreachable",
    }


class FakeStatusClient:
    def __init__(self, *, meta=None, error=None):
        self.meta = meta
        self.error = error

    def get_meta(self, token):
        self.token = token

        if self.error:
            raise self.error

        return self.meta


class SyncStatusPayloadTests(unittest.TestCase):
    def test_signed_in_status_reports_current_reachability_and_compacts_meta(self):
        client = FakeStatusClient(
            meta={
                "version": 9,
                "schema_version": "0032",
                "updated_at": "now",
                "last_device_id": "device",
                "media_hashes": ["hash-a", "hash-b"],
            }
        )

        with patch.object(sync_router, "load_sync_state", return_value=signed_in_state()):
            with patch.object(sync_router, "_build_client", return_value=client):
                payload = sync_router._status_payload()

        self.assertTrue(payload["signed_in"])
        self.assertTrue(payload["server_reachable"])
        self.assertIsNone(payload["server_error"])
        self.assertEqual(
            payload["server_meta"],
            {
                "version": 9,
                "schema_version": "0032",
                "updated_at": "now",
                "last_device_id": "device",
            },
        )
        self.assertNotIn("media_hashes", payload["server_meta"])
        self.assertEqual(client.token, TOKEN)

    def test_signed_in_status_keeps_account_payload_when_server_probe_fails(self):
        client = FakeStatusClient(error=SyncClientError("Sync server unreachable"))

        with patch.object(sync_router, "load_sync_state", return_value=signed_in_state()):
            with patch.object(sync_router, "_build_client", return_value=client):
                payload = sync_router._status_payload()

        self.assertTrue(payload["signed_in"])
        self.assertFalse(payload["server_reachable"])
        self.assertEqual(payload["server_error"], "Sync server unreachable")
        self.assertIsNone(payload["server_meta"])


if __name__ == "__main__":
    unittest.main()
