from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, is_zipfile

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


def _read_manifest(zip_file):
    if "backup-manifest.json" not in zip_file.namelist():
        raise ValueError("Archive invalide : manifeste de sauvegarde manquant.")

    try:
        manifest = json.loads(
            zip_file.read("backup-manifest.json").decode("utf-8")
        )
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("Manifeste de sauvegarde illisible.") from error

    if manifest.get("format") != 1:
        raise ValueError("Format de sauvegarde non pris en charge.")

    return manifest


def _static_members(zip_file, static_dir):
    # Resolve and validate every archived media path up front so a malicious or
    # corrupt archive cannot escape the static directory once we start writing.
    static_root = static_dir.resolve()
    members = []

    for name in zip_file.namelist():
        if not name.startswith("static/") or name.endswith("/"):
            continue

        relative = name[len("static/"):]

        if not relative:
            continue

        destination = (static_dir / relative).resolve()

        if destination != static_root and static_root not in destination.parents:
            raise ValueError(
                "Archive invalide : chemin de média en dehors du dossier static."
            )

        members.append((name, destination))

    return members


def _replace_database_file(zip_file, database_file):
    database_file.parent.mkdir(parents=True, exist_ok=True)

    # Stage the snapshot next to the live file so os.replace stays atomic and on
    # the same filesystem, then validate it really is a SQLite database before
    # swapping anything destructive into place.
    descriptor, staged_name = tempfile.mkstemp(
        dir=str(database_file.parent),
        suffix=".restore.db"
    )
    os.close(descriptor)
    staged_path = Path(staged_name)

    try:
        staged_path.write_bytes(zip_file.read("questions.db"))

        with sqlite3.connect(str(staged_path)) as connection:
            connection.execute("SELECT name FROM sqlite_master LIMIT 1")

        os.replace(staged_path, database_file)
    except sqlite3.DatabaseError as error:
        staged_path.unlink(missing_ok=True)
        raise ValueError(
            "La base de données de la sauvegarde est illisible."
        ) from error
    except Exception:
        staged_path.unlink(missing_ok=True)
        raise


def _clear_static_dir(static_dir):
    if not static_dir.exists():
        return

    for path in sorted(static_dir.rglob("*"), reverse=True):
        if path.is_dir() and not path.is_symlink():
            path.rmdir()
        else:
            path.unlink()


def restore_backup(
    zip_path: Path,
    *,
    database_file: Path = DATABASE_FILE,
    static_dir: Path = STATIC_DIR
):
    """Replace the live database and media with the contents of a backup zip.

    This is destructive: the current database file and everything under
    ``static_dir`` are overwritten. Callers running against the live engine must
    dispose its connection pool first so the SQLite file handle is released.
    """

    zip_path = Path(zip_path)

    if not is_zipfile(zip_path):
        raise ValueError("Le fichier fourni n'est pas une archive .zip valide.")

    with ZipFile(zip_path) as zip_file:
        _read_manifest(zip_file)

        if "questions.db" not in zip_file.namelist():
            raise ValueError(
                "Archive invalide : base de données questions.db manquante."
            )

        # Validate media paths before any destructive write.
        static_members = _static_members(zip_file, static_dir)

        _replace_database_file(zip_file, database_file)

        _clear_static_dir(static_dir)
        restored = ["questions.db"]

        for name, destination in static_members:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(zip_file.read(name))
            restored.append(name)

    return {"included": restored}
