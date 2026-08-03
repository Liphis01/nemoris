"""Multi-image ("media pool") helpers.

A question can carry several images, one of which is picked at ask time so the
learner cannot memorise one specific picture. The pool is stored in
``question.data["media_pool"]`` as an ordered list of media URL strings, cover
first, and ``question.media`` mirrors ``media_pool[0]``.

The key is stored ONLY when there are >= 2 images: a single-image question keeps
exactly the historical shape (a bare ``media`` string, no ``media_pool`` in
``data``), so existing rows, pack content-hashes, and diffs stay unchanged.
"""

MEDIA_POOL_KEY = "media_pool"


def _clean(values):
    """Trimmed, de-duplicated, order-preserving list of non-empty strings."""
    seen = set()
    result = []

    for value in values or []:
        text = str(value or "").strip()

        if text and text not in seen:
            seen.add(text)
            result.append(text)

    return result


def read_media_pool(media, data):
    """Every image for a question, cover first. Falls back to ``[media]``.

    Returns ``[]`` when the question has no image at all.
    """
    raw_pool = (data or {}).get(MEDIA_POOL_KEY)

    if isinstance(raw_pool, list):
        cleaned = _clean(raw_pool)

        if cleaned:
            return cleaned

    single = str(media or "").strip()

    return [single] if single else []


def normalize_media_pool(pool, cover=None):
    """Sanitise a pool: drop empties/dupes; if ``cover`` is given, force it first."""
    prefix = [cover] if cover else []

    return _clean(prefix + list(pool or []))


def pool_media_and_data(base_data, pool):
    """Fold a pool into a data dict, returning ``(cover_media, data)``.

    ``media_pool`` is written only when the pool has >= 2 entries; otherwise the
    key is dropped so single-image rows keep their historical shape. Pure — it
    does not touch a Question row, so both create and update paths can share it.
    """
    normalized = normalize_media_pool(pool)
    data = dict(base_data or {})

    if len(normalized) >= 2:
        data[MEDIA_POOL_KEY] = normalized
        cover = normalized[0]
    else:
        data.pop(MEDIA_POOL_KEY, None)
        cover = normalized[0] if normalized else ""

    return cover, data


def apply_media_pool(question, pool):
    """Write a normalised pool onto a Question row (mutates ``media``/``data``)."""
    cover, data = pool_media_and_data(question.data, pool)

    question.media = cover or None
    question.data = data

    return read_media_pool(question.media, question.data)


def question_media_refs(media, answer_media, data):
    """All static media a question references: pool images + answer media.

    Used by every "is this file still used?" scan so pool images are never
    garbage-collected while a question still points at them.
    """
    refs = read_media_pool(media, data)
    answer = str(answer_media or "").strip()

    if answer:
        refs.append(answer)

    return refs
