"""Pack export/import (sync-roadmap M1, slice 1.1/1.2).

A pack is a themed QuestionGroup (e.g. "Countries of the world") packaged
as a zip so another user can install it into their own database. Progress is
never included — the equivalent of Anki's ".apkg" with "include scheduling
information" unchecked.

Imported rows reuse the exporting database's guid verbatim rather than
minting a fresh one: step 1.3 (not built here) will diff "installed vs new
version" by guid, and reusing it means that diff is just guid membership in
the new content.json, with no extra bookkeeping column needed. This costs
nothing — guid uniqueness is only enforced per local SQLite file, and two
independent users importing the same pack each get matching guids in
their own separate databases, consistent with the M2 sync design (pack
content is excluded from the personal-content sync payload; each device
installs packs independently by pack_guid).
"""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, is_zipfile

from urllib.parse import urlparse

from sqlalchemy.orm import joinedload

from ..config import BACKUP_DIR, PACK_DIR, DATABASE_FILE, STATIC_DIR
from ..migrations import MIGRATIONS
from ..models import PackSubscription, Question, QuestionGroup
from .backups import create_backup
from .media import (
    delete_unreferenced_media_file,
    get_media_file_by_path,
    static_file_path_from_media,
    static_relative_path_from_media,
    store_media_bytes
)
from .media_pool import MEDIA_POOL_KEY, question_media_refs
from .questions import delete_question_dependents
from .tombstones import record_tombstone


PACK_FORMAT = 1

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


def _resolve_data_media(db, data, static_dir, media_assets):
    # data.media_pool holds local /static paths; export and content-hashing need
    # them as the same content-addressed refs used for media/answer_media, so a
    # pooled question round-trips its extra images and hashes identically across
    # machines. Other data keys pass through untouched.
    if not isinstance(data, dict):
        return data or {}

    pool = data.get(MEDIA_POOL_KEY)

    if not isinstance(pool, list) or not pool:
        return data

    return {
        **data,
        MEDIA_POOL_KEY: [
            _resolve_media_ref(db, entry, static_dir, media_assets)
            for entry in pool
        ]
    }


def _materialize_data_media(data, materialize):
    # Inverse of _resolve_data_media: turn media_pool refs back into local
    # /static paths on import, dropping any that fail to materialize.
    if not isinstance(data, dict):
        return data or {}

    pool = data.get(MEDIA_POOL_KEY)

    if not isinstance(pool, list) or not pool:
        return data

    return {
        **data,
        MEDIA_POOL_KEY: [
            materialized
            for materialized in (materialize(ref) for ref in pool)
            if materialized
        ]
    }


