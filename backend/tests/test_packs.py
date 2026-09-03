import hashlib
import io
import json
import tempfile
import unittest
import uuid
from datetime import date
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.services.packs as packs_service

from app.migrations import MIGRATIONS
from app.models import (
    Base,
    Collection,
    PackSubscription,
    MediaFile,
    Progress,
    Question,
    QuestionGroup
)
from app.routers.packs import (
    import_pack_zip,
    list_pack_subscriptions,
    unsubscribe_pack_subscription,
    update_pack_zip
)
from app.services.packs import (
    QUESTION_HASH_FIELDS,
    clone_installed_pack_as_variant_source,
    content_hash,
    export_pack,
    export_playlist_pack,
    import_pack,
    unsubscribe_pack,
    update_pack
)
from app.services.media import store_media_bytes
from app.services.progress import create_initial_progress, record_answer_history


SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>'
OTHER_SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>'


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class PackFixtureMixin:
    def make_static_dir(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        return Path(temp.name)

    def write_media(self, static_dir, filename, data):
        (static_dir / filename).write_bytes(data)
        return f"/static/{filename}"

    def build_source(self):
        db = make_db()
        static_dir = self.make_static_dir()

        group_media = self.write_media(static_dir, "map.svg", SVG_BYTES)
        group = QuestionGroup(
            type_group="map",
            name="Countries",
            media=group_media,
            data={"projection": "mercator"}
        )
        db.add(group)
        db.flush()

        answer_media = self.write_media(
            static_dir, "answer.svg", OTHER_SVG_BYTES
        )
        first = Question(
            type_q="map",
            question="Q1",
            answer="A1",
            media=group_media,
            answer_media=answer_media,
            tags=["europe"],
            data={"code": "fr", "aliases": ["france"]},
            group_id=group.id
        )
        second = Question(
            type_q="map",
            question="Q2",
            answer="A2",
            tags=[],
            data={"code": "de"},
            group_id=group.id
        )
        db.add_all([first, second])
        db.commit()

        return db, static_dir, group, first, second


class ExportPackTests(PackFixtureMixin, unittest.TestCase):
    def test_export_manifest_and_content_fields(self):
        db, static_dir, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()
        first.intake_order = 2
        second.intake_order = 1
        db.commit()

        zip_path = export_pack(
            db,
            group.id,
            version=1,
            name="Countries of the world",
            description="desc",
            license="CC0",
            static_dir=static_dir,
            pack_dir=pack_dir
        )

        self.assertTrue(zip_path.exists())

        with ZipFile(zip_path) as zip_file:
            manifest = json.loads(zip_file.read("manifest.json"))
            content = json.loads(zip_file.read("content.json"))
            names = zip_file.namelist()

        self.assertEqual(manifest["format"], 4)
        self.assertEqual(manifest["pack_guid"], group.guid)
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(manifest["name"], "Countries of the world")
        self.assertEqual(manifest["license"], "CC0")
        self.assertEqual(
            manifest["minimum_schema_version"], MIGRATIONS[-1].version
        )

        # A group source is a one-group pack of a single type.
        self.assertEqual(manifest["source_kind"], "group")
        self.assertEqual(manifest["type_group"], "map")
        self.assertEqual(manifest["group_count"], 1)

        self.assertEqual(len(content["groups"]), 1)
        group_entry = content["groups"][0]
        self.assertEqual(group_entry["guid"], group.guid)
        self.assertEqual(group_entry["type_group"], "map")
        self.assertEqual(group_entry["data"], {"projection": "mercator"})

        group_sha = hashlib.sha256(SVG_BYTES).hexdigest()
        answer_sha = hashlib.sha256(OTHER_SVG_BYTES).hexdigest()
        self.assertEqual(group_entry["media"], {"sha256": group_sha})

        # Every question names its owning group, so a multi-group pack can
        # place them without relying on ordering.
        self.assertEqual(
            {entry["group_guid"] for entry in content["questions"]},
            {group.guid}
        )

        questions_by_guid = {
            entry["guid"]: entry for entry in content["questions"]
        }
        self.assertEqual(len(questions_by_guid), 2)

        first_entry = questions_by_guid[first.guid]
        self.assertEqual(first_entry["question"], "Q1")
        self.assertNotIn("intake_order", first_entry)
        self.assertNotIn("intake_order", QUESTION_HASH_FIELDS)
        self.assertEqual(len(first_entry["tags"]), 1)
        tag_id = first_entry["tags"][0]
        self.assertEqual(str(uuid.UUID(tag_id)), tag_id)
        self.assertEqual(
            manifest["tag_hierarchy"]["nodes"][tag_id]["labels"]["fr"],
            "europe"
        )
        self.assertEqual(
            first_entry["data"], {"code": "fr", "aliases": ["france"]}
        )
        self.assertEqual(first_entry["media"], {"sha256": group_sha})
        self.assertEqual(first_entry["answer_media"], {"sha256": answer_sha})

        second_entry = questions_by_guid[second.guid]
        self.assertIsNone(second_entry["media"])
        self.assertIsNone(second_entry["answer_media"])

        # group.media and first.media are byte-identical -> written once.
        media_members = [name for name in names if name.startswith("media/")]
        self.assertEqual(len(media_members), 2)
        self.assertIn(f"media/{group_sha}.svg", media_members)
        self.assertIn(f"media/{answer_sha}.svg", media_members)

    def test_export_excludes_progress_entirely(self):
        db, static_dir, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()

        progress = create_initial_progress(first.id, today=date(2026, 1, 1))
        db.add(progress)
        record_answer_history(
            progress,
            2,
            {
                "last_review": date(2026, 1, 1),
                "next_review": date(2026, 1, 5),
                "stability": 3.2,
                "difficulty": 5.1,
                "reps": 1,
                "lapses": 0,
                "interval": 4
            }
        )
        db.commit()

        zip_path = export_pack(
            db,
            group.id,
            version=1,
            name="Pack",
            static_dir=static_dir,
            pack_dir=pack_dir
        )

        with ZipFile(zip_path) as zip_file:
            raw = zip_file.read("content.json").decode("utf-8")

        self.assertNotIn("stability", raw)
        self.assertNotIn("reps", raw)
        self.assertNotIn("progress", raw.lower())

    def test_export_missing_media_raises(self):
        db, static_dir, group, first, second = self.build_source()
        first.media = "/static/does-not-exist.svg"
        db.commit()

        with self.assertRaises(ValueError):
            export_pack(
                db,
                group.id,
                version=1,
                name="Pack",
                static_dir=static_dir,
                pack_dir=self.make_static_dir()
            )

    def test_export_passes_through_external_media(self):
        db = make_db()
        static_dir = self.make_static_dir()

        group = QuestionGroup(type_group="map", name="World")
        self.write_media(static_dir, "map.svg", SVG_BYTES)
        group.media = "/static/map.svg"
        db.add(group)
        db.flush()
        question = Question(
            type_q="map",
            question="Q1",
            media="https://example.com/photo.jpg",
            tags=[],
            data={},
            group_id=group.id
        )
        db.add(question)
        db.commit()

        zip_path = export_pack(
            db,
            group.id,
            version=1,
            name="World",
            static_dir=static_dir,
            pack_dir=self.make_static_dir()
        )

        with ZipFile(zip_path) as zip_file:
            content = json.loads(zip_file.read("content.json"))
            media_members = [
                name for name in zip_file.namelist()
                if name.startswith("media/")
            ]

        self.assertEqual(
            content["questions"][0]["media"],
            {"url": "https://example.com/photo.jpg"}
        )
        # External URL is never fetched -- only the group's real file is
        # staged into media/.
        self.assertEqual(len(media_members), 1)

    def test_import_passes_through_external_media(self):
        db = make_db()
        static_dir = self.make_static_dir()
        group = QuestionGroup(type_group="map", name="World")
        db.add(group)
        db.flush()
        question = Question(
            type_q="map",
            question="Q1",
            media="https://example.com/photo.jpg",
            tags=[],
            data={},
            group_id=group.id
        )
        db.add(question)
        db.commit()

        zip_path = export_pack(
            db,
            group.id,
            version=1,
            name="World",
            static_dir=static_dir,
            pack_dir=self.make_static_dir()
        )

        target_db = make_db()
        import_pack(
            target_db, zip_path, static_dir=self.make_static_dir()
        )

        imported_question = (
            target_db.query(Question)
            .filter(Question.guid == question.guid)
            .first()
        )
        self.assertEqual(
            imported_question.media, "https://example.com/photo.jpg"
        )

    def test_export_bare_filename_media_now_raises(self):
        # Bare filenames used to mean "built-in map asset shipped with the
        # frontend" -- that ambiguity was eliminated (migration 0016 + the
        # map editor no longer produces them). A bare filename left over is
        # now a genuine error, same as any other missing local file.
        db = make_db()
        group = QuestionGroup(type_group="map", name="World", media="world.svg")
        db.add(group)
        db.commit()

        with self.assertRaises(ValueError):
            export_pack(
                db,
                group.id,
                version=1,
                name="World",
                static_dir=self.make_static_dir(),
                pack_dir=self.make_static_dir()
            )

    def test_export_unknown_group_raises(self):
        db = make_db()

        with self.assertRaises(ValueError):
            export_pack(
                db,
                999,
                version=1,
                name="Pack",
                static_dir=self.make_static_dir(),
                pack_dir=self.make_static_dir()
            )


class ImportPackTests(PackFixtureMixin, unittest.TestCase):
    def export_zip(self, **overrides):
        db, static_dir, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()
        kwargs = {
            "version": 1,
            "name": "Countries of the world",
            "description": "desc",
            "license": "CC0",
            "static_dir": static_dir,
            "pack_dir": pack_dir
        }
        kwargs.update(overrides)

        zip_path = export_pack(db, group.id, **kwargs)

        return zip_path, db, group, first, second

    def test_round_trip_matches_source_and_skips_progress(self):
        zip_path, source_db, group, first, second = self.export_zip()

        target_db = make_db()
        target_static = self.make_static_dir()

        result = import_pack(
            target_db, zip_path, static_dir=target_static, source="pack.zip"
        )

        self.assertEqual(result["status"], "imported")
        self.assertEqual(result["pack_guid"], group.guid)
        self.assertEqual(result["questions_imported"], 2)

        imported_group = (
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .first()
        )
        self.assertIsNotNone(imported_group)
        self.assertEqual(imported_group.name, "Countries")
        self.assertEqual(imported_group.pack_guid, group.guid)
        self.assertEqual(imported_group.pack_version, 1)
        self.assertIsNotNone(imported_group.content_hash)
        self.assertTrue(
            Path(target_static / imported_group.media.replace(
                "/static/", ""
            )).exists()
        )

        imported_questions = {
            question.guid: question
            for question in target_db.query(Question)
            .filter(Question.group_id == imported_group.id)
            .all()
        }
        self.assertEqual(set(imported_questions), {first.guid, second.guid})

        imported_first = imported_questions[first.guid]
        self.assertEqual(imported_first.question, "Q1")
        self.assertEqual(len(imported_first.tags), 1)
        self.assertEqual(str(uuid.UUID(imported_first.tags[0])), imported_first.tags[0])
        self.assertEqual(imported_first.pack_version, 1)

        # content_hash is independently reproducible from the imported row.
        recomputed = content_hash(
            {
                "type_q": imported_first.type_q,
                "question": imported_first.question,
                "answer": imported_first.answer,
                "media": {"sha256": hashlib.sha256(SVG_BYTES).hexdigest()},
                "answer_media": {
                    "sha256": hashlib.sha256(OTHER_SVG_BYTES).hexdigest()
                },
                "tags": imported_first.tags,
                "data": imported_first.data
            },
            ("type_q", "question", "answer", "media", "answer_media", "tags", "data")
        )
        self.assertEqual(imported_first.content_hash, recomputed)

        # No Progress row for any imported question.
        progress_count = (
            target_db.query(Progress)
            .filter(
                Progress.question_id.in_(
                    q.id for q in imported_questions.values()
                )
            )
            .count()
        )
        self.assertEqual(progress_count, 0)

        subscription = (
            target_db.query(PackSubscription)
            .filter(PackSubscription.pack_guid == group.guid)
            .first()
        )
        self.assertIsNotNone(subscription)
        self.assertEqual(subscription.installed_version, 1)
        self.assertEqual(subscription.source, "pack.zip")

    def test_reimporting_same_pack_is_rejected(self):
        zip_path, source_db, group, first, second = self.export_zip()
        target_db = make_db()
        target_static = self.make_static_dir()

        import_pack(target_db, zip_path, static_dir=target_static)

        group_count = target_db.query(QuestionGroup).count()
        question_count = target_db.query(Question).count()
        subscription_count = target_db.query(PackSubscription).count()

        with self.assertRaises(ValueError):
            import_pack(target_db, zip_path, static_dir=target_static)

        # Rejected re-import must leave zero partial/duplicate writes.
        self.assertEqual(target_db.query(QuestionGroup).count(), group_count)
        self.assertEqual(target_db.query(Question).count(), question_count)
        self.assertEqual(
            target_db.query(PackSubscription).count(), subscription_count
        )

    def test_existing_group_guid_is_adopted_not_rejected(self):
        # A shared group guid means shared lineage, not a collision: the
        # receiver already has this group (typically from another pack that
        # ships it too), so the pack's questions join it rather than the
        # whole install failing.
        zip_path, source_db, group, first, second = self.export_zip()
        target_db = make_db()
        target_db.add(QuestionGroup(guid=group.guid, type_group="map", name="X"))
        target_db.commit()

        group_count = target_db.query(QuestionGroup).count()

        result = import_pack(
            target_db, zip_path, static_dir=self.make_static_dir()
        )

        self.assertEqual(result["status"], "imported")
        self.assertEqual(
            [entry["status"] for entry in result["groups"]], ["adopted"]
        )

        # Adopted, so no new group row and the existing one keeps its own
        # name and ownership -- this pack never claims a row it did not create.
        self.assertEqual(target_db.query(QuestionGroup).count(), group_count)
        adopted = (
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .one()
        )
        self.assertEqual(adopted.name, "X")
        self.assertIsNone(adopted.pack_guid)

        # The questions still land, attached to the adopted group.
        self.assertEqual(result["questions_imported"], 2)
        self.assertEqual(
            target_db.query(Question)
            .filter(Question.group_id == adopted.id)
            .count(),
            2
        )
        self.assertEqual(target_db.query(PackSubscription).count(), 1)

    def test_duplicate_question_guids_are_reported_as_conflicts(self):
        zip_path, source_db, group, first, second = self.export_zip()
        target_db = make_db()
        existing_group = QuestionGroup(
            guid=group.guid, type_group="map", name="X"
        )
        target_db.add(existing_group)
        target_db.flush()
        target_db.add(Question(
            guid=first.guid,
            type_q="map",
            question="already here",
            answer="a",
            group_id=existing_group.id
        ))
        target_db.commit()

        result = import_pack(
            target_db, zip_path, static_dir=self.make_static_dir()
        )

        # The duplicate is skipped rather than blowing up the whole install
        # on a unique-constraint violation.
        self.assertEqual(result["conflicts"], [first.guid])
        self.assertEqual(result["questions_imported"], 1)
        self.assertEqual(target_db.query(Question).count(), 2)

    def test_media_dedup_on_import_reuses_existing_file(self):
        zip_path, source_db, group, first, second = self.export_zip()
        target_db = make_db()
        target_static = self.make_static_dir()

        # Pre-seed target with byte-identical content under a different path.
        store_media_bytes(
            SVG_BYTES,
            filename="preexisting.svg",
            static_dir=target_static,
            db=target_db
        )
        before_count = target_db.query(MediaFile).count()

        import_pack(target_db, zip_path, static_dir=target_static)

        after_count = target_db.query(MediaFile).count()
        # Only the answer.svg (a genuinely new hash) should register a new row.
        self.assertEqual(after_count, before_count + 1)

    def test_rejects_non_zip_file(self):
        bogus = self.make_static_dir() / "not-a-zip.zip"
        bogus.write_text("nope", encoding="utf-8")

        with self.assertRaises(ValueError):
            import_pack(make_db(), bogus, static_dir=self.make_static_dir())

    def test_rejects_missing_manifest(self):
        archive = self.make_static_dir() / "empty.zip"

        with ZipFile(archive, "w", compression=ZIP_DEFLATED) as zip_file:
            zip_file.writestr("content.json", "{}")

        with self.assertRaises(ValueError):
            import_pack(
                make_db(), archive, static_dir=self.make_static_dir()
            )

    def test_rejects_newer_schema_requirement(self):
        archive = self.make_static_dir() / "future.zip"
        manifest = {
            "format": 1,
            "pack_guid": "some-guid",
            "version": 1,
            "name": "Pack",
            "minimum_schema_version": "9999"
        }
        content = {
            "group": {
                "guid": "some-guid",
                "type_group": "map",
                "name": "Pack",
                "media": None,
                "data": {}
            },
            "questions": []
        }

        with ZipFile(archive, "w", compression=ZIP_DEFLATED) as zip_file:
            zip_file.writestr("manifest.json", json.dumps(manifest))
            zip_file.writestr("content.json", json.dumps(content))

        with self.assertRaises(ValueError):
            import_pack(
                make_db(), archive, static_dir=self.make_static_dir()
            )


class UpdatePackTests(PackFixtureMixin, unittest.TestCase):
    def install_v1(self):
        # Source: group + two questions, exported as v1 and imported into a
        # fresh target database, simulating two separate installations.
        source_db, source_static, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()

        v1_zip = export_pack(
            source_db,
            group.id,
            version=1,
            name="Countries",
            static_dir=source_static,
            pack_dir=pack_dir
        )

        target_db = make_db()
        target_static = self.make_static_dir()
        import_pack(target_db, v1_zip, static_dir=target_static)

        return {
            "source_db": source_db,
            "source_static": source_static,
            "source_group": group,
            "source_first": first,
            "source_second": second,
            "pack_dir": pack_dir,
            "target_db": target_db,
            "target_static": target_static
        }

    def export_v2(self, ctx, **overrides):
        kwargs = {
            "version": 2,
            "name": "Countries",
            "static_dir": ctx["source_static"],
            "pack_dir": ctx["pack_dir"]
        }
        kwargs.update(overrides)

        return export_pack(
            ctx["source_db"], ctx["source_group"].id, **kwargs
        )

    def test_adds_new_and_updates_unchanged_items(self):
        ctx = self.install_v1()

        # Source changes: edit Q1's answer, add a brand-new Q3.
        ctx["source_first"].answer = "A1 corrected"
        third = Question(
            type_q="map",
            question="Q3",
            answer="A3",
            tags=[],
            data={"code": "es"},
            group_id=ctx["source_group"].id
        )
        ctx["source_db"].add(third)
        ctx["source_db"].commit()

        v2_zip = self.export_v2(ctx)

        result = update_pack(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )

        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["version"], 2)
        self.assertEqual(set(result["added"]), {third.guid})
        self.assertIn(ctx["source_first"].guid, result["updated"])
        self.assertEqual(result["forked"], [])
        self.assertEqual(result["removed"], [])

        updated_first = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == ctx["source_first"].guid)
            .first()
        )
        self.assertEqual(updated_first.answer, "A1 corrected")
        self.assertEqual(updated_first.pack_version, 2)

        added_third = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == third.guid)
            .first()
        )
        self.assertIsNotNone(added_third)
        self.assertEqual(added_third.answer, "A3")
        self.assertIsNone(
            ctx["target_db"].query(Progress)
            .filter(Progress.question_id == added_third.id)
            .first()
        )

        subscription = (
            ctx["target_db"].query(PackSubscription)
            .filter(
                PackSubscription.pack_guid
                == ctx["source_group"].guid
            )
            .first()
        )
        self.assertEqual(subscription.installed_version, 2)
        self.assertIsNotNone(subscription.updated_at)

    def test_locally_edited_item_is_left_alone(self):
        ctx = self.install_v1()

        # User edits Q1 locally on the target before the update lands.
        local_first = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == ctx["source_first"].guid)
            .first()
        )
        local_first.answer = "my own answer"
        ctx["target_db"].commit()

        # Source also changes Q1 -- but since the target forked, the update
        # must not overwrite the local edit.
        ctx["source_first"].answer = "upstream answer"
        ctx["source_db"].commit()

        v2_zip = self.export_v2(ctx)
        result = update_pack(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )

        self.assertEqual(result["forked"], [ctx["source_first"].guid])
        self.assertEqual(result["updated"], [])

        untouched = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == ctx["source_first"].guid)
            .first()
        )
        self.assertEqual(untouched.answer, "my own answer")
        # Forked rows keep their old bookkeeping -- never silently advanced.
        self.assertEqual(untouched.pack_version, 1)

    def test_forked_item_is_reported_even_if_upstream_did_not_change_it(self):
        # Regression: a row can be locally edited in a version where
        # upstream happens not to touch that particular item. It must still
        # be protected (never overwritten) AND still show up in "forked" --
        # not silently skipped just because the incoming content is
        # byte-identical to what was last synced.
        ctx = self.install_v1()

        local_second = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == ctx["source_second"].guid)
            .first()
        )
        local_second.answer = "my local edit"
        ctx["target_db"].commit()

        # Source changes Q1 only; Q2 (second) is untouched upstream.
        ctx["source_first"].answer = "upstream change"
        ctx["source_db"].commit()

        v2_zip = self.export_v2(ctx)
        result = update_pack(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )

        self.assertEqual(result["forked"], [ctx["source_second"].guid])
        self.assertEqual(result["updated"], [ctx["source_first"].guid])

        untouched = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == ctx["source_second"].guid)
            .first()
        )
        self.assertEqual(untouched.answer, "my local edit")

    def test_removed_item_is_reported_then_deleted_on_confirm(self):
        ctx = self.install_v1()

        second_guid = ctx["source_second"].guid
        ctx["source_db"].delete(ctx["source_second"])
        ctx["source_db"].commit()

        v2_zip = self.export_v2(ctx)

        preview = update_pack(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )
        self.assertEqual(preview["removed"], [second_guid])
        self.assertEqual(preview["deleted"], [])

        # Not deleted yet -- still present locally.
        still_present = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == second_guid)
            .first()
        )
        self.assertIsNotNone(still_present)

        confirm = update_pack(
            ctx["target_db"],
            v2_zip,
            static_dir=ctx["target_static"],
            delete_removed=True
        )
        self.assertEqual(confirm["removed"], [second_guid])
        self.assertEqual(confirm["deleted"], [second_guid])

        gone = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == second_guid)
            .first()
        )
        self.assertIsNone(gone)

    def test_forked_group_media_and_fields_are_not_overwritten(self):
        ctx = self.install_v1()

        local_group = (
            ctx["target_db"].query(QuestionGroup)
            .filter(QuestionGroup.guid == ctx["source_group"].guid)
            .first()
        )
        local_group.name = "My Renamed Countries"
        ctx["target_db"].commit()

        ctx["source_group"].name = "Countries v2"
        ctx["source_db"].commit()

        v2_zip = self.export_v2(ctx, name="Countries v2")
        result = update_pack(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )

        self.assertFalse(result["group_updated"])

        untouched_group = (
            ctx["target_db"].query(QuestionGroup)
            .filter(QuestionGroup.guid == ctx["source_group"].guid)
            .first()
        )
        self.assertEqual(untouched_group.name, "My Renamed Countries")

    def test_rejects_update_for_uninstalled_pack(self):
        ctx = self.install_v1()
        v2_zip = self.export_v2(ctx)

        with self.assertRaises(ValueError):
            update_pack(
                make_db(), v2_zip, static_dir=self.make_static_dir()
            )

    def test_rejects_older_version_than_installed(self):
        ctx = self.install_v1()

        with self.assertRaises(ValueError):
            update_pack(
                ctx["target_db"],
                self.export_v2(ctx, version=0),
                static_dir=ctx["target_static"]
            )

    def test_repeated_call_with_same_version_is_idempotent(self):
        ctx = self.install_v1()
        ctx["source_first"].answer = "A1 corrected"
        ctx["source_db"].commit()

        v2_zip = self.export_v2(ctx)
        first_call = update_pack(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )
        second_call = update_pack(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )

        self.assertEqual(first_call["updated"], [ctx["source_first"].guid])
        # Second call: content already matches, nothing left to touch.
        self.assertEqual(second_call["updated"], [])
        self.assertEqual(second_call["added"], [])
        self.assertEqual(second_call["forked"], [])

        # Still exactly the two original questions -- nothing duplicated.
        self.assertEqual(ctx["target_db"].query(Question).count(), 2)
        updated_first = (
            ctx["target_db"].query(Question)
            .filter(Question.guid == ctx["source_first"].guid)
            .first()
        )
        self.assertEqual(updated_first.answer, "A1 corrected")


