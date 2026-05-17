def serialize_progress(progress):

    if not progress:
        return {
            "interval": 0,
            "stability": 1.0,
            "difficulty": 5.0,
            "reps": 0,
            "lapses": 0,
            "last_review": None,
            "next_review": None,
            "history": []
        }

    return {
        "interval": progress.interval,
        "stability": progress.stability,
        "difficulty": progress.difficulty,
        "reps": progress.reps,
        "lapses": progress.lapses,
        "last_review": (
            progress.last_review.isoformat()
            if progress.last_review
            else None
        ),
        "next_review": (
            progress.next_review.isoformat()
            if progress.next_review
            else None
        ),
        "history": progress.history or []
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
        "group_id": group.id,
        
        "type_q": "map",

        "name": group.name,

        "media": group.media,

        "items": []
    }


def serialize_map_item(question):

    return {

        "question_id": question.id,

        "code": question.data.get("code") if question.data else None,

        "label": question.answer,

        "aliases": question.data.get("aliases", []) if question.data else [],

        "progress": serialize_progress(
            question.progress
        )
    }
