import unittest

from app.models import Question, QuestionGroup
from app.services.answer_policy import (
    ANSWER_POLICY_EXACT,
    ANSWER_POLICY_GOLDEN_VECTORS,
    ANSWER_POLICY_RELAXED,
    effective_answer_policy,
    grade_answer_submission,
    matches_answer_value,
    merge_answer_policy,
    normalize_answer_policy,
    normalize_answer_text
)


class AnswerPolicyTests(unittest.TestCase):
    def test_golden_vectors(self):
        for vector in ANSWER_POLICY_GOLDEN_VECTORS:
            with self.subTest(vector=vector):
                self.assertEqual(
                    normalize_answer_text(vector["left"], vector["policy"]) ==
                    normalize_answer_text(vector["right"], vector["policy"]),
                    vector["matches"]
                )

    def test_exact_policy_keeps_case_diacritics_and_spacing(self):
        self.assertNotEqual(
            normalize_answer_text("État", ANSWER_POLICY_EXACT),
            normalize_answer_text("etat", ANSWER_POLICY_EXACT)
        )
        self.assertNotEqual(
            normalize_answer_text("Ville-Lumiere", ANSWER_POLICY_EXACT),
            normalize_answer_text("Ville Lumiere", ANSWER_POLICY_EXACT)
        )

    def test_relaxed_policy_matches_aliases(self):
        question = Question(
            id=1,
            type_q="text",
            question="Ville lumière",
            answer="Paris",
            data={"aliases": ["Ville-Lumière"]}
        )

        self.assertTrue(
            matches_answer_value(question, "ville lumiere", ANSWER_POLICY_RELAXED)
        )

    def test_question_policy_overrides_group_policy(self):
        group = QuestionGroup(
            type_group="text",
            data={"answer_policy": ANSWER_POLICY_EXACT}
        )
        question = Question(
            type_q="text",
            data={"answer_policy": ANSWER_POLICY_RELAXED},
            group=group
        )

        self.assertEqual(
            effective_answer_policy(question=question)["preset"],
            "relaxed"
        )

    def test_merge_default_policy_removes_override(self):
        self.assertEqual(
            merge_answer_policy(
                {"training_record": {"done": True}},
                ANSWER_POLICY_RELAXED,
                type_q="text"
            ),
            {"training_record": {"done": True}}
        )

    def test_submission_grades_resolved_ids(self):
        question = Question(id=5, type_q="media", answer="France")

        self.assertTrue(grade_answer_submission(question, 5)["matched"])
        self.assertFalse(grade_answer_submission(question, 6)["matched"])

    def test_numeric_string_submission_is_typed_answer_not_id(self):
        question = Question(id=675, type_q="map", answer="64")

        grade = grade_answer_submission(question, "64")

        self.assertTrue(grade["matched"])
        self.assertEqual(grade["resolved_response_id"], 675)

    def test_stringified_selection_id_still_resolves_when_not_an_answer(self):
        question = Question(id=675, type_q="map", answer="Pyrénées-Atlantiques")

        grade = grade_answer_submission(question, "675")

        self.assertTrue(grade["matched"])
        self.assertEqual(grade["resolved_response_id"], 675)

    def test_unknown_policy_normalizes_to_relaxed(self):
        self.assertEqual(
            normalize_answer_policy({"preset": "unknown"}, type_q="map"),
            ANSWER_POLICY_RELAXED
        )


if __name__ == "__main__":
    unittest.main()
