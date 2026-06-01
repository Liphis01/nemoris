from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse
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
STATIC_URL_PREFIX = "/static/"


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


def safe_static_relative_path(value):
    raw_value = unquote(str(value or "").strip()).replace("\\", "/").strip("/")

    if not raw_value:
        return None

    relative_path = PurePosixPath(raw_value)

    if any(part in {"", ".", ".."} for part in relative_path.parts):
        return None

    return relative_path.as_posix()


def store_uploaded_image(
    upload_file,
    static_dir: Path | None = None,
    storage_subdir: str | Path | None = None,
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

    root_dir = static_dir or STATIC_DIR
    relative_subdir = safe_static_relative_path(storage_subdir) if storage_subdir else None

    if storage_subdir and not relative_subdir:
        raise HTTPException(status_code=400, detail="Invalid upload folder")

    target_dir = root_dir / relative_subdir if relative_subdir else root_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    extension = safe_image_extension(upload_file.filename, image_kind)

    while True:
        filename = f"{uuid4().hex}{extension}"
        file_path = target_dir / filename

        if not file_path.exists():
            break

    file_path.write_bytes(data)
    relative_url_path = f"{relative_subdir}/{filename}" if relative_subdir else filename

    return {"url": f"{STATIC_URL_PREFIX}{relative_url_path}"}


def static_relative_path_from_media(media):
    value = str(media or "").strip()

    if not value:
        return None

    if value.startswith(STATIC_URL_PREFIX):
        return safe_static_relative_path(value.removeprefix(STATIC_URL_PREFIX))

    parsed = urlparse(value)

    if (
        parsed.scheme in {"http", "https"} and
        parsed.netloc in LOCAL_STATIC_HOSTS and
        parsed.path.startswith(STATIC_URL_PREFIX)
    ):
        return safe_static_relative_path(parsed.path.removeprefix(STATIC_URL_PREFIX))

    return None


def static_filename_from_media(media):
    return static_relative_path_from_media(media)


def media_points_to_same_static_file(left, right):
    left_filename = static_relative_path_from_media(left)

    return (
        left_filename is not None and
        left_filename == static_relative_path_from_media(right)
    )


def is_static_media_referenced(db, relative_path):
    if not relative_path:
        return False

    question_media_rows = (
        db.query(Question.media)
        .filter(Question.media.isnot(None))
        .all()
    )

    if any(
        static_relative_path_from_media(media) == relative_path
        for (media,) in question_media_rows
    ):
        return True

    group_media_rows = (
        db.query(QuestionGroup.media)
        .filter(QuestionGroup.media.isnot(None))
        .all()
    )

    return any(
        static_relative_path_from_media(media) == relative_path
        for (media,) in group_media_rows
    )


def static_file_path_from_media(media, static_dir: Path | None = None):
    relative_path = static_relative_path_from_media(media)

    if not relative_path:
        return None

    target_dir = static_dir or STATIC_DIR
    root_path = target_dir.resolve()
    file_path = (target_dir / relative_path).resolve()

    try:
        file_path.relative_to(root_path)
    except ValueError:
        return None

    return file_path


def prune_empty_static_parents(file_path, root_path):
    parent = file_path.parent

    while parent != root_path and parent.is_dir():
        try:
            parent.rmdir()
        except OSError:
            break

        parent = parent.parent


def delete_unreferenced_media_file(db, media, static_dir: Path | None = None):
    relative_path = static_relative_path_from_media(media)

    if not relative_path or is_static_media_referenced(db, relative_path):
        return False

    target_dir = static_dir or STATIC_DIR
    file_path = static_file_path_from_media(media, static_dir=target_dir)

    if file_path and file_path.exists():
        file_path.unlink()
        prune_empty_static_parents(file_path, target_dir.resolve())
        return True

    return False


def delete_unreferenced_media_files(db, media_values, static_dir: Path | None = None):
    deleted = []

    for media in media_values:
        if delete_unreferenced_media_file(db, media, static_dir=static_dir):
            deleted.append(media)

    return deleted
