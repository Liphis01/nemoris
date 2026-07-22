import hashlib
import io
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.services.blueprints as blueprints_service

from app.migrations import MIGRATIONS
from app.models import (
    Base,
    BlueprintSubscription,
    MediaFile,
    Progress,
    Question,
    QuestionGroup
)
from app.routers.blueprints import (
    export_group_blueprint,
    get_blueprint_catalog,
    import_blueprint_zip,
    list_blueprint_subscriptions,
    unsubscribe_blueprint_subscription,
    update_blueprint_catalog,
    update_blueprint_zip
)
from app.schemas import BlueprintCatalogSettings, BlueprintExportRequest
from app.services.blueprints import (
    content_hash,
    export_blueprint,
    import_blueprint,
    unsubscribe_blueprint,
    update_blueprint
)
from app.services.media import store_media_bytes
from app.services.progress import create_initial_progress, record_answer_history


SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>'
OTHER_SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>'


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class BlueprintFixtureMixin:
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


class ExportBlueprintTests(BlueprintFixtureMixin, unittest.TestCase):
    def test_export_manifest_and_content_fields(self):
        db, static_dir, group, first, second = self.build_source()
        blueprint_dir = self.make_static_dir()

        zip_path = export_blueprint(
            db,
            group.id,
            version=1,
            name="Countries of the world",
            description="desc",
            license="CC0",
            static_dir=static_dir,
            blueprint_dir=blueprint_dir
        )

        self.assertTrue(zip_path.exists())

        with ZipFile(zip_path) as zip_file:
            manifest = json.loads(zip_file.read("manifest.json"))
            content = json.loads(zip_file.read("content.json"))
            names = zip_file.namelist()

        self.assertEqual(manifest["format"], 1)
        self.assertEqual(manifest["blueprint_guid"], group.guid)
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(manifest["name"], "Countries of the world")
        self.assertEqual(manifest["license"], "CC0")
        self.assertEqual(
            manifest["minimum_schema_version"], MIGRATIONS[-1].version
        )

        self.assertEqual(content["group"]["guid"], group.guid)
        self.assertEqual(content["group"]["type_group"], "map")
        self.assertEqual(content["group"]["data"], {"projection": "mercator"})

        group_sha = hashlib.sha256(SVG_BYTES).hexdigest()
        answer_sha = hashlib.sha256(OTHER_SVG_BYTES).hexdigest()
        self.assertEqual(content["group"]["media"], {"sha256": group_sha})

        questions_by_guid = {
            entry["guid"]: entry for entry in content["questions"]
        }
        self.assertEqual(len(questions_by_guid), 2)

        first_entry = questions_by_guid[first.guid]
        self.assertEqual(first_entry["question"], "Q1")
        self.assertEqual(first_entry["tags"], ["europe"])
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
        blueprint_dir = self.make_static_dir()

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

        zip_path = export_blueprint(
            db,
            group.id,
            version=1,
            name="Pack",
            static_dir=static_dir,
            blueprint_dir=blueprint_dir
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
            export_blueprint(
                db,
                group.id,
                version=1,
                name="Pack",
                static_dir=static_dir,
                blueprint_dir=self.make_static_dir()
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

        zip_path = export_blueprint(
            db,
            group.id,
            version=1,
            name="World",
            static_dir=static_dir,
            blueprint_dir=self.make_static_dir()
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

        zip_path = export_blueprint(
            db,
            group.id,
            version=1,
            name="World",
            static_dir=static_dir,
            blueprint_dir=self.make_static_dir()
        )

        target_db = make_db()
        import_blueprint(
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
            export_blueprint(
                db,
                group.id,
                version=1,
                name="World",
                static_dir=self.make_static_dir(),
                blueprint_dir=self.make_static_dir()
            )

    def test_export_unknown_group_raises(self):
        db = make_db()

        with self.assertRaises(ValueError):
            export_blueprint(
                db,
                999,
                version=1,
                name="Pack",
                static_dir=self.make_static_dir(),
                blueprint_dir=self.make_static_dir()
            )


class ImportBlueprintTests(BlueprintFixtureMixin, unittest.TestCase):
    def export_zip(self, **overrides):
        db, static_dir, group, first, second = self.build_source()
        blueprint_dir = self.make_static_dir()
        kwargs = {
            "version": 1,
            "name": "Countries of the world",
            "description": "desc",
            "license": "CC0",
            "static_dir": static_dir,
            "blueprint_dir": blueprint_dir
        }
        kwargs.update(overrides)

        zip_path = export_blueprint(db, group.id, **kwargs)

        return zip_path, db, group, first, second

    def test_round_trip_matches_source_and_skips_progress(self):
        zip_path, source_db, group, first, second = self.export_zip()

        target_db = make_db()
        target_static = self.make_static_dir()

        result = import_blueprint(
            target_db, zip_path, static_dir=target_static, source="pack.zip"
        )

        self.assertEqual(result["status"], "imported")
        self.assertEqual(result["blueprint_guid"], group.guid)
        self.assertEqual(result["questions_imported"], 2)

        imported_group = (
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .first()
        )
        self.assertIsNotNone(imported_group)
        self.assertEqual(imported_group.name, "Countries")
        self.assertEqual(imported_group.blueprint_guid, group.guid)
        self.assertEqual(imported_group.blueprint_version, 1)
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
        self.assertEqual(imported_first.tags, ["europe"])
        self.assertEqual(imported_first.blueprint_version, 1)

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
            target_db.query(BlueprintSubscription)
            .filter(BlueprintSubscription.blueprint_guid == group.guid)
            .first()
        )
        self.assertIsNotNone(subscription)
        self.assertEqual(subscription.installed_version, 1)
        self.assertEqual(subscription.source, "pack.zip")

    def test_reimporting_same_blueprint_is_rejected(self):
        zip_path, source_db, group, first, second = self.export_zip()
        target_db = make_db()
        target_static = self.make_static_dir()

        import_blueprint(target_db, zip_path, static_dir=target_static)

        group_count = target_db.query(QuestionGroup).count()
        question_count = target_db.query(Question).count()
        subscription_count = target_db.query(BlueprintSubscription).count()

        with self.assertRaises(ValueError):
            import_blueprint(target_db, zip_path, static_dir=target_static)

        # Rejected re-import must leave zero partial/duplicate writes.
        self.assertEqual(target_db.query(QuestionGroup).count(), group_count)
        self.assertEqual(target_db.query(Question).count(), question_count)
        self.assertEqual(
            target_db.query(BlueprintSubscription).count(), subscription_count
        )

    def test_local_guid_collision_is_rejected(self):
        zip_path, source_db, group, first, second = self.export_zip()
        target_db = make_db()
        target_db.add(QuestionGroup(guid=group.guid, type_group="map", name="X"))
        target_db.commit()

        group_count = target_db.query(QuestionGroup).count()
        question_count = target_db.query(Question).count()
        subscription_count = target_db.query(BlueprintSubscription).count()

        with self.assertRaises(ValueError):
            import_blueprint(
                target_db, zip_path, static_dir=self.make_static_dir()
            )

        # Rejected import must leave zero partial/duplicate writes.
        self.assertEqual(target_db.query(QuestionGroup).count(), group_count)
        self.assertEqual(target_db.query(Question).count(), question_count)
        self.assertEqual(
            target_db.query(BlueprintSubscription).count(), subscription_count
        )

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

        import_blueprint(target_db, zip_path, static_dir=target_static)

        after_count = target_db.query(MediaFile).count()
        # Only the answer.svg (a genuinely new hash) should register a new row.
        self.assertEqual(after_count, before_count + 1)

    def test_rejects_non_zip_file(self):
        bogus = self.make_static_dir() / "not-a-zip.zip"
        bogus.write_text("nope", encoding="utf-8")

        with self.assertRaises(ValueError):
            import_blueprint(make_db(), bogus, static_dir=self.make_static_dir())

    def test_rejects_missing_manifest(self):
        archive = self.make_static_dir() / "empty.zip"

        with ZipFile(archive, "w", compression=ZIP_DEFLATED) as zip_file:
            zip_file.writestr("content.json", "{}")

        with self.assertRaises(ValueError):
            import_blueprint(
                make_db(), archive, static_dir=self.make_static_dir()
            )

    def test_rejects_newer_schema_requirement(self):
        archive = self.make_static_dir() / "future.zip"
        manifest = {
            "format": 1,
            "blueprint_guid": "some-guid",
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
            import_blueprint(
                make_db(), archive, static_dir=self.make_static_dir()
            )


class UpdateBlueprintTests(BlueprintFixtureMixin, unittest.TestCase):
    def install_v1(self):
        # Source: group + two questions, exported as v1 and imported into a
        # fresh target database, simulating two separate installations.
        source_db, source_static, group, first, second = self.build_source()
        blueprint_dir = self.make_static_dir()

        v1_zip = export_blueprint(
            source_db,
            group.id,
            version=1,
            name="Countries",
            static_dir=source_static,
            blueprint_dir=blueprint_dir
        )

        target_db = make_db()
        target_static = self.make_static_dir()
        import_blueprint(target_db, v1_zip, static_dir=target_static)

        return {
            "source_db": source_db,
            "source_static": source_static,
            "source_group": group,
            "source_first": first,
            "source_second": second,
            "blueprint_dir": blueprint_dir,
            "target_db": target_db,
            "target_static": target_static
        }

    def export_v2(self, ctx, **overrides):
        kwargs = {
            "version": 2,
            "name": "Countries",
            "static_dir": ctx["source_static"],
            "blueprint_dir": ctx["blueprint_dir"]
        }
        kwargs.update(overrides)

        return export_blueprint(
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

        result = update_blueprint(
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
        self.assertEqual(updated_first.blueprint_version, 2)

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
            ctx["target_db"].query(BlueprintSubscription)
            .filter(
                BlueprintSubscription.blueprint_guid
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
        result = update_blueprint(
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
        self.assertEqual(untouched.blueprint_version, 1)

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
        result = update_blueprint(
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

        preview = update_blueprint(
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

        confirm = update_blueprint(
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
        result = update_blueprint(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )

        self.assertFalse(result["group_updated"])

        untouched_group = (
            ctx["target_db"].query(QuestionGroup)
            .filter(QuestionGroup.guid == ctx["source_group"].guid)
            .first()
        )
        self.assertEqual(untouched_group.name, "My Renamed Countries")

    def test_rejects_update_for_uninstalled_blueprint(self):
        ctx = self.install_v1()
        v2_zip = self.export_v2(ctx)

        with self.assertRaises(ValueError):
            update_blueprint(
                make_db(), v2_zip, static_dir=self.make_static_dir()
            )

    def test_rejects_older_version_than_installed(self):
        ctx = self.install_v1()

        with self.assertRaises(ValueError):
            update_blueprint(
                ctx["target_db"],
                self.export_v2(ctx, version=0),
                static_dir=ctx["target_static"]
            )

    def test_repeated_call_with_same_version_is_idempotent(self):
        ctx = self.install_v1()
        ctx["source_first"].answer = "A1 corrected"
        ctx["source_db"].commit()

        v2_zip = self.export_v2(ctx)
        first_call = update_blueprint(
            ctx["target_db"], v2_zip, static_dir=ctx["target_static"]
        )
        second_call = update_blueprint(
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


class UnsubscribeBlueprintTests(BlueprintFixtureMixin, unittest.TestCase):
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
        blueprint_dir = self.make_static_dir()
        target_static = self.make_static_dir()

        v1_zip = export_blueprint(
            source_db,
            group.id,
            version=1,
            name="Countries",
            static_dir=source_static,
            blueprint_dir=blueprint_dir
        )
        import_blueprint(target_db, v1_zip, static_dir=target_static)

        return group, first, second, target_static

    def test_keep_clears_bookkeeping_and_preserves_content(self):
        target_db = make_db()
        group, first, second, target_static = self.install_v1(target_db)

        result = unsubscribe_blueprint(
            target_db, group.guid, delete_content=False
        )

        self.assertEqual(result["status"], "kept")
        self.assertEqual(result["kept_questions"], 2)

        self.assertIsNone(
            target_db.query(BlueprintSubscription)
            .filter(BlueprintSubscription.blueprint_guid == group.guid)
            .first()
        )

        kept_group = (
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .first()
        )
        self.assertIsNotNone(kept_group)
        self.assertEqual(kept_group.name, "Countries")
        self.assertIsNone(kept_group.blueprint_guid)
        self.assertIsNone(kept_group.blueprint_version)
        self.assertIsNone(kept_group.content_hash)

        kept_questions = (
            target_db.query(Question)
            .filter(Question.group_id == kept_group.id)
            .all()
        )
        self.assertEqual(len(kept_questions), 2)
        for question in kept_questions:
            self.assertIsNone(question.blueprint_guid)
            self.assertIsNone(question.blueprint_version)
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

        result = unsubscribe_blueprint(
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
            target_db.query(BlueprintSubscription)
            .filter(BlueprintSubscription.blueprint_guid == group.guid)
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

        unsubscribe_blueprint(
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

    def test_rejects_unsubscribe_for_uninstalled_blueprint(self):
        with self.assertRaises(ValueError):
            unsubscribe_blueprint(make_db(), "not-a-real-guid")


class BlueprintRouterTests(BlueprintFixtureMixin, unittest.TestCase):
    def test_export_endpoint_returns_zip_and_404s_on_missing_group(self):
        db, static_dir, group, first, second = self.build_source()
        payload = BlueprintExportRequest(version=1, name="Pack")

        with self.assertRaises(HTTPException) as missing:
            export_group_blueprint(999, payload, db)
        self.assertEqual(missing.exception.status_code, 404)

    def test_import_endpoint_round_trips_upload(self):
        db, static_dir, group, first, second = self.build_source()
        blueprint_dir = self.make_static_dir()

        zip_path = export_blueprint(
            db,
            group.id,
            version=1,
            name="Pack",
            static_dir=static_dir,
            blueprint_dir=blueprint_dir
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
        with patch.object(blueprints_service, "STATIC_DIR", target_static):
            result = import_blueprint_zip(file=upload, db=target_db)

        self.assertEqual(result["status"], "imported")

    def test_import_endpoint_rejects_non_zip_upload(self):
        target_db = make_db()
        upload = UploadFile(file=io.BytesIO(b"not a zip"), filename="junk.zip")

        with self.assertRaises(HTTPException) as caught:
            import_blueprint_zip(file=upload, db=target_db)

        self.assertEqual(caught.exception.status_code, 400)

    def test_update_endpoint_round_trips_upload(self):
        source_db, source_static, group, first, second = self.build_source()
        blueprint_dir = self.make_static_dir()

        v1_zip = export_blueprint(
            source_db, group.id, version=1, name="Pack",
            static_dir=source_static, blueprint_dir=blueprint_dir
        )

        target_db = make_db()
        target_static = self.make_static_dir()

        with patch.object(blueprints_service, "STATIC_DIR", target_static):
            import_blueprint_zip(
                file=UploadFile(
                    file=io.BytesIO(v1_zip.read_bytes()), filename="pack.zip"
                ),
                db=target_db
            )

        first.answer = "corrected"
        source_db.commit()
        v2_zip = export_blueprint(
            source_db, group.id, version=2, name="Pack",
            static_dir=source_static, blueprint_dir=blueprint_dir
        )

        with patch.object(blueprints_service, "STATIC_DIR", target_static):
            result = update_blueprint_zip(
                file=UploadFile(
                    file=io.BytesIO(v2_zip.read_bytes()), filename="pack.zip"
                ),
                db=target_db
            )

        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["updated"], [first.guid])

    def test_update_endpoint_rejects_uninstalled_blueprint(self):
        source_db, source_static, group, first, second = self.build_source()
        v1_zip = export_blueprint(
            source_db, group.id, version=1, name="Pack",
            static_dir=source_static, blueprint_dir=self.make_static_dir()
        )
        target_db = make_db()
        target_static = self.make_static_dir()

        with patch.object(blueprints_service, "STATIC_DIR", target_static):
            with self.assertRaises(HTTPException) as caught:
                update_blueprint_zip(
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
        blueprint_dir = self.make_static_dir()
        v1_zip = export_blueprint(
            source_db, group.id, version=1, name="Pack",
            static_dir=source_static, blueprint_dir=blueprint_dir
        )

        target_db = make_db()
        target_static = self.make_static_dir()

        with patch.object(blueprints_service, "STATIC_DIR", target_static):
            import_blueprint_zip(
                file=UploadFile(
                    file=io.BytesIO(v1_zip.read_bytes()), filename="pack.zip"
                ),
                db=target_db
            )

        result = unsubscribe_blueprint_subscription(
            group.guid, delete_content=False, db=target_db
        )

        self.assertEqual(result["status"], "kept")

    def test_unsubscribe_endpoint_rejects_uninstalled_blueprint(self):
        with self.assertRaises(HTTPException) as caught:
            unsubscribe_blueprint_subscription(
                "not-a-real-guid", delete_content=False, db=make_db()
            )

        self.assertEqual(caught.exception.status_code, 400)

    def test_list_endpoint_empty_and_populated(self):
        db = make_db()
        self.assertEqual(list_blueprint_subscriptions(db=db), [])

        source_db, source_static, group, first, second = self.build_source()
        blueprint_dir = self.make_static_dir()
        zip_path = export_blueprint(
            source_db, group.id, version=1, name="Pack",
            static_dir=source_static, blueprint_dir=blueprint_dir
        )
        import_blueprint(db, zip_path, static_dir=self.make_static_dir())

        rows = list_blueprint_subscriptions(db=db)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["blueprint_guid"], group.guid)
        self.assertEqual(rows[0]["installed_version"], 1)
        self.assertEqual(rows[0]["name"], "Pack")
        self.assertIsNotNone(rows[0]["subscribed_at"])
        self.assertIsNone(rows[0]["updated_at"])

    def test_catalog_settings_endpoints_round_trip(self):
        db = make_db()

        self.assertEqual(get_blueprint_catalog(db=db), {"url": "", "key": ""})

        saved = update_blueprint_catalog(
            BlueprintCatalogSettings(
                url="https://example.supabase.co/rest/v1",
                key="sb_publishable_test"
            ),
            db=db
        )
        self.assertEqual(
            saved,
            {
                "url": "https://example.supabase.co/rest/v1",
                "key": "sb_publishable_test"
            }
        )

        self.assertEqual(
            get_blueprint_catalog(db=db),
            {
                "url": "https://example.supabase.co/rest/v1",
                "key": "sb_publishable_test"
            }
        )


if __name__ == "__main__":
    unittest.main()