class UnsubscribePackTests(PackFixtureMixin, unittest.TestCase):
    def make_file_db(self):
        # The delete_content=True path takes a real backup, which snapshots
        # a real sqlite file -- an in-memory db has nothing to snapshot.
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        db_path = Path(temp.name) / "target.db"
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(engine)

        return sessionmaker(bind=engine)(), db_path

    def install_v1(self, target_db):
        source_db, source_static, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()
        target_static = self.make_static_dir()

        v1_zip = export_pack(
            source_db,
            group.id,
            version=1,
            name="Countries",
            static_dir=source_static,
            pack_dir=pack_dir
        )
        import_pack(target_db, v1_zip, static_dir=target_static)

        return group, first, second, target_static

    def test_keep_clears_bookkeeping_and_preserves_content(self):
        target_db = make_db()
        group, first, second, target_static = self.install_v1(target_db)

        result = unsubscribe_pack(
            target_db, group.guid, delete_content=False
        )

        self.assertEqual(result["status"], "kept")
        self.assertEqual(result["kept_questions"], 2)

        self.assertIsNone(
            target_db.query(PackSubscription)
            .filter(PackSubscription.pack_guid == group.guid)
            .first()
        )

        kept_group = (
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .first()
        )
        self.assertIsNotNone(kept_group)
        self.assertEqual(kept_group.name, "Countries")
        self.assertIsNone(kept_group.pack_guid)
        self.assertIsNone(kept_group.pack_version)
        self.assertIsNone(kept_group.content_hash)

        kept_questions = (
            target_db.query(Question)
            .filter(Question.group_id == kept_group.id)
            .all()
        )
        self.assertEqual(len(kept_questions), 2)
        for question in kept_questions:
            self.assertIsNone(question.pack_guid)
            self.assertIsNone(question.pack_version)
            self.assertIsNone(question.content_hash)
        self.assertEqual(
            {question.question for question in kept_questions}, {"Q1", "Q2"}
        )

    def test_delete_removes_group_questions_progress_and_backs_up_first(self):
        target_db, target_db_path = self.make_file_db()
        group, first, second, target_static = self.install_v1(target_db)
        backup_dir = self.make_static_dir()

        first_local = (
            target_db.query(Question)
            .filter(Question.guid == first.guid)
            .first()
        )
        first_local_id = first_local.id
        progress = create_initial_progress(first_local_id, today=date(2026, 1, 1))
        target_db.add(progress)
        target_db.commit()

        result = unsubscribe_pack(
            target_db,
            group.guid,
            delete_content=True,
            static_dir=target_static,
            backup_dir=backup_dir,
            database_file=target_db_path
        )

        self.assertEqual(result["status"], "deleted")
        self.assertEqual(result["deleted_questions"], 2)
        self.assertTrue(result["group_deleted"])
        self.assertTrue(Path(result["backup_path"]).exists())

        self.assertIsNone(
            target_db.query(PackSubscription)
            .filter(PackSubscription.pack_guid == group.guid)
            .first()
        )
        self.assertIsNone(
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .first()
        )
        self.assertEqual(
            target_db.query(Question)
            .filter(Question.guid.in_([first.guid, second.guid]))
            .count(),
            0
        )
        self.assertIsNone(
            target_db.query(Progress)
            .filter(Progress.question_id == first_local_id)
            .first()
        )

    def test_delete_also_removes_locally_added_question_in_same_group(self):
        # Deletion is scoped by group membership, matching how the ordinary
        # group-delete endpoint behaves everywhere else in this app -- there
        # is no partial-group-deletion concept.
        target_db, target_db_path = self.make_file_db()
        group, first, second, target_static = self.install_v1(target_db)

        local_group = (
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .first()
        )
        extra = Question(
            type_q="map",
            question="Locally added",
            tags=[],
            data={},
            group_id=local_group.id
        )
        target_db.add(extra)
        target_db.commit()
        extra_guid = extra.guid

        unsubscribe_pack(
            target_db,
            group.guid,
            delete_content=True,
            static_dir=target_static,
            backup_dir=self.make_static_dir(),
            database_file=target_db_path
        )

        self.assertIsNone(
            target_db.query(Question)
            .filter(Question.guid == extra_guid)
            .first()
        )

    def test_rejects_unsubscribe_for_uninstalled_pack(self):
        with self.assertRaises(ValueError):
            unsubscribe_pack(make_db(), "not-a-real-guid")


