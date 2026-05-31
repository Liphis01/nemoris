from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import HTTPException

from ..config import STATIC_DIR
from ..models import Question, QuestionGroup


IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
SAFE_IMAGE_EXTENSIONS = {
    ".gif": "gif",
    ".jfif": "jpeg",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".png": "png",
    ".webp": "webp"
}
DEFAULT_EXTENSION_BY_KIND = {
    "gif": ".gif",
    "jpeg": ".jpg",
    "png": ".png",
    "webp": ".webp"
}
LOCAL_STATIC_HOSTS = {
    "127.0.0.1:8000",
    "localhost:8000"
}


def detect_raster_image_kind(data: bytes):
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"

    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"

    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"

    return None


def safe_image_extension(filename: str, image_kind: str):
    extension = Path(filename or "").suffix.lower()

    if SAFE_IMAGE_EXTENSIONS.get(extension) == image_kind:
        return extension

    return DEFAULT_EXTENSION_BY_KIND[image_kind]


def read_upload_bytes(upload_file, max_bytes=IMAGE_UPLOAD_MAX_BYTES):
    total = 0
    chunks = []

    while True:
        chunk = upload_file.file.read(CHUNK_SIZE)

        if not chunk:
            break

        total += len(chunk)

        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="Image too large"
            )

        chunks.append(chunk)

    return b"".join(chunks)


def store_uploaded_image(
    upload_file,
    static_dir: Path | None = None,
    max_bytes=IMAGE_UPLOAD_MAX_BYTES
):
    content_type = (getattr(upload_file, "content_type", "") or "").lower()

    if content_type and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported")

    data = read_upload_bytes(upload_file, max_bytes=max_bytes)
    image_kind = detect_raster_image_kind(data)

    if not image_kind:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG, GIF, and WebP images are supported"
        )

    target_dir = static_dir or STATIC_DIR
    target_dir.mkdir(exist_ok=True)
    extension = safe_image_extension(upload_file.filename, image_kind)

    while True:
        filename = f"{uuid4().hex}{extension}"
        file_path = target_dir / filename

        if not file_path.exists():
            break

    file_path.write_bytes(data)

    return {"url": f"/static/{filename}"}


def static_filename_from_media(media):
    value = str(media or "").strip()

    if not value:
        return None

    if value.startswith("/static/"):
        return Path(value).name

    parsed = urlparse(value)

    if (
        parsed.scheme in {"http", "https"} and
        parsed.netloc in LOCAL_STATIC_HOSTS and
        parsed.path.startswith("/static/")
    ):
        return Path(parsed.path).name

    return None


def media_points_to_same_static_file(left, right):
    left_filename = static_filename_from_media(left)

    return (
        left_filename is not None and
        left_filename == static_filename_from_media(right)
    )


def is_static_media_referenced(db, filename):
    if not filename:
        return False

    question_media_rows = (
        db.query(Question.media)
        .filter(Question.media.isnot(None))
        .all()
    )

    if any(static_filename_from_media(media) == filename for (media,) in question_media_rows):
        return True

    group_media_rows = (
        db.query(QuestionGroup.media)
        .filter(QuestionGroup.media.isnot(None))
        .all()
    )

    return any(static_filename_from_media(media) == filename for (media,) in group_media_rows)


def delete_unreferenced_media_file(db, media, static_dir: Path | None = None):
    filename = static_filename_from_media(media)

    if not filename or is_static_media_referenced(db, filename):
        return False

    target_dir = static_dir or STATIC_DIR
    file_path = target_dir / filename

    if file_path.exists():
        file_path.unlink()
        return True

    return False


def delete_unreferenced_media_files(db, media_values, static_dir: Path | None = None):
    deleted = []

    for media in media_values:
        if delete_unreferenced_media_file(db, media, static_dir=static_dir):
            deleted.append(media)

    return deleted
