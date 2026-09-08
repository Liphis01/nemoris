import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import LearnConfusion, Progress, Question, QuestionGroup
from app.services.learn import (
    attach_learn_confusions,
    learn_confusions_for_questions,
    record_learn_confusions
)


class LearnConfusionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        group = QuestionGroup(id=1, type_group="map", name="Régions", data={})
        self.db.add(group)

        for question_id, answer in ((1, "Ain"), (2, "Aisne"), (3, "Allier")):
            self.db.add(Question(
                id=question_id,
                type_q="map",
                question=answer,
                answer=answer,
                data={"code": str(question_id)},
                group_id=1
            ))

        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_records_pairs_without_creating_progress(self):
        result = record_learn_confusions(
            self.db,
            [
                {"expected_id": 1, "picked_id": 2, "correct": False},
                {"expected_id": 1, "picked_id": 2, "correct": True},
                {"expected_id": 1, "picked_id": 3, "correct": True}
            ],
            today=date(2026, 9, 7)
        )

        self.assertEqual(result["pairs"], 2)
        self.assertEqual(result["exposures"], 3)
        self.assertEqual(result["mispicks"], 1)

        # The Learn screen is a scratchpad: no card may become "started".
        self.assertEqual(self.db.query(Progress).count(), 0)

        row = self.db.query(LearnConfusion).filter_by(
            expected_question_id=1,
            picked_question_id=2
        ).one()
        self.assertEqual(row.exposures, 2)
        self.assertEqual(row.mispicks, 1)
        self.assertEqual(row.last_seen_on, date(2026, 9, 7))

    def test_repeated_sessions_accumulate(self):
        for _ in range(2):
            record_learn_confusions(
                self.db,
                [{"expected_id": 1, "picked_id": 2, "correct": False}]
            )

        row = self.db.query(LearnConfusion).one()
        self.assertEqual(row.exposures, 2)
        self.assertEqual(row.mispicks, 2)

    def test_ignores_self_pairs_and_unknown_questions(self):
        result = record_learn_confusions(
            self.db,
            [
                {"expected_id": 1, "picked_id": 1, "correct": False},
                {"expected_id": 1, "picked_id": 999, "correct": False},
                {"expected_id": None, "picked_id": 2, "correct": False}
            ]
        )

        self.assertEqual(result["pairs"], 0)
        self.assertEqual(self.db.query(LearnConfusion).count(), 0)

    def test_lookup_is_symmetric(self):
        record_learn_confusions(
            self.db,
            [{"expected_id": 1, "picked_id": 2, "correct": False}]
        )
        by_question = learn_confusions_for_questions(self.db, [1, 2, 3])

        self.assertEqual(
            by_question[1],
            [{"candidate_id": 2, "exposures": 1, "mispicks": 1}]
        )
        self.assertEqual(
            by_question[2],
            [{"candidate_id": 1, "exposures": 1, "mispicks": 1}]
        )
        self.assertNotIn(3, by_question)

    def test_attaches_to_nested_review_payload(self):
        record_learn_confusions(
            self.db,
            [{"expected_id": 1, "picked_id": 2, "correct": False}]
        )
        items = [{
            "presentation_kind": "map_group",
            "items": [{"question_id": 1}, {"question_id": 3}],
            "context_items": [{"question_id": 2}]
        }]

        attach_learn_confusions(self.db, items)

        self.assertEqual(
            items[0]["items"][0]["learn_confusions"],
            [{"candidate_id": 2, "exposures": 1, "mispicks": 1}]
        )
        self.assertEqual(
            items[0]["context_items"][0]["learn_confusions"],
            [{"candidate_id": 1, "exposures": 1, "mispicks": 1}]
        )
        self.assertNotIn("learn_confusions", items[0]["items"][1])


if __name__ == "__main__":
    unittest.main()
