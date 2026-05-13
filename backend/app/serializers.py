def serialize_progress(progress):

    if not progress:
        return {
            "interval": 0,
            "ease": 2.5
        }

    return {
        "interval": progress.interval,
        "ease": progress.ease_factor
    }


def serialize_review_question(question):

    return {
        "type_q": question.type_q,

        "question_id": question.id,

        "question": question.question,

        "answer": question.answer,

        "media": question.media,

        "tags": question.tags or [],

        "progress": serialize_progress(
            question.progress
        )
    }


def serialize_map_group(group):

    return {
        "type_q": "map",

        "group_id": group.id,

        "media": group.media,

        "items": []
    }


def serialize_map_item(question):

    return {

        "question_id": question.id,

        "code": question.code,

        "label": question.question,

        "aliases": question.aliases or [],

        "progress": serialize_progress(
            question.progress
        )
    }