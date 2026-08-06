from datetime import datetime, timezone
from math import isfinite
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
PACE_PRESSURE_NOTICE_KEY = "pace_pressure_notice"
PACK_CATALOG_SETTINGS_KEY = "pack_catalog"
INTAKE_SETTINGS_KEY = "review_intake"

# The pace the user picks, as questions per day. The tier is the single volume
# knob: it *is* catchup_daily_target, so the calendar smoothing and the
# new-question intake are always driven by the same number.
PACE_TIERS = {
    "leger": 10,
    "regulier": 20,
    "soutenu": 40,
    "intensif": 80
}
# How many NEW questions each tier is willing to take on per day, as a floor
# and a ceiling. The tier is a request for more work than the schedule alone
# produces: new questions top the day up toward catchup_daily_target, but never
# fewer than the floor (so a busy stretch still brings some new material) and
# never more than the ceiling (so a fresh library is not dumped at once).
TIER_NEW_QUESTION_BOUNDS = {
    "leger": (1, 5),
    "regulier": (2, 10),
    "soutenu": (3, 20),
    "intensif": (5, 40)
}
# A pre-tier user with a raw target gets bounds derived from it on the same
# proportions, so nothing has to special-case them.
NEW_QUESTION_FLOOR_SHARE = 0.06
NEW_QUESTION_CEILING_SHARE = 0.5

# Bounds on the tuned rate, as ratios of the tier seed. They live here rather
# than in intake.py because the stored intake row is normalized here and the
# dependency only runs one way (intake imports settings).
#
# The floor is deliberately shallow: the tuned rate gates new-question intake
# only -- it has no effect whatsoever on review load -- so a deep floor never
# delivered the relief it appeared to, while really halving how much new
# material the user could take on. A tier that is genuinely too heavy is now
# surfaced as a prompt instead of being silently walked down to the tier below.
TUNE_FLOOR_RATIO = 0.75
TUNE_CEILING_RATIO = 1.25
# Flat estimate used only to label the tiers ("~5 min"). Question types differ
# in practice; this is a rough figure for the picker, not a measurement.
INTAKE_SECONDS_PER_QUESTION = 15

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
    # Derived from the device-local intake row, and dismissed per device.
    PACE_PRESSURE_NOTICE_KEY,
    "fsrs_v6_migration",
    # Legacy rows from when the catalogue URL was typed in per device. The
    # catalogue now ships with the app; these must still never be synced.
    PACK_CATALOG_SETTINGS_KEY,
    # Derived, not chosen: the auto-tuned intake rate is keyed to one device's
    # "today", churns daily, and is rebuildable anywhere from review_log (which
    # does sync). Syncing it would only manufacture daily write conflicts. The
    # user's intent (pace_tier) lives in REVIEW_SETTINGS_KEY and does sync.
    INTAKE_SETTINGS_KEY
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
    "catchup_daily_target": DEFAULT_CATCHUP_DAILY_TARGET,
    "pace_tier": None
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


def new_question_bounds(daily_target, tier=None):
    """The (floor, ceiling) on new questions per day for this pace."""
    if tier in TIER_NEW_QUESTION_BOUNDS:
        return TIER_NEW_QUESTION_BOUNDS[tier]

    floor = max(1, round(daily_target * NEW_QUESTION_FLOOR_SHARE))
    ceiling = max(floor, round(daily_target * NEW_QUESTION_CEILING_SHARE))

    return floor, ceiling


def normalize_review_settings(value):
    data = value if isinstance(value, dict) else {}
    tier = data.get("pace_tier")
    tier = tier if tier in PACE_TIERS else None

    # A tier, when set, is authoritative for the number: one source of truth, so
    # the two can never drift. Users predating the tiers keep their raw target.
    raw_target = (
        PACE_TIERS[tier]
        if tier
        else data.get("catchup_daily_target", DEFAULT_CATCHUP_DAILY_TARGET)
    )

    return {
        "catchup_daily_target": normalize_daily_target(raw_target),
        "pace_tier": tier
    }


def resolve_pace_tier(daily_target, stored_tier=None):
    # The tier to highlight in the UI. An explicit choice wins; otherwise pick
    # the closest tier to the stored number so a pre-tier user still sees a
    # sensible chip selected. Ties resolve to the smaller (gentler) tier.
    if stored_tier in PACE_TIERS:
        return stored_tier

    return min(
        PACE_TIERS,
        key=lambda key: (abs(PACE_TIERS[key] - daily_target), PACE_TIERS[key])
    )


def pace_tier_options():
    # One source of truth for the picker: the daily target, its time estimate,
    # and how many new questions the tier is willing to take on.
    return [
        {
            "key": key,
            "daily_target": target,
            "estimated_minutes": round(
                target * INTAKE_SECONDS_PER_QUESTION / 60
            ),
            "new_min": TIER_NEW_QUESTION_BOUNDS[key][0],
            "new_max": TIER_NEW_QUESTION_BOUNDS[key][1]
        }
        for key, target in PACE_TIERS.items()
    ]


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
    previous = normalize_review_settings(setting.value)
    normalized = normalize_review_settings(settings)
    setting.value = normalized

    if previous["catchup_daily_target"] != normalized["catchup_daily_target"]:
        # Rescale rather than reset. The rate is stored as a ratio of the seed,
        # so the tuner's judgement carries across the change and a round trip
        # (A -> B -> A) lands exactly where staying on A would have. Clearing
        # tuned_on lets the new tier be re-tuned today rather than tomorrow.
        rescale_intake_settings(db, normalized["catchup_daily_target"])

    return normalized


