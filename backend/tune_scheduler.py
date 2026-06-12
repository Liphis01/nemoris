import argparse

from app.database import SessionLocal
from app.services.scheduler_tuning import (
    DEFAULT_TUNING_REPORT_DIR,
    tune_scheduler
)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Tune scheduler mode difficulty from real review history"
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="write reports without updating scheduler_tuning settings"
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="apply accepted tuning settings; this is also the default"
    )
    parser.add_argument("--min-total-pairs", type=int, default=100)
    parser.add_argument("--min-mode-pairs", type=int, default=25)
    parser.add_argument("--out-dir", default=str(DEFAULT_TUNING_REPORT_DIR))

    return parser


def main(argv=None, session_factory=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.min_total_pairs < 1:
        parser.error("--min-total-pairs must be positive")

    if args.min_mode_pairs < 1:
        parser.error("--min-mode-pairs must be positive")

    apply_enabled = not args.dry_run
    session_factory = session_factory or SessionLocal
    db = session_factory()

    try:
        result = tune_scheduler(
            db,
            apply_enabled=apply_enabled,
            min_total_pairs=args.min_total_pairs,
            min_mode_pairs=args.min_mode_pairs,
            out_dir=args.out_dir
        )

        if result["summary"]["applied"]:
            db.commit()
        else:
            db.rollback()
    finally:
        db.close()

    summary = result["summary"]
    paths = result["report_paths"]
    print(f"Scheduler tuning report written to {paths['html']}")
    print(f"Summary JSON: {paths['summary']}")
    print(f"Calibration CSV: {paths['calibration']}")
    print(f"Candidate scores CSV: {paths['candidate_scores']}")
    print(f"Accepted: {summary['accepted']}")
    print(f"Applied: {summary['applied']}")
    print(f"Reason: {summary['reason']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
