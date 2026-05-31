import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from sqlalchemy import create_engine

from app.migrations import run_migrations
from app.services.backups import create_backup


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
                ["0001", "0002", "0003", "0004"]
            )
            self.assertIsNotNone(result["backup"])

            self.assertIn("schema_migrations", table_names(database_file))
            self.assertIn("app_settings", table_names(database_file))
            self.assertIn("collections", table_names(database_file))

            progress_columns = column_names(database_file, "progress")
            self.assertIn("stability", progress_columns)
            self.assertIn("fsrs_card", progress_columns)
            self.assertIn("history", progress_columns)

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

            self.assertEqual(type_q, "text")
            self.assertIn("catchup_daily_target", setting)
            self.assertEqual(migration_count, 4)

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
                ["0001", "0002", "0003", "0004"]
            )
            self.assertIsNone(result["backup"])
            self.assertIn("questions", table_names(database_file))
            self.assertIn("schema_migrations", table_names(database_file))


if __name__ == "__main__":
    unittest.main()
