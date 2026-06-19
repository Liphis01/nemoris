import random

from fastapi import HTTPException

from ..models import Progress, Question
from ..scheduler import preview_intervals
from ..serializers import serialize_progress


VALID_PRECISIONS = {"year", "month", "day"}
VALID_KINDS = {"point", "interval"}
MIN_YEAR = -9999
MAX_YEAR = 9999

# A timeline card becomes a landmark anchor once it is well retained: a long
# interval and several successful reviews. Anchors are capped so a large mastered
# library does not bloat the review payload.
MASTERED_ANCHOR_MIN_INTERVAL_DAYS = 60
MASTERED_ANCHOR_MIN_REPS = 3
MAX_TIMELINE_ANCHORS = 40


def _timeline_error(message: str):
    raise HTTPException(status_code=400, detail=message)


def _date_error(message: str):
    raise ValueError(message)


def timeline_year_to_index(year):
    return year if year > 0 else year + 1


def timeline_index_to_year(index):
    return index if index > 0 else index - 1


def is_leap_year(year):
    timeline_year = timeline_year_to_index(year)
    return (
        timeline_year % 4 == 0 and
        (timeline_year % 100 != 0 or timeline_year % 400 == 0)
    )


def days_in_month(year, month):
    if month == 2:
        return 29 if is_leap_year(year) else 28

    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]


def days_before_timeline_index(timeline_year):
    previous_year = timeline_year - 1
    return (
        previous_year * 365 +
        previous_year // 4 -
        previous_year // 100 +
        previous_year // 400
    )


def days_before_year(year):
    return days_before_timeline_index(timeline_year_to_index(year))


def days_before_month(year, month):
    return sum(days_in_month(year, current_month) for current_month in range(1, month))


def date_to_ordinal(year, month, day):
    return days_before_year(year) + days_before_month(year, month) + day


MIN_TIMELINE_VALUE = date_to_ordinal(MIN_YEAR, 1, 1)
MAX_TIMELINE_VALUE = date_to_ordinal(MAX_YEAR, 12, 31)


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

    if year == 0 or year < MIN_YEAR or year > MAX_YEAR:
        _date_error("Timeline year must be between -9999 and 9999, excluding 0")

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

        max_day = days_in_month(year, month)
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
        return year, month, day

    if precision == "month":
        month = value["month"]
        day = 1 if boundary == "lower" else days_in_month(year, month)
        return year, month, day

    return year, value["month"], value["day"]


def date_lower_value(value):
    return date_to_ordinal(*_date_for_value(value, "lower"))


def date_upper_value(value):
    return date_to_ordinal(*_date_for_value(value, "upper"))


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
        "start_value": max(MIN_TIMELINE_VALUE, start_value - left_padding),
        "end_value": min(MAX_TIMELINE_VALUE, end_value + right_padding)
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
        "projected_intervals": preview_intervals(
            question.progress,
            favorite=bool((question.data or {}).get("favorite"))
        )
    }

    item["start_value"] = date_center_value(timeline["start"])

    if timeline["kind"] == "interval":
        item["end_value"] = date_center_value(timeline["end"])

    return item


def serialize_timeline_review_group(items, anchors=None):
    return {
        "type_q": "timeline",
        "name": "Timeline",
        "items": items,
        "range": build_timeline_range(items),
        "anchors": anchors or []
    }


def _anchor_center_value(timeline):
    center = date_center_value(timeline["start"])

    if timeline["kind"] == "interval":
        return round((center + date_center_value(timeline["end"])) / 2)

    return center


def _mastered_anchor_payload(question, timeline):
    payload = {
        "id": f"mastered-{question.id}",
        "source": "mastered",
        "question_id": question.id,
        "label": question.question,
        "tier": 1,
        "start": timeline["start"]
    }

    if timeline.get("end"):
        payload["end"] = timeline["end"]

    return payload


def build_mastered_timeline_anchors(db, exclude_ids=None, reference_value=None):
    """Landmark anchors drawn from the user's own well-retained timeline cards.

    `exclude_ids` keeps the current session's questions out of the anchor layer
    so it never reveals an answer. When `reference_value` is given, anchors
    closest to it are preferred before the count is capped.
    """
    excluded = set(exclude_ids or [])
    query = (
        db.query(Question)
        .join(Progress, Question.id == Progress.question_id)
        .filter(Question.type_q == "timeline")
        .filter(Progress.interval >= MASTERED_ANCHOR_MIN_INTERVAL_DAYS)
        .filter(Progress.reps >= MASTERED_ANCHOR_MIN_REPS)
    )
    anchors = []

    for question in query.all():
        if question.id in excluded:
            continue

        try:
            timeline = validate_timeline_data(question.data or {})
        except HTTPException:
            continue

        anchors.append((
            _anchor_center_value(timeline),
            _mastered_anchor_payload(question, timeline)
        ))

    if reference_value is not None:
        anchors.sort(key=lambda entry: abs(entry[0] - reference_value))
    else:
        anchors.sort(key=lambda entry: entry[1]["question_id"])

    return [payload for _, payload in anchors[:MAX_TIMELINE_ANCHORS]]


def _month_index(value):
    return timeline_year_to_index(value["year"]) * 12 + (value["month"] - 1)


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
        distance = abs(
            timeline_year_to_index(expected["year"]) -
            timeline_year_to_index(guess["year"])
        )
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
