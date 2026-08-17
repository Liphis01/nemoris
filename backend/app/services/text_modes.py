from .mode_selection import (
    CHOICE_MODE_MIN_CONTEXT,
    MODE_AFFINITY_RECALL_PROBE,
    MODE_AFFINITY_STRONG,
    MODE_AFFINITY_SUPPORT,
    apply_recent_mode_penalty,
    question_mode_affinity_counts,
    weighted_mode_choice
)


TEXT_MODE_TYPE_ALL = "type_all"
TEXT_MODE_MATCH = "match"
TEXT_MODE_TYPE_REVERSE = "type_reverse"

TEXT_MODES = (
    TEXT_MODE_TYPE_ALL,
    TEXT_MODE_MATCH,
    TEXT_MODE_TYPE_REVERSE
)
DEFAULT_TEXT_MODE = TEXT_MODE_TYPE_ALL

# type_all is full recall (the shared baseline). match is recognition among all
# the group's answers as distractors — a touch harder than the 4-option QCM
# (0.55) because every answer is on screen.
TEXT_TYPE_ALL_DIFFICULTY = 1.0
TEXT_MATCH_DIFFICULTY = 0.6
# The reverse prompt is still free recall. Keep it anchored to the shared
# baseline until actual answer events justify separate calibration.
TEXT_TYPE_REVERSE_DIFFICULTY = 1.0


def normalize_text_mode(mode):
    value = str(mode or "").strip()

    return value if value in TEXT_MODES else DEFAULT_TEXT_MODE


def _tuned_number(tuning, key, default):
    if not isinstance(tuning, dict):
        return default

    try:
        return float(tuning.get(key, default))
    except (TypeError, ValueError):
        return default


def text_mode_difficulty(mode=None, context_count=0, tuning=None):
    mode = normalize_text_mode(mode)

    if mode == TEXT_MODE_MATCH:
        return _tuned_number(tuning, "text_match_difficulty", TEXT_MATCH_DIFFICULTY)

    if mode == TEXT_MODE_TYPE_REVERSE:
        return TEXT_TYPE_REVERSE_DIFFICULTY

    return _tuned_number(tuning, "text_type_all_difficulty", TEXT_TYPE_ALL_DIFFICULTY)


def calibrate_text_quality(raw_quality, mode=None, context_count=0):
    try:
        quality = int(raw_quality)
    except (TypeError, ValueError):
        quality = 0

    return max(0, min(3, quality))


def choose_text_review_mode(
    due_questions,
    context_questions,
    multiple_choice_context_count=None,
    reverse_mode_enabled=False,
    rng=None
):
    due_questions = list(due_questions or [])
    context_questions = list(context_questions or [])
    context_count = len(context_questions)
    choice_context_count = (
        context_count
        if multiple_choice_context_count is None
        else multiple_choice_context_count
    )

    if not due_questions:
        return DEFAULT_TEXT_MODE

    affinity_counts = question_mode_affinity_counts(due_questions)
    support_count = affinity_counts[MODE_AFFINITY_SUPPORT]
    recall_probe_count = affinity_counts[MODE_AFFINITY_RECALL_PROBE]
    strong_count = affinity_counts[MODE_AFFINITY_STRONG]

    if support_count / len(due_questions) >= 0.55:
        # Struggling set -> favour the easier recognition mode.
        base_scores = {
            TEXT_MODE_MATCH: 3.4,
            TEXT_MODE_TYPE_REVERSE: 1.5,
            TEXT_MODE_TYPE_ALL: 1.4
        }
    elif recall_probe_count / len(due_questions) >= 0.55:
        base_scores = {
            TEXT_MODE_TYPE_ALL: 4.0,
            TEXT_MODE_TYPE_REVERSE: 3.3,
            TEXT_MODE_MATCH: 0.7
        }
    elif strong_count / len(due_questions) >= 0.55:
        # Confident set -> favour recall.
        base_scores = {
            TEXT_MODE_TYPE_ALL: 3.4,
            TEXT_MODE_TYPE_REVERSE: 2.9,
            TEXT_MODE_MATCH: 1.2
        }
    else:
        base_scores = {
            TEXT_MODE_TYPE_ALL: 2.6,
            TEXT_MODE_TYPE_REVERSE: 2.3,
            TEXT_MODE_MATCH: 2.2
        }

    scores = dict(base_scores)

    apply_recent_mode_penalty(scores, due_questions, "text_mode", TEXT_MODES)

    tie_order = {
        TEXT_MODE_MATCH: 0,
        TEXT_MODE_TYPE_REVERSE: 1,
        TEXT_MODE_TYPE_ALL: 2
    }
    eligible_modes = list(TEXT_MODES)

    # Matching among fewer than the shared minimum is degenerate (too few
    # distractors), so fall back to typing.
    if choice_context_count < CHOICE_MODE_MIN_CONTEXT:
        eligible_modes = [
            mode for mode in eligible_modes if mode != TEXT_MODE_MATCH
        ]

    if not reverse_mode_enabled:
        eligible_modes = [
            mode for mode in eligible_modes if mode != TEXT_MODE_TYPE_REVERSE
        ]

    return weighted_mode_choice(eligible_modes, scores, tie_order, rng=rng)