class PackRouterTests(PackFixtureMixin, unittest.TestCase):
    def test_import_endpoint_round_trips_upload(self):
        db, static_dir, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()

        zip_path = export_pack(
            db,
            group.id,
            version=1,
            name="Pack",
            static_dir=static_dir,
            pack_dir=pack_dir
        )

        target_db = make_db()
        target_static = self.make_static_dir()
        upload = UploadFile(
            file=io.BytesIO(zip_path.read_bytes()),
            filename="pack.zip"
        )

        # The router doesn't take a static_dir param (by design -- it always
        # targets the live app data). Redirect it to a throwaway dir so this
        # test cannot write into the real static/ folder.
        with patch.object(packs_service, "STATIC_DIR", target_static):
            result = import_pack_zip(file=upload, db=target_db)

        self.assertEqual(result["status"], "imported")

    def test_import_endpoint_rejects_non_zip_upload(self):
        target_db = make_db()
        upload = UploadFile(file=io.BytesIO(b"not a zip"), filename="junk.zip")

        with self.assertRaises(HTTPException) as caught:
            import_pack_zip(file=upload, db=target_db)

        self.assertEqual(caught.exception.status_code, 400)

    def test_update_endpoint_round_trips_upload(self):
        source_db, source_static, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()

        v1_zip = export_pack(
            source_db, group.id, version=1, name="Pack",
            static_dir=source_static, pack_dir=pack_dir
        )

        target_db = make_db()
        target_static = self.make_static_dir()

        with patch.object(packs_service, "STATIC_DIR", target_static):
            import_pack_zip(
                file=UploadFile(
                    file=io.BytesIO(v1_zip.read_bytes()), filename="pack.zip"
                ),
                db=target_db
            )

        first.answer = "corrected"
        source_db.commit()
        v2_zip = export_pack(
            source_db, group.id, version=2, name="Pack",
            static_dir=source_static, pack_dir=pack_dir
        )

        with patch.object(packs_service, "STATIC_DIR", target_static):
            result = update_pack_zip(
                file=UploadFile(
                    file=io.BytesIO(v2_zip.read_bytes()), filename="pack.zip"
                ),
                db=target_db
            )

        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["updated"], [first.guid])

    def test_update_endpoint_rejects_uninstalled_pack(self):
        source_db, source_static, group, first, second = self.build_source()
        v1_zip = export_pack(
            source_db, group.id, version=1, name="Pack",
            static_dir=source_static, pack_dir=self.make_static_dir()
        )
        target_db = make_db()
        target_static = self.make_static_dir()

        with patch.object(packs_service, "STATIC_DIR", target_static):
            with self.assertRaises(HTTPException) as caught:
                update_pack_zip(
                    file=UploadFile(
                        file=io.BytesIO(v1_zip.read_bytes()),
                        filename="pack.zip"
                    ),
                    db=target_db
                )

        self.assertEqual(caught.exception.status_code, 400)

    def test_unsubscribe_endpoint_keep_mode_round_trips(self):
        # Keep-mode never touches STATIC_DIR/BACKUP_DIR/DATABASE_FILE (no
        # media or backup involved), so this is safe to call through the
        # router as-is, unlike the delete path.
        source_db, source_static, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()
        v1_zip = export_pack(
            source_db, group.id, version=1, name="Pack",
            static_dir=source_static, pack_dir=pack_dir
        )

        target_db = make_db()
        target_static = self.make_static_dir()

        with patch.object(packs_service, "STATIC_DIR", target_static):
            import_pack_zip(
                file=UploadFile(
                    file=io.BytesIO(v1_zip.read_bytes()), filename="pack.zip"
                ),
                db=target_db
            )

        result = unsubscribe_pack_subscription(
            group.guid, delete_content=False, db=target_db
        )

        self.assertEqual(result["status"], "kept")

    def test_unsubscribe_endpoint_rejects_uninstalled_pack(self):
        with self.assertRaises(HTTPException) as caught:
            unsubscribe_pack_subscription(
                "not-a-real-guid", delete_content=False, db=make_db()
            )

        self.assertEqual(caught.exception.status_code, 400)

    def test_list_endpoint_empty_and_populated(self):
        db = make_db()
        self.assertEqual(list_pack_subscriptions(db=db), [])

        source_db, source_static, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()
        zip_path = export_pack(
            source_db, group.id, version=1, name="Pack",
            static_dir=source_static, pack_dir=pack_dir
        )
        import_pack(db, zip_path, static_dir=self.make_static_dir())

        rows = list_pack_subscriptions(db=db)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["pack_guid"], group.guid)
        self.assertEqual(rows[0]["installed_version"], 1)
        self.assertEqual(rows[0]["name"], "Pack")
        self.assertIsNotNone(rows[0]["subscribed_at"])
        self.assertIsNone(rows[0]["updated_at"])


