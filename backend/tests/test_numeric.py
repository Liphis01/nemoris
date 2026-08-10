import unittest
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Collection, Progress, Question, Tombstone
from app.routers.review import answer_numeric
from app.schemas import NumericAnswerRequest, QuestionCreate, QuestionUpdate
from app.services.numeric import (
    NumericParseError,
    grade_numeric_answer,
    parse_numeric_input,
    validate_numeric_data,
)
from app.services.questions import create_question, update_question
from app.serializers import serialize_review_question_item
from app.services.training import get_training_items


def numeric_data(value="100", unit="km", **overrides):
    data = {
        "value": value,
        "unit": unit,
        "display_precision": 0,
        "relative_tolerance": "0.10",
        "zero_absolute_tolerance": None,
    }
    data.update(overrides)
    return {"numeric": data}


class NumericTests(unittest.TestCase):
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
                type_q="numeric",
                question="Quelle distance ?",
                answer="ignored",
                data=data or numeric_data(),
            ),
        )
        self.db.commit()
        return question

    def test_parser_accepts_signed_french_space_and_scientific_notation(self):
        cases = {
            "+12": Decimal("12"),
            "-1,25": Decimal("-1.25"),
            "1 234,50": Decimal("1234.50"),
            "1.2e6": Decimal("1.2e6"),
            "-2,5E-3": Decimal("-2.5e-3"),
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(parse_numeric_input(raw), expected)

    def test_parser_refuses_units_non_finite_and_ambiguous_formats(self):
        for raw in ("12 km", "NaN", "Infinity", "1,2,3", "1.2.3", ""):
            with self.subTest(raw=raw):
                with self.assertRaises(NumericParseError):
                    parse_numeric_input(raw)

    def test_validation_requires_unit_and_absolute_tolerance_for_zero(self):
        normalized = validate_numeric_data(numeric_data("12,50", "m", display_precision=2))
        self.assertEqual(normalized["value"], "12.5")
        self.assertEqual(normalized["relative_tolerance"], "0.1")

        for invalid in (
            numeric_data("1", ""),
            numeric_data("0", zero_absolute_tolerance=None),
            numeric_data("0", zero_absolute_tolerance="0"),
        ):
            with self.subTest(data=invalid):
                with self.assertRaises(HTTPException):
                    validate_numeric_data(invalid)

    def test_create_and_cosmetic_update_preserve_identity_and_progress(self):
        question = self.create(numeric_data("12.5", "m", display_precision=1))
        self.assertEqual(question.answer, "12,5 m")
        self.db.add(Progress(question_id=question.id, reps=2, history=[]))
        self.db.commit()

        updated = update_question(
            self.db,
            question.id,
            QuestionUpdate(question="Nouvel énoncé", data=numeric_data(
                "12.5", "cm", display_precision=2, relative_tolerance="0.2"
            )),
        )
        self.assertEqual(updated.id, question.id)
        self.assertEqual(updated.guid, question.guid)
        self.assertEqual(updated.progress.reps, 2)
        self.assertEqual(updated.answer, "12,50 cm")

    def test_expected_value_replacement_tombstones_old_card(self):
        question = self.create()
        old_guid = question.guid
        replacement = update_question(
            self.db,
            question.id,
            QuestionUpdate(data=numeric_data("101", "km")),
        )
        self.assertNotEqual(replacement.id, question.id)
        self.assertNotEqual(replacement.guid, old_guid)
        self.assertEqual(
            self.db.query(Tombstone).filter(Tombstone.guid == old_guid).count(),
            1,
        )

    def test_server_grading_includes_tolerance_boundaries_and_history(self):
        question = self.create(numeric_data("-20", "°C"))
        self.assertTrue(grade_numeric_answer(
            self.db,
            NumericAnswerRequest(question_id=question.id, answer="-22"),
        )["correct"])
        self.assertFalse(grade_numeric_answer(
            self.db,
            NumericAnswerRequest(question_id=question.id, answer="-22,1"),
        )["correct"])

        saved = answer_numeric(
            NumericAnswerRequest(
                question_id=question.id,
                answer="-22",
                quality=2,
                commit=True,
                review_date=date(2026, 8, 10),
            ),
            self.db,
        )
        event = saved["progress"]["history"][-1]["answer_event"]
        self.assertEqual(event["type_q"], "numeric")
        self.assertEqual(event["raw_response"], "-22")
        self.assertEqual(event["expected_value"], "-20 °C")
        self.assertEqual(event["context"]["absolute_error"], "2")

    def test_zero_uses_explicit_absolute_tolerance(self):
        question = self.create(numeric_data(
            "0", "V", zero_absolute_tolerance="0.1", relative_tolerance=None
        ))
        at_boundary = grade_numeric_answer(
            self.db,
            NumericAnswerRequest(question_id=question.id, answer="-0,1"),
        )
        outside = grade_numeric_answer(
            self.db,
            NumericAnswerRequest(question_id=question.id, answer="0.1001"),
        )
        self.assertTrue(at_boundary["correct"])
        self.assertFalse(outside["correct"])

    def test_review_and_training_serialize_the_numeric_contract(self):
        question = self.create(numeric_data("12.5", "m", display_precision=1))
        collection = Collection(name="Mesures", data={}, questions=[question])
        self.db.add(collection)
        self.db.commit()

        review_item = serialize_review_question_item(question)
        self.assertEqual(review_item["presentation_kind"], "single_card")
        self.assertEqual(review_item["mode"], "numeric_input")
        self.assertEqual(review_item["numeric"]["unit"], "m")

        training = get_training_items(
            self.db,
            scope_type="collection",
            collection_id=collection.id,
        )
        self.assertEqual(training[0]["type_q"], "numeric")
        self.assertEqual(training[0]["mode"], "numeric_input")
