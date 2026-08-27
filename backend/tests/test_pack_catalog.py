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

from app.models import (
    Base,
    Collection,
    PackSubscription,
    Question,
    QuestionGroup
)
from app.routers.packs import (
    add_pack_comment_route,
    apply_pack_suggested_edit_route,
    backfill_pack_installs_route,
    delete_group_pack_publication,
    diagnose_pack_catalog,
    pack_catalog_activity,
    pack_catalog_family,
    pack_comments,
    pack_my_status,
    pack_suggested_edit_targets,
    pack_suggested_edits,
    pack_variant_source,
    preview_catalog_pack,
    rate_pack_route,
    read_pack_catalog_activity,
    record_pack_install_route,
    resolve_pack_suggested_edit_route,
    search_catalog_packs,
    submit_pack_suggested_edit_route,
    unpublish_group_pack
)
from app.schemas import (
    PackActivityReadRequest,
    PackCommentCreateRequest,
    PackInstallRecordRequest,
    PackRatingRequest,
    PackSuggestedEditCreateRequest,
    PackSuggestedEditResolveRequest
)
from app.services.pack_catalog import (
    PUBLISH_OTP_TIMEOUT,
    PUBLISH_TIMEOUT,
    PackCatalogError,
    PackCatalogTimeout,
    _annotate_publication_sources,
    request_pack_publish_code,
    fetch_pack_preview,
    get_group_pack_publication,
    get_pack_publish_status,
    list_pack_publications,
    publish_group_pack_changes,
    preview_pack_release,
    publish_pack_publication,
    save_pack_publish_draft
)
from app.services.packs import export_pack
from app.services.tag_hierarchy import apply_tag_actions, load_tag_hierarchy
from app.services import settings as settings_module


def use_catalog(
    test,
    url="https://project.supabase.co/rest/v1",
    key="sb_publishable_test"
):
    """Point the bundled catalogue at a fake project for one test.

    The catalogue project ships in config (config.CLOUD_URL/CLOUD_KEY) rather
    than being stored per device, so tests swap the constants instead of
    writing a settings row.
    """
    for name, value in (("CLOUD_URL", url), ("CLOUD_KEY", key)):
        patcher = mock.patch.object(settings_module, name, value)
        patcher.start()
        test.addCleanup(patcher.stop)


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

    def read(self, size=None):
        raw = (
            self.payload
            if isinstance(self.payload, bytes)
            else json.dumps(self.payload).encode("utf-8")
        )

        return raw if size is None else raw[:size]


class PackCatalogSchemaSqlTests(unittest.TestCase):
    def test_supabase_schema_repairs_pack_catalog_permission_paths(self):
        sql_path = (
            Path(__file__).resolve().parents[2]
            / "docs"
            / "supabase-pack-catalog-schema.sql"
        )
        sql = sql_path.read_text(encoding="utf-8")

        self.assertIn(
            "alter table public.pack_catalog enable row level security;",
            sql
        )
        self.assertIn(
            "grant select on public.pack_catalog to anon, authenticated;",
            sql
        )
        self.assertIn("create policy pack_catalog_select_public", sql)
        self.assertIn("create policy pack_catalog_select_own", sql)
        self.assertIn(
            "alter function public.pack_catalog_refresh_rating_stats()\n"
            "  security definer;",
            sql
        )
        self.assertIn(
            "alter function public.pack_catalog_refresh_comment_stats()\n"
            "  security definer;",
            sql
        )
        self.assertIn(
            "security definer\n set search_path to 'public'\nas $function$",
            sql
        )
        self.assertIn(
            "grant execute on function public.search_pack_catalog",
            sql
        )

    def test_supabase_schema_adds_pack_variant_lineage_and_activity(self):
        sql_path = (
            Path(__file__).resolve().parents[2]
            / "docs"
            / "supabase-pack-catalog-schema.sql"
        )
        sql = sql_path.read_text(encoding="utf-8")

        self.assertIn("add column if not exists variant_of_pack_guid text", sql)
        self.assertIn("add column if not exists root_pack_guid text", sql)
        self.assertIn("pack_catalog_variant_of_pack_guid_idx", sql)
        self.assertIn("pack_catalog_root_pack_guid_idx", sql)
        self.assertIn("create table if not exists public.pack_activity_events", sql)
        self.assertIn("pack_activity_events_select_own", sql)
        self.assertIn("p_variant_of_pack_guid text default null::text", sql)
        self.assertIn("Installe ce pack avant de publier une variante.", sql)
        self.assertIn("create or replace function public.get_pack_family", sql)
        self.assertIn("create or replace function public.list_pack_activity_events", sql)
        self.assertIn("create or replace function public.mark_pack_activity_events_read", sql)
        self.assertIn("'variant_published'", sql)

    def test_supabase_schema_adds_pack_suggested_edits(self):
        sql_path = (
            Path(__file__).resolve().parents[2]
            / "docs"
            / "supabase-pack-catalog-schema.sql"
        )
        sql = sql_path.read_text(encoding="utf-8")

        self.assertIn("create table if not exists public.pack_suggested_edits", sql)
        self.assertIn("pack_suggested_edits_insert_own_if_installed", sql)
        self.assertIn("pack_suggested_edits_owner_resolve", sql)
        self.assertIn("create or replace function public.submit_pack_suggested_edit", sql)
        self.assertIn("create or replace function public.list_pack_suggested_edits", sql)
        self.assertIn("create or replace function public.resolve_pack_suggested_edit", sql)
        self.assertIn("applied_at timestamptz", sql)
        self.assertIn("create or replace function public.mark_pack_suggested_edit_applied", sql)
        self.assertIn("'suggested_edit_created'", sql)


