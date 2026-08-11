import unittest
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup, Tombstone
from app.routers.review import answer_grid
from app.schemas import GridAnswerRequest, GridGroupUpdate
from app.services.grid import (
    get_grid_group,
    grade_grid_answers,
    grid_question_guid,
    save_grid_group,
    validate_grid_pack_entries,
)
from app.services.review import serialize_review_items


def source(value_one="parle", value_two="parlons"):
    row_one, row_two, column = (str(uuid.uuid4()) for _ in range(3))
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    return {
        "rows": [{"key": row_one, "label": "je"}, {"key": row_two, "label": "nous"}],
        "columns": [{"key": column, "label": "présent"}],
        "cells": [
            {"key": first, "row_key": row_one, "column_key": column, "value": value_one},
            {"key": second, "row_key": row_two, "column_key": column, "value": value_two},
        ],
    }


def row_source(value_one="parle", value_two="parles"):
    row, first_column, second_column = (str(uuid.uuid4()) for _ in range(3))
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    return {
        "rows": [{"key": row, "label": "je"}],
        "columns": [
            {"key": first_column, "label": "présent"},
            {"key": second_column, "label": "imparfait"},
        ],
        "cells": [
            {"key": first, "row_key": row, "column_key": first_column, "value": value_one},
            {"key": second, "row_key": row, "column_key": second_column, "value": value_two},
        ],
    }


class GridTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.group = QuestionGroup(type_group="grid", name="Parler", data={})
        self.db.add(self.group)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def save(self, grid, name="Parler"):
        return save_grid_group(self.db, self.group.id, GridGroupUpdate(name=name, tags=[], grid=grid))

    def test_source_creates_deterministic_atomic_cards(self):
        grid = source()
        saved = self.save(grid)
        self.assertEqual(len(saved["cards"]), 2)
        self.assertEqual(saved["cards"][0]["guid"], grid_question_guid(self.group.guid, grid["cells"][0]["key"]))
        self.assertEqual(get_grid_group(self.db, self.group.id)["group"]["grid"]["format"], 1)

    def test_axis_relabel_preserves_card_and_progress(self):
        grid = source()
        first = self.save(grid)["cards"][0]
        self.db.add(Progress(question_id=first["id"], reps=2, history=[]))
        self.db.commit()
        grid["rows"][0]["label"] = "moi"
        saved = self.save(grid, name="Parler au présent")
        card = next(item for item in saved["cards"] if item["id"] == first["id"])
        self.assertEqual(card["progress"]["reps"], 2)
        self.assertEqual(card["guid"], first["guid"])

    def test_correcting_a_cell_value_preserves_card_and_progress(self):
        grid = source()
        first = self.save(grid)["cards"][0]
        self.db.add(Progress(question_id=first["id"], reps=3, history=[]))
        self.db.commit()
        grid["cells"][0]["value"] = "parlais"
        saved = self.save(grid)
        card = next(item for item in saved["cards"] if item["id"] == first["id"])
        self.assertEqual(saved["deletedQuestionIds"], [])
        self.assertEqual(card["answer"], "parlais")
        self.assertEqual(card["guid"], first["guid"])
        self.assertEqual(card["progress"]["reps"], 3)
        self.assertEqual(self.db.query(Tombstone).filter(Tombstone.guid == first["guid"]).count(), 0)

    def test_moving_a_cell_to_another_coordinate_tombstones_its_old_card(self):
        grid = source()
        old = self.save(grid)["cards"][0]
        grid["cells"][0]["row_key"] = grid["rows"][1]["key"]
        grid["cells"][1]["row_key"] = grid["rows"][0]["key"]
        saved = self.save(grid)
        self.assertIn(old["id"], saved["deletedQuestionIds"])
        self.assertEqual(self.db.query(Tombstone).filter(Tombstone.guid == old["guid"]).count(), 1)

    def test_validation_refuses_duplicate_coordinates(self):
        grid = source()
        grid["cells"][1]["row_key"] = grid["cells"][0]["row_key"]
        with self.assertRaises(HTTPException):
            self.save(grid)

    def test_row_presentation_and_server_grading(self):
        saved = self.save(source())
        questions = [self.db.get(Question, card["id"]) for card in saved["cards"]]
        presentation = serialize_review_items(questions)
        self.assertEqual(presentation[0]["presentation_kind"], "grid_cell")

        result = grade_grid_answers(self.db, GridAnswerRequest(group_id=self.group.id, mode="fill_cell", items={questions[0].id: {"answer": "parle"}}))
        self.assertTrue(result["items"][0]["correct"])
        committed = answer_grid(GridAnswerRequest(group_id=self.group.id, mode="fill_cell", items={questions[0].id: {"answer": "parle"}}, quality=2, commit=True, review_date=date(2026, 8, 10)), self.db)
        self.assertEqual(committed["items"][0]["progress"]["history"][-1]["answer_event"]["type_q"], "grid")

    def test_two_due_cells_on_one_row_use_one_row_presentation(self):
        saved = self.save(row_source())
        questions = [self.db.get(Question, card["id"]) for card in saved["cards"]]

        presentation = serialize_review_items(questions)

        self.assertEqual(len(presentation), 1)
        self.assertEqual(presentation[0]["presentation_kind"], "grid_row")
        self.assertEqual(presentation[0]["mode"], "fill_row")
        self.assertEqual({item["question_id"] for item in presentation[0]["items"]}, {item.id for item in questions})

    def test_pack_entries_must_match_the_grid_source(self):
        grid = source()
        saved = self.save(grid)
        group = {"guid": self.group.guid, "type_group": "grid", "data": {"grid": get_grid_group(self.db, self.group.id)["group"]["grid"]}}
        cards = [{"guid": card["guid"], "group_guid": self.group.guid, "type_q": "grid", "answer": card["answer"], "data": card["data"]} for card in saved["cards"]]
        validate_grid_pack_entries([group], cards)
        cards[0]["answer"] = "incorrect"
        with self.assertRaises(ValueError):
            validate_grid_pack_entries([group], cards)
