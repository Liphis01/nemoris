import unittest

from app.services.timeline import reconcile_timeline_quality


class ReconcileTimelineQualityTests(unittest.TestCase):
    def test_a_miss_can_never_be_upgraded(self):
        # Distance says wrong (auto 0): no requested quality may inflate it.
        for requested in [None, 0, 1, 2, 3]:
            with self.subTest(requested=requested):
                self.assertEqual(reconcile_timeline_quality(0, requested), 0)

    def test_absent_request_keeps_the_auto_grade(self):
        self.assertEqual(reconcile_timeline_quality(1, None), 1)
        self.assertEqual(reconcile_timeline_quality(2, None), 2)

    def test_a_hit_can_be_refined_to_hard_good_or_easy(self):
        # Auto graded the exact answer as Good (2); the learner may say Easy.
        self.assertEqual(reconcile_timeline_quality(2, 3), 3)
        # ...or that it was actually Hard.
        self.assertEqual(reconcile_timeline_quality(2, 1), 1)
        # A near-miss auto-graded Hard (1) can be talked up to Easy.
        self.assertEqual(reconcile_timeline_quality(1, 3), 3)

    def test_a_hit_can_never_be_demoted_to_a_miss(self):
        # Even if a client asks for 0 on a hit, it clamps to Hard, never Again.
        self.assertEqual(reconcile_timeline_quality(2, 0), 1)


if __name__ == "__main__":
    unittest.main()