def export_pack(
    db,
    group_id,
    *,
    version,
    name,
    description="",
    license="",
    static_dir: Path | None = None,
    pack_dir: Path | None = None
):
    static_dir = static_dir or STATIC_DIR
    pack_dir = pack_dir or PACK_DIR

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
            "data": _resolve_data_media(
                db, question.data or {}, static_dir, media_assets
            )
        }
        # Ordered by id for stable diffs across re-exports.
        for question in sorted(group.questions, key=lambda item: item.id)
    ]
    content = {"group": group_entry, "questions": question_entries}
    manifest = {
        "format": PACK_FORMAT,
        "pack_guid": group.guid,
        "version": version,
        "name": name,
        "description": description,
        "license": license,
        "minimum_schema_version": MIGRATIONS[-1].version,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    pack_dir.mkdir(parents=True, exist_ok=True)
    # Deterministic per (group, version): re-exporting the same version
    # overwrites, which is the desired iteration behavior for an author.
    slug = _safe_filename_slug(name) or "pack"
    zip_path = pack_dir / f"{slug}-{group.guid}-v{version}.zip"

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


def _read_manifest_and_content(zip_file):
    # Shared by import and update: format/manifest/content validation is
    # identical either way, only what happens with the result differs.
    manifest = _read_json_member(
        zip_file,
        "manifest.json",
        "Invalid pack: manifest.json is missing"
    )

    if manifest.get("format") != PACK_FORMAT:
        raise ValueError("Unsupported pack format")

    # Accept old archives exported before the terminology rename. New exports
    # write pack_guid, but old blueprint_guid ZIPs should remain installable.
    pack_guid = manifest.get("pack_guid") or manifest.get("blueprint_guid")
    version = manifest.get("version")

    if not pack_guid or not isinstance(version, int):
        raise ValueError("Invalid pack manifest")

    current_schema_version = MIGRATIONS[-1].version
    minimum_schema_version = manifest.get("minimum_schema_version") or ""

    if minimum_schema_version > current_schema_version:
        raise ValueError(
            "This pack requires a newer app version (needs schema "
            f"{minimum_schema_version}, have {current_schema_version})"
        )

    content = _read_json_member(
        zip_file,
        "content.json",
        "Invalid pack: content.json is missing"
    )
    group_entry = content.get("group")
    question_entries = content.get("questions")

    if not isinstance(group_entry, dict) or not isinstance(
        question_entries, list
    ):
        raise ValueError("Invalid pack: content.json is malformed")

    return manifest, pack_guid, version, group_entry, question_entries


def _make_materializer(zip_file, static_dir, db):
    def materialize(ref):
        # Mirrors the two cases from _resolve_media_ref: only a sha256
        # ref has a file bundled in the archive to materialize; a url ref
        # resolves locally on the importing side with no data transfer.
        if not ref:
            return None

        if not isinstance(ref, dict):
            raise ValueError("Invalid pack: malformed media reference")

        if "url" in ref:
            return ref["url"]

        digest = ref.get("sha256")

        if not digest:
            raise ValueError("Invalid pack: malformed media reference")

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
                f"Invalid pack: media {digest} is missing from the "
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

    return materialize


def import_pack(db, zip_path, *, static_dir: Path | None = None, source=None):
    static_dir = static_dir or STATIC_DIR
    zip_path = Path(zip_path)

    if not is_zipfile(zip_path):
        raise ValueError("The provided file is not a valid .zip archive")

    with ZipFile(zip_path) as zip_file:
        manifest, pack_guid, version, group_entry, question_entries = (
            _read_manifest_and_content(zip_file)
        )

        already_subscribed = (
            db.query(PackSubscription)
            .filter(PackSubscription.pack_guid == pack_guid)
            .first()
        )

        if already_subscribed:
            raise ValueError("This pack is already installed")

        guid_collision = (
            db.query(QuestionGroup)
            .filter(QuestionGroup.guid == pack_guid)
            .first()
        )

        if guid_collision:
            raise ValueError(
                "A group with this pack's guid already exists locally"
            )

        materialize = _make_materializer(zip_file, static_dir, db)

        group = QuestionGroup(
            guid=group_entry.get("guid"),
            type_group=group_entry.get("type_group"),
            name=group_entry.get("name"),
            media=materialize(group_entry.get("media")),
            data=group_entry.get("data") or {},
            pack_guid=pack_guid,
            pack_version=version,
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
                data=_materialize_data_media(entry.get("data") or {}, materialize),
                group_id=group.id,
                pack_guid=pack_guid,
                pack_version=version,
                content_hash=content_hash(entry, QUESTION_HASH_FIELDS)
            ))
            # No Progress row -- mirrors create_question()'s own lazy
            # creation on first answer, needs no special-casing here.

        db.add(PackSubscription(
            pack_guid=pack_guid,
            installed_version=version,
            name=manifest.get("name"),
            source=str(source or zip_path.name),
            subscribed_at=datetime.now(timezone.utc).isoformat()
        ))
        db.commit()

    return {
        "status": "imported",
        "pack_guid": pack_guid,
        "group_id": group.id,
        "version": version,
        "questions_imported": len(question_entries)
    }


def _row_canonical_payload(db, row, fields, static_dir):
    # Re-derives the content.json-shaped dict for a row's CURRENT state, so
    # it can be hashed with the same content_hash() used at import/update
    # time. media/answer_media go back through _resolve_media_ref so the
    # comparison uses the same content-addressed ref shape either side.
    payload = {}

    for field in fields:
        value = getattr(row, field)

        if field in ("media", "answer_media"):
            payload[field] = _resolve_media_ref(db, value, static_dir, {})
        elif field == "data":
            payload[field] = _resolve_data_media(db, value or {}, static_dir, {})
        else:
            payload[field] = value

    return payload


def _is_row_forked(db, row, fields, static_dir):
    # Forked-ness is purely "did the local row change since we last touched
    # it" -- it does NOT depend on the new version's content at all. A row
    # with no content_hash (shouldn't happen for anything pack-tracked)
    # or whose media went missing on disk is treated conservatively as
    # forked: never silently overwrite something we can't verify cleanly.
    if row.content_hash is None:
        return True

    try:
        payload = _row_canonical_payload(db, row, fields, static_dir)
    except ValueError:
        return True

    return content_hash(payload, fields) != row.content_hash


