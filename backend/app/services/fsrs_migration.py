from datetime import date

from fsrs import Card, Rating

from ..models import AppSetting, Progress, Question
from ..scheduler import (
    FSRS_VERSION,
    create_fsrs_scheduler,
    date_from_review_datetime,
    fsrs_card_for_progress,
    fsrs_card_to_dict,
    is_repeat_lapse,
    legacy_quality_to_fsrs_rating,
    parse_history_date,
    review_datetime_for_date
)


FSRS_MIGRATION_KEY = "fsrs_v6_migration"


def get_fsrs_migration_setting(db):
    return (
        db.query(AppSetting)
        .filter(AppSetting.key == FSRS_MIGRATION_KEY)
        .first()
    )


def has_fsrs_v6_migration_run(db):
    setting = get_fsrs_migration_setting(db)

    if not setting or not isinstance(setting.value, dict):
        return False

    return setting.value.get("version") == FSRS_VERSION


def save_fsrs_migration_setting(db, result):
    value = {
        "version": FSRS_VERSION,
        "migrated": result["migrated"],
        "from_history": result["from_history"],
        "from_scalars": result["from_scalars"],
        "skipped": result["skipped"]
    }
    setting = get_fsrs_migration_setting(db)

    if not setting:
        db.add(AppSetting(key=FSRS_MIGRATION_KEY, value=value))
    else:
        setting.value = value


def sorted_history_items(progress, type_q):
    items = []

    for index, entry in enumerate(progress.history or []):
        if not isinstance(entry, dict):
            continue

        reviewed_on = parse_history_date(entry.get("reviewed_on"))

        if not reviewed_on:
            continue

        rating = None

        if entry.get("fsrs_rating") is not None:
            try:
                rating = Rating(int(entry["fsrs_rating"]))
            except (TypeError, ValueError):
                rating = None
        else:
            rating = legacy_quality_to_fsrs_rating(entry.get("quality"), type_q)

        if rating is None:
            continue

        items.append((reviewed_on, index, rating))

    return sorted(items, key=lambda item: (item[0], item[1]))


def replay_history_to_fsrs_card(progress, type_q):
    history_items = sorted_history_items(progress, type_q)

    if not history_items:
        return None

    scheduler = create_fsrs_scheduler(enable_fuzzing=True)
    first_review_on = history_items[0][0]
    card = Card(
        card_id=progress.question_id or 0,
        due=review_datetime_for_date(first_review_on)
    )
    reps = 0
    lapses = 0

    previous_rating = None
    previous_reviewed_on = None

    for reviewed_on, _, rating in history_items:
        # Replaying legacy history has to apply the same-day retry rule the live
        # scheduler applies, or a card the user fumbled a few times in one
        # session migrates in with a compounded lapse it never actually earned.
        repeat_lapse = is_repeat_lapse(
            rating,
            previous_rating,
            reviewed_on,
            previous_reviewed_on
        )
        previous_card = card
        card, _ = scheduler.review_card(
            card,
            rating,
            review_datetime=review_datetime_for_date(reviewed_on)
        )
        reps += 1
        previous_rating = rating
        previous_reviewed_on = reviewed_on

        if repeat_lapse:
            card.stability = previous_card.stability
            card.difficulty = previous_card.difficulty
        elif rating == Rating.Again:
            lapses += 1

    return {
        "card": card,
        "reps": reps,
        "lapses": lapses
    }


def write_fsrs_progress(progress, card, reps=None, lapses=None):
    last_review = date_from_review_datetime(card.last_review)
    next_review = date_from_review_datetime(card.due) or progress.next_review

    progress.fsrs_card = fsrs_card_to_dict(card)
    progress.fsrs_version = FSRS_VERSION

    if card.stability is not None:
        progress.stability = card.stability
    elif progress.stability is None:
        progress.stability = 1.0

    if card.difficulty is not None:
        progress.difficulty = card.difficulty
    elif progress.difficulty is None:
        progress.difficulty = 5.0

    if reps is not None:
        progress.reps = reps
    elif progress.reps is None:
        progress.reps = 0

    if lapses is not None:
        progress.lapses = lapses
    elif progress.lapses is None:
        progress.lapses = 0

    if last_review:
        progress.last_review = last_review

    if next_review:
        progress.next_review = next_review
        progress.ideal_next_review = next_review

    if progress.last_review and progress.next_review:
        progress.interval = max(
            0,
            (progress.next_review - progress.last_review).days
        )
        progress.ideal_interval = progress.interval
    elif progress.interval is None:
        progress.interval = 0
        progress.ideal_interval = 0
    elif progress.ideal_interval is None:
        progress.ideal_interval = progress.interval


def migrate_progress_to_fsrs_v6(db):
    if has_fsrs_v6_migration_run(db):
        return {
            "status": "skipped",
            "migrated": 0,
            "from_history": 0,
            "from_scalars": 0,
            "skipped": 0
        }


    rows = (
        db.query(Progress, Question.type_q)
        .join(Question, Question.id == Progress.question_id)
        .all()
    )
    result = {
        "status": "ok",
        "migrated": 0,
        "from_history": 0,
        "from_scalars": 0,
        "skipped": 0
    }

    for progress, type_q in rows:
        replayed = replay_history_to_fsrs_card(progress, type_q)

        if replayed:
            write_fsrs_progress(
                progress,
                replayed["card"],
                reps=replayed["reps"],
                lapses=replayed["lapses"]
            )
            result["from_history"] += 1
        else:
            card = fsrs_card_for_progress(progress, today=date.today())
            write_fsrs_progress(progress, card)
            result["from_scalars"] += 1

        result["migrated"] += 1

    save_fsrs_migration_setting(db, result)

    return result
