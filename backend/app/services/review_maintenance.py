from datetime import date, datetime, timezone

from ..models import AppSetting
from .progress import rebalance_progress_calendar
from .settings import REVIEW_MAINTENANCE_KEY


def _maintenance_state(db):
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == REVIEW_MAINTENANCE_KEY)
        .first()
    )

    if not setting or not isinstance(setting.value, dict):
        return None, {}

    return setting, setting.value


def _save_maintenance_state(db, today, result, ran_at=None):
    ran_at = ran_at or datetime.now(timezone.utc)
    value = {
        "rebalanced_on": today.isoformat(),
        "ran_at": ran_at.isoformat(),
        "daily_target": result.get("daily_target"),
        "updated": result.get("updated", 0),
        "moved": result.get("moved", 0),
        "total": result.get("total", 0)
    }
    setting, _ = _maintenance_state(db)

    if not setting:
        db.add(AppSetting(key=REVIEW_MAINTENANCE_KEY, value=value))
    else:
        setting.value = value

    return value


def run_review_calendar_maintenance(db, today=None, force=False):
    """Keep scheduled review dates current for the local day.

    Startup already runs a rebalance, but a desktop process can stay open across
    midnight. Review-related reads go through this guard so a skipped day is
    smoothed before the session is counted or selected, without rebalancing on
    every GET.
    """
    today = today or date.today()
    _, state = _maintenance_state(db)

    if not force and state.get("rebalanced_on") == today.isoformat():
        return {
            "changed": False,
            "rebalance": None,
            "maintenance": state
        }

    result = rebalance_progress_calendar(db, today=today)
    maintenance = _save_maintenance_state(db, today, result)

    return {
        "changed": True,
        "rebalance": result,
        "maintenance": maintenance
    }
