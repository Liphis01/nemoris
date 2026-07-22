import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup
from app.services.stats import build_stats


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


class StatsServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_question(
        self,
        question_id,
        type_q="text",
        question=None,
        answer=None,
        data=None,
        group=None,
        next_review=None,
        history=None,
        reps=None,
        lapses=None,
        difficulty=5.0,
        interval=0
    ):
        item = Question(
            id=question_id,
            type_q=type_q,
            question=question or f"Question {question_id}",
            answer=answer or f"Answer {question_id}",
            tags=[],
            data=data or {},
            group=group
        )

        if next_review is not None or history is not None or reps is not None:
            item.progress = Progress(
                stability=1.0,
                difficulty=difficulty,
                reps=reps if reps is not None else len(history or []),
                lapses=lapses if lapses is not None else sum(
                    1 for entry in history or [] if entry.get("quality") == 0
                ),
                interval=interval,
                last_review=None,
                next_review=next_review,
                history=history or []
            )

        self.db.add(item)
        return item

    def test_stats_counts_load_retention_and_rankings(self):
        today = date(2026, 1, 15)
        old_day = today - timedelta(days=100)
        map_group = QuestionGroup(
            id=10,
            type_group="map",
            name="Europe",
            media="world.svg",
            data={}
        )
        self.db.add(map_group)

        self.add_question(1, question="No progress")
        self.add_question(
            2,
            type_q="text",
            question="Reviewed text",
            next_review=today,
            history=[
                history_entry(today - timedelta(days=4), 2),
                history_entry(today - timedelta(days=3), 0),
                history_entry(today - timedelta(days=2), 1)
            ]
        )
        self.add_question(
            3,
            type_q="map",
            question="Europe - FR",
            answer="France",
            data={
                "code": "FR",
                "aliases": ["Republique francaise"],
                "favorite": True
            },
            group=map_group,
            next_review=today + timedelta(days=2),
            history=[
                history_entry(today - timedelta(days=2), 0),
                history_entry(today - timedelta(days=1), 1)
            ],
            difficulty=8.0
        )
        self.add_question(
            4,
            type_q="timeline",
            question="Moon landing",
            answer="1969",
            data={
                "timeline": {
                    "kind": "point",
                    "start": {
                        "year": 1969,
                        "precision": "year"
                    }
                }
            },
            next_review=today + timedelta(days=5),
            history=[
                history_entry(old_day, 0),
                history_entry(today - timedelta(days=1), 2)
            ]
        )
        self.add_question(
            5,
            type_q="timeline",
            question="Difficult timeline",
            answer="1914",
            next_review=today - timedelta(days=2),
            history=[
                history_entry(today - timedelta(days=3), 0),
                history_entry(today - timedelta(days=2), 0),
                history_entry(today - timedelta(days=1), 1)
            ],
            difficulty=9.0
        )
        self.add_question(
            6,
            type_q="text",
            question="Future text",
            next_review=today + timedelta(days=40),
            history=[history_entry(today - timedelta(days=1), 3)]
        )
        self.db.commit()

        stats = build_stats(self.db, today=today)

        self.assertEqual(stats["counts"]["total"], 6)
        self.assertEqual(stats["counts"]["new"], 1)
        self.assertEqual(stats["counts"]["due_total"], 2)
        self.assertEqual(stats["counts"]["overdue"], 1)
        self.assertEqual(stats["counts"]["due_today"], 1)
        self.assertEqual(stats["counts"]["mastered"], 0)
        self.assertEqual(stats["counts"]["by_type"]["text"]["total"], 3)
        self.assertEqual(stats["counts"]["by_type"]["timeline"]["due"], 1)
        self.assertEqual(stats["counts"]["by_type"]["media"]["total"], 0)

        today_load = stats["load_by_type"][0]
        self.assertEqual(today_load["date"], today.isoformat())
        self.assertEqual(today_load["total"], 2)
        self.assertEqual(today_load["types"]["text"], 1)
        self.assertEqual(today_load["types"]["timeline"], 1)
        self.assertEqual(stats["load_by_type"][2]["types"]["map"], 1)
        self.assertEqual(stats["load_by_type"][5]["types"]["timeline"], 1)

        self.assertEqual(
            stats["retention_by_type"]["text"],
            {
                "reviews": 4,
                "success": 3,
                "failed": 1,
                "hard": 1,
                "retention": 75
            }
        )
        self.assertEqual(stats["retention_by_type"]["map"]["retention"], 50)
        self.assertEqual(stats["retention_by_type"]["media"]["reviews"], 0)
        self.assertEqual(stats["retention_by_type"]["timeline"]["reviews"], 4)
        self.assertEqual(stats["retention_by_type"]["timeline"]["failed"], 2)
        self.assertEqual(stats["retention_by_type"]["timeline"]["retention"], 50)

        self.assertEqual(stats["hard_questions"][0]["id"], 5)
        self.assertEqual(stats["favorite_questions"][0]["id"], 3)
        self.assertEqual(stats["favorite_questions"][0]["data"]["code"], "FR")
        self.assertEqual(stats["weak_spots"]["map"][0]["id"], 3)
        self.assertEqual(stats["weak_spots"]["timeline"][0]["id"], 5)
        self.assertEqual(stats["weak_spots"]["media"], [])

    def test_legacy_progress_without_history_can_rank_as_hard(self):
        today = date(2026, 1, 15)
        self.add_question(
            1,
            type_q="text",
            next_review=today,
            history=[],
            reps=5,
            lapses=3,
            difficulty=8.0
        )
        self.db.commit()

        stats = build_stats(self.db, today=today)

        self.assertEqual(stats["hard_questions"][0]["id"], 1)
        self.assertEqual(stats["hard_questions"][0]["reviews"], 5)
        self.assertEqual(stats["hard_questions"][0]["failed_count"], 3)
        self.assertEqual(stats["hard_questions"][0]["retention"], 40)

    def test_unstarted_progress_counts_as_new_not_due_load(self):
        today = date(2026, 1, 15)
        self.add_question(
            1,
            type_q="text",
            next_review=today,
            history=[],
            reps=0
        )
        self.db.commit()

        stats = build_stats(self.db, today=today)

        self.assertEqual(stats["counts"]["new"], 1)
        self.assertEqual(stats["counts"]["due_total"], 0)
        self.assertEqual(stats["counts"]["due_today"], 0)
        self.assertEqual(stats["load_by_type"][0]["total"], 0)

    def test_mastered_count_uses_interval_and_reps_threshold(self):
        today = date(2026, 1, 15)
        self.add_question(
            1,
            type_q="text",
            next_review=today + timedelta(days=90),
            history=[history_entry(today - timedelta(days=1), 3)],
            reps=3,
            interval=60
        )
        self.add_question(
            2,
            type_q="map",
            next_review=today + timedelta(days=90),
            history=[history_entry(today - timedelta(days=1), 3)],
            reps=2,
            interval=90
        )
        self.add_question(
            3,
            type_q="timeline",
            next_review=today + timedelta(days=90),
            history=[history_entry(today - timedelta(days=1), 3)],
            reps=4,
            interval=30
        )
        self.add_question(4, type_q="text")
        self.db.commit()

        stats = build_stats(self.db, today=today)

        self.assertEqual(stats["counts"]["mastered"], 1)
        self.assertEqual(stats["counts"]["by_type"]["text"]["mastered"], 1)
        self.assertEqual(stats["counts"]["by_type"]["map"]["mastered"], 0)
        self.assertEqual(stats["counts"]["by_type"]["timeline"]["mastered"], 0)


if __name__ == "__main__":
    unittest.main()
