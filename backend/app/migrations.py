from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import json
import re
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse
import uuid

from sqlalchemy.engine import Connection, Engine

from .config import BACKUP_DIR, DATABASE_FILE, FRONTEND_DIST_DIR, PROJECT_DIR, STATIC_DIR
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


def _migration_map_package_v2_capability(connection):
    # Capability gate only. Map content is upgraded explicitly per group so
    # progress and source identity are never changed by merely launching.
    return None


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


def _migration_reset_intake_tuner(connection):
    # The intake tuner's second signal changed from a review-volume ratio to
    # schedule pressure. A rate earned under the old rule is not comparable to
    # one earned under the new one, and save_review_settings only resets the
    # tuner when the tier NUMBER changes, so re-picking the same tier would
    # leave a stuck user stuck. Dropping the row is equivalent to
    # reset_intake_settings: load_intake_settings normalizes a missing row back
    # to the tier seed, and it also clears the obsolete last_completion_ratio
    # key instead of leaving it on disk as dead JSON.
    from .services.settings import INTAKE_SETTINGS_KEY

    if not _table_exists(connection, "app_settings"):
        return

    connection.exec_driver_sql(
        "DELETE FROM app_settings WHERE key = ?",
        (INTAKE_SETTINGS_KEY,)
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


def _migration_pack_bookkeeping(connection):
    from .models import PackSubscription

    new_columns = {
        "pack_guid": "VARCHAR",
        "pack_version": "INTEGER",
        "content_hash": "VARCHAR"
    }

    for table in ("questions", "question_groups"):
        if not _table_exists(connection, table):
            continue

        existing_columns = _column_names(connection, table)

        for name, sql_type in new_columns.items():
            if name not in existing_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"
                )

        connection.exec_driver_sql(
            f"CREATE INDEX IF NOT EXISTS ix_{table}_pack_guid "
            f"ON {table} (pack_guid)"
        )

    # No backfill: the columns are nullable and existing rows are correctly
    # NULL (locally authored, not pack-derived).
    Base.metadata.create_all(
        bind=connection,
        tables=[PackSubscription.__table__]
    )


def _rename_column_if_needed(connection, table, old_name, new_name):
    existing_columns = _column_names(connection, table)

    if new_name in existing_columns:
        return

    if old_name in existing_columns:
        connection.exec_driver_sql(
            f'ALTER TABLE "{table}" RENAME COLUMN "{old_name}" TO "{new_name}"'
        )


