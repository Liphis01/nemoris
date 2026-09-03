import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Question, QuestionGroup
from app.schemas import TextGroupItemsBulkUpdate
from app.services.image_modes import (
    IMAGE_AUDIO_MODES,
    IMAGE_MODE_MULTIPLE_CHOICE_MEDIA,
    canonical_image_mode,
    normalize_image_mode
)
from app.services.mode_selection import recent_mode_counts
from app.services.text_groups import save_text_group_items
from app.services.text_modes import (
    DEFAULT_TEXT_MODE,
    TEXT_MODE_MATCH,
    TEXT_MODES,
    choose_text_review_mode,
    normalize_text_mode
)


class FixedRandom:
    def __init__(self, value):
        self.value = value

    def random(self):
        return self.value


class ModeCompatibilityTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self):
        self.db.close()

    def test_legacy_media_mode_is_canonicalized_and_counts_for_variety(self):
        self.assertEqual(
            normalize_image_mode("multiple_choice_image"),
            IMAGE_MODE_MULTIPLE_CHOICE_MEDIA
        )
        self.assertIn(IMAGE_MODE_MULTIPLE_CHOICE_MEDIA, IMAGE_AUDIO_MODES)
        counts = recent_mode_counts(
            [SimpleNamespace(progress=SimpleNamespace(history=[{
                "image_mode": "multiple_choice_image"
            }]))],
            "image_mode",
            {IMAGE_MODE_MULTIPLE_CHOICE_MEDIA},
            mode_normalizer=canonical_image_mode
        )
        self.assertEqual(counts, {IMAGE_MODE_MULTIPLE_CHOICE_MEDIA: 1})

    def test_removed_text_reverse_mode_normalizes_to_default(self):
        self.assertNotIn("type_reverse", TEXT_MODES)
        self.assertEqual(
            normalize_text_mode("type_reverse"),
            DEFAULT_TEXT_MODE
        )

    def test_supported_only_text_successes_are_probed_with_recall(self):
        question = SimpleNamespace(progress=SimpleNamespace(
            reps=4,
            difficulty=3.0,
            lapses=0,
            last_review=None,
            history=[{"text_mode": "match", "quality": 2}]
        ))

        self.assertEqual(
            choose_text_review_mode(
                [question],
                [question] * 5,
                rng=FixedRandom(0)
            ),
            DEFAULT_TEXT_MODE
        )

    def test_text_recall_proof_removes_match_even_for_fragile_cards(self):
        question = SimpleNamespace(progress=SimpleNamespace(
            reps=1,
            difficulty=8.0,
            lapses=0,
            last_review=None,
            history=[{"text_mode": "type_all", "quality": 2}]
        ))

        modes = {
            choose_text_review_mode(
                [question],
                [question] * 5,
                rng=FixedRandom(value)
            )
            for value in (0, 0.25, 0.5, 0.75, 0.999)
        }

        self.assertEqual(modes, {DEFAULT_TEXT_MODE})

    def test_brand_new_text_uses_match_when_available(self):
        due = [SimpleNamespace(progress=None) for _ in range(5)]

        modes = {
            choose_text_review_mode(due, due, rng=FixedRandom(value))
            for value in (0, 0.25, 0.5, 0.75, 0.999)
        }

        self.assertEqual(modes, {TEXT_MODE_MATCH})

    def test_text_group_save_strips_legacy_reverse_flag(self):
        group = QuestionGroup(
            type_group="text",
            name="Vocabulaire",
            data={"reverse_mode_enabled": True}
        )
        first = Question(
            id=1,
            type_q="text",
            question="pupil",
            answer="élève",
            tags=[],
            data={},
            group=group
        )
        second = Question(
            id=2,
            type_q="text",
            question="student",
            answer="étudiant",
            tags=[],
            data={},
            group=group
        )
        self.db.add_all([group, first, second])
        self.db.commit()

        result = save_text_group_items(
            self.db,
            group.id,
            TextGroupItemsBulkUpdate(
                group={"name": "Vocabulaire"},
                items=[
                    {"id": first.id, "question": "pupil", "answer": "élève"},
                    {"id": second.id, "question": "student", "answer": "étudiant"}
                ]
            )
        )

        self.db.refresh(group)
        self.assertNotIn("reverse_mode_enabled", group.data)
        self.assertNotIn("reverse_mode_enabled", result["group"]["data"])


if __name__ == "__main__":
    unittest.main()