def rewrite_as_format_1(source_zip, dest_zip):
    """Rebuild a pack zip in the retired format 1 layout.

    Format 1 carried a single "group" and no group_guid on questions. Real
    users have such packs installed and the live catalog still serves them,
    so they are rebuilt here rather than assumed away.
    """
    with ZipFile(source_zip) as source:
        manifest = json.loads(source.read("manifest.json"))
        content = json.loads(source.read("content.json"))
        blobs = {
            name: source.read(name)
            for name in source.namelist()
            if name.startswith("media/")
        }

    manifest["format"] = 1

    for key in ("source_kind", "type_group", "group_count"):
        manifest.pop(key, None)

    downgraded = {
        "group": content["groups"][0],
        "questions": [
            {
                key: value
                for key, value in entry.items()
                if key != "group_guid"
            }
            for entry in content["questions"]
        ]
    }

    with ZipFile(dest_zip, "w", compression=ZIP_DEFLATED) as out:
        out.writestr(
            "manifest.json", json.dumps(manifest, indent=2, sort_keys=True)
        )
        out.writestr(
            "content.json", json.dumps(downgraded, indent=2, sort_keys=True)
        )

        for name, blob in blobs.items():
            out.writestr(name, blob)

    return dest_zip


class PackFormatV1CompatTests(PackFixtureMixin, unittest.TestCase):
    def make_v1_zip(self, version=1):
        db, static_dir, group, first, second = self.build_source()
        pack_dir = self.make_static_dir()
        v2_zip = export_pack(
            db,
            group.id,
            version=version,
            name="Countries",
            static_dir=static_dir,
            pack_dir=pack_dir
        )
        v1_zip = rewrite_as_format_1(
            v2_zip, pack_dir / f"legacy-v{version}.zip"
        )

        return db, static_dir, pack_dir, group, first, second, v1_zip

    def test_format_1_pack_still_installs(self):
        _, _, _, group, first, second, v1_zip = self.make_v1_zip()
        target_db = make_db()

        result = import_pack(
            target_db, v1_zip, static_dir=self.make_static_dir()
        )

        self.assertEqual(result["status"], "imported")
        self.assertEqual(result["questions_imported"], 2)
        self.assertEqual(
            [entry["status"] for entry in result["groups"]], ["created"]
        )

        imported = (
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .one()
        )
        self.assertEqual(imported.type_group, "map")
        self.assertEqual(imported.pack_guid, group.guid)
        self.assertEqual(
            target_db.query(Question)
            .filter(Question.group_id == imported.id)
            .count(),
            2
        )

    def test_v1_install_updates_from_v2_zip_without_spurious_changes(self):
        # The load-bearing regression: adding group_guid to question entries
        # must not perturb content_hash, or every already-installed pack
        # would report its entire contents as "updated" on the next update.
        db, static_dir, pack_dir, group, first, second, v1_zip = (
            self.make_v1_zip(version=1)
        )
        target_db = make_db()
        target_static = self.make_static_dir()
        import_pack(target_db, v1_zip, static_dir=target_static)

        # Same content, exported fresh as format 2 at a higher version.
        v2_zip = export_pack(
            db,
            group.id,
            version=2,
            name="Countries",
            static_dir=static_dir,
            pack_dir=pack_dir
        )

        result = update_pack(target_db, v2_zip, static_dir=target_static)

        self.assertEqual(result["version"], 2)
        self.assertEqual(result["added"], [])
        self.assertEqual(result["updated"], [])
        self.assertEqual(result["forked"], [])
        self.assertEqual(result["removed"], [])
        self.assertFalse(result["group_updated"])
        self.assertEqual(result["groups_added"], [])
        self.assertEqual(result["groups_forked"], [])

    def test_unsupported_format_is_still_rejected(self):
        # Widening to a tuple of supported formats must not turn the check
        # into "accept anything" -- a future format still has to fail loudly.
        _, _, pack_dir, _, _, _, v1_zip = self.make_v1_zip()

        with ZipFile(v1_zip) as source:
            manifest = json.loads(source.read("manifest.json"))
            content = source.read("content.json")

        manifest["format"] = 99

        future_zip = pack_dir / "future-99.zip"

        with ZipFile(future_zip, "w", compression=ZIP_DEFLATED) as out:
            out.writestr("manifest.json", json.dumps(manifest))
            out.writestr("content.json", content)

        with self.assertRaises(ValueError):
            import_pack(
                make_db(), future_zip, static_dir=self.make_static_dir()
            )


