"""Canonical numeric values, validation, display, and server-side grading."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re

from fastapi import HTTPException
from sqlalchemy.orm import joinedload

from ..models import Question


DEFAULT_RELATIVE_TOLERANCE = Decimal("0.10")
MAX_DISPLAY_PRECISION = 12
_NUMBER_RE = re.compile(
    r"^[+-]?(?:(?:\d+(?:[.,]\d*)?)|(?:[.,]\d+))(?:[eE][+-]?\d+)?$"
)


class NumericParseError(ValueError):
    pass


def _bad(detail):
    raise HTTPException(status_code=422, detail=detail)


def parse_numeric_input(value):
    """Parse French/point decimal input without accepting units or ambiguity."""
    text = str(value if value is not None else "").strip()
    text = text.replace("\u00a0", " ").replace("\u202f", " ")
    if not text or any(char.isspace() and char != " " for char in text):
        raise NumericParseError("Nombre invalide")

    # Spaces are the only thousands separators in this first release. A mixed
    # comma/dot number is unambiguous only when its final separator is decimal.
    text = text.replace(" ", "")
    if not _NUMBER_RE.fullmatch(text):
        raise NumericParseError("Nombre invalide")

    comma = text.rfind(",")
    dot = text.rfind(".")
    if comma >= 0 and dot >= 0:
        decimal_index = max(comma, dot)
        decimal_separator = text[decimal_index]
        grouping_separator = "," if decimal_separator == "." else "."
        left, right = text[:decimal_index], text[decimal_index + 1:]
        if grouping_separator in right or left.count(grouping_separator) > 1:
            raise NumericParseError("Nombre ambigu")
        text = left.replace(grouping_separator, "") + "." + right
    elif comma >= 0:
        if text.count(",") != 1:
            raise NumericParseError("Nombre ambigu")
        text = text.replace(",", ".")
    elif text.count(".") > 1:
        raise NumericParseError("Nombre ambigu")

    try:
        parsed = Decimal(text)
    except InvalidOperation as error:
        raise NumericParseError("Nombre invalide") from error
    if not parsed.is_finite():
        raise NumericParseError("Nombre invalide")
    return parsed


def canonical_decimal(value):
    if value == 0:
        return "0"
    normalized = value.normalize()
    return format(normalized, "f")


def decimal_precision(value):
    exponent = value.as_tuple().exponent
    return max(0, -exponent) if isinstance(exponent, int) else 0


def _decimal_field(data, field, *, required=False, default=None, positive=False):
    raw = data.get(field)
    if raw is None:
        if required:
            _bad(f"{field} est requis.")
        return default
    try:
        parsed = parse_numeric_input(raw)
    except NumericParseError as error:
        _bad(f"{field} est invalide : {error}")
    if positive and parsed <= 0:
        _bad(f"{field} doit être strictement positif.")
    return parsed


def validate_numeric_data(data):
    """Validate and normalize the persisted numeric metadata."""
    numeric = (data or {}).get("numeric")
    if not isinstance(numeric, dict):
        _bad("data.numeric est requis pour une carte numérique.")

    value = _decimal_field(numeric, "value", required=True)
    unit = str(numeric.get("unit") or "").strip()
    if not unit or len(unit) > 60:
        _bad("L’unité est requise et doit contenir au plus 60 caractères.")

    display_precision = numeric.get("display_precision", decimal_precision(value))
    if isinstance(display_precision, bool):
        _bad("display_precision est invalide.")
    try:
        display_precision = int(display_precision)
    except (TypeError, ValueError):
        _bad("display_precision est invalide.")
    if not 0 <= display_precision <= MAX_DISPLAY_PRECISION:
        _bad(f"display_precision doit être entre 0 et {MAX_DISPLAY_PRECISION}.")

    if value == 0:
        absolute = _decimal_field(
            numeric,
            "zero_absolute_tolerance",
            required=True,
            positive=True,
        )
        relative = None
    else:
        relative = _decimal_field(
            numeric,
            "relative_tolerance",
            default=DEFAULT_RELATIVE_TOLERANCE,
            positive=True,
        )
        if relative > Decimal("1"):
            _bad("relative_tolerance ne peut pas dépasser 1 (100 %).")
        absolute = None

    return {
        "value": canonical_decimal(value),
        "unit": unit,
        "display_precision": display_precision,
        "relative_tolerance": canonical_decimal(relative) if relative is not None else None,
        "zero_absolute_tolerance": canonical_decimal(absolute) if absolute is not None else None,
    }


def numeric_data_for_question(data):
    normalized = validate_numeric_data(data)
    return {**(data or {}), "numeric": normalized}


def format_numeric_value(numeric):
    value = Decimal(numeric["value"])
    precision = int(numeric["display_precision"])
    quantum = Decimal("1").scaleb(-precision)
    displayed = value.quantize(quantum, rounding=ROUND_HALF_UP)
    text = f"{displayed:,.{precision}f}".replace(",", " ").replace(".", ",")
    return f"{text} {numeric['unit']}"


def validate_question_numeric(type_q, group_id, data):
    if type_q != "numeric":
        return data or {}
    if group_id is not None:
        _bad("Une carte numérique ne peut pas appartenir à un groupe.")
    return numeric_data_for_question(data)


def validate_numeric_pack_entries(question_entries):
    for entry in question_entries or []:
        if entry.get("type_q") != "numeric":
            continue
        normalized = numeric_data_for_question(entry.get("data") or {})
        if (entry.get("data") or {}).get("numeric") != normalized["numeric"]:
            raise ValueError("Invalid numeric pack: metadata is not canonical")
        if entry.get("answer") != format_numeric_value(normalized["numeric"]):
            raise ValueError("Invalid numeric pack: answer does not match metadata")


def grade_numeric_answer(db, payload):
    question = (
        db.query(Question)
        .options(joinedload(Question.progress))
        .filter(Question.id == payload.question_id, Question.type_q == "numeric")
        .first()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Numeric card not found")

    numeric = validate_numeric_data(question.data or {})
    expected = Decimal(numeric["value"])
    try:
        submitted = parse_numeric_input(payload.answer)
    except NumericParseError as error:
        return {
            "question_id": question.id,
            "correct": False,
            "format_error": str(error),
            "parsed_value": None,
            "expected": format_numeric_value(numeric),
            "numeric": numeric,
        }

    absolute_error = abs(submitted - expected)
    if expected == 0:
        allowed_error = Decimal(numeric["zero_absolute_tolerance"])
        relative_error = None
    else:
        relative_error = absolute_error / abs(expected)
        allowed_error = abs(expected) * Decimal(numeric["relative_tolerance"])

    return {
        "question_id": question.id,
        "correct": absolute_error <= allowed_error,
        "format_error": None,
        "parsed_value": canonical_decimal(submitted),
        "expected": format_numeric_value(numeric),
        "numeric": numeric,
        "absolute_error": canonical_decimal(absolute_error),
        "relative_error": canonical_decimal(relative_error) if relative_error is not None else None,
        "allowed_error": canonical_decimal(allowed_error),
    }
