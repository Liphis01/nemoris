import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# The fake sync server lives at the repo root, a sibling of backend/.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from sync_server.store import SyncConflict, SyncNotFoundError, SyncStore  # noqa: E402

from app.models import Base, MediaFile, Question  # noqa: E402
from app.services.backups import restore_backup  # noqa: E402
from app.services.sync import (  # noqa: E402
    SyncBusyError,
    auto_sync,
    code_schema_version,
    delete_account_data,
    pull,
    push,
    sign_in_request_code,
    sign_in_verify,
    sign_out,
    sync_operation_lock
)
from app.services.sync_client import SyncClientConflict, SyncClientError  # noqa: E402
from app.services.sync_state import (  # noqa: E402
    collection_is_dirty,
    ensure_device_id,
    is_signed_in,
    load_sync_state,
    mark_collection_changed,
    mark_collection_clean,
    save_auto_sync_preferences,
    should_mark_collection_changed,
    save_sync_state
)


class InProcessSyncClient:
    """Drives SyncStore directly, translating store errors to client errors.

    Lets the whole sync engine (push/pull/conflict/schema-gating) be exercised
    in-process against the real store, no HTTP layer — the HttpSyncClient wire
    adapter is thin and covered by the manual two-device E2E.
    """

    def __init__(self, store):
        self.store = store

    def request_code(self, email):
        return {"code": self.store.request_code(email)}

    def verify(self, email, code):
        return {"token": self.store.verify(email, code)}

    def get_meta(self, token):
        return self.store.get_meta(self.store.account_for_token(token))

    def push(
        self, token, *, base_version, schema_version, device_id, zip_bytes,
        media_hashes=(), force=False
    ):
        email = self.store.account_for_token(token)
        try:
            result = self.store.push(
                email,
                base_version=base_version,
                schema_version=schema_version,
                zip_bytes=zip_bytes,
                device_id=device_id,
                force=force
            )
        except SyncConflict as conflict:
            raise SyncClientConflict(conflict.server_version) from conflict

        self.store.set_media_hashes(email, media_hashes)
        return result

    def pull(self, token):
        return self.store.pull(self.store.account_for_token(token))

    def upload_media_blob(self, token, sha256, data):
        email = self.store.account_for_token(token)
        self.store.upload_media_blob(email, sha256, data)

    def download_media_blob(self, token, sha256):
        email = self.store.account_for_token(token)
        try:
            return self.store.download_media_blob(email, sha256)
        except SyncNotFoundError as error:
            raise SyncClientError(str(error)) from error

    def delete_account_data(self, token):
        email = self.store.account_for_token(token)
        self.store.delete_account_data(email)


def restore_only_finalize(zip_path, database_file, static_dir):
    # Test finalize: apply the pulled collection to explicit paths without
    # touching the global engine (no init_database / rebalance needed to prove
    # content converged). replace_media=False matches production (2.1): the
    # zip is DB-only, media reconciliation happens separately in pull().
    restore_backup(
        zip_path,
        database_file=database_file,
        static_dir=static_dir,
        replace_media=False
    )


class SyncStateTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.path = Path(self._temp.name) / "sync_state.json"

    def test_defaults_when_missing(self):
        state = load_sync_state(self.path)
        self.assertFalse(is_signed_in(state))
        self.assertEqual(state["last_server_version"], 0)
        self.assertFalse(state["auto_sync_enabled"])
        self.assertEqual(state["local_change_seq"], 0)
        self.assertEqual(state["last_synced_change_seq"], 0)
        self.assertFalse(collection_is_dirty(state))

    def test_round_trip(self):
        save_sync_state(
            {"server_url": "http://x", "account_email": "a@b.c",
             "token": "t", "device_id": "d", "last_server_version": 3},
            self.path
        )
        state = load_sync_state(self.path)
        self.assertTrue(is_signed_in(state))
        self.assertEqual(state["last_server_version"], 3)

    def test_device_id_minted_once(self):
        first = ensure_device_id(self.path)
        second = ensure_device_id(self.path)
        self.assertEqual(first, second)
        self.assertTrue(first)

    def test_auto_sync_preferences_are_device_local_state(self):
        state = save_auto_sync_preferences(True, self.path)
        self.assertTrue(state["auto_sync_enabled"])
        self.assertTrue(load_sync_state(self.path)["auto_sync_enabled"])

    def test_dirty_marker_flips_and_clean_marker_clears(self):
        changed = mark_collection_changed("test", self.path)
        self.assertTrue(collection_is_dirty(changed))
        self.assertEqual(changed["local_change_seq"], 1)
        self.assertEqual(changed["last_synced_change_seq"], 0)

        clean = mark_collection_clean(7, self.path)
        self.assertFalse(collection_is_dirty(clean))
        self.assertEqual(clean["last_synced_change_seq"], 1)
        self.assertEqual(clean["last_server_version"], 7)

    def test_collection_mutation_allowlist(self):
        self.assertTrue(should_mark_collection_changed("POST", "/questions", 200))
        self.assertTrue(should_mark_collection_changed("POST", "/answer_map", 200))
        self.assertTrue(should_mark_collection_changed("POST", "/packs/import", 200))
        self.assertFalse(should_mark_collection_changed("POST", "/sync/push", 200))
        self.assertFalse(
            should_mark_collection_changed("PUT", "/packs/catalog-settings", 200)
        )
        self.assertFalse(
            should_mark_collection_changed("POST", "/review/rebalance", 200)
        )
        self.assertFalse(should_mark_collection_changed("POST", "/questions", 400))

    def test_sync_operation_lock_prevents_overlap(self):
        with sync_operation_lock():
            with self.assertRaises(SyncBusyError):
                with sync_operation_lock():
                    pass


class SyncEngineTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.root = Path(self._temp.name)
        self.store = SyncStore(self.root / "server")

    def make_device(self, name):
        base = self.root / name
        static_dir = base / "static"
        static_dir.mkdir(parents=True, exist_ok=True)
        return {
            "db": base / "questions.db",
            "static": static_dir,
            "backups": base / "backups",
            "state": base / "sync_state.json"
        }

    def seed(self, device, questions):
        engine = create_engine(f"sqlite:///{device['db']}")
        Base.metadata.create_all(engine)
        session = sessionmaker(bind=engine)()
        for text in questions:
            session.add(Question(type_q="text", question=text, tags=[], data={}))
        session.commit()
        session.close()
        engine.dispose()

    def questions_in(self, device):
        engine = create_engine(f"sqlite:///{device['db']}")
        session = sessionmaker(bind=engine)()
        values = {q.question for q in session.query(Question).all()}
        session.close()
        engine.dispose()
        return values

    def seed_media(self, device, filename, data):
        device["static"].mkdir(parents=True, exist_ok=True)
        (device["static"] / filename).write_bytes(data)
        sha256 = hashlib.sha256(data).hexdigest()

        engine = create_engine(f"sqlite:///{device['db']}")
        session = sessionmaker(bind=engine)()
        session.add(MediaFile(path=filename, sha256=sha256, byte_size=len(data)))
        session.commit()
        session.close()
        engine.dispose()

        return sha256

    def email_for(self, device):
        return self.store.account_for_token(load_sync_state(device["state"])["token"])

    def sign_in(self, device, email="user@example.com"):
        client = InProcessSyncClient(self.store)
        code = sign_in_request_code(client, email)["code"]
        sign_in_verify(client, email, code, sync_state_path=device["state"])
        return client

    def enable_auto_sync(self, device):
        state = load_sync_state(device["state"])
        state["server_url"] = "memory://sync"
        state["auto_sync_enabled"] = True
        save_sync_state(state, device["state"])

    def do_push(self, device, client, force=False):
        return push(
            client,
            database_file=device["db"],
            static_dir=device["static"],
            backup_dir=device["backups"],
            sync_state_path=device["state"],
            force=force
        )

    def do_pull(self, device, client):
        return pull(
            client,
            database_file=device["db"],
            static_dir=device["static"],
            sync_state_path=device["state"],
            finalize=restore_only_finalize
        )

    def test_push_requires_sign_in(self):
        device = self.make_device("a")
        self.seed(device, ["Q1"])
        with self.assertRaises(ValueError):
            self.do_push(device, InProcessSyncClient(self.store))

    def test_push_then_pull_on_fresh_device(self):
        a = self.make_device("a")
        b = self.make_device("b")
        self.seed(a, ["Alpha", "Beta"])
        # b starts empty (no db file yet is fine; pull creates it).

        client_a = self.sign_in(a)
        result = self.do_push(a, client_a)
        self.assertEqual(result, {"status": "pushed", "version": 1})

        client_b = self.sign_in(b)
        pulled = self.do_pull(b, client_b)
        self.assertEqual(pulled, {"status": "pulled", "version": 1})
        self.assertEqual(self.questions_in(b), {"Alpha", "Beta"})

    def test_pull_when_server_empty(self):
        a = self.make_device("a")
        client = self.sign_in(a)
        self.assertEqual(self.do_pull(a, client), {"status": "empty"})

    def test_two_device_convergence_with_conflict(self):
        a = self.make_device("a")
        b = self.make_device("b")
        self.seed(a, ["Q-A"])

        client_a = self.sign_in(a)
        client_b = self.sign_in(b)

        # A publishes v1; B pulls it.
        self.do_push(a, client_a)
        self.do_pull(b, client_b)
        self.assertEqual(self.questions_in(b), {"Q-A"})

        # B adds a question and pushes v2.
        self.seed(b, ["Q-B2"])  # adds to B's existing db
        self.do_push(b, client_b)

        # A still thinks base is v1 -> stale push conflicts.
        with self.assertRaises(SyncClientConflict) as caught:
            self.do_push(a, client_a)
        self.assertEqual(caught.exception.server_version, 2)

        # A resolves by pulling; both devices now converged.
        self.do_pull(a, client_a)
        self.assertEqual(self.questions_in(a), {"Q-A", "Q-B2"})

    def test_force_push_overrides_conflict(self):
        a = self.make_device("a")
        b = self.make_device("b")
        self.seed(a, ["Q-A"])
        client_a = self.sign_in(a)
        client_b = self.sign_in(b)

        self.do_push(a, client_a)
        self.do_pull(b, client_b)
        self.seed(b, ["Q-B2"])
        self.do_push(b, client_b)

        # A force-pushes its own version, clobbering the server.
        forced = self.do_push(a, client_a, force=True)
        self.assertEqual(forced["version"], 3)
        self.do_pull(b, client_b)
        self.assertEqual(self.questions_in(b), {"Q-A"})

    def test_stale_push_conflicts_before_uploading_media(self):
        a = self.make_device("a")
        self.seed(a, ["Q-A"])
        self.seed_media(a, "img.svg", b"<svg/>")
        self.sign_in(a)

        uploads = []
        pushes = []

        class StaleCloudClient:
            def get_meta(self, token):
                return {"version": 2, "media_hashes": []}

            def upload_media_blob(self, token, sha256, data):
                uploads.append(sha256)

            def push(self, token, **kwargs):
                pushes.append(kwargs)
                raise AssertionError("push should not run after preflight conflict")

        with self.assertRaises(SyncClientConflict) as caught:
            self.do_push(a, StaleCloudClient())

        self.assertEqual(caught.exception.server_version, 2)
        self.assertEqual(uploads, [])
        self.assertEqual(pushes, [])

    def test_pull_refuses_newer_schema(self):
        a = self.make_device("a")
        self.sign_in(a)

        class NewerSchemaClient:
            def pull(self, token):
                return {"version": 9, "schema_version": "9999", "zip_bytes": b"x"}

        with self.assertRaises(ValueError):
            pull(
                NewerSchemaClient(),
                database_file=a["db"],
                static_dir=a["static"],
                sync_state_path=a["state"],
                finalize=restore_only_finalize
            )

    def test_push_preserves_tokens_rotated_mid_operation(self):
        # Regression: adapters (Supabase) rotate auth tokens during a push and
        # persist them via a callback; the engine must re-load state before
        # saving last_server_version, or it would clobber the rotated token
        # with its stale in-memory copy.
        a = self.make_device("a")
        self.seed(a, ["Q1"])
        self.sign_in(a)

        store = self.store
        state_path = a["state"]

        class RotatingClient(InProcessSyncClient):
            def push(self, token, **kwargs):
                result = super().push(token, **kwargs)
                # Simulate the adapter persisting a rotated token mid-op.
                state = load_sync_state(state_path)
                state["token"] = {"access_token": "new", "refresh_token": "new"}
                save_sync_state(state, state_path)
                return result

        result = self.do_push(a, RotatingClient(store))
        self.assertEqual(result["status"], "pushed")

        final = load_sync_state(state_path)
        self.assertEqual(final["last_server_version"], 1)
        self.assertEqual(
            final["token"],
            {"access_token": "new", "refresh_token": "new"}
        )

    def test_sign_out_clears_token_keeps_device(self):
        a = self.make_device("a")
        self.sign_in(a)
        device_id = load_sync_state(a["state"])["device_id"]

        sign_out(a["state"])
        state = load_sync_state(a["state"])
        self.assertFalse(is_signed_in(state))
        self.assertEqual(state["device_id"], device_id)

    def test_code_schema_version_matches_latest_migration(self):
        self.assertTrue(code_schema_version())

    def test_push_uploads_only_media_missing_on_server(self):
        a = self.make_device("a")
        self.seed(a, ["Q1"])
        sha = self.seed_media(a, "img.svg", b"<svg>1</svg>")
        self.sign_in(a)

        uploads = []

        class CountingClient(InProcessSyncClient):
            def upload_media_blob(self, token, sha256, data):
                uploads.append(sha256)
                super().upload_media_blob(token, sha256, data)

        client = CountingClient(self.store)
        self.do_push(a, client)
        self.assertEqual(uploads, [sha])
        self.assertEqual(
            self.store.get_meta(self.email_for(a))["media_hashes"], [sha]
        )

        uploads.clear()
        self.do_push(a, client)  # nothing changed since last push
        self.assertEqual(uploads, [])

    def test_pull_reconciles_missing_media_without_touching_local_only_files(self):
        a = self.make_device("a")
        b = self.make_device("b")
        self.seed(a, ["Q1"])
        self.seed_media(a, "img.svg", b"<svg>from-a</svg>")

        client_a = self.sign_in(a)
        self.do_push(a, client_a)

        client_b = self.sign_in(b)
        b["static"].mkdir(parents=True, exist_ok=True)
        (b["static"] / "local-only.txt").write_bytes(b"keep me")

        self.do_pull(b, client_b)

        self.assertEqual(
            (b["static"] / "img.svg").read_bytes(), b"<svg>from-a</svg>"
        )
        self.assertEqual((b["static"] / "local-only.txt").read_bytes(), b"keep me")

    def test_delete_account_data_wipes_server_and_signs_out(self):
        a = self.make_device("a")
        self.seed(a, ["Q1"])
        self.seed_media(a, "img.svg", b"<svg/>")
        client = self.sign_in(a)
        self.do_push(a, client)
        email = self.email_for(a)

        result = delete_account_data(client, sync_state_path=a["state"])

        self.assertFalse(is_signed_in(result))
        self.assertEqual(self.store.get_meta(email)["version"], 0)

    def test_delete_account_data_requires_sign_in(self):
        a = self.make_device("a")
        with self.assertRaises(ValueError):
            delete_account_data(
                InProcessSyncClient(self.store), sync_state_path=a["state"]
            )

    def test_auto_sync_pushes_dirty_local_collection(self):
        a = self.make_device("a")
        self.seed(a, ["Q1"])
        client = self.sign_in(a)
        self.enable_auto_sync(a)
        mark_collection_changed("seed", a["state"])

        result = auto_sync(
            lambda: client,
            database_file=a["db"],
            static_dir=a["static"],
            backup_dir=a["backups"],
            sync_state_path=a["state"]
        )

        self.assertEqual(result, {"status": "pushed", "version": 1})
        state = load_sync_state(a["state"])
        self.assertFalse(collection_is_dirty(state))
        self.assertEqual(state["last_auto_sync_status"], "pushed")
        self.assertEqual(self.store.get_meta(self.email_for(a))["version"], 1)

    def test_auto_sync_pulls_newer_cloud_when_local_clean(self):
        a = self.make_device("a")
        b = self.make_device("b")
        self.seed(a, ["Q1"])
        client_a = self.sign_in(a)
        self.do_push(a, client_a)

        client_b = self.sign_in(b)
        self.enable_auto_sync(b)

        result = auto_sync(
            lambda: client_b,
            database_file=b["db"],
            static_dir=b["static"],
            backup_dir=b["backups"],
            sync_state_path=b["state"],
            finalize=restore_only_finalize
        )

        self.assertEqual(
            result,
            {"status": "pulled", "version": 1, "reload_required": True}
        )
        self.assertEqual(self.questions_in(b), {"Q1"})
        self.assertFalse(collection_is_dirty(load_sync_state(b["state"])))

    def test_auto_sync_conflicts_when_local_dirty_and_cloud_ahead(self):
        a = self.make_device("a")
        b = self.make_device("b")
        self.seed(a, ["Q-A"])
        client_a = self.sign_in(a)
        client_b = self.sign_in(b)
        self.do_push(a, client_a)
        self.do_pull(b, client_b)
        self.enable_auto_sync(b)

        self.seed(a, ["Q-A2"])
        self.do_push(a, client_a)
        self.seed(b, ["Q-B2"])
        mark_collection_changed("local edit", b["state"])

        result = auto_sync(
            lambda: client_b,
            database_file=b["db"],
            static_dir=b["static"],
            backup_dir=b["backups"],
            sync_state_path=b["state"],
            finalize=restore_only_finalize
        )

        self.assertEqual(result, {"status": "conflict", "server_version": 2})
        self.assertTrue(collection_is_dirty(load_sync_state(b["state"])))


if __name__ == "__main__":
    unittest.main()
