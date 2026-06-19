import unittest
from datetime import date, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question
from app.services.review import get_review_items
from app.services.timeline import build_mastered_timeline_anchors


def point_data(year):
    return {"timeline": {"kind": "point", "start": {"year": year, "precision": "year"}}}


def interval_data(start_year, end_year):
    return {
        "timeline": {
            "kind": "interval",
            "start": {"year": start_year, "precision": "year"},
            "end": {"year": end_year, "precision": "year"}
        }
    }


class TimelineAnchorTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_question(
        self,
        question_id,
        type_q="timeline",
        data=None,
        interval=120,
        reps=5,
        next_review=None
    ):
        question = Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=[],
            data=data if data is not None else point_data(1500)
        )
        question.progress = Progress(
            stability=10.0,
            difficulty=5.0,
            reps=reps,
            lapses=0,
            interval=interval,
            next_review=next_review or date.today() + timedelta(days=interval),
            history=[]
        )
        self.db.add(question)
        return question

    def test_only_well_retained_timeline_cards_become_anchors(self):
        mastered = self.add_question(1, data=point_data(1492))
        self.add_question(2, data=point_data(1600), interval=30)  # interval too low
        self.add_question(3, data=point_data(1700), reps=2)  # too few reps
        self.add_question(4, type_q="text", data={})  # not a timeline card
        self.db.commit()

        anchors = build_mastered_timeline_anchors(self.db)

        self.assertEqual([anchor["id"] for anchor in anchors], ["mastered-1"])
        anchor = anchors[0]
        self.assertEqual(anchor["source"], "mastered")
        self.assertEqual(anchor["question_id"], mastered.id)
        self.assertEqual(anchor["label"], "Question 1")
        self.assertEqual(anchor["tier"], 1)
        self.assertEqual(anchor["start"]["year"], 1492)
        self.assertNotIn("end", anchor)

    def test_interval_anchor_carries_both_endpoints(self):
        self.add_question(1, data=interval_data(1914, 1918))
        self.db.commit()

        anchor = build_mastered_timeline_anchors(self.db)[0]

        self.assertEqual(anchor["start"]["year"], 1914)
        self.assertEqual(anchor["end"]["year"], 1918)

    def test_excluded_session_ids_never_appear(self):
        self.add_question(1, data=point_data(1492))
        self.add_question(2, data=point_data(1789))
        self.db.commit()

        anchors = build_mastered_timeline_anchors(self.db, exclude_ids=[2])

        self.assertEqual([anchor["question_id"] for anchor in anchors], [1])

    def test_reference_value_orders_by_proximity_then_caps(self):
        self.add_question(1, data=point_data(1000))
        self.add_question(2, data=point_data(1500))
        self.add_question(3, data=point_data(2000))
        self.db.commit()

        from app.services.timeline import date_center_value

        reference = date_center_value({"year": 1950, "precision": "year"})

        with patch("app.services.timeline.MAX_TIMELINE_ANCHORS", 2):
            anchors = build_mastered_timeline_anchors(
                self.db,
                reference_value=reference
            )

        self.assertEqual(
            [anchor["question_id"] for anchor in anchors],
            [3, 2]
        )

    def test_review_payload_attaches_anchors_and_excludes_session(self):
        today = date.today()
        # Due session card (mastered too, but in-session → excluded as anchor).
        self.add_question(1, data=point_data(1789), next_review=today)
        # Mastered card that is not due → eligible as an anchor only.
        self.add_question(2, data=point_data(1492), next_review=today + timedelta(days=120))
        self.db.commit()

        items = get_review_items(self.db)
        timeline_group = next(item for item in items if item["type_q"] == "timeline")

        self.assertEqual(
            [item["question_id"] for item in timeline_group["items"]],
            [1]
        )
        self.assertEqual(
            [anchor["question_id"] for anchor in timeline_group["anchors"]],
            [2]
        )


if __name__ == "__main__":
    unittest.main()
