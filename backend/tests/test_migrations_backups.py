import hashlib
import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import app.migrations as migrations_module
from app.migrations import run_migrations
from app.models import Base, Question, QuestionGroup
from app.services.backups import create_backup, reset_collection, restore_backup
from app.services.settings import load_intake_settings


def sqlite_url(path):
    return f"sqlite:///{path.as_posix()}"


def table_names(database_file):
    with sqlite3.connect(database_file) as connection:
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()

    return {row[0] for row in rows}


def column_names(database_file, table_name):
    with sqlite3.connect(database_file) as connection:
        rows = connection.execute(f'PRAGMA table_info("{table_name}")').fetchall()

    return {row[1] for row in rows}


class BackupTests(unittest.TestCase):
    def test_backup_zip_contains_database_static_files_and_manifest(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"
            static_dir = temp_dir / "static"
            backup_dir = temp_dir / "backups"

            with sqlite3.connect(database_file) as connection:
                connection.execute("CREATE TABLE sample (value TEXT)")
                connection.execute("INSERT INTO sample (value) VALUES ('ok')")

            static_dir.mkdir()
            (static_dir / "image.txt").write_text("media", encoding="utf-8")

            result = create_backup(
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=backup_dir,
                reason="test",
                label="manual"
            )

            self.assertTrue(result.path.exists())

            with ZipFile(result.path) as zip_file:
                self.assertIn("questions.db", zip_file.namelist())
                self.assertIn("static/image.txt", zip_file.namelist())
                manifest = json.loads(
                    zip_file.read("backup-manifest.json").decode("utf-8")
                )

            self.assertEqual(manifest["reason"], "test")
            self.assertIn("questions.db", manifest["included"])
            self.assertIn("static/image.txt", manifest["included"])


class ResetCollectionTests(unittest.TestCase):
    def _populate(self, temp_dir):
        database_file = temp_dir / "questions.db"
        static_dir = temp_dir / "static"

        with sqlite3.connect(database_file) as connection:
            connection.execute("CREATE TABLE sample (value TEXT)")
            connection.execute("INSERT INTO sample (value) VALUES ('seeded')")

        (static_dir / "nested").mkdir(parents=True)
        (static_dir / "image.txt").write_text("media", encoding="utf-8")
        (static_dir / "nested" / "clip.txt").write_text("more", encoding="utf-8")

        return database_file, static_dir

    def test_reset_removes_database_and_media(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file, static_dir = self._populate(temp_dir)

            reset_collection(
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=temp_dir / "backups"
            )

            self.assertFalse(database_file.exists())
            self.assertTrue(static_dir.exists())
            self.assertEqual(list(static_dir.rglob("*")), [])

    def test_reset_backs_up_the_wiped_collection_first(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file, static_dir = self._populate(temp_dir)
            backup_dir = temp_dir / "backups"

            result = reset_collection(
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=backup_dir
            )

            backup_path = Path(result["backup"]["path"])
            self.assertTrue(backup_path.exists())

            with ZipFile(backup_path) as zip_file:
                self.assertIn("questions.db", zip_file.namelist())
                self.assertIn("static/image.txt", zip_file.namelist())

            # The backup must be restorable, otherwise a mistaken reset is
            # unrecoverable.
            restore_backup(
                backup_path,
                database_file=database_file,
                static_dir=static_dir
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute("SELECT value FROM sample").fetchall()

            self.assertEqual(rows, [("seeded",)])
            self.assertTrue((static_dir / "image.txt").exists())

    def test_reset_drops_stale_wal_sidecars(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file, static_dir = self._populate(temp_dir)
            wal = database_file.with_name("questions.db-wal")
            shm = database_file.with_name("questions.db-shm")
            wal.write_bytes(b"stale")
            shm.write_bytes(b"stale")

            reset_collection(
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=temp_dir / "backups"
            )

            self.assertFalse(wal.exists())
            self.assertFalse(shm.exists())

    def test_reset_without_an_existing_database_makes_no_backup(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            static_dir = temp_dir / "static"
            static_dir.mkdir()

            result = reset_collection(
                database_file=temp_dir / "questions.db",
                static_dir=static_dir,
                backup_dir=temp_dir / "backups"
            )

            self.assertIsNone(result["backup"])


class RestoreTests(unittest.TestCase):
    def _make_backup(self, temp_dir, *, rows, media):
        database_file = temp_dir / "source.db"
        static_dir = temp_dir / "source-static"
        backup_dir = temp_dir / "source-backups"

        with sqlite3.connect(database_file) as connection:
            connection.execute("CREATE TABLE sample (value TEXT)")
            connection.executemany(
                "INSERT INTO sample (value) VALUES (?)",
                [(row,) for row in rows]
            )

        static_dir.mkdir()
        for name, content in media.items():
            (static_dir / name).write_text(content, encoding="utf-8")

        result = create_backup(
            database_file=database_file,
            static_dir=static_dir,
            backup_dir=backup_dir,
            reason="test"
        )

        return result.path

    def test_restore_backup_replaces_database_and_static(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            backup_path = self._make_backup(
                temp_dir,
                rows=["from-backup"],
                media={"keep.txt": "restored"}
            )

            target_db = temp_dir / "questions.db"
            target_static = temp_dir / "static"
            target_static.mkdir()
            (target_static / "stale.txt").write_text("old", encoding="utf-8")

            with sqlite3.connect(target_db) as connection:
                connection.execute("CREATE TABLE sample (value TEXT)")
                connection.execute(
                    "INSERT INTO sample (value) VALUES ('to-be-replaced')"
                )

            result = restore_backup(
                backup_path,
                database_file=target_db,
                static_dir=target_static
            )

            self.assertIn("questions.db", result["included"])
            self.assertIn("static/keep.txt", result["included"])

            with sqlite3.connect(target_db) as connection:
                values = [
                    row[0]
                    for row in connection.execute(
                        "SELECT value FROM sample"
                    ).fetchall()
                ]

            self.assertEqual(values, ["from-backup"])
            self.assertTrue((target_static / "keep.txt").exists())
            self.assertFalse((target_static / "stale.txt").exists())

    def test_restore_backup_rejects_non_zip_archive(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            bogus = temp_dir / "not-a-backup.zip"
            bogus.write_text("definitely not a zip", encoding="utf-8")

            with self.assertRaises(ValueError):
                restore_backup(bogus)

    def test_restore_backup_rejects_archive_without_manifest(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            archive = temp_dir / "incomplete.zip"

            with ZipFile(archive, "w") as zip_file:
                zip_file.writestr("questions.db", b"")

            with self.assertRaises(ValueError):
                restore_backup(archive)

    def test_restore_backup_rejects_media_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            archive = temp_dir / "evil.zip"
            target_db = temp_dir / "questions.db"
            target_static = temp_dir / "static"

            with ZipFile(archive, "w") as zip_file:
                zip_file.writestr(
                    "backup-manifest.json",
                    json.dumps({"format": 1})
                )
                zip_file.writestr("questions.db", b"")
                zip_file.writestr("static/../escape.txt", b"nope")

            with self.assertRaises(ValueError):
                restore_backup(
                    archive,
                    database_file=target_db,
                    static_dir=target_static
                )

            # Destructive work must not run when validation fails.
            self.assertFalse(target_db.exists())

    def test_export_then_import_preserves_guids_without_duplicating(self):
        # sync-roadmap 0.1: guids must survive a real export -> import cycle,
        # and re-importing the same backup must not create duplicate rows or
        # duplicate guids (restore_backup swaps the whole file, so this is
        # structurally guaranteed -- this test proves it, not just asserts it).
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            source_db = temp_dir / "source.db"
            source_static = temp_dir / "source-static"
            backup_dir = temp_dir / "backups"
            source_static.mkdir()

            engine = create_engine(sqlite_url(source_db))
            Base.metadata.create_all(engine)

            with Session(engine) as session:
                group = QuestionGroup(type_group="map", name="G1")
                session.add(group)
                session.flush()
                session.add_all([
                    Question(type_q="map", question="Q1", group_id=group.id),
                    Question(type_q="map", question="Q2", group_id=group.id)
                ])
                session.commit()

                original_guids = sorted(
                    row.guid for row in session.query(Question).all()
                )
                original_group_guid = group.guid

            engine.dispose()

            backup_path = create_backup(
                database_file=source_db,
                static_dir=source_static,
                backup_dir=backup_dir,
                reason="test"
            ).path

            target_db = temp_dir / "target.db"
            target_static = temp_dir / "target-static"

            for attempt in range(2):
                restore_backup(
                    backup_path,
                    database_file=target_db,
                    static_dir=target_static
                )

                target_engine = create_engine(sqlite_url(target_db))

                with Session(target_engine) as session:
                    questions = session.query(Question).all()
                    guids = sorted(question.guid for question in questions)
                    group_guids = [
                        row.guid
                        for row in session.query(QuestionGroup).all()
                    ]

                target_engine.dispose()

                self.assertEqual(
                    len(questions),
                    2,
                    f"attempt {attempt}: row count changed"
                )
                self.assertEqual(guids, original_guids)
                self.assertEqual(len(set(guids)), 2)
                self.assertEqual(group_guids, [original_group_guid])


class MigrationTests(unittest.TestCase):
    def test_migrations_update_legacy_database_and_create_backup_first(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"
            backup_dir = temp_dir / "backups"
            static_dir = temp_dir / "static"

            static_dir.mkdir()
            (static_dir / "map.svg").write_text("<svg />", encoding="utf-8")

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE questions (
                        id INTEGER PRIMARY KEY,
                        type_q VARCHAR,
                        question TEXT,
                        answer TEXT,
                        media VARCHAR,
                        tags JSON,
                        data JSON,
                        group_id INTEGER
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE progress (
                        id INTEGER PRIMARY KEY,
                        question_id INTEGER UNIQUE,
                        next_review DATE
                    )
                    """
                )
                connection.execute(
                    """
                    INSERT INTO questions (
                        id,
                        type_q,
                        question,
                        answer,
                        media,
                        tags,
                        data,
                        group_id
                    )
                    VALUES (1, 'image', 'Prompt', 'Answer', NULL, '[]', '{}', NULL)
                    """
                )
                connection.execute(
                    """
                    INSERT INTO progress (id, question_id, next_review)
                    VALUES (1, 1, '2026-01-01')
                    """
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=backup_dir
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                [
                    "0001", "0002", "0003", "0004", "0005", "0006", "0007",
                    "0008", "0009", "0010", "0011", "0012", "0013", "0014",
                    "0015", "0016", "0017", "0018",
                    "0019", "0020", "0021", "0022", "0023", "0024", "0025"
                ]
            )
            self.assertIsNotNone(result["backup"])

            self.assertIn("schema_migrations", table_names(database_file))
            self.assertIn("app_settings", table_names(database_file))
            self.assertIn("collections", table_names(database_file))
            self.assertIn("data", column_names(database_file, "collections"))

            progress_columns = column_names(database_file, "progress")
            self.assertIn("stability", progress_columns)
            self.assertIn("fsrs_card", progress_columns)
            self.assertIn("history", progress_columns)
            self.assertIn("ideal_interval", progress_columns)
            self.assertIn("ideal_next_review", progress_columns)

            with sqlite3.connect(database_file) as connection:
                type_q = connection.execute(
                    "SELECT type_q FROM questions WHERE id = 1"
                ).fetchone()[0]
                setting = connection.execute(
                    "SELECT value FROM app_settings WHERE key = 'review'"
                ).fetchone()[0]
                migration_count = connection.execute(
                    "SELECT COUNT(*) FROM schema_migrations"
                ).fetchone()[0]
                ideal_interval, ideal_next_review = connection.execute(
                    """
                    SELECT ideal_interval, ideal_next_review
                    FROM progress
                    WHERE id = 1
                    """
                ).fetchone()

            self.assertEqual(type_q, "text")
            self.assertIn("catchup_daily_target", setting)
            self.assertEqual(migration_count, 25)
            self.assertEqual(ideal_interval, 0)
            self.assertEqual(ideal_next_review, "2026-01-01")

            backup_path = Path(result["backup"]["path"])

            with ZipFile(backup_path) as zip_file:
                self.assertIn("questions.db", zip_file.namelist())
                self.assertIn("static/map.svg", zip_file.namelist())
                snapshot = temp_dir / "snapshot.db"
                snapshot.write_bytes(zip_file.read("questions.db"))

            with sqlite3.connect(snapshot) as connection:
                original_type_q = connection.execute(
                    "SELECT type_q FROM questions WHERE id = 1"
                ).fetchone()[0]

            self.assertEqual(original_type_q, "image")

            second_result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=backup_dir
            )

            self.assertEqual(second_result["applied"], [])
            self.assertIsNone(second_result["backup"])

    def test_fresh_database_migrations_do_not_create_backup(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"
            engine = create_engine(sqlite_url(database_file))

            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                [
                    "0001", "0002", "0003", "0004", "0005", "0006", "0007",
                    "0008", "0009", "0010", "0011", "0012", "0013", "0014",
                    "0015", "0016", "0017", "0018",
                    "0019", "0020", "0021", "0022", "0023", "0024", "0025"
                ]
            )
            self.assertIsNone(result["backup"])
            self.assertIn("questions", table_names(database_file))
            self.assertIn("schema_migrations", table_names(database_file))

    def test_ideal_schedule_migration_backfills_from_history_then_current(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in ("0001", "0002", "0003", "0004"):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                connection.execute(
                    """
                    CREATE TABLE progress (
                        id INTEGER PRIMARY KEY,
                        question_id INTEGER UNIQUE,
                        interval INTEGER,
                        next_review DATE,
                        history JSON
                    )
                    """
                )
                connection.executemany(
                    """
                    INSERT INTO progress (
                        id,
                        question_id,
                        interval,
                        next_review,
                        history
                    )
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            1,
                            1,
                            8,
                            "2026-01-08",
                            json.dumps([
                                {
                                    "interval": 5,
                                    "next_review": "2026-01-05"
                                },
                                {
                                    "ideal_interval": 7,
                                    "ideal_next_review": "2026-01-07",
                                    "interval": 8,
                                    "next_review": "2026-01-08"
                                }
                            ])
                        ),
                        (
                            2,
                            2,
                            6,
                            "2026-01-06",
                            json.dumps([
                                {
                                    "interval": 4,
                                    "next_review": "2026-01-04"
                                }
                            ])
                        ),
                        (3, 3, 9, "2026-01-09", json.dumps([]))
                    ]
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                [
                    "0005", "0006", "0007", "0008", "0009",
                    "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018",
                    "0019", "0020", "0021", "0022", "0023", "0024", "0025"
                ]
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute(
                    """
                    SELECT id, ideal_interval, ideal_next_review
                    FROM progress
                    ORDER BY id
                    """
                ).fetchall()

            self.assertEqual(
                rows,
                [
                    (1, 7, "2026-01-07"),
                    (2, 4, "2026-01-04"),
                    (3, 9, "2026-01-09")
                ]
            )

    def test_daily_grove_setting_migration_removes_removed_habit_state(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in ("0001", "0002", "0003", "0004", "0005"):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                connection.execute(
                    """
                    CREATE TABLE app_settings (
                        key VARCHAR PRIMARY KEY,
                        value JSON NOT NULL
                    )
                    """
                )
                connection.executemany(
                    "INSERT INTO app_settings (key, value) VALUES (?, ?)",
                    [
                        ("daily_grove", json.dumps({"current_streak": 12})),
                        ("review", json.dumps({"catchup_daily_target": 50}))
                    ]
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                [
                    "0006", "0007", "0008", "0009",
                    "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018",
                    "0019", "0020", "0021", "0022", "0023", "0024", "0025"
                ]
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute(
                    "SELECT key FROM app_settings ORDER BY key"
                ).fetchall()

            self.assertEqual(rows, [("review",)])

    def test_intake_tuner_reset_migration_unsticks_the_stored_rate(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in ("0001", "0002", "0003", "0004", "0005"):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                connection.execute(
                    """
                    CREATE TABLE app_settings (
                        key VARCHAR PRIMARY KEY,
                        value JSON NOT NULL
                    )
                    """
                )
                connection.executemany(
                    "INSERT INTO app_settings (key, value) VALUES (?, ?)",
                    [
                        (
                            "review",
                            json.dumps({
                                "catchup_daily_target": 80,
                                "pace_tier": "intensif"
                            })
                        ),
                        (
                            "review_intake",
                            json.dumps({
                                "effective_daily_target": 64,
                                "tuned_on": "2026-08-04",
                                "up_streak": 0,
                                "last_completion_ratio": 0.8578
                            })
                        )
                    ]
                )

            engine = create_engine(sqlite_url(database_file))
            run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute(
                    "SELECT key FROM app_settings WHERE key = 'review_intake'"
                ).fetchall()

            self.assertEqual(rows, [])

            # The point of the migration: the tier the user chose is what they
            # get back, instead of a rate earned under the deleted rule.
            session = Session(bind=engine)

            try:
                state = load_intake_settings(session, 80)
            finally:
                session.close()

            self.assertEqual(state["effective_daily_target"], 80)
            self.assertEqual(state["rate_ratio"], 1.0)
            self.assertIsNone(state["tuned_on"])
            self.assertIsNone(state["last_schedule_pressure"])

    def test_content_guid_migration_backfills_and_indexes(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in (
                    "0001", "0002", "0003", "0004", "0005",
                    "0006", "0007", "0008", "0009"
                ):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                # Legacy content tables without the guid column.
                connection.execute(
                    """
                    CREATE TABLE questions (
                        id INTEGER PRIMARY KEY,
                        type_q VARCHAR,
                        question TEXT,
                        answer TEXT,
                        media VARCHAR,
                        answer_media VARCHAR,
                        tags JSON,
                        data JSON,
                        group_id INTEGER
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE question_groups (
                        id INTEGER PRIMARY KEY,
                        type_group VARCHAR,
                        name VARCHAR
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE collections (
                        id INTEGER PRIMARY KEY,
                        name VARCHAR UNIQUE
                    )
                    """
                )
                connection.executemany(
                    "INSERT INTO questions (id, type_q, question) VALUES (?, ?, ?)",
                    [(1, "text", "Q1"), (2, "map", "Q2")]
                )
                connection.executemany(
                    "INSERT INTO question_groups (id, type_group, name) VALUES (?, ?, ?)",
                    [(1, "map", "G1"), (2, "media", "G2")]
                )
                connection.executemany(
                    "INSERT INTO collections (id, name) VALUES (?, ?)",
                    [(1, "C1"), (2, "C2")]
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                ["0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025"]
            )

            guids = {}

            for table in ("questions", "question_groups", "collections"):
                self.assertIn("guid", column_names(database_file, table))

                with sqlite3.connect(database_file) as connection:
                    rows = connection.execute(
                        f"SELECT id, guid FROM {table} ORDER BY id"
                    ).fetchall()
                    indexes = connection.execute(
                        f'PRAGMA index_list("{table}")'
                    ).fetchall()

                values = [guid for _, guid in rows]
                self.assertEqual(len(values), 2)
                self.assertEqual(len(set(values)), 2)

                for value in values:
                    uuid.UUID(value)

                unique_indexes = {
                    row[1] for row in indexes if row[2] == 1
                }
                self.assertIn(f"ix_{table}_guid", unique_indexes)

                guids[table] = rows

            # Re-running is a no-op and keeps the backfilled guids stable.
            second_result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(second_result["applied"], [])

            for table, expected in guids.items():
                with sqlite3.connect(database_file) as connection:
                    rows = connection.execute(
                        f"SELECT id, guid FROM {table} ORDER BY id"
                    ).fetchall()

                self.assertEqual(rows, expected)

            # New ORM rows get a guid from the column default.
            with Session(engine) as session:
                question = Question(type_q="text", question="Q3")
                session.add(question)
                session.commit()
                session.refresh(question)

                uuid.UUID(question.guid)
                self.assertNotIn(
                    question.guid,
                    [guid for _, guid in guids["questions"]]
                )

    def test_review_log_migration_backfills_history_entries(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"

            entries = [
                {
                    "reviewed_on": "2026-01-01",
                    "quality": 0,
                    "stability": 1.2,
                    "difficulty": 6.0,
                    "reps": 1,
                    "lapses": 1,
                    "interval": 0,
                    "next_review": "2026-01-01",
                    "ideal_interval": 0,
                    "ideal_next_review": "2026-01-01",
                    "fsrs_rating": 1,
                    "mode": "typing"
                },
                {
                    "reviewed_on": "2026-01-02",
                    "quality": 2,
                    "stability": 3.4,
                    "difficulty": 5.5,
                    "reps": 2,
                    "lapses": 1,
                    "interval": 3,
                    "next_review": "2026-01-05",
                    "ideal_interval": 3,
                    "ideal_next_review": "2026-01-05"
                }
            ]

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in (
                    "0001", "0002", "0003", "0004", "0005",
                    "0006", "0007", "0008", "0009", "0010"
                ):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                connection.execute(
                    """
                    CREATE TABLE questions (
                        id INTEGER PRIMARY KEY,
                        guid VARCHAR,
                        type_q VARCHAR,
                        question TEXT
                    )
                    """
                )
                # Full modern column set: migration 0012 queries the Progress
                # ORM against this table. Stored values match the latest
                # entry so no reconciliation row is appended here.
                connection.execute(
                    """
                    CREATE TABLE progress (
                        id INTEGER PRIMARY KEY,
                        question_id INTEGER,
                        stability FLOAT,
                        difficulty FLOAT,
                        reps INTEGER,
                        lapses INTEGER,
                        interval INTEGER,
                        ideal_interval INTEGER,
                        last_review DATE,
                        next_review DATE,
                        ideal_next_review DATE,
                        fsrs_card JSON,
                        fsrs_version VARCHAR,
                        history JSON
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO questions (id, guid, type_q, question) "
                    "VALUES (1, 'guid-1', 'text', 'Q1')"
                )
                connection.executemany(
                    """
                    INSERT INTO progress (
                        id, question_id, stability, difficulty, reps, lapses,
                        interval, ideal_interval, last_review, next_review,
                        ideal_next_review, history
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            1, 1, 3.4, 5.5, 2, 1, 3, 3,
                            "2026-01-02", "2026-01-05", "2026-01-05",
                            json.dumps(entries)
                        ),
                        (
                            2, 2, 1.2, 6.0, 1, 1, 0, 0,
                            "2026-01-01", "2026-01-01", "2026-01-01",
                            json.dumps([entries[0]])
                        )
                    ]
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                ["0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025"]
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute(
                    """
                    SELECT question_id, question_guid, seq, reviewed_on,
                           reviewed_at, quality, stability, next_review,
                           superseded_by, data
                    FROM review_log
                    ORDER BY question_id, seq
                    """
                ).fetchall()

            self.assertEqual(len(rows), 3)

            first, second, orphan = rows

            self.assertEqual(first[0], 1)
            self.assertEqual(first[1], "guid-1")
            self.assertEqual(first[2], 1)
            self.assertEqual(first[3], "2026-01-01")
            self.assertIsNone(first[4])
            self.assertEqual(first[5], 0)
            self.assertEqual(first[6], 1.2)
            self.assertEqual(first[7], "2026-01-01")
            self.assertIsNone(first[8])
            self.assertEqual(json.loads(first[9]), entries[0])

            self.assertEqual(second[2], 2)
            self.assertEqual(second[5], 2)
            self.assertEqual(json.loads(second[9]), entries[1])

            # A progress row whose question is missing still migrates, with a
            # NULL guid.
            self.assertEqual(orphan[0], 2)
            self.assertIsNone(orphan[1])
            self.assertEqual(orphan[2], 1)

            # Re-running is a no-op: no duplicated rows.
            second_result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(second_result["applied"], [])

            with sqlite3.connect(database_file) as connection:
                count = connection.execute(
                    "SELECT COUNT(*) FROM review_log"
                ).fetchone()[0]

            self.assertEqual(count, 3)

    def test_reconcile_migration_appends_manual_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"

            entry = {
                "reviewed_on": "2026-01-01",
                "quality": 0,
                "stability": 1.2,
                "difficulty": 6.0,
                "reps": 1,
                "lapses": 1,
                "interval": 0,
                "next_review": "2026-01-01",
                "ideal_interval": 0,
                "ideal_next_review": "2026-01-01"
            }

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in (
                    "0001", "0002", "0003", "0004", "0005",
                    "0006", "0007", "0008", "0009", "0010"
                ):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                connection.execute(
                    """
                    CREATE TABLE questions (
                        id INTEGER PRIMARY KEY,
                        guid VARCHAR,
                        type_q VARCHAR,
                        question TEXT
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE progress (
                        id INTEGER PRIMARY KEY,
                        question_id INTEGER,
                        stability FLOAT,
                        difficulty FLOAT,
                        reps INTEGER,
                        lapses INTEGER,
                        interval INTEGER,
                        ideal_interval INTEGER,
                        last_review DATE,
                        next_review DATE,
                        ideal_next_review DATE,
                        fsrs_card JSON,
                        fsrs_version VARCHAR,
                        history JSON
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO questions (id, guid, type_q, question) "
                    "VALUES (1, 'guid-1', 'text', 'Q1')"
                )
                # Stored ideal_* diverge from the entry: a historical
                # graduation moved them without a history trace.
                connection.execute(
                    """
                    INSERT INTO progress (
                        id, question_id, stability, difficulty, reps, lapses,
                        interval, ideal_interval, last_review, next_review,
                        ideal_next_review, history
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        1, 1, 1.2, 6.0, 1, 1, 1, 1,
                        "2026-01-01", "2026-01-02", "2026-01-02",
                        json.dumps([entry])
                    )
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                ["0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025"]
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute(
                    """
                    SELECT seq, quality, ideal_interval, ideal_next_review,
                           data
                    FROM review_log
                    WHERE question_id = 1
                    ORDER BY seq
                    """
                ).fetchall()

            self.assertEqual(len(rows), 2)

            backfilled, manual = rows

            self.assertEqual(backfilled[0], 1)
            self.assertEqual(backfilled[1], 0)

            self.assertEqual(manual[0], 2)
            self.assertIsNone(manual[1])
            self.assertEqual(manual[2], 1)
            self.assertEqual(manual[3], "2026-01-02")
            self.assertEqual(
                json.loads(manual[4]).get("manual"),
                "reconcile_history_snapshot"
            )

    def test_tombstones_migration_backfills_orphaned_revlog_guids(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in (
                    "0001", "0002", "0003", "0004", "0005", "0006",
                    "0007", "0008", "0009", "0010", "0011", "0012"
                ):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                connection.execute(
                    "CREATE TABLE questions (id INTEGER PRIMARY KEY)"
                )
                connection.execute("INSERT INTO questions (id) VALUES (1)")
                connection.execute(
                    """
                    CREATE TABLE review_log (
                        id INTEGER PRIMARY KEY,
                        question_id INTEGER,
                        question_guid VARCHAR,
                        seq INTEGER
                    )
                    """
                )
                connection.executemany(
                    "INSERT INTO review_log "
                    "(id, question_id, question_guid, seq) "
                    "VALUES (?, ?, ?, ?)",
                    [
                        (1, 99, "deleted-question-guid", 1),
                        (2, 99, "deleted-question-guid", 2),
                        (3, 1, "alive-guid", 1)
                    ]
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=temp_dir / "static",
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                ["0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025"]
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute(
                    "SELECT entity_type, guid FROM tombstones"
                ).fetchall()

            self.assertEqual(rows, [("question", "deleted-question-guid")])

    def test_media_registry_migration_hashes_static_files(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"
            static_dir = temp_dir / "static"

            (static_dir / "sub").mkdir(parents=True)
            (static_dir / "a.svg").write_bytes(b"<svg />")
            (static_dir / "sub" / "b.svg").write_bytes(b"<svg />")
            (static_dir / "c.txt").write_bytes(b"other")

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in (
                    "0001", "0002", "0003", "0004", "0005", "0006", "0007",
                    "0008", "0009", "0010", "0011", "0012", "0013"
                ):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                ["0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025"]
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute(
                    "SELECT path, sha256, byte_size FROM media_files "
                    "ORDER BY path"
                ).fetchall()

            self.assertEqual(
                [row[0] for row in rows],
                ["a.svg", "c.txt", "sub/b.svg"]
            )
            # Identical content hashes identically; different content differs.
            by_path = {row[0]: row[1] for row in rows}
            self.assertEqual(by_path["a.svg"], by_path["sub/b.svg"])
            self.assertNotEqual(by_path["a.svg"], by_path["c.txt"])
            self.assertEqual(rows[0][2], len(b"<svg />"))

            # Re-run is a no-op.
            second = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=temp_dir / "backups"
            )
            self.assertEqual(second["applied"], [])

            with sqlite3.connect(database_file) as connection:
                count = connection.execute(
                    "SELECT COUNT(*) FROM media_files"
                ).fetchone()[0]

            self.assertEqual(count, 3)

    def test_pack_bookkeeping_migration_adds_columns_and_table(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"
            static_dir = temp_dir / "static"

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in (
                    "0001", "0002", "0003", "0004", "0005", "0006", "0007",
                    "0008", "0009", "0010", "0011", "0012", "0013", "0014"
                ):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                # Post-0010 shape: real tables already carry guid.
                connection.execute(
                    """
                    CREATE TABLE questions (
                        id INTEGER PRIMARY KEY,
                        guid VARCHAR,
                        type_q VARCHAR,
                        question TEXT
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE question_groups (
                        id INTEGER PRIMARY KEY,
                        guid VARCHAR,
                        type_group VARCHAR,
                        name VARCHAR
                    )
                    """
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                ["0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025"]
            )

            self.assertIn("pack_subscriptions", table_names(database_file))

            for table in ("questions", "question_groups"):
                columns = column_names(database_file, table)
                self.assertIn("pack_guid", columns)
                self.assertIn("pack_version", columns)
                self.assertIn("content_hash", columns)

            with sqlite3.connect(database_file) as connection:
                # Nullable, no backfill: pre-existing rows stay NULL.
                connection.execute(
                    "INSERT INTO questions (id, guid, type_q, question) "
                    "VALUES (1, 'q-guid', 'text', 'Q1')"
                )
                pack_guid = connection.execute(
                    "SELECT pack_guid FROM questions WHERE id = 1"
                ).fetchone()[0]

            self.assertIsNone(pack_guid)

            # Re-run is a no-op.
            second = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=temp_dir / "backups"
            )
            self.assertEqual(second["applied"], [])

    def test_pack_terminology_migration_renames_legacy_pack_tables(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"
            static_dir = temp_dir / "static"

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in (
                    "0001", "0002", "0003", "0004", "0005", "0006", "0007",
                    "0008", "0009", "0010", "0011", "0012", "0013", "0014",
                    "0015", "0016"
                ):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                connection.execute(
                    """
                    CREATE TABLE questions (
                        id INTEGER PRIMARY KEY,
                        guid VARCHAR,
                        blueprint_guid VARCHAR,
                        blueprint_version INTEGER,
                        content_hash VARCHAR
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE question_groups (
                        id INTEGER PRIMARY KEY,
                        guid VARCHAR,
                        blueprint_guid VARCHAR,
                        blueprint_version INTEGER,
                        content_hash VARCHAR
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE blueprint_subscriptions (
                        id INTEGER PRIMARY KEY,
                        blueprint_guid VARCHAR UNIQUE NOT NULL,
                        installed_version INTEGER NOT NULL,
                        name VARCHAR,
                        source VARCHAR,
                        subscribed_at VARCHAR NOT NULL,
                        updated_at VARCHAR
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE app_settings (
                        key VARCHAR PRIMARY KEY,
                        value JSON NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    INSERT INTO questions (
                        id, guid, blueprint_guid, blueprint_version, content_hash
                    ) VALUES (1, 'q-guid', 'pack-guid', 2, 'hash-q')
                    """
                )
                connection.execute(
                    """
                    INSERT INTO question_groups (
                        id, guid, blueprint_guid, blueprint_version, content_hash
                    ) VALUES (1, 'pack-guid', 'pack-guid', 2, 'hash-g')
                    """
                )
                connection.execute(
                    """
                    INSERT INTO blueprint_subscriptions (
                        id, blueprint_guid, installed_version, name, source,
                        subscribed_at
                    ) VALUES (
                        1, 'pack-guid', 2, 'World', 'world.zip',
                        '2026-07-22T10:00:00Z'
                    )
                    """
                )
                connection.execute(
                    """
                    INSERT INTO app_settings (key, value)
                    VALUES ('blueprint_catalog', '{"url":"https://project.supabase.co"}')
                    """
                )

            engine = create_engine(sqlite_url(database_file))
            result = run_migrations(
                target_engine=engine,
                database_file=database_file,
                static_dir=static_dir,
                backup_dir=temp_dir / "backups"
            )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                ["0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025"]
            )
            self.assertIn("pack_subscriptions", table_names(database_file))
            self.assertNotIn("blueprint_subscriptions", table_names(database_file))

            for table in ("questions", "question_groups", "pack_subscriptions"):
                columns = column_names(database_file, table)
                self.assertIn("pack_guid", columns)
                self.assertNotIn("blueprint_guid", columns)

            for table in ("questions", "question_groups"):
                columns = column_names(database_file, table)
                self.assertIn("pack_version", columns)
                self.assertNotIn("blueprint_version", columns)

            with sqlite3.connect(database_file) as connection:
                question_row = connection.execute(
                    "SELECT pack_guid, pack_version FROM questions WHERE id = 1"
                ).fetchone()
                subscription_row = connection.execute(
                    """
                    SELECT pack_guid, installed_version
                    FROM pack_subscriptions
                    WHERE id = 1
                    """
                ).fetchone()
                setting_row = connection.execute(
                    "SELECT value FROM app_settings WHERE key = 'pack_catalog'"
                ).fetchone()
                old_setting = connection.execute(
                    "SELECT 1 FROM app_settings WHERE key = 'blueprint_catalog'"
                ).fetchone()

            self.assertEqual(question_row, ("pack-guid", 2))
            self.assertEqual(subscription_row, ("pack-guid", 2))
            self.assertIsNotNone(setting_row)
            self.assertIsNone(old_setting)

    def test_localize_legacy_map_media_migration(self):
        with tempfile.TemporaryDirectory() as temp_name:
            temp_dir = Path(temp_name)
            database_file = temp_dir / "questions.db"
            static_dir = temp_dir / "static"
            source_dir = temp_dir / "legacy-maps"
            source_dir.mkdir()

            svg_bytes = b"<svg><g /></svg>"
            (source_dir / "world.svg").write_bytes(svg_bytes)
            # "unknown.svg" is referenced by a row but not present anywhere
            # in the candidate dirs -- must be left untouched, not crash.

            with sqlite3.connect(database_file) as connection:
                connection.execute(
                    """
                    CREATE TABLE schema_migrations (
                        version TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        applied_at TEXT NOT NULL
                    )
                    """
                )

                for version in (
                    "0001", "0002", "0003", "0004", "0005", "0006", "0007",
                    "0008", "0009", "0010", "0011", "0012", "0013", "0014",
                    "0015"
                ):
                    connection.execute(
                        """
                        INSERT INTO schema_migrations (version, name, applied_at)
                        VALUES (?, ?, ?)
                        """,
                        (version, f"migration-{version}", "2026-01-01")
                    )

                connection.execute(
                    """
                    CREATE TABLE question_groups (
                        id INTEGER PRIMARY KEY,
                        type_group VARCHAR,
                        name VARCHAR,
                        media VARCHAR
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE questions (
                        id INTEGER PRIMARY KEY,
                        type_q VARCHAR,
                        media VARCHAR,
                        answer_media VARCHAR
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE media_files (
                        id INTEGER PRIMARY KEY,
                        path VARCHAR UNIQUE NOT NULL,
                        sha256 VARCHAR NOT NULL,
                        byte_size INTEGER
                    )
                    """
                )
                connection.executemany(
                    "INSERT INTO question_groups (id, type_group, name, media) "
                    "VALUES (?, ?, ?, ?)",
                    [
                        (1, "map", "World", "world.svg"),
                        # Two groups sharing the same legacy file must dedup
                        # to a single stored file / MediaFile row.
                        (2, "map", "World again", "world.svg"),
                        (3, "map", "Missing", "unknown.svg"),
                        (4, "media", "Real upload", "/static/existing.png"),
                        (5, "media", "External", "https://example.com/x.png")
                    ]
                )
                connection.execute(
                    "INSERT INTO questions (id, type_q, media, answer_media) "
                    "VALUES (1, 'text', NULL, NULL)"
                )

            engine = create_engine(sqlite_url(database_file))

            with patch.object(
                migrations_module,
                "_LEGACY_MAP_SOURCE_DIRS",
                [source_dir]
            ):
                result = run_migrations(
                    target_engine=engine,
                    database_file=database_file,
                    static_dir=static_dir,
                    backup_dir=temp_dir / "backups"
                )

            self.assertEqual(
                [migration["version"] for migration in result["applied"]],
                ["0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025"]
            )

            digest = hashlib.sha256(svg_bytes).hexdigest()
            stored_name = f"{digest}.svg"

            with sqlite3.connect(database_file) as connection:
                media_by_id = dict(
                    connection.execute(
                        "SELECT id, media FROM question_groups ORDER BY id"
                    ).fetchall()
                )
                media_file_count = connection.execute(
                    "SELECT COUNT(*) FROM media_files WHERE path = ?",
                    (stored_name,)
                ).fetchone()[0]

            self.assertEqual(media_by_id[1], f"/static/{stored_name}")
            self.assertEqual(media_by_id[2], f"/static/{stored_name}")
            # Unresolvable legacy value: left exactly as-is.
            self.assertEqual(media_by_id[3], "unknown.svg")
            # Real upload and external URL: untouched.
            self.assertEqual(media_by_id[4], "/static/existing.png")
            self.assertEqual(media_by_id[5], "https://example.com/x.png")
            # Deduped: one row, one file, despite two groups referencing it.
            self.assertEqual(media_file_count, 1)
            self.assertTrue((static_dir / stored_name).exists())
            self.assertEqual(
                (static_dir / stored_name).read_bytes(), svg_bytes
            )

            # Re-run is a no-op.
            with patch.object(
                migrations_module,
                "_LEGACY_MAP_SOURCE_DIRS",
                [source_dir]
            ):
                second = run_migrations(
                    target_engine=engine,
                    database_file=database_file,
                    static_dir=static_dir,
                    backup_dir=temp_dir / "backups"
                )
            self.assertEqual(second["applied"], [])


if __name__ == "__main__":
    unittest.main()
