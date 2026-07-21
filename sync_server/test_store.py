import tempfile
import unittest
from pathlib import Path

from sync_server.store import SyncAuthError, SyncConflict, SyncStore


class SyncStoreTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.store = SyncStore(Path(self._temp.name))

    def sign_in(self, email="a@b.c"):
        code = self.store.request_code(email)
        return self.store.verify(email, code)

    def test_auth_round_trip(self):
        token = self.sign_in()
        self.assertEqual(self.store.account_for_token(token), "a@b.c")

    def test_verify_rejects_bad_code(self):
        self.store.request_code("a@b.c")
        with self.assertRaises(SyncAuthError):
            self.store.verify("a@b.c", "000000")

    def test_unknown_token_rejected(self):
        with self.assertRaises(SyncAuthError):
            self.store.account_for_token("nope")

    def test_meta_empty_before_first_push(self):
        self.sign_in()
        self.assertEqual(
            self.store.get_meta("a@b.c"),
            {"version": 0, "schema_version": None, "updated_at": None}
        )

    def test_first_push_accepted_and_versioned(self):
        self.sign_in()
        result = self.store.push(
            "a@b.c",
            base_version=0,
            schema_version="0016",
            zip_bytes=b"ZIP-A",
            device_id="dev-1"
        )
        self.assertEqual(result, {"version": 1})

        meta = self.store.get_meta("a@b.c")
        self.assertEqual(meta["version"], 1)
        self.assertEqual(meta["schema_version"], "0016")
        self.assertEqual(meta["last_device_id"], "dev-1")

    def test_stale_push_conflicts(self):
        self.sign_in()
        self.store.push("a@b.c", base_version=0, schema_version="0016", zip_bytes=b"A")

        # A second device still thinks the base is 0 -> conflict on the now-v1.
        with self.assertRaises(SyncConflict) as caught:
            self.store.push("a@b.c", base_version=0, schema_version="0016", zip_bytes=b"B")

        self.assertEqual(caught.exception.server_version, 1)

    def test_force_push_overrides_conflict(self):
        self.sign_in()
        self.store.push("a@b.c", base_version=0, schema_version="0016", zip_bytes=b"A")
        result = self.store.push(
            "a@b.c", base_version=0, schema_version="0016", zip_bytes=b"B", force=True
        )
        self.assertEqual(result, {"version": 2})
        self.assertEqual(self.store.pull("a@b.c")["zip_bytes"], b"B")

    def test_pull_round_trip(self):
        self.sign_in()
        self.assertIsNone(self.store.pull("a@b.c"))

        self.store.push("a@b.c", base_version=0, schema_version="0016", zip_bytes=b"ZIP")
        pulled = self.store.pull("a@b.c")
        self.assertEqual(pulled["version"], 1)
        self.assertEqual(pulled["schema_version"], "0016")
        self.assertEqual(pulled["zip_bytes"], b"ZIP")

    def test_accounts_are_isolated(self):
        self.sign_in("a@b.c")
        self.sign_in("x@y.z")
        self.store.push("a@b.c", base_version=0, schema_version="0016", zip_bytes=b"A")

        self.assertIsNone(self.store.pull("x@y.z"))
        self.assertEqual(self.store.get_meta("x@y.z")["version"], 0)


if __name__ == "__main__":
    unittest.main()
