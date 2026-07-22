import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, PackSubscription, Question, QuestionGroup
from app.routers.packs import (
    diagnose_pack_catalog,
    search_catalog_packs
)
from app.services.pack_catalog import (
    get_pack_publish_status,
    publish_pack_publication,
    save_pack_publish_draft
)
from app.services.settings import save_pack_catalog_settings


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.headers = {}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class PackCatalogSearchTests(unittest.TestCase):
    def configure(self, db, key="sb_publishable_test"):
        save_pack_catalog_settings(
            db,
            "https://project.supabase.co/rest/v1",
            key
        )
        db.add(PackSubscription(
            pack_guid="world-map",
            installed_version=1,
            name="World",
            source="world.zip",
            subscribed_at="2026-07-22T10:00:00Z"
        ))
        db.commit()

    def test_search_posts_rpc_payload_and_normalizes_response(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "packs": [
                    {
                        "pack_guid": "world-map",
                        "name": "Pays du monde",
                        "description": "Carte interactive.",
                        "type_group": "map",
                        "question_count": 252,
                        "version": 2,
                        "size_bytes": 72420,
                        "license": "CC0",
                        "tags": ["pays"],
                        "themes": ["géographie"],
                        "download_count": 1200,
                        "featured": True,
                        "storage_path": "maps/world.zip"
                    }
                ],
                "facets": {
                    "themes": [
                        {
                            "value": "géographie",
                            "result_count": 4,
                            "download_count": 1200,
                            "pinned": True
                        }
                    ]
                },
                "total": 4,
                "next_cursor": "24"
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = search_catalog_packs(
                q="monde",
                theme="géographie",
                type="map",
                status="update_available",
                sort="récents",
                limit=99,
                cursor="24",
                db=db
            )

        self.assertEqual(result["total"], 4)
        self.assertEqual(result["next_cursor"], "24")
        self.assertEqual(
            result["packs"][0]["download_url"],
            "https://project.supabase.co/storage/v1/object/public/"
            "pack-zips/maps/world.zip"
        )
        self.assertEqual(result["facets"]["themes"][0]["value"], "__popular__")
        self.assertEqual(result["facets"]["themes"][1]["value"], "géographie")

        request, timeout = calls[0]
        self.assertEqual(timeout, 12)
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/search_pack_catalog"
        )
        self.assertEqual(request.headers.get("Apikey"), "sb_publishable_test")
        self.assertIsNone(request.headers.get("Authorization"))
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["p_query"], "monde")
        self.assertEqual(payload["p_theme"], "géographie")
        self.assertEqual(payload["p_type_group"], "map")
        self.assertEqual(payload["p_status"], "update_available")
        self.assertEqual(payload["p_sort"], "récents")
        self.assertEqual(payload["p_limit"], 60)
        self.assertEqual(payload["p_cursor"], 24)
        self.assertEqual(payload["p_installed_versions"], {"world-map": 1})

    def test_popular_theme_switches_to_popular_sort(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request)
            return FakeResponse({
                "packs": [],
                "facets": {"themes": []},
                "total": 0,
                "next_cursor": None
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            search_catalog_packs(
                theme="__popular__",
                sort="nom",
                db=db
            )

        payload = json.loads(calls[0].data.decode("utf-8"))
        self.assertEqual(payload["p_theme"], "")
        self.assertEqual(payload["p_sort"], "populaires")

    def test_legacy_anon_jwt_is_sent_as_bearer_token(self):
        db = make_db()
        legacy_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test"
        self.configure(db, key=legacy_key)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request)
            return FakeResponse({
                "packs": [],
                "facets": {"themes": []},
                "total": 0,
                "next_cursor": None
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            search_catalog_packs(db=db)

        self.assertEqual(calls[0].headers.get("Apikey"), legacy_key)
        self.assertEqual(
            calls[0].headers.get("Authorization"),
            f"Bearer {legacy_key}"
        )

    def test_missing_configuration_returns_http_error(self):
        db = make_db()

        with self.assertRaises(HTTPException) as context:
            search_catalog_packs(db=db)

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(
            context.exception.detail,
            "Catalogue Supabase non configuré."
        )

    def test_supabase_error_is_returned_as_catalogue_error(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            raise HTTPError(
                request.full_url,
                400,
                "Bad Request",
                {},
                io.BytesIO(b'{"message":"RPC failed"}')
            )

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            with self.assertRaises(HTTPException) as context:
                search_catalog_packs(db=db)

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "RPC failed")

    def test_catalog_diagnostics_reports_ready_catalogue(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))

            if request.full_url.endswith("/rpc/search_pack_catalog"):
                return FakeResponse({
                    "packs": [
                        {
                            "pack_guid": "world-map",
                            "name": "Pays du monde",
                            "description": "Carte interactive.",
                            "type_group": "map",
                            "question_count": 252,
                            "version": 2,
                            "storage_path": "maps/world.zip"
                        }
                    ],
                    "facets": {"themes": []},
                    "total": 1,
                    "next_cursor": None
                })

            return FakeResponse({})

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = diagnose_pack_catalog(db=db)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["key_type"], "publishable")
        self.assertEqual(result["total"], 1)
        self.assertEqual(
            [check["id"] for check in result["checks"]],
            ["project_url", "api_key", "search_rpc", "public_rows", "zip_files"]
        )
        self.assertEqual(
            result["sample_packs"][0]["download_status"],
            "ok"
        )
        self.assertEqual(calls[1][0].get_method(), "HEAD")

    def test_catalog_diagnostics_flags_storage_json_url(self):
        db = make_db()
        save_pack_catalog_settings(
            db,
            "https://project.supabase.co/storage/v1/object/public/"
            "packs/catalog.json",
            "sb_publishable_test"
        )
        db.commit()

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            result = diagnose_pack_catalog(db=db)

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["checks"][0]["id"], "project_url")
        self.assertEqual(result["checks"][0]["status"], "error")

    def test_catalog_diagnostics_flags_unreachable_zip(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            if request.full_url.endswith("/rpc/search_pack_catalog"):
                return FakeResponse({
                    "packs": [
                        {
                            "pack_guid": "world-map",
                            "name": "Pays du monde",
                            "description": "Carte interactive.",
                            "type_group": "map",
                            "question_count": 252,
                            "version": 2,
                            "storage_path": "maps/missing.zip"
                        }
                    ],
                    "facets": {"themes": []},
                    "total": 1,
                    "next_cursor": None
                })

            raise HTTPError(
                request.full_url,
                404,
                "Not Found",
                {},
                io.BytesIO(b"")
            )

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = diagnose_pack_catalog(db=db)

        self.assertEqual(result["status"], "error")
        self.assertEqual(
            result["sample_packs"][0]["download_status"],
            "error"
        )
        self.assertEqual(result["checks"][-1]["id"], "zip_files")

    def test_catalog_diagnostics_falls_back_to_range_get_for_zip_probe(self):
        db = make_db()
        self.configure(db)
        methods = []

        def fake_urlopen(request, timeout):
            methods.append(request.get_method())

            if request.full_url.endswith("/rpc/search_pack_catalog"):
                return FakeResponse({
                    "packs": [
                        {
                            "pack_guid": "world-map",
                            "name": "Pays du monde",
                            "description": "Carte interactive.",
                            "type_group": "map",
                            "question_count": 252,
                            "version": 2,
                            "storage_path": "maps/world.zip"
                        }
                    ],
                    "facets": {"themes": []},
                    "total": 1,
                    "next_cursor": None
                })

            if request.get_method() == "HEAD":
                raise HTTPError(
                    request.full_url,
                    405,
                    "Method Not Allowed",
                    {},
                    io.BytesIO(b"")
                )

            return FakeResponse({})

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = diagnose_pack_catalog(db=db)

        self.assertEqual(methods, ["POST", "HEAD", "GET"])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(
            result["sample_packs"][0]["download_status"],
            "ok"
        )


class PackCatalogPublishTests(unittest.TestCase):
    def configure(self, db):
        save_pack_catalog_settings(
            db,
            "https://project.supabase.co",
            "sb_publishable_test"
        )
        group = QuestionGroup(
            guid="group-guid",
            type_group="map",
            name="Capitales du monde"
        )
        db.add(group)
        db.flush()
        db.add(Question(
            guid="question-guid",
            type_q="map",
            question="France",
            answer="Paris",
            tags=["capitales", "europe"],
            group_id=group.id
        ))
        db.commit()

        return group.id

    def publish_state(self):
        return {
            "account_email": "author@example.com",
            "token": {
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "user_id": "user-123"
            }
        }

    def empty_sync_state(self):
        return {
            "server_url": "",
            "server_key": "",
            "account_email": None,
            "token": None
        }

    def sync_state(self):
        return {
            "server_url": "https://project.supabase.co/rest/v1",
            "server_key": "sb_publishable_test",
            "account_email": "sync@example.com",
            "token": {
                "access_token": "sync-access-token",
                "refresh_token": "sync-refresh-token",
                "user_id": "sync-user-123"
            }
        }

    def test_status_reuses_matching_sync_account(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value={"account_email": None, "token": None}
        ):
            result = get_pack_publish_status(db)

        self.assertTrue(result["signed_in"])
        self.assertEqual(result["account_email"], "sync@example.com")
        self.assertEqual(result["auth_source"], "sync")

    def test_save_draft_uploads_zip_and_upserts_private_catalog_row(self):
        db = make_db()
        group_id = self.configure(db)
        calls = []

        with tempfile.NamedTemporaryFile(suffix=".zip") as temp_zip:
            temp_zip.write(b"zip-bytes")
            temp_zip.flush()

            def fake_urlopen(request, timeout):
                calls.append((request, timeout))

                if "/storage/v1/object/pack-zips/" in request.full_url:
                    return FakeResponse({})

                return FakeResponse({
                    "pack_guid": "group-guid",
                    "name": "Atlas des capitales",
                    "description": "Cartes de capitales.",
                    "type_group": "map",
                    "question_count": 1,
                    "version": 2,
                    "size_bytes": 9,
                    "license": "CC0",
                    "tags": ["capitales"],
                    "themes": ["géographie"],
                    "storage_path": (
                        "user-123/group-guid/v2-atlas-des-capitales.zip"
                    ),
                    "is_public": False,
                    "publication_status": "draft"
                })

            with mock.patch(
                "app.services.pack_catalog.load_sync_state",
                return_value=self.empty_sync_state()
            ), mock.patch(
                "app.services.pack_catalog.load_pack_publish_state",
                return_value=self.publish_state()
            ), mock.patch(
                "app.services.pack_catalog.export_pack",
                return_value=Path(temp_zip.name)
            ), mock.patch(
                "app.services.pack_catalog.urlopen",
                fake_urlopen
            ):
                result = save_pack_publish_draft(
                    db,
                    group_id,
                    version=2,
                    name="Atlas des capitales",
                    description="Cartes de capitales.",
                    license="CC0",
                    tags=["capitales"],
                    themes=["géographie"]
                )

        self.assertEqual(result["status"], "draft")
        self.assertFalse(result["publication"]["is_public"])

        storage_request, storage_timeout = calls[0]
        self.assertEqual(storage_timeout, 60)
        self.assertEqual(storage_request.get_method(), "POST")
        self.assertEqual(storage_request.data, b"zip-bytes")
        self.assertEqual(
            storage_request.headers.get("Authorization"),
            "Bearer access-token"
        )
        self.assertIn(
            "/storage/v1/object/pack-zips/user-123/group-guid/"
            "v2-atlas-des-capitales.zip",
            storage_request.full_url
        )

        rpc_request, rpc_timeout = calls[1]
        self.assertEqual(rpc_timeout, 12)
        self.assertEqual(
            rpc_request.full_url,
            "https://project.supabase.co/rest/v1/rpc/upsert_my_pack_draft"
        )
        payload = json.loads(rpc_request.data.decode("utf-8"))
        self.assertEqual(payload["p_pack_guid"], "group-guid")
        self.assertEqual(payload["p_question_count"], 1)
        self.assertEqual(payload["p_version"], 2)
        self.assertEqual(payload["p_size_bytes"], 9)
        self.assertEqual(payload["p_tags"], ["capitales"])
        self.assertEqual(payload["p_themes"], ["géographie"])

    def test_publish_calls_authenticated_publish_rpc(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "pack_guid": "group-guid",
                "name": "Atlas des capitales",
                "version": 2,
                "question_count": 1,
                "storage_path": "user-123/group-guid/v2-atlas.zip",
                "is_public": True,
                "publication_status": "published"
            })

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.publish_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = publish_pack_publication(db, "group-guid")

        self.assertEqual(result["status"], "published")
        self.assertTrue(result["publication"]["is_public"])
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/publish_my_pack"
        )
        self.assertEqual(
            request.headers.get("Authorization"),
            "Bearer access-token"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_pack_guid": "group-guid"}
        )

    def test_publish_uses_matching_sync_token_before_catalog_token(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "pack_guid": "group-guid",
                "name": "Atlas des capitales",
                "version": 2,
                "question_count": 1,
                "storage_path": "sync-user-123/group-guid/v2-atlas.zip",
                "is_public": True,
                "publication_status": "published"
            })

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.publish_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            publish_pack_publication(db, "group-guid")

        self.assertEqual(
            calls[0][0].headers.get("Authorization"),
            "Bearer sync-access-token"
        )


if __name__ == "__main__":
    unittest.main()
