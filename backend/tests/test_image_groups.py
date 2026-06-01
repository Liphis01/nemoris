import io
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Progress, Question, QuestionGroup
from app.schemas import ImageGroupItemsBulkUpdate, QuestionCreate
from app.services import media as media_service
from app.services.image_groups import (
    list_image_group_items,
    save_image_group_items,
    upload_image_group_media
)
from app.services.questions import create_question


PNG_BYTES = b"\x89PNG\r\n\x1a\npng-data"


def upload(filename, content_type, data):
    return SimpleNamespace(
        filename=filename,
        content_type=content_type,
        file=io.BytesIO(data)
    )


class ImageGroupTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def test_image_schema_and_group_compatibility(self):
        group = QuestionGroup(
            type_group="image",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add(group)
        self.db.commit()

        image = create_question(
            self.db,
            QuestionCreate(
                type_q="image",
                question="Flags - France",
                answer="France",
                media="/static/france.png",
                group_id=group.id,
                data={"aliases": ["French flag"]}
            )
        )

        self.assertEqual(image.type_q, "image")
        self.assertEqual(image.group_id, group.id)
        self.assertIsNotNone(
            self.db.query(Progress)
            .filter(Progress.question_id == image.id)
            .first()
        )

        with self.assertRaises(HTTPException) as incompatible:
            create_question(
                self.db,
                QuestionCreate(
                    type_q="text",
                    question="Bad",
                    answer="Bad",
                    group_id=group.id
                )
            )

        self.assertEqual(incompatible.exception.status_code, 400)

    def test_bulk_save_creates_updates_deletes_and_preserves_progress(self):
        group = QuestionGroup(
            type_group="image",
            name="Flags",
            media="cover.png",
            data={}
        )
        existing = Question(
            type_q="image",
            question="Flags - France",
            answer="France",
            media="/static/france.png",
            tags=["old"],
            data={"aliases": ["FR"], "favorite": True},
            group=group
        )
        deleted = Question(
            type_q="image",
            question="Flags - Germany",
            answer="Germany",
            media="/static/germany.png",
            tags=["old"],
            data={"aliases": []},
            group=group
        )

        self.db.add_all([group, existing, deleted])
        self.db.flush()
        self.db.add_all([
            Progress(question_id=existing.id, next_review=date.today()),
            Progress(question_id=deleted.id, next_review=date.today())
        ])
        self.db.commit()

        response = save_image_group_items(
            self.db,
            group.id,
            ImageGroupItemsBulkUpdate(
                group={
                    "name": "European flags",
                    "media": "cover-new.png",
                    "tags": ["geo", "flags"]
                },
                items=[
                    {
                        "id": existing.id,
                        "answer": "France",
                        "media": "/static/france-new.png",
                        "aliases": ["French Republic"],
                        "data": {"favorite": True}
                    },
                    {
                        "answer": "Spain",
                        "media": "/static/spain.png",
                        "aliases": ["Espana"]
                    }
                ],
                deleted_item_ids=[deleted.id]
            )
        )

        self.assertEqual(response["group"]["name"], "European flags")
        self.assertEqual(response["group"]["tags"], ["geo", "flags"])
        self.assertEqual(response["question_count"], 2)
        self.assertEqual(response["deletedQuestionIds"], [deleted.id])
        self.assertEqual(len(response["createdQuestionIds"]), 1)
        self.assertEqual(response["updatedQuestionIds"], [existing.id])

        questions = (
            self.db.query(Question)
            .filter(Question.group_id == group.id)
            .order_by(Question.answer)
            .all()
        )
        self.assertEqual([question.answer for question in questions], ["France", "Spain"])
        self.assertTrue(all(question.tags == ["geo", "flags"] for question in questions))
        self.assertEqual(questions[0].question, "European flags - France")
        self.assertEqual(questions[0].data["aliases"], ["French Republic"])
        self.assertTrue(questions[0].data["favorite"])
        self.assertEqual(self.db.query(Progress).count(), 2)
        self.assertIsNone(self.db.get(Question, deleted.id))

    def test_list_image_group_items_returns_editor_shape(self):
        group = QuestionGroup(
            type_group="image",
            name="Flags",
            media=None,
            data={}
        )
        item = Question(
            type_q="image",
            question="Flags - France",
            answer="France",
            media="/static/france.png",
            tags=["flags"],
            data={"aliases": ["FR"]},
            group=group
        )

        self.db.add_all([group, item])
        self.db.flush()
        self.db.add(Progress(question_id=item.id, next_review=date.today()))
        self.db.commit()

        response = list_image_group_items(self.db, group.id)

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["type_q"], "image")
        self.assertEqual(response[0]["answer"], "France")
        self.assertEqual(response[0]["aliases"], ["FR"])
        self.assertIn("progress", response[0])

    def test_image_group_upload_uses_group_static_folder(self):
        group = QuestionGroup(
            type_group="image",
            name="Flags",
            media=None,
            data={}
        )
        other_group = QuestionGroup(
            type_group="map",
            name="Europe",
            media=None,
            data={}
        )
        self.db.add_all([group, other_group])
        self.db.commit()

        with tempfile.TemporaryDirectory() as temp_dir:
            static_dir = Path(temp_dir)
            previous_static_dir = media_service.STATIC_DIR
            media_service.STATIC_DIR = static_dir

            try:
                response = upload_image_group_media(
                    self.db,
                    group.id,
                    upload("france.png", "image/png", PNG_BYTES)
                )
                url = response["url"]

                self.assertTrue(url.startswith(f"/static/image-groups/{group.id}/"))
                self.assertTrue(
                    (static_dir / "image-groups" / str(group.id) / Path(url).name).exists()
                )
            finally:
                media_service.STATIC_DIR = previous_static_dir

        with self.assertRaises(HTTPException) as incompatible:
            upload_image_group_media(
                self.db,
                other_group.id,
                upload("europe.png", "image/png", PNG_BYTES)
            )

        self.assertEqual(incompatible.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
