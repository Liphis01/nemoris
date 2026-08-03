from sqlalchemy import and_, func, or_

from ..models import Question


def map_question_is_ready(question):
    return (
        question.type_q != "map"
        or bool(str(question.answer or "").strip())
    )


def question_is_reviewable(question):
    """Python twin of reviewable_question_filter.

    A question reaches a review session only if the user has not set it aside
    and, for map zones, it actually has an answer to grade.
    """
    if question is None:
        return True

    return (
        not bool(question.suspended) and
        map_question_is_ready(question)
    )


def reviewable_question_filter():
    """SQL equivalent of question_is_reviewable for selection/count queries.

    Every path that reads the review pool goes through this -- due questions,
    the new-question intake pool, the in-flight (WIP) count -- so suspending a
    question drops it out of all of them at once.
    """
    return or_(
        Question.id == None,
        and_(
            func.coalesce(Question.suspended, False) == False,
            or_(
                Question.type_q != "map",
                func.trim(func.coalesce(Question.answer, "")) != "",
            )
        )
    )
