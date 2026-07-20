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
from app.routers.blueprints import export_group_blueprint, import_blueprint_zip
from app.schemas import BlueprintExportRequest
from app.services.blueprints import content_hash, export_blueprint, import_blueprint
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

    def test_export_passes_through_builtin_and_external_media(self):
        # Discovered against real data: QuestionGroup.media for map groups is
        # often a bare filename (e.g. "world.svg") referencing a built-in map
        # asset shipped with the frontend (frontend/public/maps/), not a
        # backend-uploaded file -- it never lives under static/. Likewise
        # Question.media can be a hotlinked external URL. Neither should be
        # bundled into the zip or treated as "missing".
        db = make_db()
        static_dir = self.make_static_dir()

        group = QuestionGroup(type_group="map", name="World", media="world.svg")
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

        self.assertEqual(content["group"]["media"], {"builtin": "world.svg"})
        self.assertEqual(
            content["questions"][0]["media"],
            {"url": "https://example.com/photo.jpg"}
        )
        # Neither is a local file -- nothing staged into media/.
        self.assertEqual(media_members, [])

    def test_import_passes_through_builtin_and_external_media(self):
        db = make_db()
        static_dir = self.make_static_dir()
        group = QuestionGroup(type_group="map", name="World", media="world.svg")
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

        imported_group = (
            target_db.query(QuestionGroup)
            .filter(QuestionGroup.guid == group.guid)
            .first()
        )
        imported_question = (
            target_db.query(Question)
            .filter(Question.guid == question.guid)
            .first()
        )
        self.assertEqual(imported_group.media, "world.svg")
        self.assertEqual(
            imported_question.media, "https://example.com/photo.jpg"
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

        with self.assertRaises(ValueError):
            import_blueprint(target_db, zip_path, static_dir=target_static)

    def test_local_guid_collision_is_rejected(self):
        zip_path, source_db, group, first, second = self.export_zip()
        target_db = make_db()
        target_db.add(QuestionGroup(guid=group.guid, type_group="map", name="X"))
        target_db.commit()

        with self.assertRaises(ValueError):
            import_blueprint(
                target_db, zip_path, static_dir=self.make_static_dir()
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


if __name__ == "__main__":
    unittest.main()
