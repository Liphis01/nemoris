from datetime import datetime, timezone
from uuid import uuid4

from ..models import AppSetting
from ..scheduler import DEFAULT_CATCHUP_DAILY_TARGET, normalize_daily_target


REVIEW_SETTINGS_KEY = "review"
STARTUP_REBALANCE_NOTICE_KEY = "startup_rebalance_notice"

DEFAULT_REVIEW_SETTINGS = {
    "catchup_daily_target": DEFAULT_CATCHUP_DAILY_TARGET
}


def normalize_review_settings(value):
    data = value if isinstance(value, dict) else {}

    return {
        "catchup_daily_target": normalize_daily_target(
            data.get("catchup_daily_target", DEFAULT_CATCHUP_DAILY_TARGET)
        )
    }


def get_or_create_review_settings_row(db):
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == REVIEW_SETTINGS_KEY)
        .first()
    )

    if setting:
        return setting

    setting = AppSetting(
        key=REVIEW_SETTINGS_KEY,
        value=dict(DEFAULT_REVIEW_SETTINGS)
    )
    db.add(setting)
    db.flush()

    return setting


def get_review_settings(db):
    setting = get_or_create_review_settings_row(db)
    settings = normalize_review_settings(setting.value)

    if setting.value != settings:
        setting.value = settings

    return settings


def save_review_settings(db, settings):
    setting = get_or_create_review_settings_row(db)
    normalized = normalize_review_settings(settings)
    setting.value = normalized

    return normalized


def get_startup_rebalance_notice(db):
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == STARTUP_REBALANCE_NOTICE_KEY)
        .first()
    )

    if not setting or not isinstance(setting.value, dict):
        return None

    notice = setting.value

    if (notice.get("moved") or 0) <= 0:
        return None

    return notice


def save_startup_rebalance_notice(db, result, ran_at=None):
    if (result.get("moved") or 0) <= 0:
        clear_startup_rebalance_notice(db)
        return None

    ran_at = ran_at or datetime.now(timezone.utc)
    notice = {
        "id": f"{ran_at.isoformat()}-{uuid4().hex[:8]}",
        "ran_at": ran_at.isoformat(),
        "moved": result["moved"],
        "updated": result["updated"],
        "total": result["total"],
        "daily_target": result["daily_target"]
    }
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == STARTUP_REBALANCE_NOTICE_KEY)
        .first()
    )

    if not setting:
        setting = AppSetting(
            key=STARTUP_REBALANCE_NOTICE_KEY,
            value=notice
        )
        db.add(setting)
    else:
        setting.value = notice

    return notice


def clear_startup_rebalance_notice(db):
    (
        db.query(AppSetting)
        .filter(AppSetting.key == STARTUP_REBALANCE_NOTICE_KEY)
        .delete()
    )
