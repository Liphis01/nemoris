import math


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
MAP_TYPE_ALL_DIFFICULTY = 1.0
MAP_TYPE_PROMPT_DIFFICULTY = 1.15
MAP_MULTIPLE_CHOICE_DIFFICULTY = 0.5


def normalize_map_mode(mode):
    value = str(mode or "").strip()

    return value if value in MAP_MODES else DEFAULT_MAP_MODE


def map_click_prompt_difficulty(context_count=0):
    try:
        count = max(1, int(context_count))
    except (TypeError, ValueError):
        count = 1

    return max(0.4, min(0.95, 0.95 - (0.55 / math.sqrt(count))))


def map_mode_difficulty(mode=None, context_count=0):
    mode = normalize_map_mode(mode)

    if mode == MAP_MODE_TYPE_PROMPT:
        return MAP_TYPE_PROMPT_DIFFICULTY

    if mode == MAP_MODE_MULTIPLE_CHOICE:
        return MAP_MULTIPLE_CHOICE_DIFFICULTY

    if mode == MAP_MODE_CLICK_PROMPT:
        return map_click_prompt_difficulty(context_count)

    return MAP_TYPE_ALL_DIFFICULTY


def calibrate_map_quality(raw_quality, mode=None, context_count=0):
    try:
        quality = int(raw_quality)
    except (TypeError, ValueError):
        quality = 0

    return max(0, min(3, quality))


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
