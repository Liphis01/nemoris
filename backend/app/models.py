import uuid

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Date,
    ForeignKey,
    Table,
    JSON,
    Text,
    UniqueConstraint
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

    # Stable identity that survives export/import and future sync. The integer
    # PK stays local-only; the guid is what blueprints and sync will key on.
    guid = Column(
        String,
        unique=True,
        index=True,
        nullable=False,
        default=lambda: str(uuid.uuid4())
    )

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

    # Stable identity for export/import/sync; see QuestionGroup.guid.
    guid = Column(
        String,
        unique=True,
        index=True,
        nullable=False,
        default=lambda: str(uuid.uuid4())
    )

    # Question rows are atomic review items. "map" means one map zone, not a
    # database-level map group.
    type_q = Column(String)

    question = Column(Text)
    answer = Column(Text, nullable=True)

    # Replaces the old "fichier" field. Can point to image, SVG, audio, video.
    media = Column(String, nullable=True)

    # Optional media attached to the answer side of the card. Unlike the
    # question's media (image-only in the UI), this may point to an image,
    # audio, or video asset served from /static.
    answer_media = Column(String, nullable=True)

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
    ideal_interval = Column(Integer, nullable=True)
    last_review = Column(Date, nullable=True)
    next_review = Column(Date)
    ideal_next_review = Column(Date, nullable=True)
    fsrs_card = Column(JSON, nullable=True)
    fsrs_version = Column(String, nullable=True)
    # Append-only review snapshots used by the UI for history/stats. The active
    # schedule is interval/next_review; ideal_* remembers the pre-rebalance
    # target that catch-up smoothing should keep anchored.
    history = Column(JSON, default=list)

    question = relationship(
        "Question",
        back_populates="progress"
    )


# =========================================================
# REVIEW LOG
# =========================================================

class ReviewLog(Base):
    """Append-only log of scheduling-moving reviews, one row per history entry.

    Rows are snapshots, not bare ratings: update_progress() is not purely
    deterministic (interval fuzzing, mode factors), so each row records the
    post-review state exactly like the legacy Progress.history entries did.
    Rows are never updated or deleted; a re-grade appends a replacement row
    and marks the old one via superseded_by.
    """

    __tablename__ = "review_log"
    __table_args__ = (
        UniqueConstraint(
            "question_id",
            "seq",
            name="uq_review_log_question_seq"
        ),
    )

    id = Column(Integer, primary_key=True)

    question_id = Column(
        Integer,
        ForeignKey("questions.id"),
        index=True,
        nullable=False
    )

    # Denormalized so exported/synced rows keep their identity without a join.
    # Nullable defensively: a legacy progress row whose question is gone still
    # migrates.
    question_guid = Column(String, index=True, nullable=True)

    # Per-question monotonic ordering. Legacy history entries are date-only,
    # so array position (captured here) is the only same-day ordering.
    seq = Column(Integer, nullable=False)

    reviewed_on = Column(Date)

    # UTC ISO datetime string; None on rows migrated from date-only history.
    reviewed_at = Column(String, nullable=True)

    quality = Column(Integer)
    stability = Column(Float)
    difficulty = Column(Float)
    reps = Column(Integer)
    lapses = Column(Integer)
    interval = Column(Integer)
    next_review = Column(Date)
    ideal_interval = Column(Integer)
    ideal_next_review = Column(Date)

    # Set when a re-grade replaced this row. Append-only: never delete.
    superseded_by = Column(
        Integer,
        ForeignKey("review_log.id"),
        nullable=True
    )

    # The full history entry snapshot (fsrs_*, mode_*, favorite_*, answer
    # metadata...), so no field of the legacy entries is ever lost.
    data = Column(JSON, nullable=False, default=dict)


# =========================================================
# TOMBSTONES
# =========================================================

class Tombstone(Base):
    """Deletion record for synced content (sync-roadmap 0.4).

    Sync must distinguish "deleted here" from "not present here", otherwise a
    deletion on one device is resurrected by the next pull from another.
    Rows are append-only; purging happens only after a completed full sync.
    """

    __tablename__ = "tombstones"

    id = Column(Integer, primary_key=True)

    # question | question_group | collection
    entity_type = Column(String, nullable=False)

    guid = Column(String, nullable=False, index=True)

    # UTC ISO datetime string.
    deleted_at = Column(String, nullable=False)


# =========================================================
# MEDIA FILES
# =========================================================

class MediaFile(Base):
    """Registry of files under static/ with their content hash (0.5).

    The hash is what blueprints and sync address media by ("do you have
    abc123?"), and what upload dedup checks. Files keep their uuid filenames
    on disk — the registry adds identity, it does not move anything.
    """

    __tablename__ = "media_files"

    id = Column(Integer, primary_key=True)

    # Path relative to static/, POSIX separators — same form as media URLs.
    path = Column(String, unique=True, nullable=False)

    # Not unique: duplicate content may predate dedup; new uploads dedup.
    sha256 = Column(String, index=True, nullable=False)

    byte_size = Column(Integer)


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

    # Stable identity for export/import/sync; see QuestionGroup.guid.
    guid = Column(
        String,
        unique=True,
        index=True,
        nullable=False,
        default=lambda: str(uuid.uuid4())
    )

    name = Column(String, unique=True)

    data = Column(JSON, nullable=True)

    questions = relationship(
        "Question",
        secondary=question_collection,
        back_populates="collections"
    )
