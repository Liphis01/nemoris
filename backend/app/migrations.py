from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Callable
import uuid

from sqlalchemy.engine import Connection, Engine

from .config import BACKUP_DIR, DATABASE_FILE, STATIC_DIR
from .database import engine as default_engine
from .models import Base, ReviewLog
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
    # Migrations touching files under static/ receive the static dir as a
    # second argument so tests can point them at a fixture directory.
    needs_static_dir: bool = False


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


def _parse_migration_date(value):
    if not value:
        return None

    if isinstance(value, datetime):
        return value.date().isoformat()

    if isinstance(value, date):
        return value.isoformat()

    text = str(value)

    try:
        return datetime.fromisoformat(text).date().isoformat()
    except ValueError:
        try:
            return date.fromisoformat(text).isoformat()
        except ValueError:
            return None


def _parse_migration_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_migration_history(value):
    if not value:
        return []

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return []

    if not isinstance(value, list):
        return []

    return [
        entry
        for entry in value
        if isinstance(entry, dict)
    ]


def _history_schedule(history, interval_field, date_field):
    for entry in reversed(history):
        interval = _parse_migration_int(entry.get(interval_field))
        next_review = _parse_migration_date(entry.get(date_field))

        if interval is not None and next_review:
            return interval, next_review

    return None


def _migration_progress_ideal_schedule_columns(connection):
    if not _table_exists(connection, "progress"):
        return

    existing_columns = _column_names(connection, "progress")
    columns = {
        "ideal_interval": "INTEGER",
        "ideal_next_review": "DATE"
    }

    for column_name, column_type in columns.items():
        if column_name not in existing_columns:
            connection.exec_driver_sql(
                f"ALTER TABLE progress ADD COLUMN {column_name} {column_type}"
            )

    rows = connection.exec_driver_sql(
        """
        SELECT id, interval, next_review, history, ideal_interval, ideal_next_review
        FROM progress
        """
    ).fetchall()

    for row in rows:
        (
            progress_id,
            interval,
            next_review,
            history,
            ideal_interval,
            ideal_next_review
        ) = row

        if ideal_interval is not None and ideal_next_review:
            continue

        history_items = _parse_migration_history(history)
        scheduling = (
            _history_schedule(
                history_items,
                "ideal_interval",
                "ideal_next_review"
            )
            or _history_schedule(history_items, "interval", "next_review")
        )

        if not scheduling:
            current_next_review = _parse_migration_date(next_review)

            if not current_next_review:
                continue

            scheduling = (
                _parse_migration_int(interval) or 0,
                current_next_review
            )

        connection.exec_driver_sql(
            """
            UPDATE progress
            SET ideal_interval = ?, ideal_next_review = ?
            WHERE id = ?
            """,
            (
                scheduling[0],
                scheduling[1],
                progress_id
            )
        )


def _migration_remove_daily_grove_setting(connection):
    if not _table_exists(connection, "app_settings"):
        return

    connection.exec_driver_sql(
        "DELETE FROM app_settings WHERE key = ?",
        ("daily_grove",)
    )


def _migration_collection_data_column(connection):
    if not _table_exists(connection, "collections"):
        return

    if "data" not in _column_names(connection, "collections"):
        connection.exec_driver_sql(
            "ALTER TABLE collections ADD COLUMN data JSON"
        )


def _migration_questions_answer_media_column(connection):
    if not _table_exists(connection, "questions"):
        return

    if "answer_media" not in _column_names(connection, "questions"):
        connection.exec_driver_sql(
            "ALTER TABLE questions ADD COLUMN answer_media VARCHAR"
        )


def _migration_rename_image_type_to_media(connection):
    # The image-group feature was generalised into a media group that also holds
    # audio and video. Rename the persisted type value; the review-mode vocabulary
    # (progress.history "image_mode") is unrelated and intentionally left alone.
    if (
        _table_exists(connection, "questions") and
        "type_q" in _column_names(connection, "questions")
    ):
        connection.exec_driver_sql(
            "UPDATE questions SET type_q = ? WHERE type_q = ?",
            ("media", "image")
        )

    if (
        _table_exists(connection, "question_groups") and
        "type_group" in _column_names(connection, "question_groups")
    ):
        connection.exec_driver_sql(
            "UPDATE question_groups SET type_group = ? WHERE type_group = ?",
            ("media", "image")
        )


