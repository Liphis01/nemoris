from sqlalchemy import func, or_

from ..models import Question


def map_question_is_ready(question):
    return (
        question.type_q != "map"
        or bool(str(question.answer or "").strip())
    )


def reviewable_question_filter():
    """SQL equivalent of map_question_is_ready for selection/count queries."""
    return or_(
        Question.id == None,
        Question.type_q != "map",
        func.trim(func.coalesce(Question.answer, "")) != "",
    )
