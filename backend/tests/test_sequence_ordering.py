"""
M1 1.1: a produced ordering is graded on relative order, not index distance.

The whole point of the change is that one knowledge gap must cost one card,
not every card after it.
"""

import unittest

from app.services.sequence import grade_sequence_ordering


ALPHA, BETA, GAMMA, DELTA, EPSILON = 1, 2, 3, 4, 5
TRUE = [ALPHA, BETA, GAMMA, DELTA, EPSILON]


def qualities(true_order, produced_order, graded_ids=None):
    grades = grade_sequence_ordering(
        true_order,
        produced_order,
        graded_ids if graded_ids is not None else true_order
    )

    return {question_id: grade["quality"] for question_id, grade in grades.items()}


class OrderingGradeTests(unittest.TestCase):
    def test_the_exact_order_is_all_good(self):
        self.assertEqual(
            qualities(TRUE, TRUE),
            {ALPHA: 2, BETA: 2, GAMMA: 2, DELTA: 2, EPSILON: 2}
        )

    def test_a_single_transposition_costs_only_the_swapped_pair(self):
        # A B C D E -> A B D C E. This is the case the old absolute grader got
        # worst and the reason for the whole change: under adjacency grading the
        # swapped pair fails outright AND their outer neighbours drop to Hard.
        self.assertEqual(
            qualities(TRUE, [ALPHA, BETA, DELTA, GAMMA, EPSILON]),
            {ALPHA: 2, BETA: 2, GAMMA: 1, DELTA: 1, EPSILON: 2}
        )

    def test_a_uniform_shift_grades_clean(self):
        # One item forgotten early shifts every later item by one. Relative
        # order is untouched, so nothing after the gap is punished for it --
        # under the old distance grader this was a dozen real FSRS lapses.
        produced = [BETA, GAMMA, DELTA, EPSILON]

        self.assertEqual(
            qualities(TRUE, produced, graded_ids=produced),
            {BETA: 2, GAMMA: 2, DELTA: 2, EPSILON: 2}
        )

    def test_a_full_reversal_fails_everything(self):
        self.assertEqual(
            qualities(TRUE, list(reversed(TRUE))),
            {ALPHA: 0, BETA: 0, GAMMA: 0, DELTA: 0, EPSILON: 0}
        )

    def test_an_item_moved_far_fails_and_spares_the_rest(self):
        # EPSILON dragged to the front: it has both relations wrong, everyone
        # else keeps theirs among themselves.
        self.assertEqual(
            qualities(TRUE, [EPSILON, ALPHA, BETA, GAMMA, DELTA]),
            {ALPHA: 2, BETA: 2, GAMMA: 2, DELTA: 1, EPSILON: 0}
        )


class OrderingEdgeCaseTests(unittest.TestCase):
    def test_an_unplaced_item_is_a_miss(self):
        # Inherited from test_an_unresolved_answer_is_a_miss: no answer is
        # always a miss. It must not pass vacuously for having no neighbours.
        grades = grade_sequence_ordering(TRUE, [ALPHA, BETA], TRUE)

        self.assertEqual(grades[GAMMA]["quality"], 0)
        self.assertIsNone(grades[GAMMA]["distance"])

    def test_a_run_edge_carries_no_free_credit(self):
        # A windowed rail shows runs, so the first slot of a run is NOT the
        # first slot of the list. An item with one visible neighbour is graded
        # on that neighbour alone -- getting it wrong is a miss, not a Hard
        # earned by a boundary that was never a constraint.
        run = [GAMMA, DELTA]

        self.assertEqual(qualities(run, [GAMMA, DELTA]), {GAMMA: 2, DELTA: 2})
        self.assertEqual(qualities(run, [DELTA, GAMMA]), {GAMMA: 0, DELTA: 0})

    def test_a_lone_visible_item_falls_back_to_its_placement(self):
        self.assertEqual(qualities([GAMMA], [GAMMA]), {GAMMA: 2})
        self.assertEqual(qualities([GAMMA], []), {GAMMA: 0})

    def test_anchors_constrain_the_item_placed_between_them(self):
        # BETA and DELTA are anchors in place; only GAMMA is graded. Dropped at
        # the end it is still after BETA (kept) but no longer before DELTA
        # (broken) -- half right, so Hard.
        self.assertEqual(
            qualities(TRUE, [ALPHA, BETA, DELTA, EPSILON, GAMMA], [GAMMA]),
            {GAMMA: 1}
        )

        # Dropped at the front it is still before DELTA, so it is Hard again.
        # In fact an item bracketed by two anchors that are BOTH in place can
        # never be worse than Hard: failing both relations would require its
        # true predecessor to end up after its true successor, which fixed
        # anchors cannot do. Anchors bound the damage, which is the point of
        # showing them.
        self.assertEqual(
            qualities(TRUE, [GAMMA, ALPHA, BETA, DELTA, EPSILON], [GAMMA]),
            {GAMMA: 1}
        )

    def test_a_miss_needs_both_neighbours_to_have_moved_too(self):
        # BETA and DELTA are due as well and land the wrong way round, so
        # GAMMA between them has both relations broken.
        self.assertEqual(
            qualities(TRUE, [ALPHA, DELTA, GAMMA, BETA, EPSILON], [GAMMA]),
            {GAMMA: 0}
        )

    def test_an_item_absent_from_the_rail_is_a_miss(self):
        self.assertEqual(qualities(TRUE, TRUE, [99]), {99: 0})


if __name__ == "__main__":
    unittest.main()
