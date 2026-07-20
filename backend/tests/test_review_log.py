import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Question, ReviewLog
from app.services.progress import (
    apply_scheduling,
    apply_scheduling_batch,
    create_initial_progress,
    replace_latest_scheduling
)


class ReviewLogDualWriteTests(unittest.TestCase):
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

    def answer(self, question, quality, today=None):
        progress = create_initial_progress(
            question.id,
            today=today or date(2026, 1, 1)
        )
        self.db.add(progress)
        apply_scheduling(
            self.db,
            progress,
            quality,
            today=today or date(2026, 1, 1)
        )
        return progress

    def active_rows(self, question_id):
        return (
            self.db.query(ReviewLog)
            .filter(
                ReviewLog.question_id == question_id,
                ReviewLog.superseded_by.is_(None)
            )
            .order_by(ReviewLog.seq)
            .all()
        )

    def test_answer_appends_matching_review_log_row(self):
        question = self.add_question(1)
        progress = self.answer(question, 2)

        rows = self.db.query(ReviewLog).all()
        self.assertEqual(len(rows), 1)

        row = rows[0]
        entry = progress.history[-1]

        self.assertEqual(row.question_id, 1)
        self.assertEqual(row.question_guid, question.guid)
        self.assertEqual(row.seq, 1)
        self.assertEqual(row.quality, 2)
        self.assertEqual(row.reviewed_on, date(2026, 1, 1))
        self.assertIsNotNone(row.reviewed_at)
        self.assertIsNone(row.superseded_by)
        self.assertEqual(row.data, entry)
        self.assertEqual(row.stability, entry["stability"])
        self.assertEqual(row.interval, entry["interval"])

    def test_consecutive_answers_increment_seq(self):
        question = self.add_question(1)
        progress = self.answer(question, 2, today=date(2026, 1, 1))
        apply_scheduling(self.db, progress, 3, today=date(2026, 1, 10))

        rows = self.active_rows(1)

        self.assertEqual([row.seq for row in rows], [1, 2])
        self.assertEqual(len(progress.history), 2)
        self.assertEqual(
            [row.data for row in rows],
            list(progress.history)
        )

    def test_regrade_supersedes_previous_row(self):
        question = self.add_question(1)
        progress = self.answer(question, 1)

        replace_latest_scheduling(
            self.db,
            progress,
            3,
            today=date(2026, 1, 1)
        )

        rows = (
            self.db.query(ReviewLog)
            .order_by(ReviewLog.seq)
            .all()
        )

        self.assertEqual(len(rows), 2)

        original, replacement = rows

        self.assertEqual(original.quality, 1)
        self.assertEqual(replacement.quality, 3)
        self.assertEqual(original.superseded_by, replacement.id)
        self.assertIsNone(replacement.superseded_by)

        # The JSON history popped the corrected entry; active revlog rows
        # mirror it exactly.
        self.assertEqual(len(progress.history), 1)
        active = self.active_rows(1)
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0].data, progress.history[-1])

    def test_batch_answers_write_rows_with_guids(self):
        first = self.add_question(1)
        second = self.add_question(2, type_q="map")

        first_progress = create_initial_progress(1, today=date(2026, 1, 1))
        second_progress = create_initial_progress(2, today=date(2026, 1, 1))
        self.db.add_all([first_progress, second_progress])

        apply_scheduling_batch(
            self.db,
            [
                (first_progress, 2),
                (second_progress, 0, {"mode_difficulty": 1.1, "mode": "qcm"})
            ],
            today=date(2026, 1, 1)
        )

        rows = {
            row.question_id: row
            for row in self.db.query(ReviewLog).all()
        }

        self.assertEqual(set(rows), {1, 2})
        self.assertEqual(rows[1].question_guid, first.guid)
        self.assertEqual(rows[2].question_guid, second.guid)
        # Metadata merged into the history entry lands in the snapshot too.
        self.assertEqual(rows[2].data.get("mode"), "qcm")


if __name__ == "__main__":
    unittest.main()
