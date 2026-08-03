import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import sync_state  # noqa: E402
from app.services.sync_state import load_sync_state, save_sync_state  # noqa: E402


class FakeKeyringBackend:
    """In-memory stand-in for the `keyring` module's get/set/delete API."""

    def __init__(self):
        self.store = {}

    def get_password(self, service, key):
        return self.store.get((service, key))

    def set_password(self, service, key, value):
        self.store[(service, key)] = value

    def delete_password(self, service, key):
        self.store.pop((service, key), None)


class SyncStateTokenStorageTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.path = Path(self._temp.name) / "sync_state.json"

        self._original_backend = sync_state._keyring_backend
        self.addCleanup(self._restore_backend)

    def _restore_backend(self):
        sync_state._keyring_backend = self._original_backend

    def use_fake_backend(self):
        backend = FakeKeyringBackend()
        sync_state._keyring_backend = backend

        return backend

    # --- no backend available (this project's own dev/CI environment) ------

    def test_no_backend_round_trips_token_through_plaintext_file(self):
        sync_state._keyring_backend = None

        state = load_sync_state(self.path)
        state["account_email"] = "user@example.com"
        state["token"] = {"access_token": "a", "refresh_token": "b"}
        save_sync_state(state, self.path)

        reloaded = load_sync_state(self.path)
        self.assertEqual(
            reloaded["token"], {"access_token": "a", "refresh_token": "b"}
        )

        raw = self.path.read_text(encoding="utf-8")
        self.assertIn("access_token", raw)

    # --- fake backend available ---------------------------------------------

    def test_backend_available_keeps_token_out_of_json_file(self):
        self.use_fake_backend()

        state = load_sync_state(self.path)
        state["account_email"] = "user@example.com"
        state["token"] = {"access_token": "a", "refresh_token": "b"}
        save_sync_state(state, self.path)

        raw = self.path.read_text(encoding="utf-8")
        self.assertNotIn("access_token", raw)

        reloaded = load_sync_state(self.path)
        self.assertEqual(
            reloaded["token"], {"access_token": "a", "refresh_token": "b"}
        )
        self.assertEqual(reloaded["account_email"], "user@example.com")

    def test_sign_out_deletes_stored_credential(self):
        backend = self.use_fake_backend()

        state = load_sync_state(self.path)
        state["token"] = {"access_token": "a", "refresh_token": "b"}
        save_sync_state(state, self.path)
        self.assertTrue(backend.store)

        state = load_sync_state(self.path)
        state["token"] = None
        save_sync_state(state, self.path)

        self.assertFalse(backend.store)
        self.assertIsNone(load_sync_state(self.path)["token"])

    def test_distinct_paths_do_not_share_a_keyring_entry(self):
        self.use_fake_backend()
        other_path = Path(self._temp.name) / "other" / "sync_state.json"

        state_a = load_sync_state(self.path)
        state_a["token"] = {"access_token": "a"}
        save_sync_state(state_a, self.path)

        state_b = load_sync_state(other_path)
        state_b["token"] = {"access_token": "b"}
        save_sync_state(state_b, other_path)

        self.assertEqual(
            load_sync_state(self.path)["token"], {"access_token": "a"}
        )
        self.assertEqual(
            load_sync_state(other_path)["token"], {"access_token": "b"}
        )

    # --- backward compatibility ----------------------------------------------

    def test_old_style_plaintext_token_file_still_loads_with_backend_available(
        self
    ):
        # Simulates an existing install's sync_state.json from before this
        # change, written back when no keychain entry exists yet for it.
        self.use_fake_backend()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            '{"account_email": "user@example.com", '
            '"token": {"access_token": "legacy"}}',
            encoding="utf-8"
        )

        state = load_sync_state(self.path)
        self.assertEqual(state["token"], {"access_token": "legacy"})

        # The next save migrates it into the keychain and off disk.
        save_sync_state(state, self.path)
        raw = self.path.read_text(encoding="utf-8")
        self.assertNotIn("legacy", raw)
        self.assertEqual(
            load_sync_state(self.path)["token"], {"access_token": "legacy"}
        )


if __name__ == "__main__":
    unittest.main()
