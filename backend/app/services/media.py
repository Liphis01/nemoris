from ipaddress import ip_address
from pathlib import Path, PurePosixPath
from socket import gaierror, getaddrinfo, timeout as SocketTimeout
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen
from uuid import uuid4
from xml.etree import ElementTree

from fastapi import HTTPException

from ..config import STATIC_DIR
from ..models import Question, QuestionGroup


IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
REMOTE_IMAGE_TIMEOUT_SECONDS = 10
REMOTE_IMAGE_USER_AGENT = "QuizApp image importer"
FORBIDDEN_REMOTE_HOSTNAMES = {
    "localhost",
    "localhost.localdomain"
}
SAFE_IMAGE_EXTENSIONS = {
    ".gif": "gif",
    ".jfif": "jpeg",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".png": "png",
    ".svg": "svg",
    ".webp": "webp"
}
DEFAULT_EXTENSION_BY_KIND = {
    "gif": ".gif",
    "jpeg": ".jpg",
    "png": ".png",
    "svg": ".svg",
    "webp": ".webp"
}
LOCAL_STATIC_HOSTS = {
    "127.0.0.1:8000",
    "localhost:8000"
}
STATIC_URL_PREFIX = "/static/"
FORBIDDEN_SVG_ELEMENTS = {
    "embed",
    "foreignobject",
    "iframe",
    "object",
    "script"
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


def xml_local_name(name):
    return str(name or "").rsplit("}", 1)[-1].lower()


def is_safe_svg(data: bytes):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return False

    lowered = text.lower()

    if (
        "<!doctype" in lowered or
        "<!entity" in lowered or
        "javascript:" in lowered
    ):
        return False

    try:
        root = ElementTree.fromstring(data)
    except (ElementTree.ParseError, ValueError):
        return False

    if xml_local_name(root.tag) != "svg":
        return False

    for element in root.iter():
        if xml_local_name(element.tag) in FORBIDDEN_SVG_ELEMENTS:
            return False

        for attribute, value in element.attrib.items():
            attribute_name = xml_local_name(attribute)
            attribute_value = str(value or "").strip().lower()

            if attribute_name.startswith("on"):
                return False

            if (
                attribute_name in {"href", "src"} and
                attribute_value.startswith(("javascript:", "data:text/html"))
            ):
                return False

    return True


def detect_svg_image_kind(data: bytes):
    if is_safe_svg(data):
        return "svg"

    return None


def detect_image_kind(data: bytes):
    return detect_raster_image_kind(data) or detect_svg_image_kind(data)


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


def read_remote_bytes(response, max_bytes=IMAGE_UPLOAD_MAX_BYTES):
    content_length = response.headers.get("Content-Length")

    if content_length:
        try:
            if int(content_length) > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail="Image too large"
                )
        except ValueError:
            pass

    total = 0
    chunks = []

    while True:
        chunk = response.read(CHUNK_SIZE)

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


def store_image_bytes(
    data: bytes,
    filename: str = "",
    static_dir: Path | None = None,
    storage_subdir: str | Path | None = None
):
    image_kind = detect_image_kind(data)

    if not image_kind:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG, GIF, WebP, and SVG images are supported"
        )

    root_dir = static_dir or STATIC_DIR
    relative_subdir = safe_static_relative_path(storage_subdir) if storage_subdir else None

    if storage_subdir and not relative_subdir:
        raise HTTPException(status_code=400, detail="Invalid upload folder")

    target_dir = root_dir / relative_subdir if relative_subdir else root_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    extension = safe_image_extension(filename, image_kind)

    while True:
        stored_filename = f"{uuid4().hex}{extension}"
        file_path = target_dir / stored_filename

        if not file_path.exists():
            break

    file_path.write_bytes(data)
    relative_url_path = (
        f"{relative_subdir}/{stored_filename}"
        if relative_subdir
        else stored_filename
    )

    return {"url": f"{STATIC_URL_PREFIX}{relative_url_path}"}


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

    return store_image_bytes(
        data,
        filename=upload_file.filename,
        static_dir=static_dir,
        storage_subdir=storage_subdir
    )


def filename_from_url(url):
    parsed = urlparse(str(url or "").strip())
    filename = Path(unquote(parsed.path)).name

    return filename or "image"


def assert_remote_url_has_public_host(parsed):
    hostname = str(parsed.hostname or "").strip().rstrip(".").lower()

    if not hostname or hostname in FORBIDDEN_REMOTE_HOSTNAMES:
        raise HTTPException(status_code=400, detail="Image URL host is not allowed")

    try:
        address_infos = getaddrinfo(hostname, None)
    except gaierror as error:
        raise HTTPException(
            status_code=400,
            detail="Image URL host could not be resolved"
        ) from error

    for address_info in address_infos:
        address = address_info[4][0]

        if not ip_address(address).is_global:
            raise HTTPException(status_code=400, detail="Image URL host is not allowed")


def store_remote_image(
    url,
    static_dir: Path | None = None,
    storage_subdir: str | Path | None = None,
    max_bytes=IMAGE_UPLOAD_MAX_BYTES
):
    src = str(url or "").strip()
    parsed = urlparse(src)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Enter a valid http(s) image URL")

    assert_remote_url_has_public_host(parsed)

    request = Request(
        src,
        headers={
            "User-Agent": REMOTE_IMAGE_USER_AGENT,
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
    )

    try:
        with urlopen(request, timeout=REMOTE_IMAGE_TIMEOUT_SECONDS) as response:
            content_type = response.headers.get("Content-Type", "").lower()

            if content_type and not content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="URL did not return an image")

            data = read_remote_bytes(response, max_bytes=max_bytes)
    except HTTPException:
        raise
    except HTTPError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Image URL returned HTTP {error.code}"
        ) from error
    except (URLError, SocketTimeout, TimeoutError, ValueError) as error:
        raise HTTPException(
            status_code=400,
            detail="Image URL could not be downloaded"
        ) from error

    return store_image_bytes(
        data,
        filename=filename_from_url(src),
        static_dir=static_dir,
        storage_subdir=storage_subdir
    )


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
