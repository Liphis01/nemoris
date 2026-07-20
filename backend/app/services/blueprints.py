"""Blueprint export/import (sync-roadmap M1, slice 1.1/1.2).

A blueprint is a themed QuestionGroup (e.g. "Countries of the world") packaged
as a zip so another user can install it into their own database. Progress is
never included — the equivalent of Anki's ".apkg" with "include scheduling
information" unchecked.

Imported rows reuse the exporting database's guid verbatim rather than
minting a fresh one: step 1.3 (not built here) will diff "installed vs new
version" by guid, and reusing it means that diff is just guid membership in
the new content.json, with no extra bookkeeping column needed. This costs
nothing — guid uniqueness is only enforced per local SQLite file, and two
independent users importing the same blueprint each get matching guids in
their own separate databases, consistent with the M2 sync design (blueprint
content is excluded from the personal-content sync payload; each device
installs blueprints independently by blueprint_guid).
"""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, is_zipfile

from urllib.parse import urlparse

from sqlalchemy.orm import joinedload

from ..config import BLUEPRINT_DIR, STATIC_DIR
from ..migrations import MIGRATIONS
from ..models import BlueprintSubscription, Question, QuestionGroup
from .media import (
    get_media_file_by_path,
    static_file_path_from_media,
    static_relative_path_from_media,
    store_media_bytes
)


BLUEPRINT_FORMAT = 1

# Fields that define whether an item "changed" for future update-diffing
# (1.3). Deliberately excludes guid/id/group_id/anything progress-related.
# media/answer_media are content-addressed refs ({"sha256": ...}), never a
# local path, so the hash is identical regardless of which machine the file
# lives on.
QUESTION_HASH_FIELDS = (
    "type_q", "question", "answer", "media", "answer_media", "tags", "data"
)
GROUP_HASH_FIELDS = ("type_group", "name", "media", "data")


def content_hash(entry, fields):
    payload = {field: entry.get(field) for field in fields}
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True
    )

    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _safe_filename_slug(value):
    slug = "".join(
        char.lower() if char.isalnum() else "-"
        for char in str(value or "")
    ).strip("-")

    return slug[:60]


def _resolve_media_ref(db, value, static_dir, media_assets):
    # A media field is one of two things, only one of which is backend-owned
    # user data:
    #   - /static/<file> (or a full local-host static URL): a real uploaded
    #     file in STATIC_DIR, backed by the MediaFile registry -- bundle it.
    #   - an external http(s) URL: hotlinked, never downloaded locally --
    #     pass through, the importing app links the same URL.
    # (A third case used to exist: a bare filename like "world.svg" meaning a
    # built-in map template shipped with the frontend app itself. That
    # ambiguity was eliminated -- migration 0016 localized every such
    # reference into a real /static/ file, and the map editor no longer
    # offers a way to create new ones. Anything that isn't a resolvable
    # static file or an external URL is now a genuine error.)
    if not value:
        return None

    relative_path = static_relative_path_from_media(value)

    if relative_path is None:
        parsed = urlparse(str(value))

        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return {"url": str(value)}

        raise ValueError(f"Referenced media file is missing on disk: {value}")

    file_path = static_file_path_from_media(value, static_dir=static_dir)

    if not file_path or not file_path.exists():
        raise ValueError(f"Referenced media file is missing on disk: {value}")

    registered = get_media_file_by_path(db, relative_path)
    digest = (
        registered.sha256
        if registered
        else hashlib.sha256(file_path.read_bytes()).hexdigest()
    )
    media_assets[digest] = file_path

    return {"sha256": digest}


