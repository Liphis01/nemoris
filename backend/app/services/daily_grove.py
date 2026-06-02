from datetime import date, timedelta

from sqlalchemy import or_

from ..models import AppSetting, Progress
from .progress import progress_has_started


DAILY_GROVE_KEY = "daily_grove"
REST_LEAF_CAP = 2
MILESTONES = (3, 7, 14, 30, 60, 100, 365)

DEFAULT_DAILY_GROVE_STATE = {
    "current_streak": 0,
    "longest_streak": 0,
    "last_completed_on": None,
    "rest_leaves": 0,
    "protected_dates": [],
    "seen_milestones": []
}

GROVE_STAGES = (
    (365, "sanctuary", "Sanctuaire Nemoris"),
    (100, "ancient_forest", "Forêt ancienne"),
    (60, "forest", "Grande forêt"),
    (30, "canopy", "Canopée"),
    (14, "grove", "Bosquet dense"),
    (7, "young_grove", "Jeune bosquet"),
    (3, "sprout", "Pousse"),
    (1, "seedling", "Graine éveillée"),
    (0, "dormant", "Graine dormante")
)


def _date_from_iso(value):
    if not value:
        return None

    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def _date_to_iso(value):
    return value.isoformat() if value else None


def _int_at_least(value, minimum=0):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return minimum

    return max(minimum, number)


def _normalize_known_milestones(values):
    result = []

    for value in values or []:
        try:
            milestone = int(value)
        except (TypeError, ValueError):
            continue

        if milestone in MILESTONES and milestone not in result:
            result.append(milestone)

    return sorted(result)


def _normalize_date_list(values):
    dates = []

    for value in values or []:
        parsed = _date_from_iso(value)

        if parsed and parsed not in dates:
            dates.append(parsed)

    return [
        item.isoformat()
        for item in sorted(dates)
    ]


def normalize_daily_grove_state(value):
    data = value if isinstance(value, dict) else {}
    current_streak = _int_at_least(data.get("current_streak"))
    longest_streak = max(
        current_streak,
        _int_at_least(data.get("longest_streak"))
    )
    rest_leaves = min(
        REST_LEAF_CAP,
        _int_at_least(data.get("rest_leaves"))
    )

    return {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "last_completed_on": _date_to_iso(
            _date_from_iso(data.get("last_completed_on"))
        ),
        "rest_leaves": rest_leaves,
        "protected_dates": _normalize_date_list(data.get("protected_dates")),
        "seen_milestones": _normalize_known_milestones(
            data.get("seen_milestones")
        )
    }


def get_or_create_daily_grove_row(db):
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == DAILY_GROVE_KEY)
        .first()
    )

    if setting:
        return setting

    setting = AppSetting(
        key=DAILY_GROVE_KEY,
        value=dict(DEFAULT_DAILY_GROVE_STATE)
    )
    db.add(setting)
    db.flush()

    return setting


def get_daily_grove_state(db):
    setting = get_or_create_daily_grove_row(db)
    state = normalize_daily_grove_state(setting.value)

    if setting.value != state:
        setting.value = state

    return state


def save_daily_grove_state(db, state):
    setting = get_or_create_daily_grove_row(db)
    normalized = normalize_daily_grove_state(state)
    setting.value = normalized

    return normalized


def count_due_started_reviews(db, today=None):
    today = today or date.today()
    progresses = (
        db.query(Progress)
        .filter(
            or_(
                Progress.next_review == None,
                Progress.next_review <= today
            )
        )
        .all()
    )

    return sum(
        1
        for progress in progresses
        if progress_has_started(progress)
    )


def grove_stage_for_streak(streak):
    for minimum, key, label in GROVE_STAGES:
        if streak >= minimum:
            return {
                "key": key,
                "label": label
            }

    return {
        "key": "dormant",
        "label": "Graine dormante"
    }


def next_milestone_for_streak(streak):
    for milestone in MILESTONES:
        if streak < milestone:
            return milestone

    return None


