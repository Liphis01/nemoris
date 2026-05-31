from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Callable

from sqlalchemy.engine import Connection, Engine

from .config import BACKUP_DIR, DATABASE_FILE, STATIC_DIR
from .database import engine as default_engine
from .models import Base
from .scheduler import DEFAULT_CATCHUP_DAILY_TARGET
from .services.backups import create_backup


SCHEMA_MIGRATIONS_TABLE = "schema_migrations"
APP_TABLES = {
    "questions",
    "progress",
    "question_groups",
    "collections",
    "question_collection",
    "app_settings"
}


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    run: Callable[[Connection], None]
    requires_backup: bool = False


def _table_names(connection):
    return {
        row[0]
        for row in connection.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }


def _table_exists(connection, table_name):
    return table_name in _table_names(connection)


def _column_names(connection, table_name):
    return {
        row[1]
        for row in connection.exec_driver_sql(
            f'PRAGMA table_info("{table_name}")'
        )
    }


def _ensure_migration_table(connection):
    connection.exec_driver_sql(
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA_MIGRATIONS_TABLE} (
            version TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )


def _applied_versions(connection):
    if not _table_exists(connection, SCHEMA_MIGRATIONS_TABLE):
        return set()

    return {
        row[0]
        for row in connection.exec_driver_sql(
            f"SELECT version FROM {SCHEMA_MIGRATIONS_TABLE}"
        )
    }


def _record_migration(connection, migration):
    connection.exec_driver_sql(
        f"""
        INSERT INTO {SCHEMA_MIGRATIONS_TABLE} (version, name, applied_at)
        VALUES (?, ?, ?)
        """,
        (
            migration.version,
            migration.name,
            datetime.now(timezone.utc).isoformat()
        )
    )


def _has_existing_app_tables(target_engine, database_file):
    if not database_file or not Path(database_file).exists():
        return False

    with target_engine.connect() as connection:
        return bool(_table_names(connection) & APP_TABLES)


def _migration_initial_schema(connection):
    Base.metadata.create_all(bind=connection)


def _migration_progress_fsrs_columns(connection):
    if not _table_exists(connection, "progress"):
        return

    existing_columns = _column_names(connection, "progress")
    columns = {
        "stability": "FLOAT",
        "difficulty": "FLOAT",
        "reps": "INTEGER",
        "lapses": "INTEGER",
        "interval": "INTEGER",
        "last_review": "DATE",
        "fsrs_card": "JSON",
        "fsrs_version": "VARCHAR",
        "history": "JSON"
    }

    for column_name, column_type in columns.items():
        if column_name not in existing_columns:
            connection.exec_driver_sql(
                f"ALTER TABLE progress ADD COLUMN {column_name} {column_type}"
            )


def _migration_default_review_settings(connection):
    if not _table_exists(connection, "app_settings"):
        return

    connection.exec_driver_sql(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
        (
            "review",
            json.dumps({
                "catchup_daily_target": DEFAULT_CATCHUP_DAILY_TARGET
            })
        )
    )


def _migration_normalize_legacy_question_types(connection):
    if not _table_exists(connection, "questions"):
        return

    if "type_q" not in _column_names(connection, "questions"):
        return

    connection.exec_driver_sql(
        "UPDATE questions SET type_q = ? WHERE type_q = ?",
        ("text", "image")
    )
    connection.exec_driver_sql(
        "UPDATE questions SET type_q = ? WHERE type_q = ?",
        ("map", "map" + "_zone")
    )


MIGRATIONS = [
    Migration(
        version="0001",
        name="initial_schema",
        run=_migration_initial_schema
    ),
    Migration(
        version="0002",
        name="progress_fsrs_columns",
        run=_migration_progress_fsrs_columns,
        requires_backup=True
    ),
    Migration(
        version="0003",
        name="default_review_settings",
        run=_migration_default_review_settings
    ),
    Migration(
        version="0004",
        name="normalize_legacy_question_types",
        run=_migration_normalize_legacy_question_types,
        requires_backup=True
    )
]


def run_migrations(
    *,
    target_engine: Engine = default_engine,
    database_file: Path = DATABASE_FILE,
    static_dir: Path = STATIC_DIR,
    backup_dir: Path = BACKUP_DIR
):
    had_existing_app_tables = _has_existing_app_tables(
        target_engine,
        database_file
    )

    with target_engine.connect() as connection:
        applied_versions = _applied_versions(connection)

    pending = [
        migration
        for migration in MIGRATIONS
        if migration.version not in applied_versions
    ]
    backup = None

    if (
        had_existing_app_tables
        and any(migration.requires_backup for migration in pending)
    ):
        backup = create_backup(
            database_file=database_file,
            static_dir=static_dir,
            backup_dir=backup_dir,
            reason="migration",
            label="before-migration",
            extra_manifest={
                "pending_migrations": [
                    migration.version for migration in pending
                ]
            }
        )

    applied = []

    for migration in pending:
        with target_engine.begin() as connection:
            _ensure_migration_table(connection)

            if migration.version in _applied_versions(connection):
                continue

            migration.run(connection)
            _record_migration(connection, migration)
            applied.append({
                "version": migration.version,
                "name": migration.name
            })

    return {
        "applied": applied,
        "backup": backup.as_dict() if backup else None
    }
