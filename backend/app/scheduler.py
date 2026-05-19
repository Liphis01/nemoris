from datetime import date, timedelta
import math


DESIRED_RETENTION = 0.9


def next_interval(stability):
    """
    Convert stability to interval using FSRS forgetting curve
    """
    return max(
        1,
        round(stability * math.log(DESIRED_RETENTION) / math.log(0.9))
    )


def progress_value(progress, field, default):
    # Existing rows may have NULLs after schema upgrades; scheduling should
    # continue from defaults instead of failing or producing None math.
    if not progress:
        return default

    return getattr(progress, field) or default


def update_progress(progress, quality):
    """
    Apply a compact FSRS-inspired scheduling step.

    quality: 0 = fail, 1 = hard, 2 = easy. The returned dict is written back to
    Progress by services/progress.py so scheduling stays isolated from database
    mutation.
    """

    today = date.today()

    stability = progress_value(progress, "stability", 1.0)
    difficulty = progress_value(progress, "difficulty", 5.0)
    reps = progress_value(progress, "reps", 0)
    lapses = progress_value(progress, "lapses", 0)

    # ============================================
    # FAIL
    # ============================================

    if quality == 0:

        difficulty = min(10, difficulty + 0.4)

        stability = max(
            0.5,
            stability * 0.45
        )

        lapses += 1

    # ============================================
    # HARD
    # ============================================

    elif quality == 1:

        difficulty = min(10, difficulty + 0.1)

        stability = stability * (
            1.2 + (10 - difficulty) * 0.03
        )

    # ============================================
    # EASY
    # ============================================

    else:

        difficulty = max(1, difficulty - 0.08)

        stability = stability * (
            1.8 + (10 - difficulty) * 0.05
        )

    reps += 1

    interval = 0 if quality == 0 else next_interval(stability)

    next_review = today + timedelta(days=interval)

    return {
        "stability": stability,
        "difficulty": difficulty,
        "reps": reps,
        "lapses": lapses,
        "interval": interval,
        "next_review": next_review,
        "last_review": today
    }


def preview_intervals(progress):
    # The map recap can show what each button would schedule before the user
    # commits a quality choice.
    return {
        quality: update_progress(progress, quality)["interval"]
        for quality in (0, 1, 2)
    }
