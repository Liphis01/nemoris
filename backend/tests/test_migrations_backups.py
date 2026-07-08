import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from sqlalchemy import create_engine

from app.migrations import run_migrations
from app.services.backups import create_backup, restore_backup


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
                ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"]
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
            self.assertEqual(migration_count, 9)
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
                ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"]
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
                ["0005", "0006", "0007", "0008", "0009"]
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
                ["0006", "0007", "0008", "0009"]
            )

            with sqlite3.connect(database_file) as connection:
                rows = connection.execute(
                    "SELECT key FROM app_settings ORDER BY key"
                ).fetchall()

            self.assertEqual(rows, [("review",)])


if __name__ == "__main__":
    unittest.main()
