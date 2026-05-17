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

    # map / timeline / image_set / diagram / etc
    type_group = Column(String)

    # nom affiché
    name = Column(String)

    # ressource principale
    media = Column(String, nullable=True)

    # données additionnelles
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

    # text / map / etc
    type_q = Column(String)

    question = Column(Text)
    answer = Column(Text, nullable=True)

    # image / audio / etc
    media = Column(String, nullable=True)

    # tags
    tags = Column(JSON, nullable=True)

    # données custom selon le type (ex: {code: "FR", aliases: ["UK", "royaume uni"]} pour map)
    data = Column(JSON, nullable=True)

    # groupe éventuel
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
    history = Column(JSON, default=list)

    question = relationship(
        "Question",
        back_populates="progress"
    )

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
