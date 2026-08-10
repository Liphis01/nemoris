import unittest
from datetime import date

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Collection, Progress, Tombstone
from app.routers.review import answer_enumeration
from app.schemas import EnumerationAnswerRequest, QuestionCreate, QuestionUpdate
from app.serializers import serialize_review_question_item
from app.services.enumeration import (
    grade_enumeration_answers,
    validate_enumeration_data,
)
from app.services.questions import create_question, update_question
from app.services.training import get_training_items


def enumeration_data(required_count=2, members=None):
    return {
        "enumeration": {
            "required_count": required_count,
            "members": members or [
                {"value": "politique", "aliases": ["political"]},
                {"value": "course", "aliases": []},
                {"value": "fonctionner", "aliases": ["marcher"]},
            ],
        }
    }


class EnumerationTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self):
        self.db.close()

    def create(self, data=None):
        question = create_question(
            self.db,
            QuestionCreate(
                type_q="enumeration",
                question="Donne deux sens de run.",
                answer="ignored",
                data=data or enumeration_data(),
            ),
        )
        self.db.commit()
        return question

    def test_validation_requires_distinct_members_and_a_valid_quota(self):
        self.assertEqual(
            validate_enumeration_data(enumeration_data())["required_count"],
            2,
        )
        for data in (
            enumeration_data(0),
            enumeration_data(4),
            enumeration_data(members=[
                {"value": "course", "aliases": []},
                {"value": "Course", "aliases": []},
            ]),
        ):
            with self.subTest(data=data):
                with self.assertRaises(HTTPException):
                    validate_enumeration_data(data)

    def test_grading_requires_distinct_recognized_members(self):
        question = self.create()
        good = grade_enumeration_answers(question, ["political", "course"])
        duplicate = grade_enumeration_answers(question, ["politique", "political"])

        self.assertTrue(good["correct"])
        self.assertEqual([item["expected"] for item in good["matched"]], ["politique", "course"])
        self.assertFalse(duplicate["correct"])
        self.assertEqual(duplicate["unmatched"], ["political"])

    def test_cosmetic_prompt_edit_preserves_but_content_edit_replaces(self):
        question = self.create()
        self.db.add(Progress(question_id=question.id, reps=2, history=[]))
        self.db.commit()

        updated = update_question(
            self.db,
            question.id,
            QuestionUpdate(question="Trouve deux sens de run."),
        )
        self.assertEqual(updated.guid, question.guid)
        self.assertEqual(updated.progress.reps, 2)

        replacement = update_question(
            self.db,
            updated.id,
            QuestionUpdate(data=enumeration_data(required_count=3)),
        )
        self.assertNotEqual(replacement.guid, question.guid)
        self.assertEqual(
            self.db.query(Tombstone).filter(Tombstone.guid == question.guid).count(),
            1,
        )

    def test_review_history_and_training_use_the_same_contract(self):
        question = self.create()
        collection = Collection(name="Verbes", data={}, questions=[question])
        self.db.add(collection)
        self.db.commit()

        preview = answer_enumeration(
            EnumerationAnswerRequest(
                question_id=question.id,
                answers=["politique", "course"],
            ),
            self.db,
        )
        self.assertTrue(preview["correct"])

        saved = answer_enumeration(
            EnumerationAnswerRequest(
                question_id=question.id,
                answers=["politique", "course"],
                quality=2,
                commit=True,
                review_date=date(2026, 8, 10),
            ),
            self.db,
        )
        event = saved["progress"]["history"][-1]["answer_event"]
        self.assertEqual(event["type_q"], "enumeration")
        self.assertEqual(event["raw_response"], ["politique", "course"])
        self.assertEqual(event["expected_value"], "2 éléments distincts")

        review_item = serialize_review_question_item(question)
        self.assertEqual(review_item["mode"], "collect_quota")
        self.assertEqual(review_item["enumeration"]["required_count"], 2)
        training = get_training_items(
            self.db,
            scope_type="collection",
            collection_id=collection.id,
        )
        self.assertEqual(training[0]["type_q"], "enumeration")
        self.assertEqual(training[0]["mode"], "collect_quota")

