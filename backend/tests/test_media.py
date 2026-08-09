import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Question, QuestionGroup
from app.routers.groups import update_group
from app.routers.uploads import delete_image
from app.schemas import GroupUpdate, QuestionUpdate
from app.services import media as media_service
from app.services.questions import update_question


PNG_BYTES = b"\x89PNG\r\n\x1a\npng-data"
JPEG_BYTES = b"\xff\xd8\xff\xe0jpeg-data"
GIF_BYTES = b"GIF89agif-data"
WEBP_BYTES = b"RIFF\x10\x00\x00\x00WEBPwebp-data"
SVG_BYTES = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">'
    b'<rect width="1" height="1" fill="#fff"/></svg>'
)
SVG_DOCTYPE_BYTES = (
    b'<?xml version="1.0" encoding="utf-8"?>\n'
    b'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
    b'"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n'
    b'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>'
)
GLOBAL_ADDRINFO = [
    (None, None, None, None, ("93.184.216.34", 0))
]
LOCAL_ADDRINFO = [
    (None, None, None, None, ("127.0.0.1", 0))
]


def upload(filename, content_type, data):
    return SimpleNamespace(
        filename=filename,
        content_type=content_type,
        file=io.BytesIO(data)
    )


class RemoteHeaders:
    def __init__(self, values):
        self.values = {
            str(key).lower(): value
            for key, value in values.items()
        }

    def get(self, key, default=None):
        return self.values.get(str(key).lower(), default)