_GUID_TABLES = ("questions", "question_groups", "collections")


def _migration_content_guid_columns(connection):
    # SQLite cannot add a UNIQUE column through ALTER TABLE, so the column is
    # added plain, backfilled, then enforced by a separate unique index named
    # like the one create_all builds for fresh databases (ix_<table>_guid).
    for table in _GUID_TABLES:
        if not _table_exists(connection, table):
            continue

        if "guid" not in _column_names(connection, table):
            connection.exec_driver_sql(
                f"ALTER TABLE {table} ADD COLUMN guid VARCHAR"
            )

        rows = connection.exec_driver_sql(
            f"SELECT id FROM {table} WHERE guid IS NULL"
        ).fetchall()

        for (row_id,) in rows:
            connection.exec_driver_sql(
                f"UPDATE {table} SET guid = ? WHERE id = ?",
                (str(uuid.uuid4()), row_id)
            )

        connection.exec_driver_sql(
            f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{table}_guid "
            f"ON {table} (guid)"
        )


def _migration_review_log_table(connection):
    # Create the table from the model so there is a single schema definition.
    Base.metadata.create_all(bind=connection, tables=[ReviewLog.__table__])

    # Both tables always exist on a real post-0001 database; hand-built legacy
    # fixtures in tests may lack one of them.
    if not _table_exists(connection, "progress"):
        return

    if not _table_exists(connection, "questions"):
        return

    # Only backfill into an empty table so a re-entered migration cannot
    # duplicate rows.
    existing = connection.exec_driver_sql(
        "SELECT COUNT(*) FROM review_log"
    ).fetchone()[0]

    if existing:
        return

    rows = connection.exec_driver_sql(
        """
        SELECT progress.question_id, progress.history, questions.guid
        FROM progress
        LEFT JOIN questions ON questions.id = progress.question_id
        WHERE progress.history IS NOT NULL
          AND progress.question_id IS NOT NULL
        """
    ).fetchall()

    for question_id, history_value, question_guid in rows:
        if isinstance(history_value, str):
            try:
                entries = json.loads(history_value)
            except ValueError:
                continue
        else:
            entries = history_value or []

        if not isinstance(entries, list):
            continue

        seq = 0

        for entry in entries:
            if not isinstance(entry, dict):
                continue

            seq += 1
            # Promoted columns are best-effort copies for querying; the full
            # entry in data stays authoritative. Legacy entries are date-only,
            # so reviewed_at is NULL for migrated rows.
            connection.exec_driver_sql(
                """
                INSERT INTO review_log (
                    question_id, question_guid, seq, reviewed_on, reviewed_at,
                    quality, stability, difficulty, reps, lapses, interval,
                    next_review, ideal_interval, ideal_next_review,
                    superseded_by, data
                ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    question_id,
                    question_guid,
                    seq,
                    entry.get("reviewed_on"),
                    entry.get("quality"),
                    entry.get("stability"),
                    entry.get("difficulty"),
                    entry.get("reps"),
                    entry.get("lapses"),
                    entry.get("interval"),
                    entry.get("next_review"),
                    entry.get("ideal_interval"),
                    entry.get("ideal_next_review"),
                    json.dumps(entry)
                )
            )


def _migration_media_files_registry(connection, static_dir):
    from .models import MediaFile

    Base.metadata.create_all(bind=connection, tables=[MediaFile.__table__])

    # Only backfill into an empty registry so a re-entered migration cannot
    # duplicate rows.
    existing = connection.exec_driver_sql(
        "SELECT COUNT(*) FROM media_files"
    ).fetchone()[0]

    if existing:
        return

    static_dir = Path(static_dir)

    if not static_dir.exists():
        return

    for path in sorted(static_dir.rglob("*")):
        if not path.is_file():
            continue

        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        relative = path.relative_to(static_dir).as_posix()
        connection.exec_driver_sql(
            """
            INSERT INTO media_files (path, sha256, byte_size)
            VALUES (?, ?, ?)
            """,
            (relative, digest, path.stat().st_size)
        )


def _migration_reconcile_revlog_snapshots(connection):
    # Local imports: the ORM session and services are only needed here, and
    # importing them lazily keeps migration module import light.
    from sqlalchemy.orm import Session

    from .models import Progress
    from .services.progress import append_manual_review_log
    from .services.revlog import strict_mismatch_fields

    if not _table_exists(connection, "review_log"):
        return

    if not _table_exists(connection, "progress"):
        return

    # A real database that reached this point went through 0002/0005 and has
    # the full Progress column set; hand-built legacy fixtures in tests may
    # not, and the ORM query below needs every mapped column.
    progress_columns = _column_names(connection, "progress")

    if not {"stability", "ideal_interval", "history"} <= progress_columns:
        return

    # Schedule adjustments made outside graded reviews (historical "Acquis"
    # graduations) predate manual revlog rows, so restore-from-revlog cannot
    # reproduce them. Append one manual snapshot row per divergent card so the
    # revlog becomes a faithful source of truth (validate-revlog gate → 100%).
    session = Session(bind=connection)

    for progress in session.query(Progress).all():
        if progress.question_id is None:
            continue

        mismatched, _ = strict_mismatch_fields(session, progress)

        if mismatched:
            append_manual_review_log(
                session,
                progress,
                "reconcile_history_snapshot"
            )

    session.flush()


def _migration_tombstones_table(connection):
    from .models import Tombstone

    Base.metadata.create_all(bind=connection, tables=[Tombstone.__table__])

    # Questions deleted before this table existed left orphaned revlog rows;
    # their guids are recoverable from there, so backfill their tombstones.
    if not _table_exists(connection, "review_log"):
        return

    if not _table_exists(connection, "questions"):
        return

    deleted_at = datetime.now(timezone.utc).isoformat()
    orphan_guids = connection.exec_driver_sql(
        """
        SELECT DISTINCT question_guid
        FROM review_log
        WHERE question_guid IS NOT NULL
          AND question_id NOT IN (SELECT id FROM questions)
        """
    ).fetchall()

    for (guid,) in orphan_guids:
        connection.exec_driver_sql(
            """
            INSERT INTO tombstones (entity_type, guid, deleted_at)
            VALUES (?, ?, ?)
            """,
            ("question", guid, deleted_at)
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
    ),
    Migration(
        version="0005",
        name="progress_ideal_schedule_columns",
        run=_migration_progress_ideal_schedule_columns,
        requires_backup=True
    ),
    Migration(
        version="0006",
        name="remove_daily_grove_setting",
        run=_migration_remove_daily_grove_setting
    ),
    Migration(
        version="0007",
        name="collection_data_column",
        run=_migration_collection_data_column
    ),
    Migration(
        version="0008",
        name="questions_answer_media_column",
        run=_migration_questions_answer_media_column,
        requires_backup=True
    ),
    Migration(
        version="0009",
        name="rename_image_type_to_media",
        run=_migration_rename_image_type_to_media,
        requires_backup=True
    ),
    Migration(
        version="0010",
        name="content_guid_columns",
        run=_migration_content_guid_columns,
        requires_backup=True
    ),
    Migration(
        version="0011",
        name="review_log_table",
        run=_migration_review_log_table,
        requires_backup=True
    ),
    Migration(
        version="0012",
        name="reconcile_revlog_snapshots",
        run=_migration_reconcile_revlog_snapshots,
        requires_backup=True
    ),
    Migration(
        version="0013",
        name="tombstones_table",
        run=_migration_tombstones_table
    ),
    Migration(
        version="0014",
        name="media_files_registry",
        run=_migration_media_files_registry,
        needs_static_dir=True
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

            if migration.needs_static_dir:
                migration.run(connection, static_dir)
            else:
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
