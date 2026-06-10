from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from ..models import Progress, Question, QuestionGroup
from ..serializers import (
    serialize_image_review_group,
    serialize_image_review_item,
    serialize_map_review_group,
    serialize_map_review_zone,
    serialize_review_question_item
)
from .timeline import (
    serialize_timeline_review_group,
    serialize_timeline_review_item
)
from .map_modes import choose_map_review_mode
from .progress import progress_has_started, progress_is_new


def _question_query(db):
    return (
        db.query(Question)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group)
            .joinedload(QuestionGroup.questions)
            .joinedload(Question.progress)
        )
        .order_by(Question.id)
    )


def _due_questions(db, today):
    # Only started cards are part of the scheduled daily workload. Unstarted
    # progress rows are legacy/new rows and are handled as bonus questions.
    return [
        question
        for question in _question_query(db)
        .join(Progress, Question.id == Progress.question_id)
        .filter(
            or_(
                Progress.next_review == None,
                Progress.next_review <= today
            )
        )
        .all()
        if progress_has_started(question.progress)
    ]


def _new_questions(db):
    return [
        question
        for question in _question_query(db).outerjoin(Progress).all()
        if progress_is_new(question.progress)
    ]


def _serialize_review_items(questions):
    review_items = []
    map_grouped_items = {}
    image_grouped_items = {}
    timeline_items = []

    for question in questions:
        if question.group and question.group.type_group == "map":
            # Maps are grouped only at runtime: each zone keeps independent
            # progress, but the UI receives one map review object per group.
            group_id = question.group.id

            if group_id not in map_grouped_items:
                map_grouped_items[group_id] = {
                    "group": question.group,
                    "tags": question.tags or [],
                    "questions": []
                }

            map_grouped_items[group_id]["questions"].append(question)
            continue

        if question.group and question.group.type_group == "image":
            group_id = question.group.id

            if group_id not in image_grouped_items:
                image_grouped_items[group_id] = serialize_image_review_group(
                    question.group,
                    question.tags or []
                )

            image_grouped_items[group_id]["items"].append(
                serialize_image_review_item(question)
            )
            continue

        if question.type_q == "timeline":
            # Timeline questions stay atomic in storage/manage/calendar, but
            # review presents every due item in one combined timeline screen.
            timeline_items.append(serialize_timeline_review_item(question))
            continue

        review_items.append(serialize_review_question_item(question))

    # Mixed sessions can contain normal questions and runtime map groups.
    if timeline_items:
        review_items.append(serialize_timeline_review_group(timeline_items))

    map_review_groups = []

    for group_data in map_grouped_items.values():
        group = group_data["group"]
        due_questions = sorted(group_data["questions"], key=lambda item: item.id)
        context_questions = sorted(
            [
                item
                for item in (group.questions or [])
                if item.type_q == "map"
            ],
            key=lambda item: item.id
        )
        context_items = [
            serialize_map_review_zone(item)
            for item in context_questions
        ]
        mode = choose_map_review_mode(due_questions, context_questions)
        map_group = serialize_map_review_group(
            group,
            group_data["tags"],
            mode=mode,
            context_items=context_items
        )
        map_group["items"] = [
            serialize_map_review_zone(item)
            for item in due_questions
        ]
        map_review_groups.append(map_group)

    return review_items + map_review_groups + list(image_grouped_items.values())


def serialize_review_items(questions):
    return _serialize_review_items(questions)


def get_review_items(db, include_new=False):
    today = date.today()
    due_questions = _due_questions(db, today)

    if due_questions or not include_new:
        return serialize_review_items(due_questions)

    return serialize_review_items(_new_questions(db))
