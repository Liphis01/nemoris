MAP_MODE_TYPE_ALL = "type_all"
MAP_MODE_CLICK_PROMPT = "click_prompt"
MAP_MODE_TYPE_PROMPT = "type_prompt"
MAP_MODE_MULTIPLE_CHOICE = "multiple_choice"

MAP_MODES = (
    MAP_MODE_TYPE_ALL,
    MAP_MODE_CLICK_PROMPT,
    MAP_MODE_TYPE_PROMPT,
    MAP_MODE_MULTIPLE_CHOICE
)
DEFAULT_MAP_MODE = MAP_MODE_TYPE_ALL


def normalize_map_mode(mode):
    value = str(mode or "").strip()

    return value if value in MAP_MODES else DEFAULT_MAP_MODE


def calibrate_map_quality(raw_quality, mode=None, context_count=0):
    mode = normalize_map_mode(mode)

    try:
        quality = int(raw_quality)
    except (TypeError, ValueError):
        quality = 0

    quality = max(0, min(3, quality))

    if quality <= 0:
        return 0

    if mode == MAP_MODE_TYPE_ALL:
        return quality

    if mode == MAP_MODE_TYPE_PROMPT:
        return min(quality, 2)

    if mode == MAP_MODE_MULTIPLE_CHOICE:
        return min(quality, 1)

    if mode == MAP_MODE_CLICK_PROMPT:
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

            mode = entry.get("map_mode")

            if mode in MAP_MODES:
                counts[mode] = counts.get(mode, 0) + 1
                seen += 1

            if seen >= limit:
                break

    return counts


def choose_map_review_mode(due_questions, context_questions):
    due_questions = list(due_questions or [])
    context_questions = list(context_questions or [])
    context_count = len(context_questions)

    if not due_questions:
        return DEFAULT_MAP_MODE

    strengths = [_question_strength(question) for question in due_questions]
    hard_count = strengths.count("hard")
    strong_count = strengths.count("strong")

    if hard_count / len(strengths) >= 0.45:
        base_scores = {
            MAP_MODE_MULTIPLE_CHOICE: 4.0,
            MAP_MODE_CLICK_PROMPT: 3.3,
            MAP_MODE_TYPE_PROMPT: 2.0,
            MAP_MODE_TYPE_ALL: 0.9
        }
    elif strong_count / len(strengths) >= 0.55:
        base_scores = {
            MAP_MODE_TYPE_PROMPT: 3.5,
            MAP_MODE_TYPE_ALL: 3.1,
            MAP_MODE_CLICK_PROMPT: 1.8,
            MAP_MODE_MULTIPLE_CHOICE: 0.9
        }
    else:
        base_scores = {
            MAP_MODE_CLICK_PROMPT: 3.2,
            MAP_MODE_TYPE_PROMPT: 3.0,
            MAP_MODE_MULTIPLE_CHOICE: 2.0,
            MAP_MODE_TYPE_ALL: 1.5
        }

    scores = dict(base_scores)

    if context_count <= 4:
        scores[MAP_MODE_CLICK_PROMPT] -= 1.1
        scores[MAP_MODE_MULTIPLE_CHOICE] -= 0.4
    elif context_count >= 12:
        scores[MAP_MODE_CLICK_PROMPT] += 0.5

    recent_counts = _recent_mode_counts(due_questions)

    for mode, count in recent_counts.items():
        scores[mode] = scores.get(mode, 0) - (0.55 * count)

    tie_order = {
        MAP_MODE_MULTIPLE_CHOICE: 0,
        MAP_MODE_CLICK_PROMPT: 1,
        MAP_MODE_TYPE_PROMPT: 2,
        MAP_MODE_TYPE_ALL: 3
    }

    return max(
        MAP_MODES,
        key=lambda mode: (scores.get(mode, 0), -tie_order[mode])
    )