def update_pack(
    db,
    zip_path,
    *,
    static_dir: Path | None = None,
    source=None,
    delete_removed: bool = False
):
    """Apply a newer version of an already-installed pack.

    Safe to call repeatedly with the same zip: additions/updates are
    idempotent, and nothing is ever deleted unless delete_removed=True is
    passed explicitly. This doubles as the "preview" step -- call once with
    delete_removed=False to see what a deletion pass would remove (in the
    "removed" list) and apply everything else, then call again with
    delete_removed=True once the caller/UI has confirmed.

    Per item: new in the zip -> added; present locally and unforked ->
    updated to the new version; present locally but edited since import/last
    update -> left alone entirely (forked); present locally but absent from
    the zip -> reported as removed, deleted only if delete_removed=True.
    Progress is never touched -- it is keyed by the local row, which either
    keeps existing (added/updated/forked) or is deleted alongside its
    question through the normal deletion pipeline (tombstoned, same as any
    other question delete).
    """
    static_dir = static_dir or STATIC_DIR
    zip_path = Path(zip_path)

    if not is_zipfile(zip_path):
        raise ValueError("The provided file is not a valid .zip archive")

    with ZipFile(zip_path) as zip_file:
        manifest, pack_guid, version, group_entry, question_entries = (
            _read_manifest_and_content(zip_file)
        )

        subscription = (
            db.query(PackSubscription)
            .filter(PackSubscription.pack_guid == pack_guid)
            .first()
        )

        if not subscription:
            raise ValueError(
                "This pack is not installed; import it first"
            )

        if version < subscription.installed_version:
            raise ValueError(
                f"This pack zip (v{version}) is older than the "
                f"installed version (v{subscription.installed_version})"
            )

        local_group = (
            db.query(QuestionGroup)
            .filter(QuestionGroup.guid == pack_guid)
            .first()
        )

        if not local_group:
            raise ValueError(
                "Installed pack's group is missing locally"
            )

        materialize = _make_materializer(zip_file, static_dir, db)

        # Fork status must be checked unconditionally, before looking at
        # whether upstream changed anything -- a row can be locally edited
        # in a version where upstream happens not to touch it, and that
        # must still be detected and reported, even though there is nothing
        # to apply either way.
        group_forked = _is_row_forked(
            db, local_group, GROUP_HASH_FIELDS, static_dir
        )
        group_updated = False
        new_group_hash = content_hash(group_entry, GROUP_HASH_FIELDS)

        if (
            not group_forked
            and new_group_hash != local_group.content_hash
        ):
            local_group.type_group = group_entry.get("type_group")
            local_group.name = group_entry.get("name")
            local_group.media = materialize(group_entry.get("media"))
            local_group.data = group_entry.get("data") or {}
            local_group.pack_version = version
            local_group.content_hash = new_group_hash
            group_updated = True

        local_questions = {
            question.guid: question
            for question in (
                db.query(Question)
                .filter(Question.pack_guid == pack_guid)
                .all()
            )
        }

        added_guids = []
        updated_guids = []
        forked_guids = []
        seen_guids = set()

        for entry in question_entries:
            guid = entry.get("guid")
            seen_guids.add(guid)
            local = local_questions.get(guid)

            if local is None:
                db.add(Question(
                    guid=guid,
                    type_q=entry.get("type_q"),
                    question=entry.get("question"),
                    answer=entry.get("answer"),
                    media=materialize(entry.get("media")),
                    answer_media=materialize(entry.get("answer_media")),
                    tags=entry.get("tags") or [],
                    data=_materialize_data_media(entry.get("data") or {}, materialize),
                    group_id=local_group.id,
                    pack_guid=pack_guid,
                    pack_version=version,
                    content_hash=content_hash(entry, QUESTION_HASH_FIELDS)
                ))
                added_guids.append(guid)
                continue

            # Always check fork status first -- a row can be locally edited
            # in a version where upstream happens not to touch it, and that
            # must still be detected and reported (never overwritten either
            # way, but the caller should still know it diverged).
            if _is_row_forked(db, local, QUESTION_HASH_FIELDS, static_dir):
                forked_guids.append(guid)
                continue

            # Unforked and upstream didn't actually change this item -- leave
            # it untouched so "updated" only ever reports real changes.
            if content_hash(entry, QUESTION_HASH_FIELDS) == local.content_hash:
                continue

            local.type_q = entry.get("type_q")
            local.question = entry.get("question")
            local.answer = entry.get("answer")
            local.media = materialize(entry.get("media"))
            local.answer_media = materialize(entry.get("answer_media"))
            local.tags = entry.get("tags") or []
            local.data = _materialize_data_media(entry.get("data") or {}, materialize)
            local.pack_version = version
            local.content_hash = content_hash(entry, QUESTION_HASH_FIELDS)
            updated_guids.append(guid)

        removed_guids = [
            guid for guid in local_questions if guid not in seen_guids
        ]
        deleted_guids = []

        if delete_removed and removed_guids:
            removed_ids = [
                local_questions[guid].id for guid in removed_guids
            ]
            delete_question_dependents(db, removed_ids)
            db.query(Question).filter(
                Question.id.in_(removed_ids)
            ).delete(synchronize_session=False)
            deleted_guids = removed_guids

        subscription.installed_version = version
        subscription.updated_at = datetime.now(timezone.utc).isoformat()

        if source:
            subscription.source = str(source)

        db.commit()

    return {
        "status": "updated",
        "pack_guid": pack_guid,
        "version": version,
        "group_updated": group_updated,
        "added": added_guids,
        "updated": updated_guids,
        "forked": forked_guids,
        "removed": removed_guids,
        "deleted": deleted_guids
    }


