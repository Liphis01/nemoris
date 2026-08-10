import unittest
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup, Tombstone
from app.routers.review import answer_cloze
from app.schemas import ClozeAnswerRequest, ClozeGroupUpdate
from app.services.cloze import (
    bury_cloze_siblings,
    cloze_question_guid,
    get_cloze_group,
    grade_cloze_answer,
    parse_cloze_source,
    save_cloze_group,
    validate_cloze_pack_entries,
)
from app.services.training import get_training_items


def marker(key, answer):
    return f"{{{{cloze:{key}::{answer}}}}}"


class ClozeTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.group = QuestionGroup(type_group="cloze", name="Capitale", data={})
        self.db.add(self.group)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def save(self, source, policy=None):
        return save_cloze_group(
            self.db,
            self.group.id,
            ClozeGroupUpdate(
                name="Capitale",
                tags=["géographie"],
                answer_policy=policy,
                source=source,
            ),
        )

    def test_parser_rejects_empty_nested_and_inconsistent_linked_markers(self):
        key = str(uuid.uuid4())
        self.assertEqual(parse_cloze_source(marker(key, "Paris")), {key: "Paris"})

        for source in (
            marker(key, ""),
            f"{marker(key, 'avant ' + marker(str(uuid.uuid4()), 'dans'))}",
            f"{marker(key, 'Paris')} {marker(key, 'Lyon')}",
            "{{cloze:not-a-uuid::Paris}}",
        ):
            with self.subTest(source=source), self.assertRaises(HTTPException):
                parse_cloze_source(source)

    def test_cosmetic_edit_preserves_generated_card_and_progress(self):
        key = str(uuid.uuid4())
        first = self.save(f"La capitale est {marker(key, 'Paris')}.")
        card = first["cards"][0]
        self.db.add(Progress(question_id=card["id"], reps=2, history=[]))
        self.db.commit()

        second = self.save(f"En France, la capitale est {marker(key, 'Paris')} !")
        self.assertEqual(second["cards"][0]["id"], card["id"])
        self.assertEqual(second["cards"][0]["guid"], cloze_question_guid(self.group.guid, key))
        self.assertIsNotNone(second["cards"][0]["progress"])
        self.assertEqual(second["cards"][0]["progress"]["reps"], 2)

    def test_replacing_a_hole_creates_a_new_card_and_tombstones_old_one(self):
        old_key, new_key = str(uuid.uuid4()), str(uuid.uuid4())
        old_card = self.save(marker(old_key, "Paris"))["cards"][0]
        next_result = self.save(marker(new_key, "Lyon"))

        self.assertEqual(next_result["deletedQuestionIds"], [old_card["id"]])
        self.assertEqual(next_result["cards"][0]["guid"], cloze_question_guid(self.group.guid, new_key))
        self.assertEqual(
            self.db.query(Tombstone).filter(Tombstone.guid == old_card["guid"]).count(),
            1,
        )

    def test_server_grades_with_policy_and_records_answer_event(self):
        key = str(uuid.uuid4())
        card = self.save(marker(key, "État-Unis"))["cards"][0]
        request = ClozeAnswerRequest(group_id=self.group.id, question_id=card["id"], answer="etat unis")
        self.assertTrue(grade_cloze_answer(self.db, request)["correct"])

        self.save(marker(key, "État-Unis"), policy={"preset": "exact"})
        self.assertFalse(grade_cloze_answer(self.db, request)["correct"])

        saved = answer_cloze(
            ClozeAnswerRequest(
                group_id=self.group.id,
                question_id=card["id"],
                answer="État-Unis",
                quality=2,
                commit=True,
                review_date=date(2026, 8, 10),
            ),
            self.db,
        )
        event = saved["progress"]["history"][-1]["answer_event"]
        self.assertEqual(event["type_q"], "cloze")
        self.assertEqual(event["expected_value"], "État-Unis")
        self.assertEqual(event["raw_response"], "État-Unis")

    def test_buried_sibling_is_omitted_from_training_until_tomorrow(self):
        first_key, second_key = str(uuid.uuid4()), str(uuid.uuid4())
        self.save(
            f"{marker(first_key, 'Paris')} et {marker(second_key, 'Lyon')}"
        )["cards"]
        loaded = get_cloze_group(self.db, self.group.id)["cards"]
        first, second = loaded
        first_question = self.db.get(Question, first["id"])
        bury_cloze_siblings(self.db, first_question, today=date.today())
        self.db.commit()

        training = get_training_items(self.db, scope_type="group", group_id=self.group.id)
        self.assertEqual(len(training), 1)
        self.assertEqual(training[0]["items"][0]["question_id"], first["id"])
        self.assertNotEqual(training[0]["items"][0]["question_id"], second["id"])

    def test_pack_entries_must_match_source(self):
        key = str(uuid.uuid4())
        group_entry = {
            "guid": self.group.guid,
            "type_group": "cloze",
            "data": {"cloze": {"source": marker(key, "Paris")}},
        }
        card = {
            "guid": cloze_question_guid(self.group.guid, key),
            "group_guid": self.group.guid,
            "type_q": "cloze",
            "answer": "Paris",
            "data": {"cloze": {"key": key}},
        }
        validate_cloze_pack_entries([group_entry], [card])
        card["answer"] = "Lyon"
        with self.assertRaises(ValueError):
            validate_cloze_pack_entries([group_entry], [card])
