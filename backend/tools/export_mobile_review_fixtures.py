"""Export backend review fixtures consumed by the mobile scheduler tests.

Run from the project root with:

    backend/venv/bin/python backend/tools/export_mobile_review_fixtures.py

The script prints JSON to stdout and does not mutate the app database.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fsrs import Rating

from backend.app.scheduler import (
    FSRS_VERSION,
    create_fsrs_scheduler,
    date_from_review_datetime,
    fsrs_card_from_data,
    fsrs_card_to_dict,
    new_fsrs_card_data,
    review_datetime_for_date,
)


def initial_answer_cases(today: date):
    scheduler = create_fsrs_scheduler(enable_fuzzing=False)
    cases = []

    for app_quality, rating in (
        (0, Rating.Again),
        (1, Rating.Hard),
        (2, Rating.Good),
        (3, Rating.Easy),
    ):
        card = fsrs_card_from_data(new_fsrs_card_data(42, today))
        reviewed_card, _ = scheduler.review_card(
            card,
            rating,
            review_datetime=review_datetime_for_date(today),
        )
        next_review = (
            today
            if app_quality == 0
            else date_from_review_datetime(reviewed_card.due)
        )

        cases.append(
            {
                "name": f"initial_quality_{app_quality}",
                "question_id": 42,
                "quality": app_quality,
                "today": today.isoformat(),
                "expected": {
                    "stability": reviewed_card.stability,
                    "difficulty": reviewed_card.difficulty,
                    "interval": (next_review - today).days,
                    "next_review": next_review.isoformat(),
                    "fsrs_rating": int(rating),
                    "fsrs_state": int(reviewed_card.state),
                    "fsrs_version": FSRS_VERSION,
                    "fsrs_card": fsrs_card_to_dict(reviewed_card),
                },
            }
        )

    return cases


def main():
    payload = {
        "schema": "nemoris-mobile-review-fixtures/v1",
        "fsrs_version": FSRS_VERSION,
        "cases": initial_answer_cases(date(2026, 7, 28)),
    }
    print(json.dumps(payload, indent=2, sort_keys=True, default=str))


if __name__ == "__main__":
    main()
