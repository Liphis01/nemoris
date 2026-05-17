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


def update_progress(progress, quality):

    today = date.today()

    stability = progress.stability or 1.0
    difficulty = progress.difficulty or 5.0
    reps = progress.reps or 0
    lapses = progress.lapses or 0

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

    interval = next_interval(stability)

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