from .mode_selection import (
    CHOICE_MODE_MIN_CONTEXT,
    MODE_AFFINITY_RECALL_PROBE,
    MODE_AFFINITY_STRONG,
    MODE_AFFINITY_SUPPORT,
    apply_recent_mode_penalty,
    question_mode_affinity_counts,
    weighted_mode_choice
)


IMAGE_MODE_TYPE_ALL = "type_all"
IMAGE_MODE_TYPE_PROMPT = "type_prompt"
IMAGE_MODE_MULTIPLE_CHOICE_LABEL = "multiple_choice_label"
IMAGE_MODE_MULTIPLE_CHOICE_MEDIA = "multiple_choice_media"
LEGACY_IMAGE_MODE_MULTIPLE_CHOICE_IMAGE = "multiple_choice_image"
# Keep imports from pre-M2.1 callers working while every newly emitted mode uses
# the media-neutral identifier.
IMAGE_MODE_MULTIPLE_CHOICE_IMAGE = IMAGE_MODE_MULTIPLE_CHOICE_MEDIA

IMAGE_MODES = (
    IMAGE_MODE_TYPE_ALL,
    IMAGE_MODE_TYPE_PROMPT,
    IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
    IMAGE_MODE_MULTIPLE_CHOICE_MEDIA
)
DEFAULT_IMAGE_MODE = IMAGE_MODE_TYPE_PROMPT
IMAGE_TYPE_ALL_DIFFICULTY = 1.0
IMAGE_TYPE_PROMPT_DIFFICULTY = 1.05
IMAGE_MULTIPLE_CHOICE_DIFFICULTY = 0.55

IMAGE_MULTIPLE_CHOICE_MODES = {
    IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
    IMAGE_MODE_MULTIPLE_CHOICE_MEDIA
}

# Audio is heard one clip at a time, but the reversed QCM remains valid: four
# numbered players make its target explicit without a visual grid.
IMAGE_AUDIO_MODES = (
    IMAGE_MODE_TYPE_PROMPT,
    IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
    IMAGE_MODE_MULTIPLE_CHOICE_MEDIA
)


def canonical_image_mode(mode):
    value = str(mode or "").strip()

    if value == LEGACY_IMAGE_MODE_MULTIPLE_CHOICE_IMAGE:
        return IMAGE_MODE_MULTIPLE_CHOICE_MEDIA

    return value if value in IMAGE_MODES else None


def normalize_image_mode(mode):
    value = canonical_image_mode(mode)

    return value if value is not None else DEFAULT_IMAGE_MODE


def _tuned_number(tuning, key, default):
    if not isinstance(tuning, dict):
        return default

    try:
        return float(tuning.get(key, default))
    except (TypeError, ValueError):
        return default


def image_mode_difficulty(mode=None, context_count=0, tuning=None):
    mode = normalize_image_mode(mode)

    if mode == IMAGE_MODE_TYPE_PROMPT:
        return _tuned_number(
            tuning,
            "type_prompt_difficulty",
            IMAGE_TYPE_PROMPT_DIFFICULTY
        )

    if mode in IMAGE_MULTIPLE_CHOICE_MODES:
        return _tuned_number(
            tuning,
            "multiple_choice_difficulty",
            IMAGE_MULTIPLE_CHOICE_DIFFICULTY
        )

    return IMAGE_TYPE_ALL_DIFFICULTY


def calibrate_image_quality(raw_quality, mode=None, context_count=0):
    try:
        quality = int(raw_quality)
    except (TypeError, ValueError):
        quality = 0

    return max(0, min(3, quality))


def choose_image_review_mode(
    due_questions,
    context_questions,
    multiple_choice_context_count=None,
    discouraged_modes=None,
    audio_only=False,
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
        return DEFAULT_IMAGE_MODE

    affinity_counts = question_mode_affinity_counts(due_questions)
    support_count = affinity_counts[MODE_AFFINITY_SUPPORT]
    recall_probe_count = affinity_counts[MODE_AFFINITY_RECALL_PROBE]
    strong_count = affinity_counts[MODE_AFFINITY_STRONG]

    if support_count / len(due_questions) >= 0.55:
        base_scores = {
            IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 4.0,
            IMAGE_MODE_MULTIPLE_CHOICE_MEDIA: 3.8,
            IMAGE_MODE_TYPE_PROMPT: 2.1,
            IMAGE_MODE_TYPE_ALL: 0.8
        }
    elif recall_probe_count / len(due_questions) >= 0.55:
        base_scores = {
            IMAGE_MODE_TYPE_PROMPT: 4.2,
            IMAGE_MODE_TYPE_ALL: 3.5,
            IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 0.8,
            IMAGE_MODE_MULTIPLE_CHOICE_MEDIA: 0.7
        }
    elif strong_count / len(due_questions) >= 0.55:
        base_scores = {
            IMAGE_MODE_TYPE_PROMPT: 3.6,
            IMAGE_MODE_TYPE_ALL: 3.1,
            IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 1.1,
            IMAGE_MODE_MULTIPLE_CHOICE_MEDIA: 1.0
        }
    else:
        base_scores = {
            IMAGE_MODE_TYPE_PROMPT: 3.0,
            IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 2.2,
            IMAGE_MODE_MULTIPLE_CHOICE_MEDIA: 2.1,
            IMAGE_MODE_TYPE_ALL: 1.4
        }

    scores = dict(base_scores)

    if context_count <= 4:
        scores[IMAGE_MODE_MULTIPLE_CHOICE_LABEL] -= 0.4
        scores[IMAGE_MODE_MULTIPLE_CHOICE_MEDIA] -= 0.4
    elif context_count >= 12:
        scores[IMAGE_MODE_MULTIPLE_CHOICE_MEDIA] += 0.2

    apply_recent_mode_penalty(
        scores,
        due_questions,
        "image_mode",
        IMAGE_MODES,
        mode_normalizer=canonical_image_mode
    )

    for mode in discouraged_modes or []:
        if mode in IMAGE_MODES:
            scores[mode] = scores.get(mode, 0) - 0.75

    tie_order = {
        IMAGE_MODE_MULTIPLE_CHOICE_LABEL: 0,
        IMAGE_MODE_MULTIPLE_CHOICE_MEDIA: 1,
        IMAGE_MODE_TYPE_PROMPT: 2,
        IMAGE_MODE_TYPE_ALL: 3
    }
    eligible_modes = list(IMAGE_MODES)

    if choice_context_count < CHOICE_MODE_MIN_CONTEXT:
        eligible_modes = [
            mode
            for mode in eligible_modes
            if mode not in IMAGE_MULTIPLE_CHOICE_MODES
        ]

    if audio_only:
        eligible_modes = [
            mode
            for mode in eligible_modes
            if mode in IMAGE_AUDIO_MODES
        ] or [IMAGE_MODE_TYPE_PROMPT]

    return weighted_mode_choice(
        eligible_modes,
        scores,
        tie_order,
        rng=rng
    )
