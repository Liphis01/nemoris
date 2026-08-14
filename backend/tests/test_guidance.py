import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup
from app.services.guidance import build_profile_guidance


def history_entry(reviewed_on, quality):
    return {
        "reviewed_on": reviewed_on.isoformat(),
        "quality": quality,
        "stability": 1.0,
        "difficulty": 5.0,
        "reps": 1,
        "lapses": 0,
        "interval": 1,
        "next_review": (reviewed_on + timedelta(days=1)).isoformat()
    }


class GuidanceServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_group(self, group_id, name, type_group="text"):
        group = QuestionGroup(id=group_id, type_group=type_group, name=name, data={})
        self.db.add(group)
        return group

    def add_question(
        self,
        question_id,
        *,
        type_q="text",
        group=None,
        tags=None,
        next_review=None,
        history=None,
        reps=None,
        lapses=None,
        stability=1.0
    ):
        item = Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=tags or [],
            data={},
            group=group
        )

        if next_review is not None or history is not None or reps is not None:
            item.progress = Progress(
                stability=stability,
                difficulty=5.0,
                reps=reps if reps is not None else len(history or []),
                lapses=lapses if lapses is not None else sum(
                    1 for entry in history or [] if entry.get("quality") == 0
                ),
                interval=0,
                last_review=None,
                next_review=next_review,
                history=history or []
            )

        self.db.add(item)
        return item

    def test_weakest_groups_ranks_by_fragile_ratio(self):
        today = date(2026, 1, 15)
        weak_group = self.add_group(1, "Weak group")
        strong_group = self.add_group(2, "Strong group")

        # Two fragile questions (recent miss) and one mastered.
        self.add_question(
            1,
            group=weak_group,
            next_review=today + timedelta(days=30),
            history=[history_entry(today - timedelta(days=1), 0)],
            stability=90.0
        )
        self.add_question(
            2,
            group=weak_group,
            next_review=today + timedelta(days=30),
            history=[history_entry(today - timedelta(days=2), 0)],
            stability=90.0
        )
        self.add_question(
            3,
            group=weak_group,
            next_review=today + timedelta(days=90),
            history=[history_entry(today - timedelta(days=10), 3)],
            reps=3,
            stability=90.0
        )

        for question_id in (4, 5, 6):
            self.add_question(
                question_id,
                group=strong_group,
                next_review=today + timedelta(days=90),
                history=[history_entry(today - timedelta(days=10), 3)],
                reps=3,
                stability=90.0
            )

        self.db.commit()

        guidance = build_profile_guidance(self.db, today=today)
        weakest_ids = [item["id"] for item in guidance["weakest_groups"]]

        self.assertEqual(weakest_ids, [1])
        self.assertEqual(guidance["weakest_groups"][0]["fragile_count"], 2)
        self.assertEqual(guidance["weakest_groups"][0]["total"], 3)

    def test_group_below_minimum_sample_is_excluded(self):
        today = date(2026, 1, 15)
        tiny_group = self.add_group(1, "Tiny group")

        self.add_question(
            1,
            group=tiny_group,
            next_review=today,
            history=[history_entry(today - timedelta(days=1), 0)],
            stability=1.0
        )
        self.add_question(
            2,
            group=tiny_group,
            next_review=today,
            history=[history_entry(today - timedelta(days=1), 0)],
            stability=1.0
        )
        self.db.commit()

        guidance = build_profile_guidance(self.db, today=today)

        self.assertEqual(guidance["weakest_groups"], [])

    def test_improving_groups_detects_positive_retention_delta(self):
        today = date(2026, 1, 15)
        group = self.add_group(1, "Improving group")

        for question_id in range(1, 4):
            self.add_question(
                question_id,
                group=group,
                next_review=today + timedelta(days=30),
                history=[
                    history_entry(today - timedelta(days=20), 0),
                    history_entry(today - timedelta(days=2), 3)
                ],
                reps=2,
                stability=30.0
            )

        declining_group = self.add_group(2, "Declining group")

        for question_id in range(4, 7):
            self.add_question(
                question_id,
                group=declining_group,
                next_review=today + timedelta(days=30),
                history=[
                    history_entry(today - timedelta(days=20), 3),
                    history_entry(today - timedelta(days=2), 0)
                ],
                reps=2,
                stability=30.0
            )

        self.db.commit()

        guidance = build_profile_guidance(self.db, today=today)
        improving_ids = [item["id"] for item in guidance["improving_groups"]]

        self.assertIn(1, improving_ids)
        self.assertNotIn(2, improving_ids)
        entry = guidance["improving_groups"][0]
        self.assertGreater(entry["delta"], 0)
        self.assertEqual(entry["recent_retention"], 100)
        self.assertEqual(entry["previous_retention"], 0)

    def test_close_to_mastery_excludes_fully_mastered_groups(self):
        today = date(2026, 1, 15)
        near_group = self.add_group(1, "Near mastery")

        self.add_question(
            1,
            group=near_group,
            next_review=today + timedelta(days=90),
            history=[history_entry(today - timedelta(days=30), 3)],
            reps=4,
            stability=90.0
        )
        self.add_question(
            2,
            group=near_group,
            next_review=today + timedelta(days=25),
            history=[history_entry(today - timedelta(days=25), 3)],
            reps=2,
            stability=25.0
        )
        self.add_question(
            3,
            group=near_group,
            next_review=today + timedelta(days=90),
            history=[history_entry(today - timedelta(days=1), 0)],
            stability=1.0
        )

        full_group = self.add_group(2, "Fully mastered")

        for question_id in range(4, 7):
            self.add_question(
                question_id,
                group=full_group,
                next_review=today + timedelta(days=90),
                history=[history_entry(today - timedelta(days=30), 3)],
                reps=4,
                stability=90.0
            )

        self.db.commit()

        guidance = build_profile_guidance(self.db, today=today)
        close_ids = [item["id"] for item in guidance["close_to_mastery_groups"]]

        self.assertIn(1, close_ids)
        self.assertNotIn(2, close_ids)

    def test_fragile_upcoming_load_requires_due_soon_fragile_items(self):
        today = date(2026, 1, 15)
        due_soon_group = self.add_group(1, "Due soon")

        self.add_question(
            1,
            group=due_soon_group,
            next_review=today + timedelta(days=2),
            history=[history_entry(today - timedelta(days=1), 0)],
            stability=1.0
        )
        for question_id in (2, 3):
            self.add_question(
                question_id,
                group=due_soon_group,
                next_review=today + timedelta(days=90),
                history=[history_entry(today - timedelta(days=10), 3)],
                reps=3,
                stability=90.0
            )

        far_group = self.add_group(2, "Far fragile")

        self.add_question(
            4,
            group=far_group,
            next_review=today + timedelta(days=60),
            history=[history_entry(today - timedelta(days=1), 0)],
            stability=1.0
        )
        for question_id in (5, 6):
            self.add_question(
                question_id,
                group=far_group,
                next_review=today + timedelta(days=90),
                history=[history_entry(today - timedelta(days=10), 3)],
                reps=3,
                stability=90.0
            )

        self.db.commit()

        guidance = build_profile_guidance(self.db, today=today)
        fragile_ids = [
            item["id"] for item in guidance["fragile_upcoming_load_groups"]
        ]

        self.assertEqual(fragile_ids, [1])
        self.assertEqual(
            guidance["fragile_upcoming_load_groups"][0]["upcoming_load"], 1
        )

    def test_new_material_runway_computes_daily_rate_and_days_remaining(self):
        today = date(2026, 1, 15)

        for question_id in range(1, 6):
            self.add_question(question_id, type_q="text")

        for question_id in range(6, 9):
            self.add_question(
                question_id,
                next_review=today + timedelta(days=30),
                history=[history_entry(today - timedelta(days=3), 2)],
                reps=1,
                stability=5.0
            )

        self.db.commit()

        guidance = build_profile_guidance(self.db, today=today)
        runway = guidance["new_material_runway"]

        self.assertEqual(runway["unseen_total"], 5)
        self.assertEqual(runway["recent_new_seen"], 3)
        self.assertAlmostEqual(runway["daily_rate"], 3 / 14, places=2)
        self.assertEqual(runway["days_remaining"], round(5 / (3 / 14)))

    def test_new_material_runway_has_no_days_remaining_without_recent_intake(self):
        today = date(2026, 1, 15)
        self.add_question(1, type_q="text")
        self.db.commit()

        guidance = build_profile_guidance(self.db, today=today)
        runway = guidance["new_material_runway"]

        self.assertEqual(runway["unseen_total"], 1)
        self.assertEqual(runway["recent_new_seen"], 0)
        self.assertIsNone(runway["days_remaining"])

    def test_retention_by_tag_rolls_up_to_root_tags(self):
        today = date(2026, 1, 15)

        self.add_question(
            1,
            tags=["core:geography"],
            next_review=today + timedelta(days=30),
            history=[
                history_entry(today - timedelta(days=10), 3),
                history_entry(today - timedelta(days=5), 0)
            ],
            reps=2,
            stability=10.0
        )
        self.add_question(
            2,
            tags=["core:geography"],
            next_review=today + timedelta(days=30),
            history=[history_entry(today - timedelta(days=5), 3)],
            reps=1,
            stability=10.0
        )
        self.add_question(3, type_q="text")
        self.db.commit()

        guidance = build_profile_guidance(self.db, today=today)
        by_tag = {item["tag"]: item for item in guidance["retention_by_tag"]}

        self.assertIn("core:geography", by_tag)
        geography = by_tag["core:geography"]
        self.assertEqual(geography["reviews"], 3)
        self.assertEqual(geography["retention"], 67)
        self.assertTrue(geography["label"])

    def test_guidance_does_not_mutate_progress(self):
        today = date(2026, 1, 15)
        group = self.add_group(1, "Untouched group")

        for question_id in (1, 2, 3):
            self.add_question(
                question_id,
                group=group,
                next_review=today + timedelta(days=2),
                history=[history_entry(today - timedelta(days=1), 0)],
                stability=1.0
            )

        self.db.commit()
        before = [
            (question.progress.reps, question.progress.next_review)
            for question in self.db.query(Question).order_by(Question.id)
        ]

        build_profile_guidance(self.db, today=today)

        after = [
            (question.progress.reps, question.progress.next_review)
            for question in self.db.query(Question).order_by(Question.id)
        ]
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