class PackVariantSourceCloneTests(PackFixtureMixin, unittest.TestCase):
    def build_installed_single_group_pack(self):
        db = make_db()
        static_dir = self.make_static_dir()
        media = self.write_media(static_dir, "map.svg", SVG_BYTES)
        base_guid = "base-pack-guid"
        group = QuestionGroup(
            guid=base_guid,
            type_group="map",
            name="Countries",
            media=media,
            data={"projection": "mercator"},
            pack_guid=base_guid,
            pack_version=2,
            content_hash="group-hash"
        )
        db.add(group)
        db.flush()
        question = Question(
            guid="base-question-guid",
            type_q="map",
            question="France",
            answer="Paris",
            media=media,
            tags=["europe"],
            data={"code": "fr", "aliases": ["France"]},
            group_id=group.id,
            pack_guid=base_guid,
            pack_version=2,
            content_hash="question-hash"
        )
        db.add(question)
        db.flush()
        db.add(create_initial_progress(question.id, today=date(2026, 1, 1)))
        db.add(PackSubscription(
            pack_guid=base_guid,
            installed_version=2,
            name="Countries",
            source="base.zip",
            subscribed_at="2026-08-01T10:00:00Z"
        ))
        db.commit()

        return db, static_dir, base_guid, group, question

    def test_single_group_clone_uses_fresh_identities_and_no_progress(self):
        db, _static_dir, base_guid, group, question = (
            self.build_installed_single_group_pack()
        )

        result = clone_installed_pack_as_variant_source(db, base_guid)

        self.assertEqual(result["source_kind"], "group")
        self.assertEqual(result["variant_of_pack_guid"], base_guid)
        self.assertEqual(result["base_pack_name"], "Countries")

        cloned_group = db.query(QuestionGroup).get(result["source_id"])
        self.assertIsNotNone(cloned_group)
        self.assertNotEqual(cloned_group.guid, group.guid)
        self.assertIsNone(cloned_group.pack_guid)
        self.assertIsNone(cloned_group.pack_version)
        self.assertIsNone(cloned_group.content_hash)
        self.assertEqual(cloned_group.name, "Countries - variante")
        self.assertEqual(cloned_group.media, group.media)
        self.assertEqual(cloned_group.data, group.data)

        cloned_question = (
            db.query(Question)
            .filter(Question.group_id == cloned_group.id)
            .one()
        )
        self.assertNotEqual(cloned_question.guid, question.guid)
        self.assertEqual(cloned_question.question, question.question)
        self.assertEqual(cloned_question.tags, question.tags)
        self.assertEqual(cloned_question.data, question.data)
        self.assertIsNone(cloned_question.pack_guid)
        self.assertIsNone(cloned_question.pack_version)
        self.assertIsNone(cloned_question.content_hash)
        self.assertFalse(cloned_question.suspended)
        self.assertIsNone(
            db.query(Progress)
            .filter(Progress.question_id == cloned_question.id)
            .first()
        )
        self.assertEqual(
            db.query(Progress)
            .filter(Progress.question_id == question.id)
            .count(),
            1
        )

    def test_single_group_variant_exports_and_imports_next_to_original(self):
        db, static_dir, base_guid, group, question = (
            self.build_installed_single_group_pack()
        )
        result = clone_installed_pack_as_variant_source(db, base_guid)
        cloned_group = db.query(QuestionGroup).get(result["source_id"])
        variant_zip = export_pack(
            db,
            cloned_group.id,
            version=1,
            name="Countries variant",
            static_dir=static_dir,
            pack_dir=self.make_static_dir()
        )

        target_db = make_db()
        target_group = QuestionGroup(
            guid=group.guid,
            type_group=group.type_group,
            name=group.name,
            media=group.media,
            data=group.data,
            pack_guid=base_guid,
            pack_version=2,
            content_hash="group-hash"
        )
        target_db.add(target_group)
        target_db.flush()
        target_db.add(Question(
            guid=question.guid,
            type_q=question.type_q,
            question=question.question,
            answer=question.answer,
            media=question.media,
            tags=question.tags,
            data=question.data,
            group_id=target_group.id,
            pack_guid=base_guid,
            pack_version=2,
            content_hash="question-hash"
        ))
        target_db.add(PackSubscription(
            pack_guid=base_guid,
            installed_version=2,
            name="Countries",
            source="base.zip",
            subscribed_at="2026-08-01T10:00:00Z"
        ))
        target_db.commit()

        import_result = import_pack(
            target_db,
            variant_zip,
            static_dir=static_dir,
            source="variant.zip"
        )

        self.assertEqual(import_result["questions_imported"], 1)
        self.assertEqual(target_db.query(PackSubscription).count(), 2)
        self.assertEqual(target_db.query(QuestionGroup).count(), 2)
        self.assertEqual(target_db.query(Question).count(), 2)

    def test_multi_group_clone_creates_playlist_source(self):
        db = make_db()
        base_guid = "mixed-pack-guid"
        map_group = QuestionGroup(
            guid="map-group-guid",
            type_group="map",
            name="Cartes",
            media="/static/map.svg",
            data={"projection": "mercator"},
            pack_guid=base_guid,
            pack_version=1,
            content_hash="map-group-hash"
        )
        text_group = QuestionGroup(
            guid="text-group-guid",
            type_group="text",
            name="Questions",
            data={},
            pack_guid=base_guid,
            pack_version=1,
            content_hash="text-group-hash"
        )
        db.add_all([map_group, text_group])
        db.flush()
        map_question = Question(
            guid="map-question-guid",
            type_q="map",
            question="France",
            answer="FR",
            tags=["geo"],
            data={"code": "fr"},
            group_id=map_group.id,
            pack_guid=base_guid,
            pack_version=1,
            content_hash="map-question-hash"
        )
        text_question = Question(
            guid="text-question-guid",
            type_q="text",
            question="Capitale ?",
            answer="Paris",
            tags=["geo"],
            data={},
            group_id=text_group.id,
            pack_guid=base_guid,
            pack_version=1,
            content_hash="text-question-hash"
        )
        numeric_question = Question(
            guid="numeric-question-guid",
            type_q="numeric",
            question="2 + 2",
            answer="4",
            tags=["math"],
            data={"numeric": {"value": "4"}},
            pack_guid=base_guid,
            pack_version=1,
            content_hash="numeric-question-hash"
        )
        db.add_all([map_question, text_question, numeric_question])
        db.add(PackSubscription(
            pack_guid=base_guid,
            installed_version=1,
            name="Pack mixte",
            source="mixed.zip",
            subscribed_at="2026-08-01T10:00:00Z"
        ))
        db.commit()

        result = clone_installed_pack_as_variant_source(db, base_guid)

        self.assertEqual(result["source_kind"], "playlist")
        self.assertEqual(result["question_count"], 3)
        self.assertEqual(result["group_count"], 2)
        collection = db.query(Collection).get(result["source_id"])
        self.assertIsNotNone(collection)
        self.assertEqual(len(collection.questions), 3)
        self.assertNotEqual(collection.guid, base_guid)

        cloned_questions = sorted(collection.questions, key=lambda item: item.question)
        self.assertTrue(all(question.pack_guid is None for question in cloned_questions))
        self.assertEqual(
            {question.question for question in cloned_questions},
            {"2 + 2", "Capitale ?", "France"}
        )
        cloned_groups = db.query(QuestionGroup).filter(
            QuestionGroup.pack_guid.is_(None)
        ).all()
        self.assertEqual(len(cloned_groups), 2)
        self.assertEqual(
            {group.guid for group in cloned_groups}
            & {"map-group-guid", "text-group-guid"},
            set()
        )


