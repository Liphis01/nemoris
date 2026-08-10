"""The first numeric release has one server-graded typed retrieval route."""

NUMERIC_MODE_INPUT = "numeric_input"
NUMERIC_MODES = (NUMERIC_MODE_INPUT,)
DEFAULT_NUMERIC_MODE = NUMERIC_MODE_INPUT
NUMERIC_INPUT_DIFFICULTY = 1.0


def normalize_numeric_mode(mode):
    value = str(mode or "").strip()
    return value if value in NUMERIC_MODES else DEFAULT_NUMERIC_MODE


def numeric_mode_difficulty(mode=None, context_count=0, tuning=None):
    normalize_numeric_mode(mode)
    return NUMERIC_INPUT_DIFFICULTY
