import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models import AppSetting, Base, MediaFile, Tombstone
from app.routers import uploads as uploads_router
from app.routers.meta import schema_version
from app.migrations import MIGRATIONS
from app.services.media import (
    delete_unreferenced_media_file,
    store_media_bytes
)
from app.services.settings import sync_settings_payload


SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
OTHER_SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>'


class MediaRegistryTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()
        self._temp = tempfile.TemporaryDirectory()
        self.static_dir = Path(self._temp.name)

    def tearDown(self):
        self.db.close()
        self._temp.cleanup()

    def store(self, data=SVG_BYTES, subdir=None):
        return store_media_bytes(
            data,
            filename="file.svg",
            static_dir=self.static_dir,
            storage_subdir=subdir,
            db=self.db
        )

    def test_store_registers_hash(self):
        result = self.store()

        expected = hashlib.sha256(SVG_BYTES).hexdigest()
        self.assertEqual(result["sha256"], expected)

        rows = self.db.query(MediaFile).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].sha256, expected)
        self.assertEqual(rows[0].byte_size, len(SVG_BYTES))
        self.assertTrue((self.static_dir / rows[0].path).exists())

    def test_duplicate_content_reuses_existing_file(self):
        first = self.store()
        second = self.store()

        self.assertEqual(second["url"], first["url"])
        self.assertTrue(second.get("deduplicated"))
        self.assertEqual(self.db.query(MediaFile).count(), 1)
        # One single file on disk.
        files = [p for p in self.static_dir.rglob("*") if p.is_file()]
        self.assertEqual(len(files), 1)

    def test_different_content_stores_separately(self):
        self.store()
        self.store(OTHER_SVG_BYTES)

        self.assertEqual(self.db.query(MediaFile).count(), 2)

    def test_delete_unregisters_and_tombstones(self):
        result = self.store()

        deleted = delete_unreferenced_media_file(
            self.db,
            result["url"],
            static_dir=self.static_dir
        )

        self.assertTrue(deleted)
        self.assertEqual(self.db.query(MediaFile).count(), 0)

        tombstones = [
            (row.entity_type, row.guid)
            for row in self.db.query(Tombstone).all()
        ]
        self.assertEqual(tombstones, [("media", result["sha256"])])

    def test_blob_endpoint_serves_by_hash(self):
        result = self.store()

        with patch.object(uploads_router, "STATIC_DIR", self.static_dir):
            response = uploads_router.get_media_blob(
                result["sha256"],
                self.db
            )
            self.assertTrue(str(response.path).startswith(str(self.static_dir)))

            with self.assertRaises(HTTPException) as caught:
                uploads_router.get_media_blob("0" * 64, self.db)

        self.assertEqual(caught.exception.status_code, 404)


class SettingsClassificationTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def test_sync_payload_excludes_device_settings(self):
        self.db.add_all([
            AppSetting(key="review", value={"catchup_daily_target": 40}),
            AppSetting(key="startup_rebalance_notice", value={"moved": 3}),
            AppSetting(key="fsrs_v6_migration", value={"done": True}),
            AppSetting(key="unknown_future_key", value={"x": 1})
        ])
        self.db.commit()

        payload = sync_settings_payload(self.db)

        self.assertEqual(payload, {"review": {"catchup_daily_target": 40}})


class SchemaVersionEndpointTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Session = sessionmaker(bind=engine)
        self.db = Session()
        self.db.execute(text(
            """
            CREATE TABLE schema_migrations (
                version TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            )
            """
        ))
        self.db.execute(text(
            "INSERT INTO schema_migrations VALUES ('0001', 'initial', 'now')"
        ))

    def tearDown(self):
        self.db.close()

    def test_reports_code_and_database_versions(self):
        payload = schema_version(self.db)

        self.assertEqual(payload["code_version"], MIGRATIONS[-1].version)
        self.assertEqual(payload["database_version"], "0001")
        self.assertEqual(payload["pending"], len(MIGRATIONS) - 1)


if __name__ == "__main__":
    unittest.main()
