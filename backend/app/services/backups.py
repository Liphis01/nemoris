from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile

from ..config import BACKUP_DIR, DATABASE_FILE, STATIC_DIR


@dataclass(frozen=True)
class BackupResult:
    path: Path
    created_at: str
    reason: str
    included: list[str]

    def as_dict(self):
        return {
            "path": str(self.path),
            "created_at": self.created_at,
            "reason": self.reason,
            "included": self.included
        }


def _safe_label(value):
    label = "".join(
        char.lower() if char.isalnum() else "-"
        for char in str(value or "")
    ).strip("-")

    return label[:60]


def _unique_backup_path(backup_dir, timestamp, label):
    suffix = f"-{label}" if label else ""
    path = backup_dir / f"quiz-app-backup-{timestamp}{suffix}.zip"
    index = 2

    while path.exists():
        path = backup_dir / (
            f"quiz-app-backup-{timestamp}{suffix}-{index}.zip"
        )
        index += 1

    return path


def _write_database_snapshot(zip_file, database_file, temp_dir):
    snapshot_file = temp_dir / "questions.db"

    with sqlite3.connect(str(database_file)) as source:
        with sqlite3.connect(str(snapshot_file)) as target:
            source.backup(target)

    zip_file.write(snapshot_file, "questions.db")


def _write_static_files(zip_file, static_dir):
    written = []

    if not static_dir.exists():
        return written

    for path in sorted(static_dir.rglob("*")):
        if path.is_file():
            archive_name = Path("static") / path.relative_to(static_dir)
            zip_file.write(path, archive_name.as_posix())
            written.append(archive_name.as_posix())

    return written


def create_backup(
    *,
    database_file: Path = DATABASE_FILE,
    static_dir: Path = STATIC_DIR,
    backup_dir: Path = BACKUP_DIR,
    reason: str = "manual",
    label: str | None = None,
    extra_manifest: dict | None = None
):
    backup_dir.mkdir(parents=True, exist_ok=True)
    created_at = datetime.now(timezone.utc).isoformat()
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = _unique_backup_path(
        backup_dir,
        timestamp,
        _safe_label(label or reason)
    )
    included = []

    manifest = {
        "format": 1,
        "created_at": created_at,
        "reason": reason,
        "database_file": str(database_file),
        "static_dir": str(static_dir),
        "extra": extra_manifest or {}
    }

    with tempfile.TemporaryDirectory() as temp_name:
        temp_dir = Path(temp_name)

        with ZipFile(backup_path, "w", compression=ZIP_DEFLATED) as zip_file:
            if database_file.exists():
                _write_database_snapshot(zip_file, database_file, temp_dir)
                included.append("questions.db")

            included.extend(_write_static_files(zip_file, static_dir))
            manifest["included"] = included
            zip_file.writestr(
                "backup-manifest.json",
                json.dumps(manifest, indent=2, sort_keys=True)
            )

    return BackupResult(
        path=backup_path,
        created_at=created_at,
        reason=reason,
        included=included
    )
