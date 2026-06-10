IMAGE_MODE_TYPE_ALL = "type_all"
IMAGE_MODE_CLICK_PROMPT = "click_prompt"
IMAGE_MODE_TYPE_PROMPT = "type_prompt"
IMAGE_MODE_MULTIPLE_CHOICE_LABEL = "multiple_choice_label"
IMAGE_MODE_MULTIPLE_CHOICE_IMAGE = "multiple_choice_image"

IMAGE_MODES = (
    IMAGE_MODE_TYPE_ALL,
    IMAGE_MODE_CLICK_PROMPT,
    IMAGE_MODE_TYPE_PROMPT,
    IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
    IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
)
DEFAULT_IMAGE_MODE = IMAGE_MODE_TYPE_PROMPT

IMAGE_MULTIPLE_CHOICE_MODES = {
    IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
    IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
}


def normalize_image_mode(mode):
    value = str(mode or "").strip()

    return value if value in IMAGE_MODES else DEFAULT_IMAGE_MODE


def calibrate_image_quality(raw_quality, mode=None, context_count=0):
    mode = normalize_image_mode(mode)

    try:
        quality = int(raw_quality)
    except (TypeError, ValueError):
        quality = 0

    quality = max(0, min(3, quality))

    if quality <= 0:
        return 0

    if mode == IMAGE_MODE_TYPE_ALL:
        return quality

    if mode == IMAGE_MODE_TYPE_PROMPT:
        return min(quality, 2)

    if mode in IMAGE_MULTIPLE_CHOICE_MODES:
        return min(quality, 1)

    if mode == IMAGE_MODE_CLICK_PROMPT:
        if context_count <= 4:
            return min(quality, 1)

        if context_count <= 10:
            return min(quality, 2)

    return quality


def _progress_started(progress):
    history = progress.history if progress else []

    return bool(
        progress and (
            (progress.reps or 0) > 0 or
            progress.last_review or
            len(history or []) > 0
        )
    )


def _question_strength(question):
    progress = question.progress

    if not _progress_started(progress):
        return "hard"

    difficulty = float(progress.difficulty or 5.0)

    if difficulty >= 6.7 or (progress.lapses or 0) > 0:
        return "hard"

    if difficulty <= 4.2 and (progress.reps or 0) >= 3:
        return "strong"

    return "medium"


def _recent_mode_counts(questions, limit=6):
    counts = {}

    for question in questions or []:
        history = list(question.progress.history or []) if question.progress else []
        seen = 0

        for entry in reversed(history):
            if not isinstance(entry, dict):
                continue

            mode = entry.get("image_mode")

            if mode in IMAGE_MODES:
                counts[mode] = counts.get(mode, 0) + 1
                seen += 1

            if seen >= limit:
                break

    return counts


def choose_image_review_mode(due_questions, context_questions):
    due_questions = list(due_questions or [])
    context_questions = list(context_questions or [])
    context_count = len(context_questions)

    if not due_questions:
        return DEFAULT_IMAGE_MODE

    strengths = [_question_strength(question) for question in due_questions]
    hard_count = strengths.count("hard")
    strong_count = strengths.count("strong")

    if hard_count / len(strengths) >= 0.45:
        base_scores = {
            IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 4.0,
            IMAGE_MODE_MULTIPLE_CHOICE_IMAGE: 3.8,
            IMAGE_MODE_CLICK_PROMPT: 3.2,
            IMAGE_MODE_TYPE_PROMPT: 2.1,
            IMAGE_MODE_TYPE_ALL: 0.8
        }
    elif strong_count / len(strengths) >= 0.55:
        base_scores = {
            IMAGE_MODE_TYPE_PROMPT: 3.6,
            IMAGE_MODE_TYPE_ALL: 3.1,
            IMAGE_MODE_CLICK_PROMPT: 1.8,
            IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 1.1,
            IMAGE_MODE_MULTIPLE_CHOICE_IMAGE: 1.0
        }
    else:
        base_scores = {
            IMAGE_MODE_CLICK_PROMPT: 3.2,
            IMAGE_MODE_TYPE_PROMPT: 3.0,
            IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 2.2,
            IMAGE_MODE_MULTIPLE_CHOICE_IMAGE: 2.1,
            IMAGE_MODE_TYPE_ALL: 1.4
        }

    scores = dict(base_scores)

    if context_count <= 4:
        scores[IMAGE_MODE_CLICK_PROMPT] -= 1.1
        scores[IMAGE_MODE_MULTIPLE_CHOICE_LABEL] -= 0.4
        scores[IMAGE_MODE_MULTIPLE_CHOICE_IMAGE] -= 0.4
    elif context_count >= 12:
        scores[IMAGE_MODE_CLICK_PROMPT] += 0.5
        scores[IMAGE_MODE_MULTIPLE_CHOICE_IMAGE] += 0.2

    recent_counts = _recent_mode_counts(due_questions)

    for mode, count in recent_counts.items():
        scores[mode] = scores.get(mode, 0) - (0.55 * count)

    tie_order = {
        IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 0,
        IMAGE_MODE_MULTIPLE_CHOICE_IMAGE: 1,
        IMAGE_MODE_CLICK_PROMPT: 2,
        IMAGE_MODE_TYPE_PROMPT: 3,
        IMAGE_MODE_TYPE_ALL: 4
    }

    return max(
        IMAGE_MODES,
        key=lambda mode: (scores.get(mode, 0), -tie_order[mode])
    )
