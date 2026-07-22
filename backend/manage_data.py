import argparse


def backup_command(args):
    from app.services.backups import create_backup

    result = create_backup(reason=args.reason, label=args.label)
    print(f"Backup created: {result.path}")
    return 0


def migrate_command(_args):
    from app.bootstrap import init_database

    result = init_database()
    applied = result["applied"]

    if result["backup"]:
        print(f"Backup created: {result['backup']['path']}")

    if not applied:
        print("No pending migrations.")
        return 0

    print("Applied migrations:")

    for migration in applied:
        print(f"  {migration['version']} {migration['name']}")

    return 0


def validate_revlog_command(args):
    from app.services.revlog import validate_revlog

    if args.database:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        engine = create_engine(f"sqlite:///{args.database}")
        db = sessionmaker(bind=engine)()
    else:
        from app.database import SessionLocal

        db = SessionLocal()

    try:
        report = validate_revlog(db)
    finally:
        db.close()

    restore = report["restore"]
    replay = report["replay"]

    print(f"Questions checked: {report['questions']}")
    print(
        f"Restore (strict): {restore['matched']}/{restore['checked']} matched, "
        f"{restore['mismatch_count']} mismatched"
    )
    print(
        "Active-schedule drift (interval/next_review moved by rebalancing, "
        f"expected): {restore['active_schedule_drift']}"
    )
    print(
        f"Replay (best-effort): {replay['matched_rows']}/"
        f"{replay['checked_rows']} rows matched, "
        f"{replay['mismatch_questions']} questions with divergence, "
        f"{replay['skipped_rows']} rows skipped"
    )

    for mismatch in restore["mismatches"]:
        print(f"  RESTORE MISMATCH question {mismatch['question_id']}:")

        for field, values in mismatch["fields"].items():
            print(
                f"    {field}: stored={values['stored']} "
                f"restored={values['restored']}"
            )

    for sample in replay["samples"]:
        print(
            f"  replay divergence question {sample['question_id']} "
            f"seq {sample['seq']}: recorded={sample['recorded']} "
            f"replayed={sample['replayed']}"
        )

    return 0 if restore["mismatch_count"] == 0 else 1


def build_parser():
    parser = argparse.ArgumentParser(
        description="Quiz app local data maintenance"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    backup_parser = subparsers.add_parser(
        "backup",
        help="Create an exportable zip backup of questions.db and static/"
    )
    backup_parser.add_argument(
        "--reason",
        default="manual",
        help="Reason stored in backup-manifest.json"
    )
    backup_parser.add_argument(
        "--label",
        default="manual",
        help="Short filename label for the backup zip"
    )
    backup_parser.set_defaults(func=backup_command)

    migrate_parser = subparsers.add_parser(
        "migrate",
        help="Run pending schema/data migrations"
    )
    migrate_parser.set_defaults(func=migrate_command)

    validate_parser = subparsers.add_parser(
        "validate-revlog",
        help=(
            "Check that restore-from-review_log reproduces stored progress "
            "(gate before dropping Progress.history)"
        )
    )
    validate_parser.add_argument(
        "--database",
        default=None,
        help="Optional path to a database copy (defaults to the live file)"
    )
    validate_parser.set_defaults(func=validate_revlog_command)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
