import json

from .database import engine
from .models import Base
from .scheduler import DEFAULT_CATCHUP_DAILY_TARGET


def ensure_progress_schema():
    """
    Keep local SQLite databases usable after Progress model changes.
    create_all() creates missing tables, but it does not add columns.
    """
    with engine.begin() as connection:
        existing_columns = {
            row[1]
            for row in connection.exec_driver_sql(
                "PRAGMA table_info(progress)"
            )
        }

        columns = {
            "stability": "FLOAT",
            "difficulty": "FLOAT",
            "reps": "INTEGER",
            "lapses": "INTEGER",
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


def normalize_legacy_question_types():
    """
    Collapse older question type names into the current atomic model.

    The database should not contain a separate map_group/map_zone model; map
    questions are normal Question rows connected by group_id.
    """
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "UPDATE questions SET type_q = 'text' WHERE type_q = 'image'"
        )
        connection.exec_driver_sql(
            "UPDATE questions SET type_q = ? WHERE type_q = ?",
            ("map", "map" + "_zone")
        )


def ensure_default_app_settings():
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
            (
                "review",
                json.dumps({
                    "catchup_daily_target": DEFAULT_CATCHUP_DAILY_TARGET
                })
            )
        )


def init_database():
    # create_all is enough for this local app's initial tables. The helper
    # functions below handle the small legacy fixes that create_all cannot do.
    Base.metadata.create_all(bind=engine)
    ensure_progress_schema()
    ensure_default_app_settings()
    normalize_legacy_question_types()
