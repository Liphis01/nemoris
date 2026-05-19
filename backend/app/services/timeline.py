import calendar
import random
from datetime import date

from fastapi import HTTPException

from ..scheduler import preview_intervals
from ..serializers import serialize_progress


VALID_PRECISIONS = {"year", "month", "day"}
VALID_KINDS = {"point", "interval"}
MIN_YEAR = 1
MAX_YEAR = 9999


def _timeline_error(message: str):
    raise HTTPException(status_code=400, detail=message)


def _date_error(message: str):
    raise ValueError(message)


def normalize_timeline_date(value):
    if not isinstance(value, dict):
        _date_error("Timeline date must be an object")

    precision = value.get("precision")
    if precision not in VALID_PRECISIONS:
        _date_error("Timeline precision must be year, month, or day")

    try:
        year = int(value.get("year"))
    except (TypeError, ValueError):
        _date_error("Timeline year is required")

    if year < MIN_YEAR or year > MAX_YEAR:
        _date_error("Timeline year must be between 1 and 9999")

    month = value.get("month")
    day = value.get("day")

    if precision in {"month", "day"}:
        try:
            month = int(month)
        except (TypeError, ValueError):
            _date_error("Timeline month is required for this precision")

        if month < 1 or month > 12:
            _date_error("Timeline month must be between 1 and 12")
    else:
        month = None

    if precision == "day":
        try:
            day = int(day)
        except (TypeError, ValueError):
            _date_error("Timeline day is required for day precision")

        max_day = calendar.monthrange(year, month)[1]
        if day < 1 or day > max_day:
            _date_error("Timeline day is invalid for this month")
    else:
        day = None

    return {
        "year": year,
        "month": month,
        "day": day,
        "precision": precision
    }


def validate_timeline_data(data):
    timeline = (data or {}).get("timeline")

    if not isinstance(timeline, dict):
        _timeline_error("Timeline questions require data.timeline")

    kind = timeline.get("kind")
    if kind not in VALID_KINDS:
        _timeline_error("Timeline kind must be point or interval")

    if kind == "interval":
        if not timeline.get("end"):
            _timeline_error("Timeline intervals require an end date")

    try:
        start = normalize_timeline_date(timeline.get("start"))
        end = (
            normalize_timeline_date(timeline.get("end"))
            if kind == "interval"
            else None
        )
    except ValueError as error:
        _timeline_error(str(error))

    if kind == "interval":
        if date_lower_value(end) < date_lower_value(start):
            _timeline_error("Timeline interval end must be after start")

    return {
        "kind": kind,
        "start": start,
        **({"end": end} if end else {})
    }


def validate_question_timeline(type_q: str, group_id: int | None, data):
    if type_q != "timeline":
        return

    if group_id:
        _timeline_error("Timeline questions cannot belong to a group")

    validate_timeline_data(data)


def _date_for_value(value, boundary):
    precision = value["precision"]
    year = value["year"]

    if precision == "year":
        month = 1 if boundary == "lower" else 12
        day = 1 if boundary == "lower" else 31
        return date(year, month, day)

    if precision == "month":
        month = value["month"]
        day = 1 if boundary == "lower" else calendar.monthrange(year, month)[1]
        return date(year, month, day)

    return date(year, value["month"], value["day"])


def date_lower_value(value):
    return _date_for_value(value, "lower").toordinal()


def date_upper_value(value):
    return _date_for_value(value, "upper").toordinal()


def date_center_value(value):
    return round((date_lower_value(value) + date_upper_value(value)) / 2)


def _precision_rank(precision):
    return {
        "year": 0,
        "month": 1,
        "day": 2
    }[precision]


def _minimum_span_days(items):
    finest_rank = 0

    for item in items:
        timeline = item["timeline"]
        finest_rank = max(
            finest_rank,
            _precision_rank(timeline["start"]["precision"])
        )
        if timeline["kind"] == "interval":
            finest_rank = max(
                finest_rank,
                _precision_rank(timeline["end"]["precision"])
            )

    if finest_rank == 2:
        return 90
    if finest_rank == 1:
        return 730
    return 7305


def build_timeline_range(items):
    values = []

    for item in items:
        timeline = item["timeline"]
        values.append(date_lower_value(timeline["start"]))
        values.append(date_upper_value(timeline["start"]))

        if timeline["kind"] == "interval":
            values.append(date_lower_value(timeline["end"]))
            values.append(date_upper_value(timeline["end"]))

    start_value = min(values)
    end_value = max(values)
    span = max(1, end_value - start_value)
    minimum_span = _minimum_span_days(items)

    if span < minimum_span:
        extra = minimum_span - span
        start_value -= extra // 2
        end_value += extra - extra // 2
        span = end_value - start_value

    left_padding = round(span * random.uniform(0.15, 0.35))
    right_padding = round(span * random.uniform(0.15, 0.35))

    return {
        "start_value": max(1, start_value - left_padding),
        "end_value": min(date(MAX_YEAR, 12, 31).toordinal(), end_value + right_padding)
    }


def serialize_timeline_review_item(question):
    timeline = validate_timeline_data(question.data or {})
    item = {
        "question_id": question.id,
        "question": question.question,
        "answer": question.answer,
        "media": question.media,
        "tags": question.tags or [],
        "timeline": timeline,
        "progress": serialize_progress(question.progress),
        "projected_intervals": preview_intervals(question.progress)
    }

    item["start_value"] = date_center_value(timeline["start"])

    if timeline["kind"] == "interval":
        item["end_value"] = date_center_value(timeline["end"])

    return item


def serialize_timeline_review_group(items):
    return {
        "type_q": "timeline",
        "name": "Timeline",
        "items": items,
        "range": build_timeline_range(items)
    }


def _month_index(value):
    return value["year"] * 12 + (value["month"] - 1)


def _quality_from_distance(distance, precision):
    if distance == 0:
        return 2

    hard_threshold = {
        "year": 1,
        "month": 2,
        "day": 14
    }[precision]

    if distance <= hard_threshold:
        return 1

    return 0


def grade_timeline_date(expected, guessed):
    if not isinstance(guessed, dict):
        _timeline_error("Timeline answer is missing a date")

    expected_precision = expected["precision"]

    try:
        guess = normalize_timeline_date({
            **guessed,
            "precision": expected_precision
        })
    except ValueError as error:
        _timeline_error(str(error))

    if expected_precision == "year":
        distance = abs(expected["year"] - guess["year"])
        unit = "years"
    elif expected_precision == "month":
        distance = abs(_month_index(expected) - _month_index(guess))
        unit = "months"
    else:
        distance = abs(
            date_lower_value(expected) - date_lower_value(guess)
        )
        unit = "days"

    return {
        "quality": _quality_from_distance(distance, expected_precision),
        "distance": distance,
        "unit": unit,
        "guess": guess
    }


def grade_timeline_answer(timeline, guessed):
    start_result = grade_timeline_date(timeline["start"], guessed.get("start"))
    quality = start_result["quality"]
    end_result = None

    if timeline["kind"] == "interval":
        end_result = grade_timeline_date(timeline["end"], guessed.get("end"))
        quality = min(quality, end_result["quality"])

    return {
        "quality": quality,
        "start": start_result,
        "end": end_result
    }