def milestone_progress(streak):
    target = next_milestone_for_streak(streak)

    if target is None:
        return {
            "current": streak,
            "target": None,
            "remaining": 0,
            "percent": 100
        }

    previous = 0

    for milestone in MILESTONES:
        if milestone >= target:
            break
        previous = milestone

    span = max(1, target - previous)
    progress = max(0, streak - previous)

    return {
        "current": streak,
        "target": target,
        "remaining": max(0, target - streak),
        "percent": min(100, round((progress / span) * 100))
    }


def build_daily_grove_status(
    db,
    today=None,
    state=None,
    completed=False,
    already_complete=False,
    blocked=False,
    milestone_reached=None,
    protected_dates_used=None
):
    today = today or date.today()
    state = state or get_daily_grove_state(db)
    due_count = count_due_started_reviews(db, today=today)
    today_complete = state["last_completed_on"] == today.isoformat()
    eligible = due_count == 0 and not today_complete
    streak = state["current_streak"]

    return {
        **state,
        "today": today.isoformat(),
        "due_count": due_count,
        "today_complete": today_complete,
        "eligible": eligible,
        "can_complete_today": eligible,
        "completed": completed,
        "already_complete": already_complete,
        "blocked": blocked,
        "milestone_reached": milestone_reached,
        "protected_dates_used": protected_dates_used or [],
        "next_milestone": next_milestone_for_streak(streak),
        "milestone_progress": milestone_progress(streak),
        "grove_stage": grove_stage_for_streak(streak)
    }


def _missed_dates(last_completed_on, today, count):
    return [
        (last_completed_on + timedelta(days=offset)).isoformat()
        for offset in range(1, count + 1)
    ]


def _apply_completion_to_state(state, today):
    last_completed_on = _date_from_iso(state["last_completed_on"])

    if last_completed_on == today:
        return state, {
            "already_complete": True,
            "milestone_reached": None,
            "protected_dates_used": []
        }

    current_streak = state["current_streak"]
    rest_leaves = state["rest_leaves"]
    protected_dates = list(state["protected_dates"])
    protected_dates_used = []

    if last_completed_on and today > last_completed_on:
        gap_days = (today - last_completed_on).days - 1

        if gap_days > 0:
            protected_count = min(rest_leaves, gap_days)
            protected_dates_used = _missed_dates(
                last_completed_on,
                today,
                protected_count
            )
            rest_leaves -= protected_count
            protected_dates = sorted(
                set(protected_dates + protected_dates_used)
            )

            if protected_count < gap_days:
                current_streak = 0
    elif last_completed_on and today < last_completed_on:
        return state, {
            "already_complete": True,
            "milestone_reached": None,
            "protected_dates_used": []
        }

    next_streak = current_streak + 1
    longest_streak = max(state["longest_streak"], next_streak)
    seen_milestones = list(state["seen_milestones"])
    milestone_reached = None

    if next_streak in MILESTONES and next_streak not in seen_milestones:
        milestone_reached = next_streak
        seen_milestones.append(next_streak)

    if next_streak > 0 and next_streak % 7 == 0:
        rest_leaves = min(REST_LEAF_CAP, rest_leaves + 1)

    return {
        "current_streak": next_streak,
        "longest_streak": longest_streak,
        "last_completed_on": today.isoformat(),
        "rest_leaves": rest_leaves,
        "protected_dates": protected_dates,
        "seen_milestones": sorted(seen_milestones)
    }, {
        "already_complete": False,
        "milestone_reached": milestone_reached,
        "protected_dates_used": protected_dates_used
    }


def complete_daily_grove(db, today=None):
    today = today or date.today()
    state = get_daily_grove_state(db)

    if state["last_completed_on"] == today.isoformat():
        return build_daily_grove_status(
            db,
            today=today,
            state=state,
            already_complete=True
        )

    due_count = count_due_started_reviews(db, today=today)

    if due_count > 0:
        return build_daily_grove_status(
            db,
            today=today,
            state=state,
            blocked=True
        )

    next_state, result = _apply_completion_to_state(state, today)

    if result["already_complete"]:
        return build_daily_grove_status(
            db,
            today=today,
            state=state,
            already_complete=True
        )

    saved_state = save_daily_grove_state(db, next_state)

    return build_daily_grove_status(
        db,
        today=today,
        state=saved_state,
        completed=True,
        milestone_reached=result["milestone_reached"],
        protected_dates_used=result["protected_dates_used"]
    )