class PackCatalogSearchTests(unittest.TestCase):
    def configure(self, db, key="sb_publishable_test"):
        use_catalog(self, key=key)
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
                    "global_total": 18,
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
        self.assertFalse(result["packs"][0]["is_mine"])
        self.assertEqual(
            result["packs"][0]["local_status"],
            {
                "status": "update_available",
                "is_mine": False,
                "has_local_content": True,
                "installed_version": 1,
                "local_pack_version": None,
                "local_group_id": None,
                "local_group_name": None
            }
        )
        self.assertEqual(result["facets"]["themes"][0]["value"], "__popular__")
        self.assertEqual(result["facets"]["themes"][0]["result_count"], 18)
        self.assertEqual(result["facets"]["global_total"], 18)
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

    def test_search_orders_themes_by_global_popularity(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            return FakeResponse({
                "packs": [],
                "facets": {
                    "global_total": 80,
                    "themes": [
                        {
                            "value": "maths",
                            "result_count": 50,
                            "download_count": 10,
                            "pinned": True
                        },
                        {
                            "value": "histoire",
                            "result_count": 3,
                            "download_count": 900,
                            "featured": True
                        },
                        {
                            "value": "géographie",
                            "result_count": 4,
                            "download_count": 900
                        }
                    ]
                },
                "total": 2,
                "next_cursor": None
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = search_catalog_packs(q="atlas", db=db)

        self.assertEqual(result["total"], 2)
        self.assertEqual(result["facets"]["themes"][0]["value"], "__popular__")
        self.assertEqual(result["facets"]["themes"][0]["result_count"], 80)
        self.assertEqual(
            [theme["value"] for theme in result["facets"]["themes"][1:]],
            ["géographie", "histoire", "maths"]
        )

    def test_search_merges_accent_and_case_theme_variants(self):
        # Two authors' local tag_hierarchy can each carry a differently
        # accented/cased label for the same core root, so the catalog can
        # legitimately hold both "Geographie" and "géographie" across
        # different packs. The sidebar must show one merged tile, not two,
        # with the counts summed so its number matches the packs that
        # filtering by it returns.
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            return FakeResponse({
                "packs": [],
                "facets": {
                    "global_total": 7,
                    "themes": [
                        {
                            "value": "Geographie",
                            "result_count": 3,
                            "download_count": 50
                        },
                        {
                            "value": "géographie",
                            "result_count": 4,
                            "download_count": 900,
                            "featured": True
                        }
                    ]
                },
                "total": 7,
                "next_cursor": None
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = search_catalog_packs(q="atlas", db=db)

        themes = result["facets"]["themes"][1:]
        self.assertEqual(len(themes), 1)
        self.assertEqual(themes[0]["label"], "Géographie")
        self.assertEqual(themes[0]["result_count"], 7)
        self.assertEqual(themes[0]["download_count"], 950)
        self.assertTrue(themes[0]["featured"])

    def test_search_dedupes_and_canonicalizes_pack_theme_list(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            return FakeResponse({
                "packs": [{
                    "pack_guid": "world-map",
                    "name": "Pays du monde",
                    "type_group": "map",
                    "question_count": 120,
                    "themes": ["geographie", "Géographie", "Histoire"]
                }],
                "facets": {"themes": []},
                "total": 1,
                "next_cursor": None
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = search_catalog_packs(q="monde", db=db)

        entry = result["packs"][0]
        self.assertEqual(entry["themes"], ["Géographie", "Histoire"])
        # Flat heuristic shared with the intake pace-tier estimate
        # (settings.INTAKE_SECONDS_PER_QUESTION): 120 * 15s / 60 = 30.
        self.assertEqual(entry["estimated_minutes"], 30)

    def test_search_normalizes_grouped_family_metadata(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            return FakeResponse({
                "packs": [{
                    "pack_guid": "variant-pack",
                    "name": "Pays du monde corrigé",
                    "type_group": "map",
                    "question_count": 253,
                    "version": 1,
                    "storage_path": "variants/world.zip",
                    "variant_of_pack_guid": "world-map",
                    "root_pack_guid": "world-map",
                    "original_pack_guid": "world-map",
                    "recommended_pack_guid": "variant-pack",
                    "original_name": "Pays du monde",
                    "variant_count": 3,
                    "avg_rating": 4.8,
                    "rating_count": 12
                }],
                "facets": {"themes": []},
                "total": 1,
                "next_cursor": None
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = search_catalog_packs(db=db)

        entry = result["packs"][0]
        self.assertEqual(entry["variant_of_pack_guid"], "world-map")
        self.assertEqual(entry["root_pack_guid"], "world-map")
        self.assertEqual(entry["original_pack_guid"], "world-map")
        self.assertEqual(entry["recommended_pack_guid"], "variant-pack")
        self.assertEqual(entry["original_name"], "Pays du monde")
        self.assertEqual(entry["variant_count"], 3)
        self.assertTrue(entry["is_recommended_variant"])

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

    def test_search_marks_local_authored_pack_as_mine_and_local_copy(self):
        db = make_db()
        self.configure(db)
        db.add(QuestionGroup(
            guid="my-pack",
            type_group="text",
            name="Mon pack local"
        ))
        db.commit()
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request)
            return FakeResponse({
                "packs": [
                    {
                        "pack_guid": "world-map",
                        "name": "Pays du monde",
                        "version": 2,
                        "storage_path": "maps/world.zip"
                    },
                    {
                        "pack_guid": "my-pack",
                        "name": "Mon pack publié",
                        "version": 3,
                        "storage_path": "mine.zip"
                    },
                    {
                        "pack_guid": "other-pack",
                        "name": "Autre pack",
                        "version": 1,
                        "storage_path": "other.zip"
                    }
                ],
                "facets": {"themes": []},
                "total": 3,
                "next_cursor": None
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = search_catalog_packs(status="local_copy", db=db)

        self.assertEqual([entry["pack_guid"] for entry in result["packs"]], [
            "my-pack"
        ])
        self.assertEqual(result["total"], 1)
        self.assertIsNone(result["next_cursor"])
        self.assertTrue(result["packs"][0]["is_mine"])
        self.assertEqual(
            result["packs"][0]["local_status"],
            {
                "status": "local_copy",
                "is_mine": True,
                "has_local_content": True,
                "installed_version": None,
                "local_pack_version": None,
                "local_group_id": 1,
                "local_group_name": "Mon pack local"
            }
        )
        payload = json.loads(calls[0].data.decode("utf-8"))
        self.assertEqual(payload["p_status"], "all")

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
        # Only reachable when a self-hoster blanks NEMORIS_SUPABASE_URL/_KEY:
        # the shipped build always has a catalogue project.
        db = make_db()
        use_catalog(self, url="", key="")

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
        use_catalog(
            self,
            url="https://project.supabase.co/storage/v1/object/public/"
                "packs/catalog.json"
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

    def test_search_normalizes_rating_and_comment_counts(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            return FakeResponse({
                "packs": [
                    {
                        "pack_guid": "world-map",
                        "name": "Pays du monde",
                        "storage_path": "maps/world.zip",
                        "avg_rating": 4.75,
                        "rating_count": 8,
                        "comment_count": 3
                    }
                ],
                "facets": {"themes": []},
                "total": 1,
                "next_cursor": None
            })

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = search_catalog_packs(db=db)

        self.assertEqual(result["packs"][0]["avg_rating"], 4.75)
        self.assertEqual(result["packs"][0]["rating_count"], 8)
        self.assertEqual(result["packs"][0]["comment_count"], 3)

    def test_search_forwards_note_sort_unchanged(self):
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
            search_catalog_packs(sort="note", db=db)

        payload = json.loads(calls[0].data.decode("utf-8"))
        self.assertEqual(payload["p_sort"], "note")


class PackCatalogAuthTestCase(unittest.TestCase):
    """Shared fixtures for tests that need an authenticated catalog
    session -- reused by publish, unpublish, install-tracking, rating and
    comment tests alike."""

    def configure(self, db):
        use_catalog(self, url="https://project.supabase.co")
        current = load_tag_hierarchy(db)
        apply_tag_actions(db, current["revision"], [
            {
                "type": "create",
                "tag_id": "11111111-1111-4111-8111-111111111111",
                "label": "Capitales",
                "parent_ids": ["core:geography"]
            },
            {
                "type": "create",
                "tag_id": "22222222-2222-4222-8222-222222222222",
                "label": "Europe",
                "parent_ids": ["core:geography"]
            }
        ])
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
            tags=[
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222"
            ],
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

    def signed_out_state(self):
        return {"account_email": None, "token": None}


class PackPublishSignInTests(PackCatalogAuthTestCase):
    """Sending the sign-in e-mail is slow by nature (Supabase answers only
    once the mail is handed off), so it must not be read as a dead server."""

    def request_code(self, fake_urlopen):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.urlopen", fake_urlopen
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ):
            return request_pack_publish_code(db, "author@example.com")

    def test_send_gets_a_longer_budget_than_other_catalog_calls(self):
        seen = []

        def fake_urlopen(request, timeout):
            seen.append(timeout)
            return FakeResponse({})

        self.request_code(fake_urlopen)

        self.assertEqual(seen, [PUBLISH_OTP_TIMEOUT])
        self.assertGreater(PUBLISH_OTP_TIMEOUT, PUBLISH_TIMEOUT)

    def test_slow_send_is_reported_as_slow_not_as_inaccessible(self):
        def fake_urlopen(request, timeout):
            raise TimeoutError("timed out")

        with self.assertRaises(PackCatalogTimeout) as caught:
            self.request_code(fake_urlopen)

        self.assertIn("trop de temps", str(caught.exception))

    def test_real_rejection_still_fails(self):
        def fake_urlopen(request, timeout):
            raise HTTPError(
                request.full_url, 422, "error", {},
                io.BytesIO(json.dumps(
                    {"msg": "Signups not allowed for otp"}
                ).encode("utf-8"))
            )

        with self.assertRaises(PackCatalogError):
            self.request_code(fake_urlopen)


class PackCatalogPublishTests(PackCatalogAuthTestCase):
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

                if "/rest/v1/pack_catalog?select=" in request.full_url:
                    return FakeResponse([])

                if "/storage/v1/object/pack-zips/" in request.full_url:
                    return FakeResponse({})

                return FakeResponse({
                    "pack_guid": "group-guid",
                    "name": "États et géographie",
                    "description": "Cartes de capitales françaises.",
                    "type_group": "map",
                    "question_count": 1,
                    "version": 2,
                    "size_bytes": 9,
                    "license": "CC0",
                    "tags": ["capitales"],
                    "themes": ["géographie"],
                    "storage_path": (
                        "user-123/group-guid/v2-états-et-géographie.zip"
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
                    name="États et géographie",
                    description="Cartes de capitales françaises.",
                    license="CC0",
                    tags=["capitales"],
                    themes=["géographie"]
                )

        self.assertEqual(result["status"], "draft")
        self.assertFalse(result["publication"]["is_public"])

        lookup_request, lookup_timeout = calls[0]
        self.assertEqual(lookup_timeout, 12)
        self.assertIn("/rest/v1/pack_catalog?select=", lookup_request.full_url)

        storage_request, storage_timeout = calls[1]
        self.assertEqual(storage_timeout, 60)
        self.assertEqual(storage_request.get_method(), "POST")
        self.assertEqual(storage_request.data, b"zip-bytes")
        self.assertEqual(
            storage_request.headers.get("Authorization"),
            "Bearer access-token"
        )
        self.assertIn(
            "/storage/v1/object/pack-zips/user-123/group-guid/"
            "v2-%C3%A9tats-et-g%C3%A9ographie.zip",
            storage_request.full_url
        )

        rpc_request, rpc_timeout = calls[2]
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
        self.assertEqual(payload["p_name"], "États et géographie")
        self.assertEqual(
            payload["p_description"],
            "Cartes de capitales françaises."
        )
        self.assertEqual(payload["p_tags"], ["capitales"])
        self.assertEqual(payload["p_themes"], ["Géographie"])

    def test_list_publications_retries_without_lineage_on_old_schema(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))

            if "variant_of_pack_guid" in request.full_url:
                raise HTTPError(
                    request.full_url,
                    400,
                    "Bad Request",
                    {},
                    io.BytesIO(
                        b'{"message":"column pack_catalog.variant_of_pack_guid '
                        b'does not exist"}'
                    )
                )

            return FakeResponse([{
                "pack_guid": "group-guid",
                "name": "Atlas des capitales",
                "description": "Cartes de capitales.",
                "type_group": "map",
                "question_count": 1,
                "version": 2,
                "storage_path": "user-123/group-guid/v2-atlas.zip",
                "is_public": True,
                "publication_status": "published"
            }])

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
            result = list_pack_publications(db)

        self.assertEqual(len(calls), 2)
        self.assertIn("variant_of_pack_guid", calls[0][0].full_url)
        self.assertNotIn("variant_of_pack_guid", calls[1][0].full_url)
        self.assertEqual(result["publications"][0]["pack_guid"], "group-guid")
        self.assertIsNone(result["publications"][0]["variant_of_pack_guid"])

    def test_save_draft_retries_legacy_upsert_signature_for_normal_pack(self):
        db = make_db()
        group_id = self.configure(db)
        calls = []

        with tempfile.NamedTemporaryFile(suffix=".zip") as temp_zip:
            temp_zip.write(b"zip-bytes")
            temp_zip.flush()

            def fake_urlopen(request, timeout):
                calls.append((request, timeout))

                if "/rest/v1/pack_catalog?select=" in request.full_url:
                    return FakeResponse([])

                if "/storage/v1/object/pack-zips/" in request.full_url:
                    return FakeResponse({})

                payload = json.loads(request.data.decode("utf-8"))

                if "p_variant_of_pack_guid" in payload:
                    raise HTTPError(
                        request.full_url,
                        400,
                        "Bad Request",
                        {},
                        io.BytesIO(
                            b'{"message":"Could not find the function '
                            b'public.upsert_my_pack_draft('
                            b'p_variant_of_pack_guid) in the schema cache"}'
                        )
                    )

                return FakeResponse({
                    "pack_guid": "group-guid",
                    "name": "Atlas des capitales",
                    "version": 1,
                    "question_count": 1,
                    "storage_path": "user-123/group-guid/v1-atlas.zip",
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
                    name="Atlas des capitales"
                )

        first_rpc_payload = json.loads(calls[2][0].data.decode("utf-8"))
        retry_rpc_payload = json.loads(calls[3][0].data.decode("utf-8"))
        self.assertIn("p_variant_of_pack_guid", first_rpc_payload)
        self.assertNotIn("p_variant_of_pack_guid", retry_rpc_payload)
        self.assertEqual(result["publication"]["pack_guid"], "group-guid")

    def test_save_variant_draft_requires_updated_variant_schema(self):
        db = make_db()
        group_id = self.configure(db)

        with tempfile.NamedTemporaryFile(suffix=".zip") as temp_zip:
            temp_zip.write(b"zip-bytes")
            temp_zip.flush()

            def fake_urlopen(request, timeout):
                if "/rest/v1/pack_catalog?select=" in request.full_url:
                    return FakeResponse([])

                if "/storage/v1/object/pack-zips/" in request.full_url:
                    return FakeResponse({})

                raise HTTPError(
                    request.full_url,
                    400,
                    "Bad Request",
                    {},
                    io.BytesIO(
                        b'{"message":"Could not find the function '
                        b'public.upsert_my_pack_draft('
                        b'p_variant_of_pack_guid) in the schema cache"}'
                    )
                )

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
                with self.assertRaises(PackCatalogError) as context:
                    save_pack_publish_draft(
                        db,
                        group_id,
                        name="Atlas corrigé",
                        variant_of_pack_guid="base-pack-guid"
                    )

        self.assertIn("schéma Supabase", str(context.exception))

    def test_save_draft_auto_increments_public_pack_version(self):
        db = make_db()
        group_id = self.configure(db)
        calls = []

        with tempfile.NamedTemporaryFile(suffix=".zip") as temp_zip:
            temp_zip.write(b"zip-bytes")
            temp_zip.flush()

            def fake_urlopen(request, timeout):
                calls.append((request, timeout))

                if "/rest/v1/pack_catalog?select=" in request.full_url:
                    return FakeResponse([{
                        "pack_guid": "group-guid",
                        "name": "Atlas des capitales",
                        "version": 2,
                        "question_count": 1,
                        "storage_path": "user-123/group-guid/v2-atlas.zip",
                        "is_public": True,
                        "publication_status": "published"
                    }])

                if "/storage/v1/object/pack-zips/" in request.full_url:
                    return FakeResponse({})

                return FakeResponse({
                    "pack_guid": "group-guid",
                    "name": "Atlas des capitales",
                    "version": 3,
                    "question_count": 1,
                    "storage_path": "user-123/group-guid/v3-atlas.zip",
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
            ) as export_mock, mock.patch(
                "app.services.pack_catalog.urlopen",
                fake_urlopen
            ):
                result = save_pack_publish_draft(
                    db,
                    group_id,
                    name="Atlas des capitales"
                )

        self.assertEqual(result["publication"]["version"], 3)
        self.assertEqual(export_mock.call_args.kwargs["version"], 3)
        rpc_payload = json.loads(calls[2][0].data.decode("utf-8"))
        self.assertEqual(rpc_payload["p_version"], 3)
        self.assertIn("/v3-atlas-des-capitales.zip", calls[1][0].full_url)

    def test_save_variant_draft_sends_locked_base_guid(self):
        db = make_db()
        group_id = self.configure(db)
        calls = []

        with tempfile.NamedTemporaryFile(suffix=".zip") as temp_zip:
            temp_zip.write(b"zip-bytes")
            temp_zip.flush()

            def fake_urlopen(request, timeout):
                calls.append((request, timeout))

                if "/rest/v1/pack_catalog?select=" in request.full_url:
                    return FakeResponse([])

                if "/storage/v1/object/pack-zips/" in request.full_url:
                    return FakeResponse({})

                return FakeResponse({
                    "pack_guid": "group-guid",
                    "name": "Atlas corrigé",
                    "version": 1,
                    "question_count": 1,
                    "storage_path": "user-123/group-guid/v1-atlas.zip",
                    "is_public": False,
                    "publication_status": "draft",
                    "variant_of_pack_guid": "base-pack-guid",
                    "root_pack_guid": "base-pack-guid"
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
                    name="Atlas corrigé",
                    variant_of_pack_guid="base-pack-guid"
                )

        rpc_payload = json.loads(calls[2][0].data.decode("utf-8"))
        self.assertEqual(rpc_payload["p_variant_of_pack_guid"], "base-pack-guid")
        self.assertEqual(
            result["publication"]["variant_of_pack_guid"],
            "base-pack-guid"
        )

    def test_preview_release_compares_published_zip_with_local_source(self):
        db = make_db()
        group_id = self.configure(db)
        calls = []

        with tempfile.TemporaryDirectory() as temp_name:
            old_zip = export_pack(
                db,
                group_id,
                version=1,
                name="Atlas des capitales",
                pack_dir=Path(temp_name)
            )
            old_zip_bytes = old_zip.read_bytes()

        question = (
            db.query(Question)
            .filter(Question.guid == "question-guid")
            .first()
        )
        question.answer = "Paris corrigé"
        db.add(Question(
            guid="second-question-guid",
            type_q="map",
            question="Espagne",
            answer="Madrid",
            tags=[
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222"
            ],
            group_id=group_id
        ))
        db.commit()

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))

            if "/rest/v1/pack_catalog?select=" in request.full_url:
                return FakeResponse([{
                    "pack_guid": "group-guid",
                    "name": "Atlas des capitales",
                    "description": "Cartes de capitales.",
                    "type_group": "map",
                    "question_count": 1,
                    "version": 1,
                    "size_bytes": len(old_zip_bytes),
                    "license": "CC0",
                    "tags": ["capitales"],
                    "themes": ["géographie"],
                    "storage_path": "user-123/group-guid/v1-atlas.zip",
                    "is_public": True,
                    "publication_status": "published"
                }])

            if "/storage/v1/object/pack-zips/" in request.full_url:
                return FakeResponse(old_zip_bytes)

            return FakeResponse({})

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
            result = preview_pack_release(
                db,
                "group-guid",
                version=2,
                name="Atlas des capitales",
                description="Cartes de capitales enrichies.",
                license="CC0",
                tags=["capitales"],
                themes=["géographie"]
            )

        self.assertEqual(result["status"], "preview")
        self.assertEqual(result["published_version"], 1)
        self.assertEqual(result["next_version"], 2)
        self.assertEqual(result["question_count"], {"published": 1, "next": 2})
        self.assertEqual(result["questions"]["added"], ["second-question-guid"])
        self.assertEqual(result["questions"]["edited"], ["question-guid"])
        self.assertEqual(result["questions"]["removed"], [])
        self.assertEqual(result["metadata_changed"], ["description"])
        self.assertFalse(result["unchanged"])
        self.assertIn("/rest/v1/pack_catalog?select=", calls[0][0].full_url)
        self.assertIn("/storage/v1/object/pack-zips/", calls[1][0].full_url)

    def test_publish_group_changes_uses_linked_publication_without_manual_version(self):
        db = make_db()
        group_id = self.configure(db)
        group = db.query(QuestionGroup).filter(QuestionGroup.id == group_id).first()
        group.name = "Capitales corrigées"
        db.commit()
        calls = []
        published_row = {
            "pack_guid": "group-guid",
            "name": "Atlas des capitales",
            "description": "Cartes de capitales.",
            "version": 2,
            "question_count": 1,
            "license": "CC0",
            "tags": ["capitales"],
            "themes": ["géographie"],
            "storage_path": "user-123/group-guid/v2-atlas.zip",
            "is_public": True,
            "publication_status": "published"
        }

        with tempfile.NamedTemporaryFile(suffix=".zip") as temp_zip:
            temp_zip.write(b"zip-bytes")
            temp_zip.flush()

            def fake_urlopen(request, timeout):
                calls.append((request, timeout))

                if "/rest/v1/pack_catalog?select=" in request.full_url:
                    return FakeResponse([published_row])

                if "/storage/v1/object/pack-zips/" in request.full_url:
                    return FakeResponse({})

                if request.full_url.endswith("/rest/v1/rpc/upsert_my_pack_draft"):
                    return FakeResponse({
                        **published_row,
                        "name": "Capitales corrigées",
                        "version": 3,
                        "storage_path": (
                            "user-123/group-guid/v3-capitales-corrigées.zip"
                        ),
                        "is_public": False,
                        "publication_status": "draft"
                    })

                if request.full_url.endswith("/rest/v1/rpc/publish_my_pack"):
                    return FakeResponse({
                        **published_row,
                        "name": "Capitales corrigées",
                        "version": 3,
                        "storage_path": (
                            "user-123/group-guid/v3-capitales-corrigées.zip"
                        )
                    })

                raise AssertionError(f"unexpected request {request.full_url}")

            with mock.patch(
                "app.services.pack_catalog.load_sync_state",
                return_value=self.empty_sync_state()
            ), mock.patch(
                "app.services.pack_catalog.load_pack_publish_state",
                return_value=self.publish_state()
            ), mock.patch(
                "app.services.pack_catalog.export_pack",
                return_value=Path(temp_zip.name)
            ) as export_mock, mock.patch(
                "app.services.pack_catalog.urlopen",
                fake_urlopen
            ):
                result = publish_group_pack_changes(db, group_id)

        self.assertEqual(result["status"], "published")
        self.assertEqual(result["previous_version"], 2)
        self.assertEqual(result["next_version"], 3)
        self.assertEqual(result["publication"]["name"], "Capitales corrigées")
        self.assertEqual(export_mock.call_args.kwargs["version"], 3)
        draft_payload = json.loads(calls[3][0].data.decode("utf-8"))
        self.assertEqual(draft_payload["p_name"], "Capitales corrigées")
        self.assertEqual(draft_payload["p_description"], "Cartes de capitales.")
        self.assertEqual(draft_payload["p_version"], 3)

    def test_group_pack_publication_signed_out_is_non_blocking(self):
        db = make_db()
        group_id = self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            result = get_group_pack_publication(db, group_id)

        self.assertEqual(result["status"], "signed_out")
        self.assertFalse(result["can_publish_changes"])

    def test_save_draft_rejects_same_version_for_public_pack(self):
        db = make_db()
        group_id = self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse([{
                "pack_guid": "group-guid",
                "name": "Atlas des capitales",
                "version": 2,
                "question_count": 1,
                "storage_path": "user-123/group-guid/v2-atlas.zip",
                "is_public": True,
                "publication_status": "published"
            }])

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.publish_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ), self.assertRaisesRegex(
            ValueError,
            "déjà des changements plus récents"
        ):
            save_pack_publish_draft(
                db,
                group_id,
                version=2,
                name="Atlas des capitales"
            )

        self.assertEqual(len(calls), 1)
        self.assertIn("/rest/v1/pack_catalog?select=", calls[0][0].full_url)

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


class PackCatalogUnpublishTests(PackCatalogAuthTestCase):
    def test_unpublish_calls_authenticated_rpc(self):
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
                "is_public": False,
                "publication_status": "archived"
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
            result = unpublish_group_pack("group-guid", db=db)

        self.assertEqual(result["status"], "unpublished")
        self.assertEqual(
            result["publication"]["publication_status"], "archived"
        )
        self.assertFalse(result["publication"]["is_public"])
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/unpublish_my_pack"
        )
        self.assertEqual(
            request.headers.get("Authorization"),
            "Bearer access-token"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_pack_guid": "group-guid"}
        )

    def test_unpublish_requires_sign_in(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(HTTPException) as context:
                unpublish_group_pack("group-guid", db=db)

        self.assertEqual(context.exception.status_code, 401)


class PackCatalogDeletePublicationTests(PackCatalogAuthTestCase):
    def test_delete_archived_pack_removes_row_then_storage_zip(self):
        db = make_db()
        self.configure(db)
        calls = []
        archived_row = {
            "pack_guid": "group-guid",
            "name": "Atlas des capitales",
            "version": 2,
            "question_count": 1,
            "storage_path": "user-123/group-guid/v2-atlas.zip",
            "is_public": False,
            "publication_status": "archived"
        }

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))

            if "/rest/v1/pack_catalog?select=" in request.full_url:
                return FakeResponse([archived_row])

            if request.full_url.endswith("/rest/v1/rpc/delete_my_pack"):
                return FakeResponse(archived_row)

            if "/storage/v1/object/pack-zips/" in request.full_url:
                return FakeResponse({})

            raise AssertionError(f"unexpected request {request.full_url}")

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
            result = delete_group_pack_publication("group-guid", db=db)

        self.assertEqual(
            result,
            {
                "status": "deleted",
                "pack_guid": "group-guid",
                "zip_deleted": True
            }
        )
        self.assertIn("/rest/v1/pack_catalog?select=", calls[0][0].full_url)
        self.assertEqual(calls[1][0].get_method(), "POST")
        self.assertEqual(
            calls[1][0].full_url,
            "https://project.supabase.co/rest/v1/rpc/delete_my_pack"
        )
        self.assertEqual(
            json.loads(calls[1][0].data.decode("utf-8")),
            {"p_pack_guid": "group-guid"}
        )
        self.assertEqual(calls[2][0].get_method(), "DELETE")
        self.assertEqual(calls[2][1], 60)
        self.assertIn(
            "/storage/v1/object/pack-zips/user-123/group-guid/v2-atlas.zip",
            calls[2][0].full_url
        )

    def test_delete_requires_archived_pack(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse([{
                "pack_guid": "group-guid",
                "name": "Atlas des capitales",
                "version": 2,
                "question_count": 1,
                "storage_path": "user-123/group-guid/v2-atlas.zip",
                "is_public": True,
                "publication_status": "published"
            }])

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
            with self.assertRaises(HTTPException) as context:
                delete_group_pack_publication("group-guid", db=db)

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(len(calls), 1)


class PackCatalogInstallTrackingTests(PackCatalogAuthTestCase):
    def test_record_install_posts_authenticated_rpc(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "pack_guid": "group-guid",
                "user_id": "user-123",
                "installed_version": 2
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
            result = record_pack_install_route(
                "group-guid",
                PackInstallRecordRequest(installed_version=2),
                db=db
            )

        self.assertEqual(result, {"recorded": True})
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/record_pack_install"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_pack_guid": "group-guid", "p_installed_version": 2}
        )

    def test_record_install_requires_sign_in(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(HTTPException) as context:
                record_pack_install_route(
                    "group-guid",
                    PackInstallRecordRequest(installed_version=1),
                    db=db
                )

        self.assertEqual(context.exception.status_code, 401)

    def test_backfill_skips_network_call_with_no_local_subscriptions(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.publish_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            result = backfill_pack_installs_route(db=db)

        self.assertEqual(result, {"recorded": 0})

    def test_backfill_posts_local_subscriptions_as_bulk_installs(self):
        db = make_db()
        self.configure(db)
        db.add(PackSubscription(
            pack_guid="world-map",
            installed_version=3,
            name="World",
            source="world.zip",
            subscribed_at="2026-07-22T10:00:00Z"
        ))
        db.commit()
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse(2)

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
            result = backfill_pack_installs_route(db=db)

        self.assertEqual(result, {"recorded": 2})
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/record_pack_installs_bulk"
        )
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(
            payload["p_installs"],
            [{"pack_guid": "world-map", "installed_version": 3}]
        )


class PackCatalogActivityTests(PackCatalogAuthTestCase):
    def test_activity_list_calls_authenticated_rpc(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "unread_count": 1,
                "events": [{
                    "id": 42,
                    "event_type": "variant_published",
                    "pack_guid": "base-pack",
                    "pack_name": "Pack original",
                    "related_pack_guid": "variant-pack",
                    "related_pack_name": "Pack corrigé",
                    "read_at": None,
                    "created_at": "2026-08-26T10:00:00Z"
                }]
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
            result = pack_catalog_activity(limit=99, db=db)

        self.assertEqual(result["unread_count"], 1)
        self.assertEqual(result["events"][0]["id"], 42)
        self.assertEqual(result["events"][0]["related_pack_name"], "Pack corrigé")
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/list_pack_activity_events"
        )
        self.assertEqual(
            request.headers.get("Authorization"),
            "Bearer access-token"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_limit": 60}
        )

    def test_activity_list_returns_empty_when_rpc_missing(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            raise HTTPError(
                request.full_url,
                404,
                "Not Found",
                {},
                io.BytesIO(
                    b'{"message":"Could not find the function '
                    b'public.list_pack_activity_events(p_limit) '
                    b'in the schema cache"}'
                )
            )

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
            result = pack_catalog_activity(limit=20, db=db)

        self.assertEqual(result, {"events": [], "unread_count": 0})

    def test_activity_mark_read_posts_event_ids(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({"updated": 2})

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
            result = read_pack_catalog_activity(
                PackActivityReadRequest(event_ids=[42, 43]),
                db=db
            )

        self.assertEqual(result, {"updated": 2})
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/mark_pack_activity_events_read"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_event_ids": [42, 43]}
        )

    def test_activity_mark_read_ignores_missing_rpc(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            raise HTTPError(
                request.full_url,
                404,
                "Not Found",
                {},
                io.BytesIO(
                    b'{"message":"Could not find the function '
                    b'public.mark_pack_activity_events_read(p_event_ids) '
                    b'in the schema cache"}'
                )
            )

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
            result = read_pack_catalog_activity(
                PackActivityReadRequest(event_ids=[42]),
                db=db
            )

        self.assertEqual(result, {"updated": 0})

    def test_activity_requires_sign_in(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(HTTPException) as context:
                pack_catalog_activity(db=db)

        self.assertEqual(context.exception.status_code, 401)


class PackCatalogVariantSourceRouteTests(PackCatalogAuthTestCase):
    def test_variant_source_requires_sign_in(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ):
            with self.assertRaises(HTTPException) as context:
                pack_variant_source("base-pack", db=db)

        self.assertEqual(context.exception.status_code, 401)

    def test_variant_source_requires_local_subscription(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.publish_state()
        ):
            with self.assertRaises(HTTPException) as context:
                pack_variant_source("base-pack", db=db)

        self.assertEqual(context.exception.status_code, 404)

    def test_variant_source_creates_local_clone_for_installed_pack(self):
        db = make_db()
        base_guid = "base-pack"
        group = QuestionGroup(
            guid=base_guid,
            type_group="text",
            name="Base",
            pack_guid=base_guid,
            pack_version=1,
            content_hash="group-hash"
        )
        db.add(group)
        db.flush()
        db.add(Question(
            guid="question-guid",
            type_q="text",
            question="Q",
            answer="A",
            tags=[],
            data={},
            group_id=group.id,
            pack_guid=base_guid,
            pack_version=1,
            content_hash="question-hash"
        ))
        db.add(PackSubscription(
            pack_guid=base_guid,
            installed_version=1,
            name="Base",
            source="base.zip",
            subscribed_at="2026-08-01T10:00:00Z"
        ))
        db.commit()

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.publish_state()
        ):
            result = pack_variant_source(base_guid, db=db)

        self.assertEqual(result["source_kind"], "group")
        self.assertEqual(result["variant_of_pack_guid"], base_guid)
        self.assertEqual(db.query(QuestionGroup).count(), 2)
        self.assertEqual(db.query(Question).count(), 2)


class PackCatalogEligibilityTests(PackCatalogAuthTestCase):
    def test_my_status_calls_authenticated_rpc(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({"is_installed": True, "my_rating": 4})

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
            result = pack_my_status("group-guid", db=db)

        self.assertEqual(result, {"is_installed": True, "my_rating": 4})
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/get_my_pack_status"
        )

    def test_my_status_requires_sign_in(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(HTTPException) as context:
                pack_my_status("group-guid", db=db)

        self.assertEqual(context.exception.status_code, 401)


class PackCatalogSuggestedEditTests(PackCatalogAuthTestCase):
    def configure_installed_pack(self, db):
        use_catalog(self, url="https://project.supabase.co")
        group = QuestionGroup(
            guid="country-group-guid",
            type_group="text",
            name="Capitales",
            pack_guid="world-map",
            pack_version=2,
            content_hash="group-hash"
        )
        question = Question(
            guid="france-question-guid",
            type_q="text",
            question="Capitale de la France ?",
            answer="Lyon",
            tags=["core:geography"],
            group=group,
            pack_guid="world-map",
            pack_version=2,
            content_hash="question-hash"
        )
        db.add(group)
        db.add(question)
        db.add(PackSubscription(
            pack_guid="world-map",
            installed_version=2,
            name="Pays du monde",
            source="world.zip",
            subscribed_at="2026-08-01T10:00:00Z"
        ))
        db.commit()

    def configure_owned_pack_source(self, db, *, answer="Lyon"):
        use_catalog(self, url="https://project.supabase.co")
        group = QuestionGroup(
            guid="world-map",
            type_group="text",
            name="Pays du monde"
        )
        question = Question(
            guid="france-question-guid",
            type_q="text",
            question="Capitale de la France ?",
            answer=answer,
            tags=["core:geography"],
            group=group
        )
        db.add(group)
        db.add(question)
        db.commit()

        return question.id

    def configure_owned_playlist_source(self, db, *, answer="Lyon"):
        use_catalog(self, url="https://project.supabase.co")
        group = QuestionGroup(
            guid="country-group-guid",
            type_group="text",
            name="Capitales"
        )
        question = Question(
            guid="france-question-guid",
            type_q="text",
            question="Capitale de la France ?",
            answer=answer,
            tags=["core:geography"],
            group=group
        )
        collection = Collection(
            guid="world-map",
            name="Pays du monde",
            questions=[question]
        )
        db.add(group)
        db.add(question)
        db.add(collection)
        db.commit()

        return question.id

    def suggestion_row(self, *, status="accepted", applied_at=None):
        return {
            "id": 12,
            "pack_guid": "world-map",
            "author_label": "reader@example.com",
            "status": status,
            "target_question_guid": "france-question-guid",
            "target_group_guid": "world-map",
            "target_label": "Capitale de la France ?",
            "target_snapshot": {
                "question_guid": "france-question-guid",
                "group_guid": "world-map",
                "group_name": "Pays du monde",
                "type_q": "text",
                "question": "Capitale de la France ?",
                "answer": "Lyon"
            },
            "proposed_question": "",
            "proposed_answer": "Paris",
            "note": "La capitale est Paris.",
            "owner_note": "",
            "created_at": "2026-08-27T10:00:00Z",
            "resolved_at": "2026-08-27T10:05:00Z",
            "applied_at": applied_at
        }

    def publication_row(self):
        return {
            "pack_guid": "world-map",
            "name": "Pays du monde",
            "description": "",
            "type_group": "text",
            "question_count": 1,
            "version": 1,
            "size_bytes": 1024,
            "license": "CC0",
            "tags": ["core:geography"],
            "themes": ["Géographie"],
            "storage_path": "user-123/world-map/world.zip",
            "is_public": True,
            "publication_status": "published"
        }

    def test_targets_list_installed_pack_questions(self):
        db = make_db()
        self.configure_installed_pack(db)

        result = pack_suggested_edit_targets("world-map", db=db)

        self.assertEqual(result["pack_guid"], "world-map")
        self.assertEqual(result["name"], "Pays du monde")
        self.assertEqual(result["targets"], [{
            "question_guid": "france-question-guid",
            "group_guid": "country-group-guid",
            "group_name": "Capitales",
            "type_q": "text",
            "question": "Capitale de la France ?",
            "answer": "Lyon"
        }])

    def test_targets_require_local_install(self):
        db = make_db()
        use_catalog(self, url="https://project.supabase.co")

        with self.assertRaises(HTTPException) as context:
            pack_suggested_edit_targets("world-map", db=db)

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Installe ce pack", context.exception.detail)

    def test_submit_suggested_edit_posts_snapshot_to_authenticated_rpc(self):
        db = make_db()
        self.configure_installed_pack(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))

            if request.full_url.endswith("/rpc/record_pack_install"):
                return FakeResponse({"recorded": True})

            return FakeResponse({
                "id": 12,
                "pack_guid": "world-map",
                "author_label": "author@example.com",
                "status": "pending",
                "target_question_guid": "france-question-guid",
                "target_group_guid": "country-group-guid",
                "target_label": "Capitale de la France ?",
                "target_snapshot": {
                    "question_guid": "france-question-guid",
                    "group_guid": "country-group-guid",
                    "group_name": "Capitales",
                    "type_q": "text",
                    "question": "Capitale de la France ?",
                    "answer": "Lyon"
                },
                "proposed_question": "",
                "proposed_answer": "Paris",
                "note": "La capitale est Paris.",
                "owner_note": "",
                "created_at": "2026-08-27T10:00:00Z"
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
            result = submit_pack_suggested_edit_route(
                "world-map",
                PackSuggestedEditCreateRequest(
                    target_question_guid="france-question-guid",
                    proposed_answer="Paris",
                    note="La capitale est Paris."
                ),
                db=db
            )

        self.assertEqual(result["suggestion"]["id"], 12)
        self.assertEqual(result["suggestion"]["proposed_answer"], "Paris")
        self.assertEqual(
            calls[0][0].full_url,
            "https://project.supabase.co/rest/v1/rpc/record_pack_install"
        )
        self.assertEqual(
            calls[1][0].full_url,
            "https://project.supabase.co/rest/v1/rpc/submit_pack_suggested_edit"
        )
        payload = json.loads(calls[1][0].data.decode("utf-8"))
        self.assertEqual(payload["p_pack_guid"], "world-map")
        self.assertEqual(payload["p_target_question_guid"], "france-question-guid")
        self.assertEqual(payload["p_target_group_guid"], "country-group-guid")
        self.assertEqual(payload["p_target_snapshot"]["answer"], "Lyon")
        self.assertEqual(payload["p_proposed_answer"], "Paris")
        self.assertEqual(payload["p_note"], "La capitale est Paris.")

    def test_submit_suggested_edit_requires_sign_in(self):
        db = make_db()
        self.configure_installed_pack(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(HTTPException) as context:
                submit_pack_suggested_edit_route(
                    "world-map",
                    PackSuggestedEditCreateRequest(note="Corriger la réponse."),
                    db=db
                )

        self.assertEqual(context.exception.status_code, 401)

    def test_owner_lists_suggested_edits(self):
        db = make_db()
        use_catalog(self, url="https://project.supabase.co")
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "pending_count": 1,
                "suggestions": [{
                    "id": 12,
                    "pack_guid": "world-map",
                    "author_label": "reader@example.com",
                    "status": "pending",
                    "target_label": "Capitale de la France ?",
                    "proposed_answer": "Paris",
                    "note": "La capitale est Paris."
                }]
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
            result = pack_suggested_edits("world-map", db=db)

        self.assertEqual(result["pending_count"], 1)
        self.assertEqual(result["suggestions"][0]["proposed_answer"], "Paris")
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/list_pack_suggested_edits"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_pack_guid": "world-map", "p_limit": 50}
        )

    def test_owner_resolves_suggested_edit(self):
        db = make_db()
        use_catalog(self, url="https://project.supabase.co")
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "id": 12,
                "pack_guid": "world-map",
                "author_label": "reader@example.com",
                "status": "accepted",
                "target_label": "Capitale de la France ?",
                "proposed_answer": "Paris",
                "note": "La capitale est Paris.",
                "owner_note": "Corrigé localement.",
                "resolved_at": "2026-08-27T10:05:00Z"
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
            result = resolve_pack_suggested_edit_route(
                12,
                PackSuggestedEditResolveRequest(
                    status="accepted",
                    owner_note="Corrigé localement."
                ),
                db=db
            )

        self.assertEqual(result["suggestion"]["status"], "accepted")
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/resolve_pack_suggested_edit"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {
                "p_edit_id": 12,
                "p_status": "accepted",
                "p_owner_note": "Corrigé localement."
            }
        )

    def test_owner_applies_accepted_suggested_edit_to_local_source(self):
        db = make_db()
        question_id = self.configure_owned_pack_source(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))

            if "/pack_suggested_edits?" in request.full_url:
                return FakeResponse([self.suggestion_row()])

            if "/pack_catalog?" in request.full_url:
                return FakeResponse([self.publication_row()])

            if request.full_url.endswith("/rpc/mark_pack_suggested_edit_applied"):
                return FakeResponse(self.suggestion_row(
                    applied_at="2026-08-27T10:10:00Z"
                ))

            raise AssertionError(f"unexpected URL {request.full_url}")

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
            result = apply_pack_suggested_edit_route(12, db=db)

        db.expire_all()
        question = db.query(Question).filter(Question.id == question_id).first()
        self.assertEqual(question.answer, "Paris")
        self.assertIsNone(question.pack_guid)
        self.assertEqual(result["status"], "applied")
        self.assertEqual(result["question"]["answer"], "Paris")
        self.assertEqual(
            result["suggestion"]["applied_at"],
            "2026-08-27T10:10:00Z"
        )
        self.assertEqual(
            calls[0][0].full_url,
            "https://project.supabase.co/rest/v1/pack_suggested_edits"
            "?select=*&id=eq.12&limit=1"
        )
        self.assertEqual(
            calls[-1][0].full_url,
            "https://project.supabase.co/rest/v1/rpc/mark_pack_suggested_edit_applied"
        )
        self.assertEqual(
            json.loads(calls[-1][0].data.decode("utf-8")),
            {"p_edit_id": 12}
        )

    def test_owner_applies_suggested_edit_to_playlist_source(self):
        db = make_db()
        question_id = self.configure_owned_playlist_source(db)

        def fake_urlopen(request, timeout):
            if "/pack_suggested_edits?" in request.full_url:
                return FakeResponse([self.suggestion_row()])

            if "/pack_catalog?" in request.full_url:
                return FakeResponse([self.publication_row()])

            if request.full_url.endswith("/rpc/mark_pack_suggested_edit_applied"):
                return FakeResponse(self.suggestion_row(
                    applied_at="2026-08-27T10:10:00Z"
                ))

            raise AssertionError(f"unexpected URL {request.full_url}")

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
            result = apply_pack_suggested_edit_route(12, db=db)

        db.expire_all()
        question = db.query(Question).filter(Question.id == question_id).first()
        self.assertEqual(question.answer, "Paris")
        self.assertEqual(result["question"]["answer"], "Paris")

    def test_apply_suggested_edit_requires_acceptance_first(self):
        db = make_db()
        question_id = self.configure_owned_pack_source(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse([self.suggestion_row(status="pending")])

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
            with self.assertRaises(HTTPException) as context:
                apply_pack_suggested_edit_route(12, db=db)

        db.expire_all()
        question = db.query(Question).filter(Question.id == question_id).first()
        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Accepte la suggestion", context.exception.detail)
        self.assertEqual(question.answer, "Lyon")
        self.assertEqual(len(calls), 1)

    def test_apply_suggested_edit_stops_on_stale_local_question(self):
        db = make_db()
        question_id = self.configure_owned_pack_source(db, answer="Marseille")
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))

            if "/pack_suggested_edits?" in request.full_url:
                return FakeResponse([self.suggestion_row()])

            if "/pack_catalog?" in request.full_url:
                return FakeResponse([self.publication_row()])

            raise AssertionError(f"unexpected URL {request.full_url}")

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
            with self.assertRaises(HTTPException) as context:
                apply_pack_suggested_edit_route(12, db=db)

        db.expire_all()
        question = db.query(Question).filter(Question.id == question_id).first()
        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("a changé", context.exception.detail)
        self.assertEqual(question.answer, "Marseille")
        self.assertFalse(any(
            call[0].full_url.endswith("/rpc/mark_pack_suggested_edit_applied")
            for call in calls
        ))


class PackCatalogCommentsTests(PackCatalogAuthTestCase):
    def test_list_comments_sends_no_authorization_header(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse([
                {
                    "id": 1,
                    "author_label": "fan@example.com",
                    "body": "Super pack !",
                    "created_at": "2026-07-25T10:00:00Z"
                }
            ])

        with mock.patch(
            "app.services.pack_catalog.urlopen",
            fake_urlopen
        ):
            result = pack_comments("group-guid", db=db)

        self.assertEqual(len(result["comments"]), 1)
        self.assertEqual(result["comments"][0]["body"], "Super pack !")
        request, _ = calls[0]
        self.assertIn("/rest/v1/pack_comments", request.full_url)
        self.assertIn("pack_guid=eq.group-guid", request.full_url)
        self.assertIsNone(request.headers.get("Authorization"))

    def test_add_comment_calls_authenticated_rpc(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "id": 1,
                "author_label": "author@example.com",
                "body": "Merci pour le retour !",
                "created_at": "2026-07-25T10:00:00Z"
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
            result = add_pack_comment_route(
                "group-guid",
                PackCommentCreateRequest(body="Merci pour le retour !"),
                db=db
            )

        self.assertEqual(result["comment"]["body"], "Merci pour le retour !")
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/add_pack_comment"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_pack_guid": "group-guid", "p_body": "Merci pour le retour !"}
        )

    def test_add_comment_requires_sign_in(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(HTTPException) as context:
                add_pack_comment_route(
                    "group-guid",
                    PackCommentCreateRequest(body="Test"),
                    db=db
                )

        self.assertEqual(context.exception.status_code, 401)

    def test_add_comment_surfaces_supabase_error(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            raise HTTPError(
                request.full_url,
                400,
                "Bad Request",
                {},
                io.BytesIO(b'{"message":"not installed"}')
            )

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
            with self.assertRaises(HTTPException) as context:
                add_pack_comment_route(
                    "group-guid",
                    PackCommentCreateRequest(body="Test"),
                    db=db
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "not installed")


class PackCatalogRatingTests(PackCatalogAuthTestCase):
    def test_rate_pack_calls_authenticated_rpc(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "my_rating": 5,
                "avg_rating": 4.5,
                "rating_count": 12
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
            result = rate_pack_route(
                "group-guid",
                PackRatingRequest(rating=5),
                db=db
            )

        self.assertEqual(
            result,
            {"my_rating": 5, "avg_rating": 4.5, "rating_count": 12}
        )
        request, _ = calls[0]
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/rate_pack"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_pack_guid": "group-guid", "p_rating": 5}
        )

    def test_rate_pack_requires_sign_in(self):
        db = make_db()
        self.configure(db)

        with mock.patch(
            "app.services.pack_catalog.load_sync_state",
            return_value=self.empty_sync_state()
        ), mock.patch(
            "app.services.pack_catalog.load_pack_publish_state",
            return_value=self.signed_out_state()
        ), mock.patch(
            "app.services.pack_catalog.urlopen",
            side_effect=AssertionError("network should not be called")
        ):
            with self.assertRaises(HTTPException) as context:
                rate_pack_route(
                    "group-guid",
                    PackRatingRequest(rating=3),
                    db=db
                )

        self.assertEqual(context.exception.status_code, 401)


class PackCatalogFamilyTests(unittest.TestCase):
    def configure(self, db):
        use_catalog(self)
        db.add(PackSubscription(
            pack_guid="world-map",
            installed_version=2,
            name="Pays du monde",
            source="world.zip",
            subscribed_at="2026-08-01T10:00:00Z"
        ))
        db.commit()

    def test_family_rpc_returns_original_and_variants_with_local_status(self):
        db = make_db()
        self.configure(db)
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({
                "pack_guid": "variant-pack",
                "original_pack_guid": "world-map",
                "recommended_pack_guid": "variant-pack",
                "variant_count": 1,
                "packs": [
                    {
                        "pack_guid": "world-map",
                        "name": "Pays du monde",
                        "type_group": "map",
                        "question_count": 252,
                        "version": 2,
                        "storage_path": "world.zip",
                        "root_pack_guid": "world-map",
                        "original_pack_guid": "world-map",
                        "recommended_pack_guid": "variant-pack",
                        "variant_count": 1
                    },
                    {
                        "pack_guid": "variant-pack",
                        "name": "Pays du monde corrigé",
                        "type_group": "map",
                        "question_count": 253,
                        "version": 1,
                        "storage_path": "variant.zip",
                        "variant_of_pack_guid": "world-map",
                        "root_pack_guid": "world-map",
                        "original_pack_guid": "world-map",
                        "recommended_pack_guid": "variant-pack",
                        "original_name": "Pays du monde",
                        "variant_count": 1
                    }
                ]
            })

        with mock.patch("app.services.pack_catalog.urlopen", fake_urlopen):
            result = pack_catalog_family("variant-pack", db=db)

        self.assertEqual(result["original_pack_guid"], "world-map")
        self.assertEqual(result["recommended_pack_guid"], "variant-pack")
        self.assertEqual(result["variant_count"], 1)
        self.assertEqual([pack["pack_guid"] for pack in result["packs"]], [
            "world-map",
            "variant-pack"
        ])
        self.assertEqual(
            result["packs"][0]["local_status"]["status"],
            "up_to_date"
        )
        self.assertTrue(result["packs"][1]["is_recommended_variant"])
        request, timeout = calls[0]
        self.assertEqual(timeout, 12)
        self.assertEqual(
            request.full_url,
            "https://project.supabase.co/rest/v1/rpc/get_pack_family"
        )
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {"p_pack_guid": "variant-pack"}
        )

    def test_family_rpc_missing_returns_empty_family(self):
        db = make_db()
        self.configure(db)

        def fake_urlopen(request, timeout):
            raise HTTPError(
                request.full_url,
                404,
                "Not Found",
                {},
                io.BytesIO(
                    b'{"message":"Could not find the function '
                    b'public.get_pack_family(p_pack_guid) in the schema cache"}'
                )
            )

        with mock.patch("app.services.pack_catalog.urlopen", fake_urlopen):
            result = pack_catalog_family("world-map", db=db)

        self.assertEqual(result, {
            "pack_guid": "world-map",
            "original_pack_guid": "world-map",
            "recommended_pack_guid": "world-map",
            "variant_count": 0,
            "packs": []
        })


class PackPreviewTests(unittest.TestCase):
    """fetch_pack_preview reads a not-yet-installed pack's zip in memory."""

    def setUp(self):
        self.db = make_db()
        use_catalog(
            self,
            url="https://project.supabase.co/rest/v1",
            key="sb_publishable_test"
        )
        self.static_dir = Path(tempfile.mkdtemp())
        self.pack_dir = Path(tempfile.mkdtemp())

    def build_zip_bytes(self, question_count=3):
        group = QuestionGroup(type_group="text", name="Capitales")
        self.db.add(group)
        self.db.flush()
        questions = [
            Question(
                type_q="text",
                question=f"Q{index}",
                answer=f"A{index}",
                tags=[],
                group_id=group.id
            )
            for index in range(question_count)
        ]
        self.db.add_all(questions)
        self.db.commit()

        zip_path = export_pack(
            self.db,
            group.id,
            version=1,
            name="Capitales",
            description="desc",
            static_dir=self.static_dir,
            pack_dir=self.pack_dir
        )

        return group.guid, zip_path.read_bytes()

    def download_url(self):
        return (
            "https://project.supabase.co/storage/v1/object/public/"
            "pack-zips/capitales.zip"
        )

    def test_returns_item_types_and_samples_without_touching_the_db(self):
        pack_guid, zip_bytes = self.build_zip_bytes()

        def fake_urlopen(request, timeout):
            return FakeResponse(zip_bytes)

        with mock.patch("app.services.pack_catalog.urlopen", fake_urlopen):
            preview = fetch_pack_preview(pack_guid, self.download_url())

        self.assertEqual(preview["pack_guid"], pack_guid)
        self.assertEqual(preview["question_count"], 3)
        self.assertEqual(
            preview["item_types"],
            [{"type_q": "text", "count": 3}]
        )
        self.assertEqual(preview["sample_count"], 3)
        self.assertFalse(preview["truncated"])
        self.assertEqual(
            [item["question"] for item in preview["samples"]],
            ["Q0", "Q1", "Q2"]
        )
        # Nothing was imported: no group/question exists beyond the one this
        # test itself created to build the fixture zip.
        self.assertEqual(
            self.db.query(QuestionGroup).count(), 1
        )

    def test_truncates_samples_past_the_preview_limit(self):
        pack_guid, zip_bytes = self.build_zip_bytes(question_count=9)

        def fake_urlopen(request, timeout):
            return FakeResponse(zip_bytes)

        with mock.patch("app.services.pack_catalog.urlopen", fake_urlopen):
            preview = fetch_pack_preview(pack_guid, self.download_url(), limit=4)

        self.assertEqual(preview["question_count"], 9)
        self.assertEqual(preview["sample_count"], 4)
        self.assertTrue(preview["truncated"])

    def test_rejects_a_url_outside_the_catalog_bucket(self):
        with self.assertRaises(PackCatalogError):
            fetch_pack_preview("guid", "https://evil.example.com/pack.zip")

    def test_rejects_an_oversized_download(self):
        _pack_guid, zip_bytes = self.build_zip_bytes()

        def fake_urlopen(request, timeout):
            return FakeResponse(zip_bytes)

        with mock.patch("app.services.pack_catalog.urlopen", fake_urlopen), \
                mock.patch(
                    "app.services.pack_catalog.PREVIEW_MAX_DOWNLOAD_BYTES",
                    len(zip_bytes) - 1
                ):
            with self.assertRaises(PackCatalogError):
                fetch_pack_preview("guid", self.download_url())

    def test_rejects_a_corrupt_zip(self):
        def fake_urlopen(request, timeout):
            return FakeResponse(b"not a zip")

        with mock.patch("app.services.pack_catalog.urlopen", fake_urlopen):
            with self.assertRaises(PackCatalogError):
                fetch_pack_preview("guid", self.download_url())

    def test_router_wraps_preview_error_as_bad_request(self):
        with self.assertRaises(HTTPException) as context:
            preview_catalog_pack("guid", "https://evil.example.com/pack.zip")

        self.assertEqual(context.exception.status_code, 400)


class PublicationSourceTests(unittest.TestCase):
    """A published pack can outlive the content it was made from."""

    def setUp(self):
        self.db = make_db()

    def tearDown(self):
        self.db.close()

    def test_links_a_pack_back_to_its_group_or_playlist(self):
        group = QuestionGroup(type_group="map", name="Drapeaux du monde")
        playlist = Collection(name="Drapeaux mix", data={}, questions=[])
        self.db.add_all([group, playlist])
        self.db.commit()

        publications = _annotate_publication_sources(self.db, [
            {"pack_guid": group.guid},
            {"pack_guid": playlist.guid}
        ])

        self.assertEqual(publications[0]["source"], {
            "kind": "group",
            "id": group.id,
            "name": "Drapeaux du monde"
        })
        self.assertFalse(publications[0]["orphaned"])

        self.assertEqual(publications[1]["source"], {
            "kind": "playlist",
            "id": playlist.id,
            "name": "Drapeaux mix"
        })
        self.assertFalse(publications[1]["orphaned"])

    def test_flags_a_pack_whose_local_source_was_deleted(self):
        # Deleting a group locally never touches the catalog row, so the pack
        # stays public and installable with nothing left to rebuild it from.
        publications = _annotate_publication_sources(self.db, [
            {"pack_guid": "guid-of-a-deleted-group"}
        ])

        self.assertTrue(publications[0]["orphaned"])
        self.assertIsNone(publications[0]["source"]["kind"])
        self.assertIsNone(publications[0]["source"]["id"])


if __name__ == "__main__":
    unittest.main()