class PlaylistPackTests(PackFixtureMixin, unittest.TestCase):
    def test_numeric_only_playlist_round_trips_without_a_group(self):
        db = make_db()
        numeric = Question(
            type_q="numeric",
            question="Distance Terre-Lune ?",
            answer="384 400 km",
            tags=[],
            data={"numeric": {
                "value": "384400",
                "unit": "km",
                "display_precision": 0,
                "relative_tolerance": "0.1",
                "zero_absolute_tolerance": None,
            }},
        )
        playlist = Collection(name="Mesures", data={}, questions=[numeric])
        db.add(playlist)
        db.commit()

        zip_path = export_playlist_pack(
            db,
            playlist.id,
            version=1,
            name="Mesures",
            static_dir=self.make_static_dir(),
            pack_dir=self.make_static_dir(),
        )
        with ZipFile(zip_path) as zip_file:
            content = json.loads(zip_file.read("content.json"))
        self.assertEqual(content["groups"], [])
        self.assertIsNone(content["questions"][0]["group_guid"])

        target = make_db()
        result = import_pack(target, zip_path, static_dir=self.make_static_dir())
        imported = target.query(Question).one()
        self.assertEqual(result["group_id"], None)
        self.assertEqual(imported.type_q, "numeric")
        self.assertIsNone(imported.group_id)
        self.assertEqual(imported.data["numeric"]["value"], "384400")

    def build_playlist_source(self):
        """A playlist spanning a map group and a text group.

        This is the case a single group cannot express -- type_group is
        immutable, so mixed content is exactly why format 2 exists.
        """
        db = make_db()
        static_dir = self.make_static_dir()

        map_media = self.write_media(static_dir, "flags.svg", SVG_BYTES)
        map_group = QuestionGroup(
            type_group="map",
            name="Drapeaux du monde",
            media=map_media,
            data={"projection": "mercator"}
        )
        text_group = QuestionGroup(
            type_group="text", name="Geographie", data={}
        )
        db.add_all([map_group, text_group])
        db.flush()

        picked_map = Question(
            type_q="map",
            question="Drapeau du Bresil",
            answer="BR",
            media=map_media,
            tags=["drapeaux"],
            data={},
            group_id=map_group.id
        )
        left_out = Question(
            type_q="map",
            question="Drapeau du Perou",
            answer="PE",
            tags=["drapeaux"],
            data={},
            group_id=map_group.id
        )
        picked_text = Question(
            type_q="text",
            question="Capitale du Bresil",
            answer="Brasilia",
            tags=["drapeaux"],
            data={},
            group_id=text_group.id
        )
        db.add_all([picked_map, left_out, picked_text])
        db.flush()

        playlist = Collection(
            name="Drapeaux mix",
            data={},
            questions=[picked_map, picked_text]
        )
        db.add(playlist)
        db.commit()

        return (
            db, static_dir, playlist, map_group, text_group,
            picked_map, left_out, picked_text
        )

    def test_mixed_playlist_exports_every_contributing_group(self):
        (
            db, static_dir, playlist, map_group, text_group,
            picked_map, left_out, picked_text
        ) = self.build_playlist_source()

        zip_path = export_playlist_pack(
            db,
            playlist.id,
            version=1,
            name="Drapeaux mix",
            static_dir=static_dir,
            pack_dir=self.make_static_dir()
        )

        with ZipFile(zip_path) as zip_file:
            manifest = json.loads(zip_file.read("manifest.json"))
            content = json.loads(zip_file.read("content.json"))
            names = zip_file.namelist()

        self.assertEqual(manifest["pack_guid"], playlist.guid)
        self.assertEqual(manifest["source_kind"], "playlist")
        self.assertEqual(manifest["group_count"], 2)
        # Not a dominant type: the installer really does receive both.
        self.assertEqual(manifest["type_group"], "mixed")

        self.assertEqual(
            {entry["type_group"] for entry in content["groups"]},
            {"map", "text"}
        )

        # Only the playlist's own questions travel...
        self.assertEqual(
            {entry["question"] for entry in content["questions"]},
            {"Drapeau du Bresil", "Capitale du Bresil"}
        )

        # ...but the map group still ships its SVG, or its questions would
        # arrive unrenderable.
        groups_by_type = {
            entry["type_group"]: entry for entry in content["groups"]
        }
        group_sha = hashlib.sha256(SVG_BYTES).hexdigest()
        self.assertEqual(
            groups_by_type["map"]["media"], {"sha256": group_sha}
        )
        self.assertEqual(
            groups_by_type["map"]["data"], {"projection": "mercator"}
        )
        self.assertIn(f"media/{group_sha}.svg", names)

    def test_mixed_playlist_round_trips_into_a_fresh_database(self):
        (
            db, static_dir, playlist, map_group, text_group,
            picked_map, left_out, picked_text
        ) = self.build_playlist_source()

        zip_path = export_playlist_pack(
            db,
            playlist.id,
            version=1,
            name="Drapeaux mix",
            static_dir=static_dir,
            pack_dir=self.make_static_dir()
        )

        target_db = make_db()
        target_static = self.make_static_dir()
        result = import_pack(target_db, zip_path, static_dir=target_static)

        self.assertEqual(result["questions_imported"], 2)
        self.assertEqual(len(result["groups"]), 2)
        self.assertEqual(
            {entry["status"] for entry in result["groups"]}, {"created"}
        )

        groups = {
            group.type_group: group
            for group in target_db.query(QuestionGroup).all()
        }
        self.assertEqual(set(groups), {"map", "text"})

        # Both groups are stamped with the playlist's guid -- that stamp,
        # not guid equality, is what ties them to the subscription.
        for group in groups.values():
            self.assertEqual(group.pack_guid, playlist.guid)

        self.assertEqual(groups["map"].name, "Drapeaux du monde")
        self.assertEqual(
            groups["map"].data, {"projection": "mercator"}
        )

        # The excluded question stayed behind.
        self.assertEqual(target_db.query(Question).count(), 2)
        self.assertEqual(
            target_db.query(Question)
            .filter(Question.group_id == groups["text"].id)
            .one()
            .question,
            "Capitale du Bresil"
        )

        # The map SVG was materialized on the receiving side.
        imported_media = groups["map"].media
        self.assertTrue(imported_media)
        self.assertTrue(
            (target_static / Path(imported_media).name).exists()
        )

    def test_unsubscribing_a_playlist_pack_removes_all_its_groups(self):
        (
            db, static_dir, playlist, map_group, text_group,
            picked_map, left_out, picked_text
        ) = self.build_playlist_source()

        zip_path = export_playlist_pack(
            db,
            playlist.id,
            version=1,
            name="Drapeaux mix",
            static_dir=static_dir,
            pack_dir=self.make_static_dir()
        )
        target_db = make_db()
        target_static = self.make_static_dir()
        import_pack(target_db, zip_path, static_dir=target_static)

        result = unsubscribe_pack(
            target_db,
            playlist.guid,
            delete_content=True,
            static_dir=target_static,
            backup_dir=self.make_static_dir(),
            database_file=target_static / "app.db"
        )

        self.assertEqual(result["deleted_questions"], 2)
        self.assertEqual(len(result["groups_deleted"]), 2)
        self.assertEqual(target_db.query(QuestionGroup).count(), 0)
        self.assertEqual(target_db.query(Question).count(), 0)
        self.assertEqual(target_db.query(PackSubscription).count(), 0)

    def test_empty_playlist_cannot_be_exported(self):
        db = make_db()
        playlist = Collection(name="Vide", data={}, questions=[])
        db.add(playlist)
        db.commit()

        with self.assertRaises(ValueError):
            export_playlist_pack(
                db,
                playlist.id,
                version=1,
                name="Vide",
                static_dir=self.make_static_dir(),
                pack_dir=self.make_static_dir()
            )


if __name__ == "__main__":
    unittest.main()
