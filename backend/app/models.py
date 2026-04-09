from sqlalchemy import Column, Integer, String, ForeignKey, Float, Date
from datetime import date
from .database import Base

class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    question = Column(String)
    answer = Column(String)
    theme = Column(String)


class Progress(Base):
    __tablename__ = "progress"

    id = Column(Integer, primary_key=True)
    question_id = Column(Integer, ForeignKey("questions.id"))
    interval = Column(Integer, default=1)
    ease_factor = Column(Float, default=2.5)
    next_review = Column(Date, default=date.today)