def export_blueprint(
    db,
    group_id,
    *,
    version,
    name,
    description="",
    license="",
    static_dir: Path | None = None,
    blueprint_dir: Path | None = None
):
    static_dir = static_dir or STATIC_DIR
    blueprint_dir = blueprint_dir or BLUEPRINT_DIR

    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions))
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise ValueError("Question group not found")

    media_assets = {}

    group_entry = {
        "guid": group.guid,
        "type_group": group.type_group,
        "name": group.name,
        "media": _resolve_media_ref(db, group.media, static_dir, media_assets),
        "data": group.data or {}
    }
    question_entries = [
        {
            "guid": question.guid,
            "type_q": question.type_q,
            "question": question.question,
            "answer": question.answer,
            "media": _resolve_media_ref(
                db, question.media, static_dir, media_assets
            ),
            "answer_media": _resolve_media_ref(
                db, question.answer_media, static_dir, media_assets
            ),
            "tags": question.tags or [],
            "data": question.data or {}
        }
        # Ordered by id for stable diffs across re-exports.
        for question in sorted(group.questions, key=lambda item: item.id)
    ]
    content = {"group": group_entry, "questions": question_entries}
    manifest = {
        "format": BLUEPRINT_FORMAT,
        "blueprint_guid": group.guid,
        "version": version,
        "name": name,
        "description": description,
        "license": license,
        "minimum_schema_version": MIGRATIONS[-1].version,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    blueprint_dir.mkdir(parents=True, exist_ok=True)
    # Deterministic per (group, version): re-exporting the same version
    # overwrites, which is the desired iteration behavior for an author.
    slug = _safe_filename_slug(name) or "blueprint"
    zip_path = blueprint_dir / f"{slug}-{group.guid}-v{version}.zip"

    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zip_file:
        zip_file.writestr(
            "manifest.json",
            json.dumps(manifest, indent=2, sort_keys=True)
        )
        zip_file.writestr(
            "content.json",
            json.dumps(content, indent=2, sort_keys=True)
        )

        for digest, file_path in media_assets.items():
            zip_file.write(file_path, f"media/{digest}{file_path.suffix.lower()}")

    return zip_path


def _read_json_member(zip_file, name, error_message):
    if name not in zip_file.namelist():
        raise ValueError(error_message)

    try:
        return json.loads(zip_file.read(name).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError(f"{name} is unreadable") from error


def import_blueprint(db, zip_path, *, static_dir: Path | None = None, source=None):
    static_dir = static_dir or STATIC_DIR
    zip_path = Path(zip_path)

    if not is_zipfile(zip_path):
        raise ValueError("The provided file is not a valid .zip archive")

    with ZipFile(zip_path) as zip_file:
        manifest = _read_json_member(
            zip_file,
            "manifest.json",
            "Invalid blueprint: manifest.json is missing"
        )

        if manifest.get("format") != BLUEPRINT_FORMAT:
            raise ValueError("Unsupported blueprint format")

        blueprint_guid = manifest.get("blueprint_guid")
        version = manifest.get("version")

        if not blueprint_guid or not isinstance(version, int):
            raise ValueError("Invalid blueprint manifest")

        current_schema_version = MIGRATIONS[-1].version
        minimum_schema_version = manifest.get("minimum_schema_version") or ""

        if minimum_schema_version > current_schema_version:
            raise ValueError(
                "This blueprint requires a newer app version (needs schema "
                f"{minimum_schema_version}, have {current_schema_version})"
            )

        already_subscribed = (
            db.query(BlueprintSubscription)
            .filter(BlueprintSubscription.blueprint_guid == blueprint_guid)
            .first()
        )

        if already_subscribed:
            raise ValueError("This blueprint is already installed")

        guid_collision = (
            db.query(QuestionGroup)
            .filter(QuestionGroup.guid == blueprint_guid)
            .first()
        )

        if guid_collision:
            raise ValueError(
                "A group with this blueprint's guid already exists locally"
            )

        content = _read_json_member(
            zip_file,
            "content.json",
            "Invalid blueprint: content.json is missing"
        )
        group_entry = content.get("group")
        question_entries = content.get("questions")

        if not isinstance(group_entry, dict) or not isinstance(
            question_entries, list
        ):
            raise ValueError("Invalid blueprint: content.json is malformed")

        def materialize(ref):
            # Mirrors the two cases from _resolve_media_ref: only a sha256
            # ref has a file bundled in the archive to materialize; a url ref
            # resolves locally on the importing side with no data transfer.
            if not ref:
                return None

            if not isinstance(ref, dict):
                raise ValueError("Invalid blueprint: malformed media reference")

            if "url" in ref:
                return ref["url"]

            digest = ref.get("sha256")

            if not digest:
                raise ValueError("Invalid blueprint: malformed media reference")

            member_name = next(
                (
                    name
                    for name in zip_file.namelist()
                    if name.startswith(f"media/{digest}")
                ),
                None
            )

            if member_name is None:
                raise ValueError(
                    f"Invalid blueprint: media {digest} is missing from the "
                    "archive"
                )

            # store_media_bytes already dedups by sha256 (0.5) -- no separate
            # pre-check needed, just reuse it as-is.
            result = store_media_bytes(
                zip_file.read(member_name),
                filename=member_name,
                static_dir=static_dir,
                allow_audio_video=True,
                db=db
            )

            return result["url"]

        group = QuestionGroup(
            guid=group_entry.get("guid"),
            type_group=group_entry.get("type_group"),
            name=group_entry.get("name"),
            media=materialize(group_entry.get("media")),
            data=group_entry.get("data") or {},
            blueprint_guid=blueprint_guid,
            blueprint_version=version,
            content_hash=content_hash(group_entry, GROUP_HASH_FIELDS)
        )
        db.add(group)
        db.flush()

        for entry in question_entries:
            db.add(Question(
                guid=entry.get("guid"),
                type_q=entry.get("type_q"),
                question=entry.get("question"),
                answer=entry.get("answer"),
                media=materialize(entry.get("media")),
                answer_media=materialize(entry.get("answer_media")),
                tags=entry.get("tags") or [],
                data=entry.get("data") or {},
                group_id=group.id,
                blueprint_guid=blueprint_guid,
                blueprint_version=version,
                content_hash=content_hash(entry, QUESTION_HASH_FIELDS)
            ))
            # No Progress row -- mirrors create_question()'s own lazy
            # creation on first answer, needs no special-casing here.

        db.add(BlueprintSubscription(
            blueprint_guid=blueprint_guid,
            installed_version=version,
            name=manifest.get("name"),
            source=str(source or zip_path.name),
            subscribed_at=datetime.now(timezone.utc).isoformat()
        ))
        db.commit()

    return {
        "status": "imported",
        "blueprint_guid": blueprint_guid,
        "group_id": group.id,
        "version": version,
        "questions_imported": len(question_entries)
    }