class RemoteResponse:
    def __init__(self, data, content_type="image/png", content_length=None):
        headers = {}

        if content_type is not None:
            headers["Content-Type"] = content_type

        if content_length is not None:
            headers["Content-Length"] = content_length

        self.headers = RemoteHeaders(headers)
        self.file = io.BytesIO(data)

    def read(self, size=-1):
        return self.file.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class MediaTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.static_dir = Path(self.temp_dir.name)
        self.previous_static_dir = media_service.STATIC_DIR
        media_service.STATIC_DIR = self.static_dir

    def tearDown(self):
        media_service.STATIC_DIR = self.previous_static_dir
        self.db.close()
        self.temp_dir.cleanup()

    def test_upload_accepts_raster_images_and_generates_unique_names(self):
        cases = [
            ("photo.jpg", "image/jpeg", JPEG_BYTES, ".jpg"),
            ("photo.png", "image/png", PNG_BYTES, ".png"),
            ("photo.gif", "image/gif", GIF_BYTES, ".gif"),
            ("photo.webp", "image/webp", WEBP_BYTES, ".webp"),
            ("photo.svg", "image/svg+xml", SVG_BYTES, ".svg"),
            ("map.svg", "image/svg+xml", SVG_DOCTYPE_BYTES, ".svg")
        ]

        urls = []

        for filename, content_type, data, expected_extension in cases:
            with self.subTest(filename=filename):
                result = media_service.store_uploaded_image(
                    upload(filename, content_type, data)
                )
                url = result["url"]

                self.assertTrue(url.startswith("/static/"))
                self.assertTrue(url.endswith(expected_extension))
                self.assertTrue((self.static_dir / Path(url).name).exists())
                urls.append(url)

        duplicate_a = media_service.store_uploaded_image(
            upload("same.png", "image/png", PNG_BYTES)
        )["url"]
        duplicate_b = media_service.store_uploaded_image(
            upload("same.png", "image/png", PNG_BYTES)
        )["url"]

        self.assertEqual(len(urls), len(set(urls)))
        self.assertNotEqual(duplicate_a, duplicate_b)

    def test_upload_can_store_and_delete_static_subdirectory_files(self):
        result = media_service.store_uploaded_image(
            upload("flag.png", "image/png", PNG_BYTES),
            storage_subdir="image-groups/7"
        )
        url = result["url"]
        file_path = self.static_dir / "image-groups" / "7" / Path(url).name

        self.assertTrue(url.startswith("/static/image-groups/7/"))
        self.assertTrue(file_path.exists())
        self.assertEqual(
            media_service.static_filename_from_media(url),
            f"image-groups/7/{Path(url).name}"
        )

        question = Question(
            type_q="media",
            question="Flags - France",
            answer="France",
            media=url,
            tags=[],
            data={}
        )
        self.db.add(question)
        self.db.commit()

        self.assertFalse(media_service.delete_unreferenced_media_file(self.db, url))
        self.assertTrue(file_path.exists())

        question.media = None
        self.db.commit()

        self.assertTrue(media_service.delete_unreferenced_media_file(self.db, url))
        self.assertFalse(file_path.exists())
        self.assertFalse((self.static_dir / "image-groups" / "7").exists())

    def test_upload_rejects_non_images_and_oversized_images(self):
        with self.assertRaises(HTTPException) as non_image_error:
            media_service.store_uploaded_image(
                upload("notes.txt", "text/plain", b"not an image")
            )

        self.assertEqual(non_image_error.exception.status_code, 400)

        with self.assertRaises(HTTPException) as oversized_error:
            media_service.store_uploaded_image(
                upload("large.png", "image/png", PNG_BYTES + b"x" * 32),
                max_bytes=len(PNG_BYTES)
            )

        self.assertEqual(oversized_error.exception.status_code, 413)

    def test_upload_rejects_unsafe_svg_images(self):
        unsafe_payloads = [
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
            (
                b'<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
                b'<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>'
            )
        ]

        for payload in unsafe_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(HTTPException) as svg_error:
                    media_service.store_uploaded_image(
                        upload("bad.svg", "image/svg+xml", payload)
                    )

                self.assertEqual(svg_error.exception.status_code, 400)

    def test_remote_import_downloads_and_stores_supported_image(self):
        with patch.object(
            media_service,
            "getaddrinfo",
            return_value=GLOBAL_ADDRINFO
        ), patch.object(
            media_service,
            "urlopen",
            return_value=RemoteResponse(PNG_BYTES, content_type="image/png")
        ) as urlopen_mock:
            result = media_service.store_remote_image(
                "https://example.com/photo.png"
            )

        url = result["url"]

        self.assertTrue(url.startswith("/static/"))
        self.assertTrue(url.endswith(".png"))
        self.assertTrue((self.static_dir / Path(url).name).exists())
        self.assertEqual(
            urlopen_mock.call_args.args[0].full_url,
            "https://example.com/photo.png"
        )

    def test_remote_import_rejects_invalid_url_and_non_image_response(self):
        with self.assertRaises(HTTPException) as invalid_url_error:
            media_service.store_remote_image("file:///tmp/photo.png")

        self.assertEqual(invalid_url_error.exception.status_code, 400)

        with patch.object(
            media_service,
            "getaddrinfo",
            return_value=GLOBAL_ADDRINFO
        ), patch.object(
            media_service,
            "urlopen",
            return_value=RemoteResponse(b"<html></html>", content_type="text/html")
        ):
            with self.assertRaises(HTTPException) as non_image_error:
                media_service.store_remote_image("https://example.com/page")

        self.assertEqual(non_image_error.exception.status_code, 400)

    def test_remote_import_rejects_local_hosts(self):
        with self.assertRaises(HTTPException) as localhost_error:
            media_service.store_remote_image(
                "http://localhost:8000/static/photo.png"
            )

        self.assertEqual(localhost_error.exception.status_code, 400)

        with patch.object(
            media_service,
            "getaddrinfo",
            return_value=LOCAL_ADDRINFO
        ):
            with self.assertRaises(HTTPException) as private_host_error:
                media_service.store_remote_image("https://example.com/photo.png")

        self.assertEqual(private_host_error.exception.status_code, 400)

    def test_remote_import_rejects_oversized_images(self):
        with patch.object(
            media_service,
            "getaddrinfo",
            return_value=GLOBAL_ADDRINFO
        ), patch.object(
            media_service,
            "urlopen",
            return_value=RemoteResponse(
                PNG_BYTES,
                content_type="image/png",
                content_length=str(len(PNG_BYTES) + 1)
            )
        ):
            with self.assertRaises(HTTPException) as oversized_error:
                media_service.store_remote_image(
                    "https://example.com/photo.png",
                    max_bytes=len(PNG_BYTES)
                )

        self.assertEqual(oversized_error.exception.status_code, 413)

    def test_replacing_question_media_deletes_unreferenced_local_file(self):
        old_file = self.static_dir / "old.png"
        old_file.write_bytes(PNG_BYTES)
        question = Question(
            type_q="text",
            question="Question",
            answer="Answer",
            media="/static/old.png",
            tags=[],
            data={}
        )

        self.db.add(question)
        self.db.commit()

        update_question(
            self.db,
            question.id,
            QuestionUpdate(media="/static/new.png")
        )

        self.assertFalse(old_file.exists())

    def test_replacing_question_media_keeps_file_referenced_by_group(self):
        shared_file = self.static_dir / "shared.png"
        shared_file.write_bytes(PNG_BYTES)
        group = QuestionGroup(
            type_group="map",
            name="Shared",
            media="/static/shared.png",
            data={}
        )
        question = Question(
            type_q="text",
            question="Question",
            answer="Answer",
            media="/static/shared.png",
            tags=[],
            data={}
        )

        self.db.add_all([group, question])
        self.db.commit()

        update_question(
            self.db,
            question.id,
            QuestionUpdate(media="/static/new.png")
        )

        self.assertTrue(shared_file.exists())

        update_group(
            group.id,
            GroupUpdate(media=None),
            db=self.db
        )

        self.assertFalse(shared_file.exists())

    def test_delete_media_clears_media_and_preserves_question_type(self):
        local_file = self.static_dir / "timeline.png"
        local_file.write_bytes(PNG_BYTES)
        question = Question(
            type_q="timeline",
            question="Timeline event",
            answer="1900",
            media="/static/timeline.png",
            tags=[],
            data={}
        )

        self.db.add(question)
        self.db.commit()

        response = delete_image(question.id, db=self.db)
        self.db.refresh(question)

        self.assertEqual(response, {"status": "image deleted"})
        self.assertIsNone(question.media)
        self.assertEqual(question.type_q, "timeline")
        self.assertFalse(local_file.exists())

    def test_delete_external_media_clears_without_deleting_files(self):
        question = Question(
            type_q="text",
            question="Question",
            answer="Answer",
            media="https://example.com/image.jpg",
            tags=[],
            data={}
        )

        self.db.add(question)
        self.db.commit()

        response = delete_image(question.id, db=self.db)
        self.db.refresh(question)

        self.assertEqual(response, {"status": "image deleted"})
        self.assertIsNone(question.media)
        self.assertEqual(question.type_q, "text")


if __name__ == "__main__":
    unittest.main()
