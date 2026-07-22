import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Progress, Question
from app.services.progress import (
    apply_scheduling,
    create_initial_progress,
    replace_latest_scheduling
)
from app.services.revlog import (
    active_review_entries,
    replay_memory_state,
    restore_progress_from_revlog,
    validate_revlog
)


class RevlogRestoreTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_question(self, question_id, type_q="text"):
        question = Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=[],
            data={}
        )
        self.db.add(question)
        self.db.flush()
        return question

    def answer(self, question_id, quality, today):
        progress = (
            self.db.query(Progress)
            .filter(Progress.question_id == question_id)
            .first()
        )

        if progress is None:
            progress = create_initial_progress(question_id, today=today)
            self.db.add(progress)

        apply_scheduling(self.db, progress, quality, today=today)
        return progress

    def assert_restore_matches(self, progress):
        scratch = Progress(question_id=progress.question_id)
        restore_progress_from_revlog(self.db, scratch)

        for field in (
            "stability",
            "difficulty",
            "reps",
            "lapses",
            "interval",
            "last_review",
            "next_review",
            "ideal_interval",
            "ideal_next_review"
        ):
            self.assertEqual(
                getattr(scratch, field),
                getattr(progress, field),
                f"restored {field} diverges from stored state"
            )

    def test_restore_matches_progress_after_answers(self):
        self.add_question(1)
        self.answer(1, 2, date(2026, 1, 1))
        progress = self.answer(1, 3, date(2026, 1, 10))

        self.assert_restore_matches(progress)

    def test_restore_matches_after_regrade(self):
        self.add_question(1)
        progress = self.answer(1, 1, date(2026, 1, 1))
        replace_latest_scheduling(self.db, progress, 3, today=date(2026, 1, 1))

        # Only the active (non-superseded) row feeds the restore.
        entries = active_review_entries(self.db, 1)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["quality"], 3)

        self.assert_restore_matches(progress)

    def test_restore_empty_log_gives_fresh_state(self):
        self.add_question(1)
        scratch = Progress(question_id=1)
        restore_progress_from_revlog(self.db, scratch, today=date(2026, 2, 1))

        self.assertEqual(scratch.stability, 1.0)
        self.assertEqual(scratch.difficulty, 5.0)
        self.assertEqual(scratch.reps, 0)
        self.assertEqual(scratch.lapses, 0)
        self.assertIsNone(scratch.last_review)
        self.assertEqual(scratch.next_review, date(2026, 2, 1))

    def test_replay_reproduces_memory_state(self):
        self.add_question(1)
        self.answer(1, 2, date(2026, 1, 1))
        self.answer(1, 0, date(2026, 1, 4))
        self.answer(1, 3, date(2026, 1, 12))

        entries = active_review_entries(self.db, 1)
        replayed = replay_memory_state(entries, question_id=1)

        self.assertEqual(len(replayed), 3)

        for entry, result in zip(entries, replayed):
            self.assertIsNotNone(result)
            self.assertAlmostEqual(
                result["stability"],
                entry["stability"],
                places=6
            )
            self.assertAlmostEqual(
                result["difficulty"],
                entry["difficulty"],
                places=6
            )

    def test_replay_reproduces_mode_adjusted_rows(self):
        self.add_question(1, type_q="map")
        progress = create_initial_progress(1, today=date(2026, 1, 1))
        self.db.add(progress)
        apply_scheduling(
            self.db,
            progress,
            2,
            today=date(2026, 1, 1),
            metadata={"mode_difficulty": 1.2, "mode": "qcm"}
        )

        entries = active_review_entries(self.db, 1)
        self.assertEqual(entries[0].get("mode_difficulty"), 1.2)

        replayed = replay_memory_state(entries, question_id=1)

        self.assertAlmostEqual(
            replayed[0]["stability"],
            entries[0]["stability"],
            places=6
        )
        self.assertAlmostEqual(
            replayed[0]["difficulty"],
            entries[0]["difficulty"],
            places=6
        )

    def test_validate_revlog_reports_clean_database(self):
        self.add_question(1)
        self.add_question(2)
        self.answer(1, 2, date(2026, 1, 1))
        self.answer(1, 3, date(2026, 1, 9))
        self.answer(2, 0, date(2026, 1, 2))

        report = validate_revlog(self.db)

        self.assertEqual(report["questions"], 2)
        self.assertEqual(report["restore"]["mismatch_count"], 0)
        self.assertEqual(
            report["restore"]["matched"],
            report["restore"]["checked"]
        )
        self.assertEqual(
            report["replay"]["matched_rows"],
            report["replay"]["checked_rows"]
        )
        self.assertEqual(report["replay"]["checked_rows"], 3)


if __name__ == "__main__":
    unittest.main()
