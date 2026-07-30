from datetime import datetime, timezone
from uuid import uuid4

from ..config import CLOUD_KEY, CLOUD_URL
from ..models import AppSetting
from ..scheduler import (
    DEFAULT_CATCHUP_DAILY_TARGET,
    DEFAULT_EASY_REWARD_FLOOR,
    DEFAULT_FAILURE_PENALTY_POWER,
    MAX_EASY_REWARD_FLOOR,
    MAX_FAILURE_PENALTY_POWER,
    MIN_EASY_REWARD_FLOOR,
    MIN_FAILURE_PENALTY_POWER,
    normalize_daily_target
)
from .map_modes import (
    MAP_MULTIPLE_CHOICE_DIFFICULTY,
    MAP_TYPE_PROMPT_DIFFICULTY
)


REVIEW_SETTINGS_KEY = "review"
SCHEDULER_TUNING_SETTINGS_KEY = "scheduler_tuning"
STARTUP_REBALANCE_NOTICE_KEY = "startup_rebalance_notice"
PACK_CATALOG_SETTINGS_KEY = "pack_catalog"

# sync-roadmap 0.6 — classification of AppSetting keys. Sync (M2) sends only
# SYNC_SETTING_KEYS; everything else stays on the device. An unknown key is
# treated as device-local by default: never sync what is not understood.
SYNC_SETTING_KEYS = {
    REVIEW_SETTINGS_KEY,
    SCHEDULER_TUNING_SETTINGS_KEY,
    "tag_hierarchy"
}
DEVICE_SETTING_KEYS = {
    STARTUP_REBALANCE_NOTICE_KEY,
    "fsrs_v6_migration",
    # Legacy rows from when the catalogue URL was typed in per device. The
    # catalogue now ships with the app; these must still never be synced.
    PACK_CATALOG_SETTINGS_KEY
}


def sync_settings_payload(db):
    """The settings that travel with the collection during sync."""
    return {
        row.key: row.value
        for row in (
            db.query(AppSetting)
            .filter(AppSetting.key.in_(SYNC_SETTING_KEYS))
            .all()
        )
    }
MIN_TYPE_PROMPT_DIFFICULTY = 1.00
MAX_TYPE_PROMPT_DIFFICULTY = 1.35
MIN_MULTIPLE_CHOICE_DIFFICULTY = 0.30
MAX_MULTIPLE_CHOICE_DIFFICULTY = 0.80
MIN_CLICK_PROMPT_BIAS = -0.25
MAX_CLICK_PROMPT_BIAS = 0.15

DEFAULT_REVIEW_SETTINGS = {
    "catchup_daily_target": DEFAULT_CATCHUP_DAILY_TARGET
}
DEFAULT_SCHEDULER_TUNING_SETTINGS = {
    "type_prompt_difficulty": MAP_TYPE_PROMPT_DIFFICULTY,
    "multiple_choice_difficulty": MAP_MULTIPLE_CHOICE_DIFFICULTY,
    "click_prompt_bias": 0.0,
    "easy_reward_floor": DEFAULT_EASY_REWARD_FLOOR,
    "failure_penalty_power": DEFAULT_FAILURE_PENALTY_POWER
}


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def _float_setting(data, key, default, lower, upper):
    try:
        value = float(data.get(key, default))
    except (TypeError, ValueError):
        value = default

    return clamp(value, lower, upper)


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


def normalize_scheduler_tuning_settings(value):
    data = value if isinstance(value, dict) else {}

    return {
        "type_prompt_difficulty": _float_setting(
            data,
            "type_prompt_difficulty",
            DEFAULT_SCHEDULER_TUNING_SETTINGS["type_prompt_difficulty"],
            MIN_TYPE_PROMPT_DIFFICULTY,
            MAX_TYPE_PROMPT_DIFFICULTY
        ),
        "multiple_choice_difficulty": _float_setting(
            data,
            "multiple_choice_difficulty",
            DEFAULT_SCHEDULER_TUNING_SETTINGS["multiple_choice_difficulty"],
            MIN_MULTIPLE_CHOICE_DIFFICULTY,
            MAX_MULTIPLE_CHOICE_DIFFICULTY
        ),
        "click_prompt_bias": _float_setting(
            data,
            "click_prompt_bias",
            DEFAULT_SCHEDULER_TUNING_SETTINGS["click_prompt_bias"],
            MIN_CLICK_PROMPT_BIAS,
            MAX_CLICK_PROMPT_BIAS
        ),
        "easy_reward_floor": _float_setting(
            data,
            "easy_reward_floor",
            DEFAULT_SCHEDULER_TUNING_SETTINGS["easy_reward_floor"],
            MIN_EASY_REWARD_FLOOR,
            MAX_EASY_REWARD_FLOOR
        ),
        "failure_penalty_power": _float_setting(
            data,
            "failure_penalty_power",
            DEFAULT_SCHEDULER_TUNING_SETTINGS["failure_penalty_power"],
            MIN_FAILURE_PENALTY_POWER,
            MAX_FAILURE_PENALTY_POWER
        )
    }


def load_scheduler_tuning_settings(db):
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == SCHEDULER_TUNING_SETTINGS_KEY)
        .first()
    )

    return normalize_scheduler_tuning_settings(
        setting.value if setting else None
    )


def save_scheduler_tuning_settings(db, settings):
    normalized = normalize_scheduler_tuning_settings(settings)
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == SCHEDULER_TUNING_SETTINGS_KEY)
        .first()
    )

    if not setting:
        db.add(AppSetting(
            key=SCHEDULER_TUNING_SETTINGS_KEY,
            value=normalized
        ))
    else:
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


def get_pack_catalog_settings():
    """The catalogue's Supabase project — bundled, not user-configured.

    A pack catalogue is only meaningful as one shared service: pointing a
    device at its own project would just show an empty catalogue with nobody
    to publish to. So this reads config, which self-hosters override through
    NEMORIS_SUPABASE_URL/_KEY.
    """
    return {"url": CLOUD_URL, "key": CLOUD_KEY}
