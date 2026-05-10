from sqlalchemy import Column, Integer, String, ForeignKey, Float, Date, JSON, Table
from sqlalchemy.orm import relationship
from datetime import date
from .database import Base

question_collection = Table(
    "question_collection",
    Base.metadata,
    Column("question_id", Integer, ForeignKey("questions.id")),
    Column("collection_id", Integer, ForeignKey("collections.id")),
)

class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True)

    question = Column(String)
    answer = Column(String)
    tags = Column(JSON, default=[])

    type_q = Column(String, default="text")

    media = Column(String, nullable=True)   # uniquement images

    code = Column(String, nullable=True)
    aliases = Column(JSON, nullable=True)

    map_id = Column(Integer, ForeignKey("maps.id"), nullable=True)
    map = relationship("Map")
    
    collections = relationship(
        "Collection",
        secondary=question_collection,
        backref="questions"
    )

class Progress(Base):
    __tablename__ = "progress"

    id = Column(Integer, primary_key=True)
    question_id = Column(Integer, ForeignKey("questions.id"))

    interval = Column(Integer, default=1)
    ease_factor = Column(Float, default=2.5)
    next_review = Column(Date, default=date.today)


class Collection(Base):
    __tablename__ = "collections"

    id = Column(Integer, primary_key=True)
    name = Column(String)
    description = Column(String, nullable=True)

class Map(Base):
    __tablename__ = "maps"

    id = Column(Integer, primary_key=True)
    name = Column(String)
    svg = Column(String)