def normalize_intake_settings(value, seed):
    # `seed` is the user's chosen daily target. The tuned rate is stored as a
    # RATIO of it, never as an absolute number: that is what lets a tier change
    # rescale instead of reset, so leaving a tier and coming back lands on
    # exactly the rate staying would have produced.
    data = value if isinstance(value, dict) else {}

    if "rate_ratio" in data:
        raw_ratio = data.get("rate_ratio")
    elif "effective_daily_target" in data:
        # Pre-ratio row: recover the ratio so the upgrade keeps the earned rate
        # instead of discarding it. Bounded by the clamp below, so a seed that
        # changed between the write and this read is harmless.
        try:
            raw_ratio = float(data["effective_daily_target"]) / max(1, seed)
        except (TypeError, ValueError, ZeroDivisionError):
            raw_ratio = 1.0
    else:
        raw_ratio = 1.0

    try:
        ratio = float(raw_ratio)
    except (TypeError, ValueError):
        ratio = 1.0

    if not isfinite(ratio):
        ratio = 1.0

    ratio = clamp(ratio, TUNE_FLOOR_RATIO, TUNE_CEILING_RATIO)

    try:
        floor_days = max(0, int(data.get("floor_days", 0)))
    except (TypeError, ValueError):
        floor_days = 0

    tuned_on = data.get("tuned_on")
    tuned_on = tuned_on if isinstance(tuned_on, str) else None

    return {
        "rate_ratio": ratio,
        # Derived, not stored: every existing reader (the settings payload, the
        # quota, the frontend) keeps working unchanged.
        "effective_daily_target": max(1, int(seed * ratio + 0.5)),
        "tuned_on": tuned_on,
        "floor_days": floor_days,
        "last_retention": data.get("last_retention"),
        "last_schedule_pressure": data.get("last_schedule_pressure"),
        "last_reviews_in_window": data.get("last_reviews_in_window")
    }


def load_intake_settings(db, seed):
    # Deliberately non-creating (unlike get_or_create_review_settings_row): this
    # runs on the read-only review path, which must not flush.
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == INTAKE_SETTINGS_KEY)
        .first()
    )

    return normalize_intake_settings(setting.value if setting else None, seed)


def save_intake_settings(db, settings, seed):
    normalized = normalize_intake_settings(settings, seed)
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == INTAKE_SETTINGS_KEY)
        .first()
    )

    if not setting:
        db.add(AppSetting(key=INTAKE_SETTINGS_KEY, value=normalized))
    else:
        setting.value = normalized

    return normalized


def reset_intake_settings(db, seed):
    return save_intake_settings(db, None, seed)


def rescale_intake_settings(db, seed):
    """Re-anchor the tuned rate on a new tier seed, keeping its judgement.

    The stored ratio survives, so effective_daily_target simply re-derives
    against the new seed. This is what makes a tier round trip cost nothing:
    the old code reset to the seed here and silently discarded whatever the
    tuner had earned.
    """
    state = load_intake_settings(db, seed)

    return save_intake_settings(
        db,
        {**state, "tuned_on": None},
        seed
    )


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


def suggested_lighter_tier(tier):
    """The next tier down, or None when already at the lightest.

    None is meaningful: it means no pace can carry this collection, and the
    honest advice is to suspend questions rather than to change the tier.
    """
    if tier not in PACE_TIERS:
        return None

    lighter = [
        (value, key)
        for key, value in PACE_TIERS.items()
        if value < PACE_TIERS[tier]
    ]

    return max(lighter)[1] if lighter else None


def save_pace_pressure_notice(db, notice, ran_at=None):
    """Tell the user their tier is heavier than their calendar can carry.

    This replaces silently walking the rate down into another tier's territory:
    the tuner gates new questions only, so it can never relieve review load --
    only the user changing tier can do that.
    """
    if not notice:
        clear_pace_pressure_notice(db)
        return None

    ran_at = ran_at or datetime.now(timezone.utc)
    payload = {
        "id": f"{ran_at.isoformat()}-{uuid4().hex[:8]}",
        "ran_at": ran_at.isoformat(),
        **notice
    }
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == PACE_PRESSURE_NOTICE_KEY)
        .first()
    )

    if not setting:
        db.add(AppSetting(key=PACE_PRESSURE_NOTICE_KEY, value=payload))
    else:
        setting.value = payload

    return payload


def get_pace_pressure_notice(db):
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == PACE_PRESSURE_NOTICE_KEY)
        .first()
    )

    return setting.value if setting else None


def clear_pace_pressure_notice(db):
    (
        db.query(AppSetting)
        .filter(AppSetting.key == PACE_PRESSURE_NOTICE_KEY)
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
