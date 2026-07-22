import io
import json
import unittest
from unittest import mock
from urllib.error import HTTPError

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, PackSubscription
from app.routers.packs import (
    diagnose_pack_catalog,
    search_catalog_packs
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


if __name__ == "__main__":
    unittest.main()
