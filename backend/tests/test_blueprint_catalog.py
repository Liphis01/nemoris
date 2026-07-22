import io
import json
import unittest
from urllib.error import HTTPError

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, BlueprintSubscription
from app.routers.blueprints import search_catalog_blueprints
from app.services.settings import save_blueprint_catalog_settings


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class BlueprintCatalogSearchTests(unittest.TestCase):
    def configure(self, db):
        save_blueprint_catalog_settings(
            db,
            "https://project.supabase.co/rest/v1",
            "sb_publishable_test"
        )
        db.add(BlueprintSubscription(
            blueprint_guid="world-map",
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
                "blueprints": [
                    {
                        "blueprint_guid": "world-map",
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

        with unittest.mock.patch(
            "app.services.blueprint_catalog.urlopen",
            fake_urlopen
        ):
            result = search_catalog_blueprints(
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
            result["blueprints"][0]["download_url"],
            "https://project.supabase.co/storage/v1/object/public/"
            "blueprint-zips/maps/world.zip"
        )
        self.assertEqual(result["facets"]["themes"][0]["value"], "__popular__")
        self.assertEqual(result["facets"]["themes"][1]["value"], "géographie")

        request, timeout = calls[0]
        self.assertEqual(timeout, 12)
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/search_blueprint_catalog"
        )
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
                "blueprints": [],
                "facets": {"themes": []},
                "total": 0,
                "next_cursor": None
            })

        with unittest.mock.patch(
            "app.services.blueprint_catalog.urlopen",
            fake_urlopen
        ):
            search_catalog_blueprints(
                theme="__popular__",
                sort="nom",
                db=db
            )

        payload = json.loads(calls[0].data.decode("utf-8"))
        self.assertEqual(payload["p_theme"], "")
        self.assertEqual(payload["p_sort"], "populaires")

    def test_missing_configuration_returns_http_error(self):
        db = make_db()

        with self.assertRaises(HTTPException) as context:
            search_catalog_blueprints(db=db)

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

        with unittest.mock.patch(
            "app.services.blueprint_catalog.urlopen",
            fake_urlopen
        ):
            with self.assertRaises(HTTPException) as context:
                search_catalog_blueprints(db=db)

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "RPC failed")


if __name__ == "__main__":
    unittest.main()
