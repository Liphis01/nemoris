from .database import engine
from .models import Base


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
            "history": "JSON"
        }

        for column_name, column_type in columns.items():
            if column_name not in existing_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE progress ADD COLUMN {column_name} {column_type}"
                )


def normalize_legacy_question_types():
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "UPDATE questions SET type_q = 'text' WHERE type_q = 'image'"
        )
        connection.exec_driver_sql(
            "UPDATE questions SET type_q = ? WHERE type_q = ?",
            ("map", "map" + "_zone")
        )


def init_database():
    Base.metadata.create_all(bind=engine)
    ensure_progress_schema()
    normalize_legacy_question_types()
