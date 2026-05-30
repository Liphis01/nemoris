from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Date,
    ForeignKey,
    Table,
    JSON,
    Text
)

from sqlalchemy.orm import relationship
from .database import Base

# =========================================================
# MANY TO MANY : collections
# =========================================================

question_collection = Table(
    "question_collection",
    Base.metadata,
    Column("question_id", ForeignKey("questions.id")),
    Column("collection_id", ForeignKey("collections.id"))
)

# =========================================================
# QUESTION GROUPS
# =========================================================

class QuestionGroup(Base):
    __tablename__ = "question_groups"

    id = Column(Integer, primary_key=True)

    # Runtime grouping metadata. The actual reviewable items remain Question
    # rows; this table only says how related questions should be presented.
    type_group = Column(String)

    # Display name shown in Manage/review UIs.
    name = Column(String)

    # Main visual/media resource for the group, for example a map SVG filename.
    media = Column(String, nullable=True)

    # Open-ended group metadata. Prefer this over adding columns for every
    # future grouped-review variant.
    data = Column(JSON, nullable=True)

    questions = relationship(
        "Question",
        back_populates="group",
        # cascade="all, delete"
    )

# =========================================================
# QUESTIONS
# =========================================================

class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True)

    # Question rows are atomic review items. "map" means one map zone, not a
    # database-level map group.
    type_q = Column(String)

    question = Column(Text)
    answer = Column(Text, nullable=True)

    # Replaces the old "fichier" field. Can point to image, SVG, audio, video.
    media = Column(String, nullable=True)

    # tags
    tags = Column(JSON, nullable=True)

    # Type-specific data lives here. For map zones this stores data.code and
    # data.aliases so the schema stays stable as map features grow.
    data = Column(JSON, nullable=True)

    # Optional visual/grouped-review membership. Progress still belongs to this
    # individual question, not to the group.
    group_id = Column(
        Integer,
        ForeignKey("question_groups.id"),
        nullable=True
    )

    group = relationship(
        "QuestionGroup",
        back_populates="questions"
    )

    collections = relationship(
        "Collection",
        secondary=question_collection,
        back_populates="questions"
    )

    progress = relationship(
        "Progress",
        uselist=False,
        back_populates="question",
        # cascade="all, delete"
    )

# =========================================================
# PROGRESS
# =========================================================

class Progress(Base):
    __tablename__ = "progress"

    id = Column(Integer, primary_key=True)

    question_id = Column(
        Integer,
        ForeignKey("questions.id"),
        unique=True
    )

    stability = Column(Float, default=1.0)
    difficulty = Column(Float, default=5.0)
    reps = Column(Integer, default=0)
    lapses = Column(Integer, default=0)
    interval = Column(Integer, default=0)
    last_review = Column(Date, nullable=True)
    next_review = Column(Date)
    fsrs_card = Column(JSON, nullable=True)
    fsrs_version = Column(String, nullable=True)
    # Append-only review snapshots used by the UI for history/stats. The active
    # scheduling state is stored in the scalar columns above.
    history = Column(JSON, default=list)

    question = relationship(
        "Question",
        back_populates="progress"
    )


# =========================================================
# APP SETTINGS
# =========================================================

class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)

    # Small JSON blobs for local app preferences and startup migration markers.
    value = Column(JSON, nullable=False, default=dict)

# =========================================================
# COLLECTIONS
# =========================================================

class Collection(Base):
    __tablename__ = "collections"

    id = Column(Integer, primary_key=True)

    name = Column(String, unique=True)

    questions = relationship(
        "Question",
        secondary=question_collection,
        back_populates="collections"
    )