def _migration_pack_terminology(connection):
    from .models import PackSubscription

    for table in ("questions", "question_groups"):
        if not _table_exists(connection, table):
            continue

        _rename_column_if_needed(connection, table, "blueprint_guid", "pack_guid")
        _rename_column_if_needed(
            connection, table, "blueprint_version", "pack_version"
        )

        existing_columns = _column_names(connection, table)
        if "pack_guid" not in existing_columns:
            connection.exec_driver_sql(
                f'ALTER TABLE "{table}" ADD COLUMN pack_guid VARCHAR'
            )
        if "pack_version" not in existing_columns:
            connection.exec_driver_sql(
                f'ALTER TABLE "{table}" ADD COLUMN pack_version INTEGER'
            )
        if "content_hash" not in existing_columns:
            connection.exec_driver_sql(
                f'ALTER TABLE "{table}" ADD COLUMN content_hash VARCHAR'
            )

        connection.exec_driver_sql(
            f"CREATE INDEX IF NOT EXISTS ix_{table}_pack_guid "
            f"ON {table} (pack_guid)"
        )

    if (
        _table_exists(connection, "blueprint_subscriptions")
        and not _table_exists(connection, "pack_subscriptions")
    ):
        connection.exec_driver_sql(
            'ALTER TABLE "blueprint_subscriptions" RENAME TO "pack_subscriptions"'
        )

    Base.metadata.create_all(
        bind=connection,
        tables=[PackSubscription.__table__]
    )

    if _table_exists(connection, "pack_subscriptions"):
        _rename_column_if_needed(
            connection, "pack_subscriptions", "blueprint_guid", "pack_guid"
        )

    if _table_exists(connection, "app_settings"):
        existing_pack = connection.exec_driver_sql(
            "SELECT 1 FROM app_settings WHERE key = 'pack_catalog'"
        ).fetchone()
        existing_blueprint = connection.exec_driver_sql(
            "SELECT 1 FROM app_settings WHERE key = 'blueprint_catalog'"
        ).fetchone()

        if existing_blueprint and not existing_pack:
            connection.exec_driver_sql(
                """
                UPDATE app_settings
                SET key = 'pack_catalog'
                WHERE key = 'blueprint_catalog'
                """
            )
        elif existing_blueprint and existing_pack:
            connection.exec_driver_sql(
                "DELETE FROM app_settings WHERE key = 'blueprint_catalog'"
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


# sync-roadmap: a bare filename like "world.svg" on QuestionGroup.media used
# to mean "a built-in map template shipped with the frontend"
# (frontend/public/maps/), never backend data. That ambiguity is being
# eliminated -- these files become ordinary uploaded media. Two candidate
# source directories, in priority order: the built frontend (present in any
# packaged/frozen install, since the app must ship its own UI there) and the
# dev-mode source checkout (present when frontend/dist hasn't been built).
# A module-level list so tests can point it at a fixture directory.
_LEGACY_MAP_SOURCE_DIRS = [
    FRONTEND_DIST_DIR / "maps",
    PROJECT_DIR / "frontend" / "public" / "maps"
]

_LEGACY_MEDIA_COLUMNS = {
    "question_groups": ("media",),
    "questions": ("media", "answer_media")
}


def _is_local_static_reference(value):
    from .services.media import static_relative_path_from_media

    return static_relative_path_from_media(value) is not None


def _is_external_url(value):
    return urlparse(str(value)).scheme in ("http", "https")


def _migration_localize_legacy_map_media(connection, static_dir):
    # Needs the registry from 0014 to register localized files into.
    if not _table_exists(connection, "media_files"):
        return

    # Any non-empty value that is neither a real /static/ file nor an
    # external URL is a legacy bare reference (in practice: map group SVGs
    # picked from the old bundled-asset picker).
    bare_values = set()

    for table, columns in _LEGACY_MEDIA_COLUMNS.items():
        if not _table_exists(connection, table):
            continue

        existing_columns = _column_names(connection, table)

        for column in columns:
            if column not in existing_columns:
                continue

            rows = connection.exec_driver_sql(
                f"SELECT DISTINCT {column} FROM {table} "
                f"WHERE {column} IS NOT NULL AND {column} != ''"
            ).fetchall()

            for (value,) in rows:
                if _is_local_static_reference(value):
                    continue

                if _is_external_url(value):
                    continue

                bare_values.add(value)

    if not bare_values:
        return

    static_dir = Path(static_dir)
    resolved = {}

    for filename in bare_values:
        source_bytes = None

        for base in _LEGACY_MAP_SOURCE_DIRS:
            candidate = base / filename

            if candidate.is_file():
                source_bytes = candidate.read_bytes()
                break

        # Not found anywhere: leave references to it untouched rather than
        # fail the whole migration over one unresolvable legacy value.
        if source_bytes is None:
            continue

        digest = hashlib.sha256(source_bytes).hexdigest()
        extension = Path(filename).suffix.lower() or ".svg"
        stored_name = f"{digest}{extension}"
        stored_path = static_dir / stored_name

        static_dir.mkdir(parents=True, exist_ok=True)

        if not stored_path.exists():
            stored_path.write_bytes(source_bytes)

        existing = connection.exec_driver_sql(
            "SELECT id FROM media_files WHERE path = ?",
            (stored_name,)
        ).fetchone()

        if not existing:
            connection.exec_driver_sql(
                "INSERT INTO media_files (path, sha256, byte_size) "
                "VALUES (?, ?, ?)",
                (stored_name, digest, len(source_bytes))
            )

        resolved[filename] = f"/static/{stored_name}"

    for table, columns in _LEGACY_MEDIA_COLUMNS.items():
        if not _table_exists(connection, table):
            continue

        existing_columns = _column_names(connection, table)

        for column in columns:
            if column not in existing_columns:
                continue

            for old_value, new_value in resolved.items():
                connection.exec_driver_sql(
                    f"UPDATE {table} SET {column} = ? WHERE {column} = ?",
                    (new_value, old_value)
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


def _migration_review_log_reviewed_on_index(connection):
    # The new-question intake counters aggregate review_log by reviewed_on on
    # every review-screen load; unindexed that is a full scan of the biggest
    # table in the database.
    if not _table_exists(connection, "review_log"):
        return

    # A legacy table predating the column would make CREATE INDEX fail outright.
    if "reviewed_on" not in _column_names(connection, "review_log"):
        return

    connection.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS ix_review_log_reviewed_on
        ON review_log (reviewed_on)
        """
    )


def _migration_question_suspended_column(connection):
    # Existing questions are all active: suspension is opt-in, so a NOT NULL
    # default of 0 leaves every library behaving exactly as before.
    if not _table_exists(connection, "questions"):
        return

    if "suspended" in _column_names(connection, "questions"):
        return

    connection.exec_driver_sql(
        "ALTER TABLE questions ADD COLUMN suspended BOOLEAN NOT NULL DEFAULT 0"
    )


def _migration_tag_slugs(connection, static_dir):
    """Give every tag a stable slug and adopt the shipped hierarchy.

    Tags were free text, so the same idea could exist several times ("USA" /
    "États-Unis") and a hierarchy built on one spelling could not reach the
    other. Slugs make identity explicit and let a tag's display text change
    without breaking anything referencing it — which is also what lets an
    imported pack merge into a local hierarchy instead of sitting beside it.
    """
    from .services.tag_hierarchy import (
        TAG_HIERARCHY_KEY,
        build_slug_map,
        merge_hierarchy_slice,
        resolve_seed_alias,
        seed_slice
    )
    from .services.tag_seed import SEED_VERSION

    if not _table_exists(connection, "questions"):
        return

    if not _table_exists(connection, "app_settings"):
        return

    question_columns = _column_names(connection, "questions")

    if "tags" not in question_columns:
        return

    row = connection.exec_driver_sql(
        "SELECT value FROM app_settings WHERE key = ?",
        (TAG_HIERARCHY_KEY,)
    ).first()

    stored = {}
    if row and row[0]:
        try:
            stored = json.loads(row[0]) if isinstance(row[0], str) else row[0]
        except (TypeError, ValueError):
            stored = {}
    stored = stored if isinstance(stored, dict) else {}

    # Deliberately NOT guarded on the stored hierarchy version. That guard was
    # unsound: normalize_tag_hierarchy() stamps version 2 on any load, so a
    # single read before this migration ran would make it skip itself and leave
    # question tags as display text forever. Canonicalising is idempotent by
    # construction — a slug maps to itself and an existing label always wins —
    # so re-running is a no-op and far safer than not running at all.
    def decode_tags(value):
        if isinstance(value, list):
            return value
        if not value:
            return []
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return []
        return decoded if isinstance(decoded, list) else []

    has_content_hash = "content_hash" in question_columns
    select_columns = "id, tags" + (", content_hash" if has_content_hash else "")
    question_rows = [
        (row_[0], decode_tags(row_[1]), row_[2] if has_content_hash else None)
        for row_ in connection.exec_driver_sql(
            f"SELECT {select_columns} FROM questions"
        )
    ]

    # Every piece of text that is currently acting as a tag, from both sides.
    texts = set()
    for _, tags, _hash in question_rows:
        for tag in tags:
            if str(tag or "").strip():
                texts.add(str(tag).strip())

    legacy_parents = stored.get("parents") if isinstance(stored.get("parents"), dict) else {}
    legacy_labels = stored.get("labels") if isinstance(stored.get("labels"), dict) else {}
    for child, parent_list in legacy_parents.items():
        texts.add(str(child))
        values = parent_list if isinstance(parent_list, (list, tuple, set)) else [parent_list]
        texts.update(str(parent) for parent in values)
    texts.update(str(key) for key in legacy_labels)
    texts = {text for text in texts if text.strip()}

    # Slug first (merging spellings of one idea), then the shipped alias map
    # (merging one idea's names onto the shared vocabulary).
    base_slugs = build_slug_map(texts)
    slug_by_text = {
        text: resolve_seed_alias(slug) for text, slug in base_slugs.items()
    }

    # One display label per resulting slug: an existing hierarchy label wins,
    # otherwise the spelling the collection actually uses most.
    usage = {}
    for _, tags, _hash in question_rows:
        for tag in tags:
            text = str(tag or "").strip()
            if text:
                usage[text] = usage.get(text, 0) + 1

    hierarchy_label_by_slug = {}
    for key, label in legacy_labels.items():
        slug = slug_by_text.get(str(key))
        clean = str(label or "").strip()
        if slug and clean:
            hierarchy_label_by_slug.setdefault(slug, clean)

    best_text_by_slug = {}
    for text, slug in slug_by_text.items():
        current = best_text_by_slug.get(slug)
        if current is None or (usage.get(text, 0), text) > (usage.get(current, 0), current):
            best_text_by_slug[slug] = text

    labels = {}
    for slug, text in best_text_by_slug.items():
        labels[slug] = hierarchy_label_by_slug.get(slug) or text
    for slug, label in hierarchy_label_by_slug.items():
        labels.setdefault(slug, label)

    def to_slugs(tags):
        out = []
        for tag in tags or []:
            slug = slug_by_text.get(str(tag or "").strip())
            if slug and slug not in out:
                out.append(slug)
        return out

    # Pack-tracked rows first, through the ORM, because fork detection has to
    # canonicalise media refs the same way packs.py does. Recomputing every hash
    # unconditionally would quietly adopt a user's local edits as upstream truth
    # and let the next pack update overwrite them, so a row that was already
    # forked keeps its stale hash and a pristine row gets a matching new one.
    pack_tracked_ids = {
        question_id
        for question_id, _tags, row_hash in question_rows
        if row_hash is not None
    }

    # Legacy fixtures can predate the modern column set; the ORM selects all of
    # it, so only take this path when the row really is pack-tracked.
    if pack_tracked_ids:
        from sqlalchemy.orm import Session

        from .models import Question
        from .services.packs import (
            QUESTION_HASH_FIELDS,
            _row_canonical_payload,
            content_hash
        )

        session = Session(bind=connection)

        def canonical_hash(question):
            return content_hash(
                _row_canonical_payload(
                    session, question, QUESTION_HASH_FIELDS, static_dir
                ),
                QUESTION_HASH_FIELDS
            )

        for question in (
            session.query(Question)
            .filter(Question.id.in_(pack_tracked_ids))
            .all()
        ):
            try:
                was_forked = canonical_hash(question) != question.content_hash
            except ValueError:
                # Media missing on disk: cannot verify, so change nothing but
                # the tags themselves.
                question.tags = to_slugs(question.tags)
                continue

            question.tags = to_slugs(question.tags)

            if was_forked:
                continue

            try:
                question.content_hash = canonical_hash(question)
            except ValueError:
                pass

        session.flush()

    # Everything else is a plain tag rewrite with no hash to keep in step.
    for question_id, tags, row_hash in question_rows:
        if row_hash is not None:
            continue

        connection.exec_driver_sql(
            "UPDATE questions SET tags = ? WHERE id = ?",
            (json.dumps(to_slugs(tags), ensure_ascii=False), question_id)
        )

    # Rebuild the hierarchy on slugs, then fold in the shipped seed.
    slug_parents = {}
    for child, parent_list in legacy_parents.items():
        child_slug = slug_by_text.get(str(child))
        if not child_slug:
            continue
        values = parent_list if isinstance(parent_list, (list, tuple, set)) else [parent_list]
        for parent in values:
            parent_slug = slug_by_text.get(str(parent))
            if parent_slug and parent_slug != child_slug:
                slug_parents.setdefault(child_slug, [])
                if parent_slug not in slug_parents[child_slug]:
                    slug_parents[child_slug].append(parent_slug)

    # Keep migration 0021 frozen on its historical v2 shape. The current tag
    # service now speaks v3 IDs; importing its normalizer here would make an
    # old migration change meaning and assign UUIDs one migration too early.
    hierarchy = {
        "version": 2,
        "parents": slug_parents,
        "labels": labels,
        "seed": {"version": 0, "removed": []}
    }

    known = set(hierarchy["labels"]) | set(hierarchy["parents"]) | set(slug_by_text.values())
    # Carry deletion tombstones forward: re-running must not resurrect a
    # category the user deliberately removed.
    previous_seed = stored.get("seed") if isinstance(stored.get("seed"), dict) else {}
    removed = previous_seed.get("removed")
    hierarchy = merge_hierarchy_slice(
        hierarchy,
        seed_slice(known),
        removed_slugs=removed if isinstance(removed, list) else []
    )
    hierarchy["seed"] = {
        "version": SEED_VERSION,
        "removed": sorted(removed) if isinstance(removed, list) else []
    }

    # Drop disambiguation artefacts. build_slug_map suffixes a slug when two
    # genuinely different texts collide ("c++"/"c#"), but an earlier, narrower
    # comparison rule also split a tag from its own slug — leaving a twin like
    # "guerre-de-cent-ans-2" that carries no questions and only clutters the
    # picker. Only removed when the base exists, nothing is filed under it, no
    # question uses it, and its label means the same thing as the base's, so a
    # real tag that merely ends in a number is never touched.
    used_slugs = {slug for _id, tags, _hash in question_rows for slug in to_slugs(tags)}
    hierarchy_children = {}
    for child, parent_list in hierarchy["parents"].items():
        for parent in parent_list:
            hierarchy_children.setdefault(parent, []).append(child)

    from .services.tag_hierarchy import comparison_key

    for slug in list(hierarchy["labels"]):
        match = re.match(r"^(.+)-\d+$", slug)

        if not match:
            continue

        base = match.group(1)

        # The base may itself have been aliased onto the shared vocabulary
        # ("jeux-video" -> "video-games"), so follow that before giving up.
        base = resolve_seed_alias(base)

        if base not in hierarchy["labels"]:
            continue
        if slug in used_slugs or hierarchy_children.get(slug):
            continue
        if comparison_key(hierarchy["labels"][slug]) != comparison_key(
            hierarchy["labels"][base]
        ):
            continue

        hierarchy["labels"].pop(slug, None)
        hierarchy["parents"].pop(slug, None)
        for child, parent_list in list(hierarchy["parents"].items()):
            kept = [parent for parent in parent_list if parent != slug]
            if kept:
                hierarchy["parents"][child] = kept
            else:
                hierarchy["parents"].pop(child, None)

    connection.exec_driver_sql(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        (TAG_HIERARCHY_KEY, json.dumps(hierarchy, ensure_ascii=False))
    )

    # Auditable record of what merged into what, alongside the automatic
    # pre-migration backup, so a surprising merge can be traced. A later no-op
    # re-run has nothing to report and must not overwrite the real record.
    merged = {}
    for text, slug in slug_by_text.items():
        merged.setdefault(slug, []).append(text)

    merged = {
        slug: sorted(texts_)
        for slug, texts_ in sorted(merged.items())
        if len(texts_) > 1
    }

    already_audited = connection.exec_driver_sql(
        "SELECT 1 FROM app_settings WHERE key = ?",
        ("tag_slug_migration",)
    ).first()

    if merged or not already_audited:
        connection.exec_driver_sql(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            (
                "tag_slug_migration",
                json.dumps(
                    {
                        "merged": merged,
                        "tags": len(slug_by_text),
                        "slugs": len(set(slug_by_text.values())),
                        "questions": len(question_rows)
                    },
                    ensure_ascii=False
                )
            )
        )


def _migration_multilingual_tag_ids(connection, static_dir):
    """Move label-derived v2 slugs to multilingual v3 tag identities."""
    if not _table_exists(connection, "questions"):
        return
    if not _table_exists(connection, "app_settings"):
        return

    from sqlalchemy.orm import Session

    from .models import AppSetting, PackSubscription, Question
    from .services.tag_hierarchy import (
        DEFAULT_LOCALE,
        CORE_ROOT_IDS,
        TAG_HIERARCHY_KEY,
        _default_node,
        _with_compatibility_fields,
        ancestors,
        comparison_key,
        legacy_local_tag_id,
        load_tag_hierarchy,
        normalize_tag_hierarchy,
        parent_map,
        resolve_tag_id,
        resolve_seed_alias,
        slugify_tag
    )
    from .services.tag_seed import SEED_NODES

    if _table_exists(connection, "pack_subscriptions"):
        columns = _column_names(connection, "pack_subscriptions")
        additions = {
            "tag_hierarchy_base": "JSON",
            "tag_pending": "JSON",
            "tag_conflicts": "JSON",
            "tag_legacy_map": "JSON"
        }
        for column_name, column_type in additions.items():
            if column_name not in columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE pack_subscriptions ADD COLUMN {column_name} {column_type}"
                )

    session = Session(bind=connection)
    question_columns = _column_names(connection, "questions")
    questions_have_tags = "tags" in question_columns
    setting = (
        session.query(AppSetting)
        .filter(AppSetting.key == TAG_HIERARCHY_KEY)
        .first()
    )
    stored = setting.value if setting and isinstance(setting.value, dict) else {}

    # Migration runners already record completed versions, but keeping the
    # data transform itself idempotent makes recovery/manual reruns safe too.
    if int(stored.get("version") or 0) >= 3:
        session.flush()
        return

    # Include tags that were never filed in the hierarchy so every question
    # still resolves to a labelled node after the migration.
    if not isinstance(stored.get("nodes"), dict):
        stored = dict(stored)
        labels = dict(stored.get("labels") or {})
        if questions_have_tags:
            for (tags,) in session.query(Question.tags).all():
                for value in tags or []:
                    text = str(value or "").strip()
                    if text:
                        labels.setdefault(text, text)
        stored["labels"] = labels

    hierarchy = normalize_tag_hierarchy(stored)
    hierarchy["revision"] = max(1, int(hierarchy.get("revision") or 0) + 1)
    pack_maps = {}
    used_ids = set()

    for question in (session.query(Question).all() if questions_have_tags else []):
        original_tags = list(question.tags or [])
        was_forked = False

        if question.content_hash:
            try:
                from .services.packs import (
                    QUESTION_HASH_FIELDS,
                    _row_canonical_payload,
                    content_hash
                )
                was_forked = content_hash(
                    _row_canonical_payload(
                        session, question, QUESTION_HASH_FIELDS, static_dir
                    ),
                    QUESTION_HASH_FIELDS
                ) != question.content_hash
            except (ValueError, TypeError):
                was_forked = True

        converted = []
        for value in original_tags:
            text = str(value or "").strip()
            if not text:
                continue
            tag_id = resolve_tag_id(hierarchy, text)
            if not tag_id:
                tag_id = legacy_local_tag_id(text)
                hierarchy["nodes"][tag_id] = _default_node(
                    tag_id,
                    labels={DEFAULT_LOCALE: text},
                    origin="migration"
                )
                hierarchy["legacy_ids"][slugify_tag(text)] = tag_id
            if tag_id not in converted:
                converted.append(tag_id)
                used_ids.add(tag_id)
            if question.pack_guid:
                pack_maps.setdefault(question.pack_guid, {})[
                    slugify_tag(text)
                ] = tag_id

        question.tags = converted

        if question.content_hash and not was_forked:
            try:
                question.content_hash = content_hash(
                    _row_canonical_payload(
                        session, question, QUESTION_HASH_FIELDS, static_dir
                    ),
                    QUESTION_HASH_FIELDS
                )
            except (ValueError, TypeError):
                pass

    # The old seed shipped hundreds of globally named descendants. In v3 only
    # roots are universal. Keep a seeded descendant when it is used, was
    # renamed/reparented, or is needed above one of those nodes; otherwise its
    # label remains available through the suggestion catalog.
    raw_labels = stored.get("labels") if isinstance(stored.get("labels"), dict) else {}
    raw_parents = stored.get("parents") if isinstance(stored.get("parents"), dict) else {}
    seed_by_slug = {slug: (label, list(parents)) for slug, label, parents in SEED_NODES}
    seed_ids = {}
    customized_ids = set()
    for slug, (default_label, default_parents) in seed_by_slug.items():
        if not default_parents:
            continue
        tag_id = resolve_tag_id(hierarchy, slug)
        if not tag_id or tag_id in CORE_ROOT_IDS:
            continue
        seed_ids[slug] = tag_id
        hierarchy["nodes"][tag_id]["suggestion_key"] = slug
        raw_label = next(
            (value for key, value in raw_labels.items() if resolve_seed_alias(slugify_tag(key)) == slug),
            default_label
        )
        raw_parent_values = next(
            (values for key, values in raw_parents.items() if resolve_seed_alias(slugify_tag(key)) == slug),
            default_parents
        )
        if isinstance(raw_parent_values, str):
            raw_parent_values = [raw_parent_values]
        actual_parent_slugs = {
            resolve_seed_alias(slugify_tag(value))
            for value in (raw_parent_values or [])
        }
        if (
            comparison_key(raw_label) != comparison_key(default_label)
            or actual_parent_slugs != set(default_parents)
        ):
            customized_ids.add(tag_id)

    keep_ids = set(CORE_ROOT_IDS) | used_ids | customized_ids
    pmap = parent_map(hierarchy)
    for tag_id in list(keep_ids):
        keep_ids |= ancestors(tag_id, pmap)

    demoted_ids = set(seed_ids.values()) - keep_ids
    for tag_id in demoted_ids:
        hierarchy["nodes"].pop(tag_id, None)
    for node in hierarchy["nodes"].values():
        node["parents"] = [parent for parent in node.get("parents", []) if parent not in demoted_ids]
    hierarchy["legacy_ids"] = {
        key: tag_id
        for key, tag_id in hierarchy.get("legacy_ids", {}).items()
        if tag_id not in demoted_ids
    }

    if setting is None:
        setting = AppSetting(key=TAG_HIERARCHY_KEY, value={})
        session.add(setting)
    setting.value = _with_compatibility_fields(hierarchy)

    if _table_exists(connection, "pack_subscriptions"):
        for subscription in session.query(PackSubscription).all():
            subscription.tag_hierarchy_base = subscription.tag_hierarchy_base or None
            subscription.tag_pending = subscription.tag_pending or []
            subscription.tag_conflicts = subscription.tag_conflicts or []
            subscription.tag_legacy_map = {
                **(subscription.tag_legacy_map or {}),
                **pack_maps.get(subscription.pack_guid, {})
            }

    audit = (
        session.query(AppSetting)
        .filter(AppSetting.key == "tag_id_migration")
        .first()
    )
    if audit is None:
        audit = AppSetting(key="tag_id_migration", value={})
        session.add(audit)
    audit.value = {
        "version": 3,
        "questions": connection.exec_driver_sql(
            "SELECT COUNT(*) FROM questions"
        ).scalar_one(),
        "nodes": len(hierarchy["nodes"]),
        "pack_mappings": sum(len(values) for values in pack_maps.values())
    }
    session.flush()


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
    ),
    Migration(
        version="0015",
        name="pack_bookkeeping",
        run=_migration_pack_bookkeeping,
        requires_backup=True
    ),
    Migration(
        version="0016",
        name="localize_legacy_map_media",
        run=_migration_localize_legacy_map_media,
        requires_backup=True,
        needs_static_dir=True
    ),
    Migration(
        version="0017",
        name="pack_terminology",
        run=_migration_pack_terminology,
        requires_backup=True
    ),
    Migration(
        version="0018",
        name="map_package_v2",
        run=_migration_map_package_v2_capability,
        requires_backup=True
    ),
    Migration(
        version="0019",
        name="review_log_reviewed_on_index",
        run=_migration_review_log_reviewed_on_index
    ),
    Migration(
        version="0020",
        name="question_suspended_column",
        run=_migration_question_suspended_column
    ),
    Migration(
        version="0021",
        name="tag_slugs",
        run=_migration_tag_slugs,
        requires_backup=True,
        needs_static_dir=True
    ),
    Migration(
        version="0022",
        name="tag_slugs_repair",
        # These two versions have already shipped in development databases.
        # The current transform is deliberately idempotent and includes both
        # historical repairs, so rerunning it preserves their upgrade path.
        run=_migration_tag_slugs,
        requires_backup=True,
        needs_static_dir=True
    ),
    Migration(
        version="0023",
        name="tag_slug_twin_cleanup",
        run=_migration_tag_slugs,
        requires_backup=True,
        needs_static_dir=True
    ),
    Migration(
        version="0024",
        name="multilingual_tag_ids",
        run=_migration_multilingual_tag_ids,
        requires_backup=True,
        needs_static_dir=True
    ),
    # No backup: this drops one derived, device-local, rebuildable row.
    Migration(
        version="0025",
        name="reset_intake_tuner",
        run=_migration_reset_intake_tuner
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
