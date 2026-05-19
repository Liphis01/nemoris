from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from ..models import Collection, Progress, Question
from ..serializers import (
    serialize_grouped_map_review,
    serialize_map_item,
    serialize_review_question
)


def get_review_items(db, tags=None, limit=200, collection_id=None):
    today = date.today()

    query = (
        db.query(Question)
        .outerjoin(Progress)
        .options(
            joinedload(Question.progress),
            joinedload(Question.group),
            joinedload(Question.collections)
        )
        .filter(
            or_(
                Progress.id == None,
                Progress.next_review == None,
                Progress.next_review <= today
            )
        )
    )

    if collection_id:
        query = (
            query
            .join(Question.collections)
            .filter(Collection.id == collection_id)
        )

    review_items = []
    grouped_items = {}

    for question in query.all():
        if tags and not set(tags).intersection(set(question.tags or [])):
            continue

        if question.group and question.group.type_group == "map":
            group_id = question.group.id

            if group_id not in grouped_items:
                grouped_items[group_id] = serialize_grouped_map_review(question.group)

            grouped_items[group_id]["items"].append(serialize_map_item(question))
            continue

        review_items.append(serialize_review_question(question))

    return (review_items + list(grouped_items.values()))[:limit]
