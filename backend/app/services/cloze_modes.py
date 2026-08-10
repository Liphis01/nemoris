"""The first cloze release deliberately has one auditable retrieval mode."""

CLOZE_MODE_FILL_BLANK = "fill_blank"
CLOZE_MODES = (CLOZE_MODE_FILL_BLANK,)
DEFAULT_CLOZE_MODE = CLOZE_MODE_FILL_BLANK
CLOZE_FILL_BLANK_DIFFICULTY = 1.0


def normalize_cloze_mode(mode):
    value = str(mode or "").strip()
    return value if value in CLOZE_MODES else DEFAULT_CLOZE_MODE


def cloze_mode_difficulty(mode=None, context_count=0, tuning=None):
    # One blank recalled from its authored context is the reference route.
    normalize_cloze_mode(mode)
    return CLOZE_FILL_BLANK_DIFFICULTY