def unsubscribe_pack(
    db,
    pack_guid,
    *,
    delete_content: bool = False,
    static_dir: Path | None = None,
    backup_dir: Path | None = None,
    database_file: Path | None = None
):
    """Stop tracking a pack subscription.

    delete_content=False (default, "keep as personal copy"): the group and
    its questions stay exactly as they are, only the bookkeeping that ties
    them to the pack is cleared (pack_guid/pack_version/
    content_hash -- a locally-owned row shouldn't claim a stale pack
    origin once nothing is tracking updates for it anymore). Progress and
    everything else is untouched.

    delete_content=True: deletes the group and everything in it, through the
    same pipeline as a normal group delete (delete_question_dependents +
    tombstones) -- scoped by group membership, not pack_guid, so a
    question the user added locally into a pack-derived group is
    deleted along with it too, exactly like any other group delete (this app
    has no concept of partial-group deletion). A backup is taken first,
    unconditionally: unsubscribing can delete a large pack's worth of
    review history in one action, more than a single question delete risks.
    """
    static_dir = static_dir or STATIC_DIR
    backup_dir = backup_dir or BACKUP_DIR
    database_file = database_file or DATABASE_FILE

    subscription = (
        db.query(PackSubscription)
        .filter(PackSubscription.pack_guid == pack_guid)
        .first()
    )

    if not subscription:
        raise ValueError("This pack is not installed")

    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.guid == pack_guid)
        .first()
    )

    if not delete_content:
        questions = (
            db.query(Question)
            .filter(Question.pack_guid == pack_guid)
            .all()
        )

        for question in questions:
            question.pack_guid = None
            question.pack_version = None
            question.content_hash = None

        if group:
            group.pack_guid = None
            group.pack_version = None
            group.content_hash = None

        db.delete(subscription)
        db.commit()

        return {
            "status": "kept",
            "pack_guid": pack_guid,
            "kept_questions": len(questions),
            "group_kept": group is not None
        }

    backup_result = create_backup(
        database_file=database_file,
        static_dir=static_dir,
        backup_dir=backup_dir,
        reason="unsubscribe",
        label=group.name if group else pack_guid
    )

    if group:
        question_rows = (
            db.query(
                Question.id,
                Question.media,
                Question.answer_media,
                Question.data
            )
            .filter(Question.group_id == group.id)
            .all()
        )
        question_ids = [row[0] for row in question_rows]
        media_values = [
            ref
            for row in question_rows
            for ref in question_media_refs(row[1], row[2], row[3])
        ]
        media_values.append(group.media)
    else:
        # Defensive: subscription exists but its group is already gone
        # (e.g. deleted through the ordinary group-delete endpoint). Fall
        # back to whatever still claims this pack's origin.
        question_ids = [
            question.id
            for question in (
                db.query(Question)
                .filter(Question.pack_guid == pack_guid)
                .all()
            )
        ]
        media_values = []

    if question_ids:
        delete_question_dependents(db, question_ids)
        db.query(Question).filter(
            Question.id.in_(question_ids)
        ).delete(synchronize_session=False)

    if group:
        record_tombstone(db, "question_group", group.guid)
        db.delete(group)

    db.delete(subscription)
    db.commit()

    for media in media_values:
        delete_unreferenced_media_file(db, media, static_dir=static_dir)

    return {
        "status": "deleted",
        "pack_guid": pack_guid,
        "deleted_questions": len(question_ids),
        "group_deleted": group is not None,
        "backup_path": str(backup_result.path)
    }
