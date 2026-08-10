import unittest
from typing import get_args

from app import schemas
from app.services.image_modes import (
    IMAGE_MODES,
    LEGACY_IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
)
from app.services.map_modes import MAP_MODES
from app.services.sequence_modes import SEQUENCE_MODES
from app.services.text_modes import TEXT_MODES
from app.services.cloze_modes import CLOZE_MODES
from app.services.numeric_modes import NUMERIC_MODES
from app.services.grid_modes import GRID_MODES
from app.services.set_modes import SET_MODES
from app.services.enumeration_modes import ENUMERATION_MODES
from app.services.type_contracts import (
    GROUP_TYPE_CONTRACTS,
    PRESENTATION_KINDS,
    QUESTION_TYPE_CONTRACTS
)


class TypeContractTests(unittest.TestCase):
    def test_every_question_type_has_a_contract(self):
        self.assertEqual(
            set(QUESTION_TYPE_CONTRACTS),
            set(get_args(schemas.QuestionType))
        )

    def test_every_group_type_has_a_contract(self):
        self.assertEqual(
            set(GROUP_TYPE_CONTRACTS),
            set(get_args(schemas.GroupType))
        )

    def test_question_contracts_declare_required_consumers(self):
        required_fields = {
            "grouping",
            "persisted_validator",
            "runtime_presentations",
            "modes",
            "answer_grader",
            "default_answer_policy",
            "matching_authority",
            "training_support",
            "retry_shape",
            "manage_editor",
            "calendar_filter_label",
            "pack_sync_handling",
            "mobile_support"
        }

        for type_q, contract in QUESTION_TYPE_CONTRACTS.items():
            with self.subTest(type_q=type_q):
                self.assertEqual(contract.type_q, type_q)
                for field in required_fields:
                    self.assertTrue(getattr(contract, field))
                self.assertIn(contract.grouping, {"required", "optional", "forbidden"})
                self.assertTrue(set(contract.runtime_presentations) <= set(PRESENTATION_KINDS))

    def test_group_contracts_declare_required_consumers(self):
        required_fields = {
            "question_type",
            "runtime_presentation",
            "modes",
            "default_answer_policy",
            "matching_authority",
            "training_support",
            "retry_shape",
            "manage_editor",
            "calendar_filter_label",
            "pack_sync_handling"
        }

        for type_group, contract in GROUP_TYPE_CONTRACTS.items():
            with self.subTest(type_group=type_group):
                self.assertEqual(contract.type_group, type_group)
                for field in required_fields:
                    self.assertTrue(getattr(contract, field))
                self.assertIn(contract.question_type, QUESTION_TYPE_CONTRACTS)
                self.assertIn(contract.runtime_presentation, PRESENTATION_KINDS)

    def test_mode_literals_are_reflected_in_contracts(self):
        self.assertEqual(QUESTION_TYPE_CONTRACTS["map"].modes, MAP_MODES)
        self.assertEqual(QUESTION_TYPE_CONTRACTS["media"].modes, IMAGE_MODES)
        self.assertEqual(QUESTION_TYPE_CONTRACTS["text"].modes, TEXT_MODES)
        self.assertEqual(QUESTION_TYPE_CONTRACTS["numeric"].modes, NUMERIC_MODES)
        self.assertEqual(QUESTION_TYPE_CONTRACTS["cloze"].modes, CLOZE_MODES)
        self.assertEqual(QUESTION_TYPE_CONTRACTS["grid"].modes, GRID_MODES)
        self.assertEqual(QUESTION_TYPE_CONTRACTS["set"].modes, SET_MODES)
        self.assertEqual(QUESTION_TYPE_CONTRACTS["enumeration"].modes, ENUMERATION_MODES)
        self.assertEqual(QUESTION_TYPE_CONTRACTS["sequence"].modes, SEQUENCE_MODES)
        self.assertEqual(GROUP_TYPE_CONTRACTS["map"].modes, MAP_MODES)
        self.assertEqual(GROUP_TYPE_CONTRACTS["media"].modes, IMAGE_MODES)
        self.assertEqual(GROUP_TYPE_CONTRACTS["text"].modes, TEXT_MODES)
        self.assertEqual(GROUP_TYPE_CONTRACTS["cloze"].modes, CLOZE_MODES)
        self.assertEqual(GROUP_TYPE_CONTRACTS["grid"].modes, GRID_MODES)
        self.assertEqual(GROUP_TYPE_CONTRACTS["set"].modes, SET_MODES)
        self.assertEqual(GROUP_TYPE_CONTRACTS["sequence"].modes, SEQUENCE_MODES)

    def test_schema_mode_literals_match_mode_modules(self):
        self.assertEqual(set(get_args(schemas.MapMode)), set(MAP_MODES))
        self.assertEqual(
            set(get_args(schemas.ImageMode)),
            set(IMAGE_MODES) | {LEGACY_IMAGE_MODE_MULTIPLE_CHOICE_IMAGE}
        )
        self.assertEqual(set(get_args(schemas.TextMode)), set(TEXT_MODES))
        self.assertEqual(set(get_args(schemas.NumericMode)), set(NUMERIC_MODES))
        self.assertEqual(set(get_args(schemas.ClozeMode)), set(CLOZE_MODES))
        self.assertEqual(set(get_args(schemas.GridMode)), set(GRID_MODES))
        self.assertEqual(set(get_args(schemas.SetMode)), set(SET_MODES))
        self.assertEqual(set(get_args(schemas.EnumerationMode)), set(ENUMERATION_MODES))
        self.assertEqual(set(get_args(schemas.SequenceMode)), set(SEQUENCE_MODES))


if __name__ == "__main__":
    unittest.main()
