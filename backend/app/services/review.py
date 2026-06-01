from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from ..models import Progress, Question
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


def get_review_items(db):
    today = date.today()

    # Start from due atomic questions. joinedload keeps Manage/review payloads
    # from triggering per-question lazy queries for progress/group.
    query = (
        db.query(Question)
        .outerjoin(Progress)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group)
        )
        .filter(
            or_(
                Progress.id == None,
                Progress.next_review == None,
                Progress.next_review <= today
            )
        )
    )

    review_items = []
    map_grouped_items = {}
    image_grouped_items = {}
    timeline_items = []

    for question in query.all():
        if question.group and question.group.type_group == "map":
            # Maps are grouped only at runtime: each zone keeps independent
            # progress, but the UI receives one map review object per group.
            group_id = question.group.id

            if group_id not in map_grouped_items:
                map_grouped_items[group_id] = serialize_map_review_group(
                    question.group,
                    question.tags or []
                )

            map_grouped_items[group_id]["items"].append(
                serialize_map_review_zone(question)
            )
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

    return (
        review_items +
        list(map_grouped_items.values()) +
        list(image_grouped_items.values())
    )
