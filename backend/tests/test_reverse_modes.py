import unittest
from datetime import date
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup
from app.routers.review import answer_text
from app.schemas import TextAnswerRequest, TextGroupItemsBulkUpdate
from app.services.answer_policy import ANSWER_POLICY_EXACT
from app.services.image_modes import (
    IMAGE_AUDIO_MODES,
    IMAGE_MODE_MULTIPLE_CHOICE_MEDIA,
    canonical_image_mode,
    normalize_image_mode
)
from app.services.mode_selection import recent_mode_counts
from app.services.text_groups import reverse_mode_diagnostic
from app.services.text_groups import save_text_group_items
from app.services.training import get_training_items
from app.services.text_modes import (
    DEFAULT_TEXT_MODE,
    TEXT_MODE_TYPE_REVERSE,
    choose_text_review_mode
)


class FixedRandom:
    def __init__(self, value):
        self.value = value

    def random(self):
        return self.value


class ReverseModeTests(unittest.TestCase):
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

    def test_reverse_mode_requires_unique_normalized_cues(self):
        group = QuestionGroup(type_group="text", name="Vocabulaire", data={})
        questions = [
            Question(id=1, type_q="text", question="élève", answer="pupil"),
            Question(id=2, type_q="text", question="etudiant", answer="PUPIL")
        ]

        self.assertIn("même indice", reverse_mode_diagnostic(group, questions))

        group.data = {"answer_policy": ANSWER_POLICY_EXACT}
        self.assertIsNone(reverse_mode_diagnostic(group, questions))

    def test_disabled_reverse_mode_is_not_selected(self):
        question = SimpleNamespace(progress=None)

        for _ in range(20):
            self.assertNotEqual(
                choose_text_review_mode(
                    [question],
                    [question] * 5,
                    reverse_mode_enabled=False
                ),
                TEXT_MODE_TYPE_REVERSE
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
                reverse_mode_enabled=False,
                rng=FixedRandom(0)
            ),
            DEFAULT_TEXT_MODE
        )

    def test_reverse_text_answer_is_graded_against_the_original_prompt(self):
        group = QuestionGroup(
            type_group="text",
            name="Vocabulaire",
            data={"reverse_mode_enabled": True}
        )
        question = Question(
            id=1,
            type_q="text",
            question="pupil",
            answer="élève",
            tags=[],
            data={},
            group=group
        )
        question.progress = Progress(
            stability=1.0,
            difficulty=5.0,
            reps=1,
            lapses=0,
            interval=0,
            next_review=date.today(),
            history=[]
        )
        self.db.add_all([group, question])
        self.db.commit()

        answer_text(
            TextAnswerRequest(
                items={question.id: 3},
                mode=TEXT_MODE_TYPE_REVERSE,
                answers={question.id: "PUPIL"}
            ),
            db=self.db
        )

        entry = self.db.get(Progress, question.id).history[-1]
        self.assertEqual(entry["quality"], 3)
        self.assertEqual(entry["answer_event"]["expected_value"], "pupil")
        self.assertEqual(entry["answer_event"]["direction"], "answer_to_prompt")

    def test_reverse_text_answer_rejects_a_group_without_opt_in(self):
        group = QuestionGroup(type_group="text", name="Vocabulaire", data={})
        question = Question(
            id=1,
            type_q="text",
            question="pupil",
            answer="élève",
            tags=[],
            data={},
            group=group
        )
        self.db.add_all([group, question])
        self.db.commit()

        with self.assertRaises(HTTPException) as raised:
            answer_text(
                TextAnswerRequest(
                    items={question.id: 3},
                    mode=TEXT_MODE_TYPE_REVERSE,
                    answers={question.id: "pupil"}
                ),
                db=self.db
            )

        self.assertEqual(raised.exception.status_code, 422)

    def test_text_group_save_rejects_enabling_an_ambiguous_reverse_mode(self):
        group = QuestionGroup(type_group="text", name="Vocabulaire", data={})
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
            answer="Eleve",
            tags=[],
            data={},
            group=group
        )
        self.db.add_all([group, first, second])
        self.db.commit()

        with self.assertRaises(HTTPException) as raised:
            save_text_group_items(
                self.db,
                group.id,
                TextGroupItemsBulkUpdate(
                    group={"reverse_mode_enabled": True},
                    items=[
                        {"id": first.id, "question": "pupil", "answer": "élève"},
                        {"id": second.id, "question": "student", "answer": "Eleve"}
                    ]
                )
            )

        self.assertEqual(raised.exception.status_code, 422)
        self.db.refresh(group)
        self.assertNotIn("reverse_mode_enabled", group.data)

    def test_training_downgrades_an_invalid_reverse_mode(self):
        group = QuestionGroup(
            type_group="text",
            name="Vocabulaire",
            data={"reverse_mode_enabled": True}
        )
        self.db.add_all([
            group,
            Question(
                id=1,
                type_q="text",
                question="pupil",
                answer="élève",
                tags=[],
                data={},
                group=group
            ),
            Question(
                id=2,
                type_q="text",
                question="student",
                answer="Eleve",
                tags=[],
                data={},
                group=group
            )
        ])
        self.db.commit()

        items = get_training_items(
            self.db,
            scope_type="group",
            group_id=group.id,
            text_mode=TEXT_MODE_TYPE_REVERSE
        )

        self.assertTrue(items)
        self.assertTrue(all(item["mode"] == DEFAULT_TEXT_MODE for item in items))


if __name__ == "__main__":
    unittest.main()
