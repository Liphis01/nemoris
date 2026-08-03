import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.migrations import run_migrations
from app.models import AppSetting, PackSubscription, Question
from app.services.packs import (
    QUESTION_HASH_FIELDS,
    _row_canonical_payload,
    content_hash
)
from app.services.tag_hierarchy import (
    CORE_ROOT_IDS,
    TAG_HIERARCHY_KEY,
    comparison_key,
    load_tag_hierarchy,
    parent_map,
    resolve_tag_id,
    slugify_tag,
    tag_suggestions
)
from app.services.tag_seed import SEED_NODES


def sqlite_url(path):
    return f"sqlite:///{path.as_posix()}"


class LegacyHelpersTests(unittest.TestCase):
    def test_slug_helpers_remain_stable_for_frozen_legacy_migrations(self):
        self.assertEqual(slugify_tag("Géographie"), "geographie")
        self.assertEqual(slugify_tag("Guerre de Cent Ans"), "guerre-de-cent-ans")
        self.assertNotEqual(comparison_key("C++"), comparison_key("C#"))


class MultilingualTagIdMigrationTests(unittest.TestCase):
    def build_v2_database(self, temp_dir, questions, hierarchy, subscription=None):
        database_file = temp_dir / "questions.db"
        engine = create_engine(sqlite_url(database_file))
        Base.metadata.create_all(engine)

        with Session(engine) as session:
            for entry in questions:
                session.add(Question(**entry))
            session.add(AppSetting(key=TAG_HIERARCHY_KEY, value=hierarchy))
            if subscription:
                session.add(PackSubscription(**subscription))
            session.commit()

        with sqlite3.connect(database_file) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
            )
            for version in range(1, 24):
                connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations VALUES (?, ?, ?)",
                    (f"{version:04d}", "legacy", "2026-01-01T00:00:00Z")
                )

        return database_file, engine

    def run_migration(self, temp_dir, database_file, engine):
        static_dir = temp_dir / "static"
        static_dir.mkdir(exist_ok=True)
        return run_migrations(
            target_engine=engine,
            database_file=database_file,
            static_dir=static_dir,
            backup_dir=temp_dir / "backups"
        )

    def test_maps_accented_root_aliases_and_custom_tags_without_losing_labels(self):
        with tempfile.TemporaryDirectory() as name:
            temp_dir = Path(name)
            database_file, engine = self.build_v2_database(
                temp_dir,
                [
                    {"type_q": "text", "question": "a", "answer": "a", "tags": ["Géographie", "Mon sujet"], "data": {}},
                    {"type_q": "text", "question": "b", "answer": "b", "tags": ["geographie", "mon-sujet"], "data": {}}
                ],
                {
                    "version": 2,
                    "parents": {"mon-sujet": ["geography"]},
                    "labels": {"geography": "Géographie", "mon-sujet": "Mon sujet"},
                    "seed": {"version": 1, "removed": []}
                }
            )

            result = self.run_migration(temp_dir, database_file, engine)

            self.assertEqual([entry["version"] for entry in result["applied"]], ["0024"])
            self.assertIsNotNone(result["backup"])
            with Session(engine) as session:
                rows = session.query(Question).order_by(Question.id).all()
                hierarchy = load_tag_hierarchy(session)

            custom = rows[0].tags[1]
            self.assertEqual(rows[0].tags[0], "core:geography")
            self.assertEqual(rows[1].tags[0], "core:geography")
            self.assertEqual(rows[1].tags[1], custom)
            self.assertEqual(str(uuid.UUID(custom)), custom)
            self.assertEqual(hierarchy["version"], 3)
            self.assertEqual(set(CORE_ROOT_IDS) & set(hierarchy["nodes"]), set(CORE_ROOT_IDS))
            self.assertEqual(hierarchy["nodes"][custom]["labels"]["fr"], "Mon sujet")
            self.assertEqual(hierarchy["nodes"][custom]["parents"], ["core:geography"])

    def test_preserves_multiple_parents_for_custom_nodes(self):
        with tempfile.TemporaryDirectory() as name:
            temp_dir = Path(name)
            database_file, engine = self.build_v2_database(
                temp_dir,
                [{"type_q": "text", "question": "Paris", "answer": "Paris", "tags": ["paris"], "data": {}}],
                {
                    "version": 2,
                    "parents": {
                        "paris": ["france", "capitales"],
                        "france": ["geography"],
                        "capitales": ["geography"]
                    },
                    "labels": {
                        "paris": "Paris", "france": "France", "capitales": "Capitales",
                        "geography": "Géographie"
                    }
                }
            )
            self.run_migration(temp_dir, database_file, engine)

            with Session(engine) as session:
                hierarchy = load_tag_hierarchy(session)
                paris = resolve_tag_id(hierarchy, "paris")
                france = resolve_tag_id(hierarchy, "france")
                capitals = resolve_tag_id(hierarchy, "capitales")

            self.assertEqual(set(parent_map(hierarchy)[paris]), {france, capitals})

    def test_demotes_untouched_unused_seed_descendants_to_suggestions(self):
        labels = {slug: label for slug, label, _parents in SEED_NODES}
        parents = {slug: parent_ids for slug, _label, parent_ids in SEED_NODES if parent_ids}
        with tempfile.TemporaryDirectory() as name:
            temp_dir = Path(name)
            database_file, engine = self.build_v2_database(
                temp_dir,
                [{"type_q": "text", "question": "Linux", "answer": "Linux", "tags": ["computing"], "data": {}}],
                {"version": 2, "parents": parents, "labels": labels, "seed": {"version": 1}}
            )
            self.run_migration(temp_dir, database_file, engine)

            with Session(engine) as session:
                hierarchy = load_tag_hierarchy(session)
                computing = resolve_tag_id(hierarchy, "computing")
                biology = resolve_tag_id(hierarchy, "biology")
                suggestions = {entry["key"] for entry in tag_suggestions(hierarchy)}

            self.assertIsNotNone(computing)
            self.assertIsNone(biology)
            self.assertIn("biology", suggestions)
            self.assertNotIn("computing", suggestions)

    def test_preserves_pack_legacy_mapping_and_recomputes_only_pristine_hashes(self):
        pristine_payload = {
            "type_q": "text", "question": "pristine", "answer": "a",
            "media": None, "answer_media": None, "tags": ["Géographie"], "data": {}
        }
        with tempfile.TemporaryDirectory() as name:
            temp_dir = Path(name)
            database_file, engine = self.build_v2_database(
                temp_dir,
                [
                    {**pristine_payload, "guid": "q1", "pack_guid": "pack-a", "content_hash": content_hash(pristine_payload, QUESTION_HASH_FIELDS)},
                    {**pristine_payload, "question": "local edit", "guid": "q2", "pack_guid": "pack-a", "content_hash": "stale"}
                ],
                {"version": 2, "parents": {}, "labels": {"geography": "Géographie"}},
                {
                    "pack_guid": "pack-a", "installed_version": 1, "name": "Pack A",
                    "source": "pack.zip", "subscribed_at": "2026-01-01T00:00:00Z"
                }
            )
            self.run_migration(temp_dir, database_file, engine)

            with Session(engine) as session:
                questions = {row.guid: row for row in session.query(Question).all()}
                subscription = session.query(PackSubscription).one()
                pristine_hash = content_hash(
                    _row_canonical_payload(
                        session, questions["q1"], QUESTION_HASH_FIELDS, temp_dir / "static"
                    ),
                    QUESTION_HASH_FIELDS
                )

            self.assertEqual(subscription.tag_legacy_map["geographie"], "core:geography")
            self.assertEqual(questions["q1"].content_hash, pristine_hash)
            self.assertEqual(questions["q2"].content_hash, "stale")

    def test_rerun_is_idempotent_and_does_not_take_a_second_backup(self):
        with tempfile.TemporaryDirectory() as name:
            temp_dir = Path(name)
            database_file, engine = self.build_v2_database(
                temp_dir,
                [{"type_q": "text", "question": "a", "answer": "a", "tags": ["Sujet"], "data": {}}],
                {"version": 2, "parents": {}, "labels": {"sujet": "Sujet"}}
            )
            first = self.run_migration(temp_dir, database_file, engine)
            with Session(engine) as session:
                before = json.dumps(load_tag_hierarchy(session), sort_keys=True)
            second = self.run_migration(temp_dir, database_file, engine)
            with Session(engine) as session:
                after = json.dumps(load_tag_hierarchy(session), sort_keys=True)

            self.assertIsNotNone(first["backup"])
            self.assertEqual(second["applied"], [])
            self.assertIsNone(second["backup"])
            self.assertEqual(before, after)

    def test_existing_0023_database_adds_pack_columns_before_orm_reads(self):
        with tempfile.TemporaryDirectory() as name:
            temp_dir = Path(name)
            database_file, engine = self.build_v2_database(
                temp_dir,
                [
                    {
                        "type_q": "text",
                        "question": "Capitale de la France",
                        "answer": "Paris",
                        "tags": ["geography"],
                        "pack_guid": "pack-a",
                        "data": {}
                    }
                ],
                {
                    "version": 2,
                    "parents": {},
                    "labels": {"geography": "Géographie"}
                },
                {
                    "pack_guid": "pack-a",
                    "installed_version": 1,
                    "name": "Pack A",
                    "source": "pack.zip",
                    "subscribed_at": "2026-01-01T00:00:00Z"
                }
            )

            # Reproduce the deployed pre-v3 table: migrations 0021-0023 are
            # recorded, but the subscription metadata columns do not exist.
            with sqlite3.connect(database_file) as connection:
                for column in (
                    "tag_hierarchy_base",
                    "tag_pending",
                    "tag_conflicts",
                    "tag_legacy_map"
                ):
                    connection.execute(
                        f"ALTER TABLE pack_subscriptions DROP COLUMN {column}"
                    )

            result = self.run_migration(temp_dir, database_file, engine)

            self.assertEqual(
                [entry["version"] for entry in result["applied"]],
                ["0024"]
            )
            with sqlite3.connect(database_file) as connection:
                columns = {
                    row[1]
                    for row in connection.execute(
                        "PRAGMA table_info(pack_subscriptions)"
                    )
                }
            self.assertTrue(
                {
                    "tag_hierarchy_base",
                    "tag_pending",
                    "tag_conflicts",
                    "tag_legacy_map"
                }.issubset(columns)
            )

            with Session(engine) as session:
                subscription = session.query(PackSubscription).one()
                self.assertEqual(subscription.tag_pending, [])
                self.assertEqual(subscription.tag_conflicts, [])
                self.assertEqual(
                    subscription.tag_legacy_map["geography"],
                    "core:geography"
                )


if __name__ == "__main__":
    unittest.main()
