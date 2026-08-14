import unittest
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup, Tombstone
from app.routers.review import answer_set
from app.schemas import SetAnswerRequest, SetGroupUpdate
from app.services.review import serialize_review_items
from app.services.training import get_training_items
from app.services.set_groups import (
    grade_set_answers,
    save_set_group,
    set_question_guid,
    validate_set_pack_entries,
)


def members(first="Hélium", second="Néon"):
    return [
        {"key": str(uuid.uuid4()), "value": first, "aliases": ["He"]},
        {"key": str(uuid.uuid4()), "value": second, "aliases": ["Ne"]},
    ]


class MembershipSetTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.group = QuestionGroup(type_group="set", name="Gaz nobles", data={})
        self.db.add(self.group)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def save(self, source, edit_policy=None):
        return save_set_group(
            self.db,
            self.group.id,
            SetGroupUpdate(name="Gaz nobles", tags=[], members=source, edit_policy=edit_policy),
        )

    def test_creates_stable_member_cards_and_preserves_alias_edit_progress(self):
        source = members()
        first = self.save(source)["cards"][0]
        self.db.add(Progress(question_id=first["id"], reps=2, history=[]))
        self.db.commit()
        source[0]["aliases"] = ["He", "gaz hélium"]
        saved = self.save(source, edit_policy="preserve_progress")
        card = next(item for item in saved["cards"] if item["id"] == first["id"])
        self.assertEqual(card["guid"], set_question_guid(self.group.guid, source[0]["key"]))
        self.assertEqual(card["progress"]["reps"], 2)

    def test_alias_edit_replaces_by_default(self):
        source = members()
        old = self.save(source)["cards"][0]
        source[0]["aliases"] = ["He", "gaz hélium"]
        saved = self.save(source)
        self.assertIn(old["id"], saved["deletedQuestionIds"])
        self.assertEqual(self.db.query(Tombstone).filter(Tombstone.guid == old["guid"]).count(), 1)

    def test_changed_member_value_retires_the_old_card(self):
        source = members()
        old = self.save(source)["cards"][0]
        source[0]["value"] = "Argon"
        saved = self.save(source)
        self.assertIn(old["id"], saved["deletedQuestionIds"])
        self.assertEqual(self.db.query(Tombstone).filter(Tombstone.guid == old["guid"]).count(), 1)

    def test_refuses_ambiguous_aliases(self):
        source = members()
        source[1]["aliases"] = ["helium"]
        with self.assertRaises(HTTPException):
            self.save(source)

    def test_server_grades_unordered_answers_and_schedules_only_targets(self):
        saved = self.save(members())
        cards = [self.db.get(Question, card["id"]) for card in saved["cards"]]
        request = SetAnswerRequest(group_id=self.group.id, question_ids=[card.id for card in cards], answers=["Ne", "inconnu"])
        preview = grade_set_answers(self.db, request)
        self.assertEqual([item["correct"] for item in preview["items"]], [False, True])
        self.assertEqual(preview["unmatched"], ["inconnu"])

        committed = answer_set(SetAnswerRequest(group_id=self.group.id, question_ids=[card.id for card in cards], answers=["Ne"], quality=2, commit=True, review_date=date(2026, 8, 10)), self.db)
        self.assertEqual(committed["items"][0]["progress"]["history"][-1]["quality"], 0)
        self.assertEqual(committed["items"][1]["progress"]["history"][-1]["answer_event"]["type_q"], "set")

    def test_review_serializes_one_unordered_presentation(self):
        saved = self.save(members())
        questions = [self.db.get(Question, card["id"]) for card in saved["cards"]]
        payload = serialize_review_items(questions)
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["presentation_kind"], "set_group")
        self.assertNotIn("members", payload[0])

        training = get_training_items(self.db, scope_type="group", group_id=self.group.id)
        self.assertEqual(training[0]["presentation_kind"], "set_group")
        self.assertEqual(training[0]["mode"], "collect_members")

    def test_pack_cards_must_exactly_match_the_source(self):
        source = members()
        saved = self.save(source)
        group = {"guid": self.group.guid, "type_group": "set", "data": {"set": {"members": source}}}
        cards = [{"guid": card["guid"], "group_guid": self.group.guid, "type_q": "set", "answer": card["answer"], "data": card["data"]} for card in saved["cards"]]
        validate_set_pack_entries([group], cards)
        cards[0]["data"]["aliases"] = []
        with self.assertRaises(ValueError):
            validate_set_pack_entries([group], cards)
