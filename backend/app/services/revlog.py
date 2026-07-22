"""Readers and validation for the append-only review_log (sync-roadmap 0.3).

The revlog rows are snapshots: restoring state means taking the latest active
row, exactly like ``restore_progress_from_history`` does with the legacy JSON
entries. Forward-replay is a merge tool for future sync (M3), never the source
of truth — update_progress is not purely deterministic (interval fuzzing), so
replay only aims to reproduce memory state (stability/difficulty), not dates.
"""

import math

from ..models import Progress, ReviewLog
from ..scheduler import parse_history_date, update_progress
from .progress import (
    create_initial_progress,
    restore_progress_from_history,
    write_scheduling
)


def active_review_entries(db, question_id):
    # The revlog equivalent of the legacy history list: superseded rows are
    # corrections replaced by a later row and stay out of state restoration.
    rows = (
        db.query(ReviewLog)
        .filter(
            ReviewLog.question_id == question_id,
            ReviewLog.superseded_by.is_(None)
        )
        .order_by(ReviewLog.seq)
        .all()
    )

    return [dict(row.data or {}) for row in rows]


def restore_progress_from_revlog(db, progress: Progress, today=None):
    # Same restore semantics as the JSON history, new source. The entries in
    # data are byte-identical to what record_answer_history wrote, so the
    # existing restore logic applies unchanged.
    entries = active_review_entries(db, progress.question_id)
    restore_progress_from_history(progress, entries, today=today)

    return progress


def replay_memory_state(entries, question_id=None):
    """Forward-replay recorded reviews with fuzzing off (M3 groundwork).

    Rebuilds the scheduling chain on a scratch Progress so same-day
    repeat-lapse freezes reproduce. Returns one dict per entry with the
    replayed stability/difficulty; dates are intentionally not compared —
    fuzzing only ever touched due dates, never memory state.
    """
    if not entries:
        return []

    first_date = parse_history_date(entries[0].get("reviewed_on"))
    scratch = create_initial_progress(
        question_id if question_id is not None else -1,
        today=first_date
    )
    replayed = []

    for entry in entries:
        quality = entry.get("quality")
        reviewed_on = parse_history_date(entry.get("reviewed_on"))

        if quality is None or reviewed_on is None:
            replayed.append(None)
            continue

        scheduling = update_progress(
            scratch,
            quality,
            today=reviewed_on,
            mode_difficulty=entry.get("mode_difficulty"),
            enable_fuzzing=False
        )
        write_scheduling(scratch, quality, scheduling)
        replayed.append({
            "stability": scheduling["stability"],
            "difficulty": scheduling["difficulty"],
            "repeat_lapse": bool(scheduling.get("repeat_lapse"))
        })

    return replayed


def _floats_close(left, right, tolerance):
    if left is None or right is None:
        return left == right

    try:
        return math.isclose(
            float(left),
            float(right),
            rel_tol=tolerance,
            abs_tol=tolerance
        )
    except (TypeError, ValueError):
        return False


def strict_mismatch_fields(db, progress, tolerance=1e-6):
    """Fields where restore-from-revlog diverges from the stored state.

    Only the strict fields (memory state + at-review-time schedule) count;
    interval/next_review belong to the local rebalancer. Used by validation
    and by the reconciliation migration.
    """
    entries = active_review_entries(db, progress.question_id)
    scratch = Progress(question_id=progress.question_id)
    restore_progress_from_history(scratch, entries)

    mismatched = []

    for field in ("stability", "difficulty"):
        if not _floats_close(
            getattr(scratch, field),
            getattr(progress, field),
            tolerance
        ):
            mismatched.append(field)

    for field in (
        "reps",
        "lapses",
        "last_review",
        "ideal_interval",
        "ideal_next_review"
    ):
        if getattr(scratch, field) != getattr(progress, field):
            mismatched.append(field)

    return mismatched, scratch


def validate_revlog(db, tolerance=1e-6, sample_limit=10):
    """Property check: restore-from-revlog must reproduce stored state.

    Strict fields are the memory state and the at-review-time schedule
    (ideal_*). interval/next_review drift is informational only: the
    rebalancer legitimately moves the active schedule after answers — that is
    the ideal/active split, not a defect. Replay matching is best-effort:
    rows recorded under older tuning parameters or FSRS versions may not
    replay identically; the snapshot restore stays authoritative.

    Read-only: scratch Progress objects are never added to the session.
    """
    report = {
        "questions": 0,
        "restore": {
            "checked": 0,
            "matched": 0,
            "mismatch_count": 0,
            "mismatches": [],
            "active_schedule_drift": 0
        },
        "replay": {
            "checked_rows": 0,
            "matched_rows": 0,
            "mismatch_questions": 0,
            "skipped_rows": 0,
            "samples": []
        }
    }

    for progress in db.query(Progress).all():
        if progress.question_id is None:
            continue

        report["questions"] += 1
        entries = active_review_entries(db, progress.question_id)

        report["restore"]["checked"] += 1
        mismatched_fields, scratch = strict_mismatch_fields(
            db,
            progress,
            tolerance
        )

        if mismatched_fields:
            report["restore"]["mismatch_count"] += 1

            if len(report["restore"]["mismatches"]) < sample_limit:
                report["restore"]["mismatches"].append({
                    "question_id": progress.question_id,
                    "fields": {
                        field: {
                            "stored": getattr(progress, field),
                            "restored": getattr(scratch, field)
                        }
                        for field in mismatched_fields
                    }
                })
        else:
            report["restore"]["matched"] += 1

        if (
            scratch.interval != progress.interval
            or scratch.next_review != progress.next_review
        ):
            report["restore"]["active_schedule_drift"] += 1

        # Best-effort replay comparison on memory state.
        replayed = replay_memory_state(
            entries,
            question_id=progress.question_id
        )
        question_mismatched = False

        for index, (entry, result) in enumerate(zip(entries, replayed)):
            if result is None:
                report["replay"]["skipped_rows"] += 1
                continue

            recorded_stability = entry.get("stability")
            recorded_difficulty = entry.get("difficulty")

            if recorded_stability is None and recorded_difficulty is None:
                report["replay"]["skipped_rows"] += 1
                continue

            report["replay"]["checked_rows"] += 1

            if (
                _floats_close(
                    result["stability"],
                    recorded_stability,
                    tolerance
                )
                and _floats_close(
                    result["difficulty"],
                    recorded_difficulty,
                    tolerance
                )
            ):
                report["replay"]["matched_rows"] += 1
            else:
                question_mismatched = True

                if len(report["replay"]["samples"]) < sample_limit:
                    report["replay"]["samples"].append({
                        "question_id": progress.question_id,
                        "seq": index + 1,
                        "recorded": {
                            "stability": recorded_stability,
                            "difficulty": recorded_difficulty
                        },
                        "replayed": {
                            "stability": result["stability"],
                            "difficulty": result["difficulty"]
                        }
                    })

        if question_mismatched:
            report["replay"]["mismatch_questions"] += 1

    return report
