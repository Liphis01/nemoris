"""
M1 1.4: Easy becomes reachable, but only by the learner refining a genuine hit.

Mirrors test_timeline_quality.py -- the two types share the contract because
they share the shape: the server grades from a distance, the learner may say it
felt harder or easier than the distance suggests.
"""

import unittest

from app.services.sequence import reconcile_sequence_quality


class ReconcileSequenceQualityTests(unittest.TestCase):
    def test_a_miss_can_never_be_upgraded(self):
        for requested in [None, 0, 1, 2, 3]:
            with self.subTest(requested=requested):
                self.assertEqual(reconcile_sequence_quality(0, requested), 0)

    def test_absent_request_keeps_the_auto_grade(self):
        self.assertEqual(reconcile_sequence_quality(1, None), 1)
        self.assertEqual(reconcile_sequence_quality(2, None), 2)

    def test_a_hit_can_be_refined_to_hard_good_or_easy(self):
        self.assertEqual(reconcile_sequence_quality(2, 3), 3)
        self.assertEqual(reconcile_sequence_quality(2, 1), 1)
        self.assertEqual(reconcile_sequence_quality(1, 3), 3)

    def test_a_hit_can_never_be_demoted_to_a_miss(self):
        self.assertEqual(reconcile_sequence_quality(2, 0), 1)


if __name__ == "__main__":
    unittest.main()
