import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup, ReviewLog
from app.routers.review import answer_map, answer_text, answer_timeline
from app.schemas import (
    MapAnswerRequest,
    TextAnswerRequest,
    TimelineAnswerItem,
    TimelineAnswerRequest,
    TimelineDateValue
)


class GivenAnswerTests(unittest.TestCase):
    """M0 0.1: what the learner answered must reach the history entry."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_question(self, question_id, type_q, data=None, answer=None, group=None):
        question = Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=answer or f"Answer {question_id}",
            tags=[],
            data=data or {},
            group=group
        )
        self.db.add(question)
        self.db.add(Progress(
            question_id=question_id,
            stability=1.0,
            difficulty=5.0,
            reps=1,
            lapses=0,
            interval=0,
            next_review=date.today(),
            history=[]
        ))

        return question

    def latest_entry(self, question_id):
        progress = (
            self.db.query(Progress)
            .filter(Progress.question_id == question_id)
            .one()
        )

        return progress.history[-1]

    def test_map_answers_are_stored_when_supplied(self):
        self.add_question(1, "map")
        self.add_question(2, "map")
        self.db.commit()

        answer_map(
            MapAnswerRequest(
                items={1: 2, 2: 0},
                answers={1: "France", 2: "Belgique"},
                candidates={1: [1, 2], 2: [1, 2]}
            ),
            db=self.db
        )

        first_entry = self.latest_entry(1)
        self.assertEqual(first_entry["answer"], "France")
        self.assertEqual(first_entry["answer_event"]["raw_response"], "France")
        self.assertEqual(first_entry["answer_event"]["candidate_ids"], [1, 2])
        self.assertEqual(first_entry["answer_event"]["type_q"], "map")
        self.assertEqual(
            first_entry["answer_event"]["presentation_kind"],
            "map_group"
        )
        # A miss is the interesting case: it records the confusion, not the
        # right answer.
        self.assertEqual(self.latest_entry(2)["answer"], "Belgique")

    def test_map_answers_are_absent_when_the_client_omits_them(self):
        self.add_question(1, "map")
        self.db.commit()

        answer_map(MapAnswerRequest(items={1: 2}), db=self.db)

        self.assertNotIn("answer", self.latest_entry(1))
        self.assertIn("answer_event", self.latest_entry(1))
        self.assertIsNone(self.latest_entry(1)["answer_event"]["raw_response"])

    def test_partial_answers_only_annotate_the_items_supplied(self):
        self.add_question(1, "map")
        self.add_question(2, "map")
        self.db.commit()

        answer_map(
            MapAnswerRequest(items={1: 2, 2: 2}, answers={1: "France"}),
            db=self.db
        )

        self.assertEqual(self.latest_entry(1)["answer"], "France")
        self.assertNotIn("answer", self.latest_entry(2))

    def test_text_answers_are_stored(self):
        self.add_question(1, "text")
        self.db.commit()

        answer_text(
            TextAnswerRequest(items={1: 0}, answers={1: "stalagmite"}),
            db=self.db
        )

        self.assertEqual(self.latest_entry(1)["answer"], "stalagmite")

    def test_backend_downgrades_raw_text_miss(self):
        self.add_question(1, "text", answer="stalagmite")
        self.db.commit()

        answer_text(
            TextAnswerRequest(items={1: 3}, answers={1: "stalactite"}),
            db=self.db
        )

        entry = self.latest_entry(1)
        self.assertEqual(entry["quality"], 0)
        self.assertEqual(entry["raw_quality"], 3)
        self.assertEqual(entry["effective_quality"], 0)
        self.assertFalse(entry["answer_event"]["context"]["backend_matched"])
        self.assertEqual(
            entry["answer_event"]["context"]["grading_authority"],
            "backend"
        )

    def test_legacy_text_answer_keeps_client_quality(self):
        self.add_question(1, "text", answer="stalagmite")
        self.db.commit()

        answer_text(TextAnswerRequest(items={1: 3}), db=self.db)

        entry = self.latest_entry(1)
        self.assertEqual(entry["quality"], 3)
        self.assertEqual(
            entry["answer_event"]["context"]["grading_authority"],
            "legacy_client"
        )

    def test_group_exact_policy_is_recorded_and_applied(self):
        group = QuestionGroup(
            type_group="text",
            name="Orthographe",
            data={
                "answer_policy": {
                    "preset": "exact",
                    "case": "strict",
                    "diacritics": "strict",
                    "spacing": "strict",
                    "punctuation": "strict",
                    "fuzzy": "none"
                }
            }
        )
        self.db.add(group)
        self.add_question(1, "text", answer="État", group=group)
        self.db.commit()

        answer_text(
            TextAnswerRequest(items={1: 2}, answers={1: "etat"}),
            db=self.db
        )

        entry = self.latest_entry(1)
        self.assertEqual(entry["quality"], 0)
        self.assertEqual(
            entry["answer_event"]["answer_policy"]["preset"],
            "exact"
        )

    def test_timeline_stores_the_placed_date(self):
        self.add_question(
            1,
            "timeline",
            data={
                "timeline": {
                    "kind": "point",
                    "start": {"year": 1789, "precision": "year"}
                }
            }
        )
        self.db.commit()

        answer_timeline(
            TimelineAnswerRequest(
                items={
                    1: TimelineAnswerItem(
                        start=TimelineDateValue(year=1792, precision="year")
                    )
                },
                presentation_context={"range": {"start_value": 1, "end_value": 2}}
            ),
            db=self.db
        )

        entry = self.latest_entry(1)

        self.assertEqual(entry["answer"]["start"]["year"], 1792)
        self.assertIsNone(entry["answer"]["end"])
        self.assertEqual(entry["answer_event"]["type_q"], "timeline")
        self.assertEqual(
            entry["answer_event"]["presentation_kind"],
            "timeline_group"
        )
        self.assertEqual(
            entry["answer_event"]["expected_value"]["start"]["year"],
            1789
        )
        self.assertEqual(
            entry["answer_event"]["context"]["range"],
            {"start_value": 1, "end_value": 2}
        )

    def test_the_answer_is_mirrored_into_the_revlog(self):
        self.add_question(1, "map")
        self.db.commit()

        answer_map(
            MapAnswerRequest(items={1: 2}, answers={1: "France"}),
            db=self.db
        )

        row = (
            self.db.query(ReviewLog)
            .filter(ReviewLog.question_id == 1)
            .order_by(ReviewLog.seq.desc())
            .first()
        )

        self.assertEqual(row.data["answer"], "France")
        self.assertEqual(row.data["answer_event"]["raw_response"], "France")


if __name__ == "__main__":
    unittest.main()
