import unittest
from types import SimpleNamespace

from app.services.mode_selection import (
    apply_recent_mode_penalty,
    recent_mode_counts
)


def _question(history):
    return SimpleNamespace(progress=SimpleNamespace(history=history))


class RecentModeCountsTests(unittest.TestCase):
    def test_counts_are_capped_at_limit_entries_per_question(self):
        history = [{"map_mode": "type_prompt"} for _ in range(10)]

        counts = recent_mode_counts(
            [_question(history)],
            "map_mode",
            {"type_prompt"},
            limit=6
        )

        self.assertEqual(counts, {"type_prompt": 6})

    def test_modes_outside_the_valid_set_are_ignored(self):
        history = [{"map_mode": "not_a_real_mode"}]

        counts = recent_mode_counts(
            [_question(history)],
            "map_mode",
            {"type_prompt"}
        )

        self.assertEqual(counts, {})

    def test_questions_without_progress_contribute_nothing(self):
        counts = recent_mode_counts(
            [SimpleNamespace(progress=None)],
            "map_mode",
            {"type_prompt"}
        )

        self.assertEqual(counts, {})


class ApplyRecentModePenaltyTests(unittest.TestCase):
    def test_penalty_stays_commensurate_with_base_scores_on_a_large_due_set(self):
        # Roadmap scenario: every one of 30 due questions was recently drilled
        # with the same mode 6 times in a row -- the steady-state case that
        # reached a ~-60 penalty (against 0.9-4.0 base scores) before the fix.
        history = [{"sequence_mode": "type_position"} for _ in range(6)]
        questions = [_question(history) for _ in range(30)]
        scores = {
            "type_position": 3.5,
            "next_in_sequence": 3.0,
            "reorder": 1.8,
            "multiple_choice": 0.9
        }
        valid_modes = set(scores)

        apply_recent_mode_penalty(scores, questions, "sequence_mode", valid_modes)

        self.assertAlmostEqual(scores["type_position"], 3.5 - 0.55 * 6, places=6)
        self.assertGreater(scores["type_position"], -10)

    def test_penalty_magnitude_is_independent_of_due_set_size(self):
        history = [{"sequence_mode": "type_position"} for _ in range(6)]
        small_due_set = [_question(history) for _ in range(5)]
        large_due_set = [_question(history) for _ in range(30)]
        valid_modes = {"type_position"}

        small_scores = apply_recent_mode_penalty(
            {"type_position": 3.5}, small_due_set, "sequence_mode", valid_modes
        )
        large_scores = apply_recent_mode_penalty(
            {"type_position": 3.5}, large_due_set, "sequence_mode", valid_modes
        )

        self.assertAlmostEqual(
            small_scores["type_position"],
            large_scores["type_position"],
            places=6
        )

    def test_no_due_questions_leaves_scores_untouched(self):
        scores = {"type_position": 3.5}

        result = apply_recent_mode_penalty(
            scores, [], "sequence_mode", {"type_position"}
        )

        self.assertEqual(result, {"type_position": 3.5})


if __name__ == "__main__":
    unittest.main()
