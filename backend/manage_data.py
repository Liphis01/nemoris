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

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
