import hashlib
from ipaddress import ip_address
from pathlib import Path, PurePosixPath
from socket import gaierror, getaddrinfo, timeout as SocketTimeout
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen
from uuid import uuid4
from xml.etree import ElementTree

from fastapi import HTTPException
from sqlalchemy import or_

from ..config import STATIC_DIR
from ..models import MediaFile, Question, QuestionGroup
from .media_pool import question_media_refs
from .tombstones import record_tombstone


IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
# Audio/video files are much larger than images, so answer media (the only place
# audio/video is accepted today) gets a bigger cap.
MEDIA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
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
SAFE_AUDIO_EXTENSIONS = {
    ".mp3": "mp3",
    ".wav": "wav",
    ".ogg": "ogg",
    ".oga": "ogg",
    ".m4a": "m4a",
    ".m4b": "m4a",
    ".aac": "m4a"
}
SAFE_VIDEO_EXTENSIONS = {
    ".mp4": "mp4",
    ".m4v": "mp4",
    ".webm": "webm"
}
SAFE_MEDIA_EXTENSIONS = {
    **SAFE_IMAGE_EXTENSIONS,
    **SAFE_AUDIO_EXTENSIONS,
    **SAFE_VIDEO_EXTENSIONS
}
DEFAULT_EXTENSION_BY_KIND = {
    "gif": ".gif",
    "jpeg": ".jpg",
    "png": ".png",
    "svg": ".svg",
    "webp": ".webp",
    "mp3": ".mp3",
    "wav": ".wav",
    "ogg": ".ogg",
    "m4a": ".m4a",
    "mp4": ".mp4",
    "webm": ".webm"
}
IMAGE_KINDS = {"gif", "jpeg", "png", "svg", "webp"}
AUDIO_KINDS = {"mp3", "wav", "ogg", "m4a"}
VIDEO_KINDS = {"mp4", "webm"}
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

    # A DOCTYPE is common in otherwise static SVG 1.1 map files. ElementTree
    # does not fetch an external DTD here, so the declaration itself is safe;
    # keep rejecting entity declarations, which are the part that can expand
    # content or reference external resources.
    if "<!entity" in lowered or "javascript:" in lowered:
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


def detect_audio_kind(data: bytes):
    # MP3: an ID3v2 tag or a raw MPEG audio frame sync (0xFF Ex/Fx).
    if data.startswith(b"ID3"):
        return "mp3"

    if len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        return "mp3"

    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"

    if data.startswith(b"OggS"):
        return "ogg"

    # ISO base media (M4A/AAC audio) shares the "ftyp" box with MP4 video and is
    # told apart by its major brand.
    if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in {b"M4A ", b"M4B "}:
        return "m4a"

    return None


def detect_video_kind(data: bytes):
    # WebM/Matroska starts with the EBML header.
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"

    # Any other ISO base media "ftyp" box is treated as MP4 video.
    if len(data) >= 8 and data[4:8] == b"ftyp":
        return "mp4"

    return None


def detect_media_kind(data: bytes, allow_audio_video: bool = False):
    kind = detect_image_kind(data)

    if kind:
        return kind

    if allow_audio_video:
        return detect_audio_kind(data) or detect_video_kind(data)

    return None


def safe_media_extension(filename: str, media_kind: str):
    extension = Path(filename or "").suffix.lower()

    if SAFE_MEDIA_EXTENSIONS.get(extension) == media_kind:
        return extension

    return DEFAULT_EXTENSION_BY_KIND[media_kind]


def media_kind_from_name(value):
    # Coarse image/audio/video classification from a filename or URL extension,
    # mirroring the frontend getMediaKind so audio-only groups can be detected
    # server-side. Empty stays empty; unknown/extensionless falls back to image.
    src = str(value or "").strip()

    if not src:
        return ""

    extension = Path(src.split("?", 1)[0].split("#", 1)[0]).suffix.lower()

    if extension in SAFE_AUDIO_EXTENSIONS:
        return "audio"

    if extension in SAFE_VIDEO_EXTENSIONS:
        return "video"

    return "image"


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


def store_media_bytes(
    data: bytes,
    filename: str = "",
    static_dir: Path | None = None,
    storage_subdir: str | Path | None = None,
    allow_audio_video: bool = False,
    db=None,
    commit=True
):
    media_kind = detect_media_kind(data, allow_audio_video=allow_audio_video)

    if not media_kind:
        detail = (
            "Only JPEG, PNG, GIF, WebP, SVG images, MP3/WAV/OGG/M4A audio, "
            "and MP4/WebM video are supported"
            if allow_audio_video
            else "Only JPEG, PNG, GIF, WebP, and SVG images are supported"
        )
        raise HTTPException(status_code=400, detail=detail)

    root_dir = static_dir or STATIC_DIR
    relative_subdir = safe_static_relative_path(storage_subdir) if storage_subdir else None

    if storage_subdir and not relative_subdir:
        raise HTTPException(status_code=400, detail="Invalid upload folder")

    target_dir = root_dir / relative_subdir if relative_subdir else root_dir
    extension = safe_media_extension(filename, media_kind)
    digest = hashlib.sha256(data).hexdigest()

    # Content dedup: identical bytes already registered means the upload can
    # reuse the existing file instead of storing a copy (sync-roadmap 0.5).
    if db is not None:
        existing = (
            db.query(MediaFile)
            .filter(MediaFile.sha256 == digest)
            .first()
        )

        if existing and (root_dir / existing.path).exists():
            return {
                "url": f"{STATIC_URL_PREFIX}{existing.path}",
                "sha256": digest,
                "deduplicated": True,
                "created_file": False,
                "stored_path": existing.path
            }

    target_dir.mkdir(parents=True, exist_ok=True)

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

    if db is not None:
        db.add(MediaFile(
            path=relative_url_path,
            sha256=digest,
            byte_size=len(data)
        ))
        if commit:
            db.commit()

    return {
        "url": f"{STATIC_URL_PREFIX}{relative_url_path}",
        "sha256": digest,
        "created_file": True,
        "stored_path": relative_url_path
    }


def store_uploaded_image(
    upload_file,
    static_dir: Path | None = None,
    storage_subdir: str | Path | None = None,
    max_bytes=IMAGE_UPLOAD_MAX_BYTES,
    allow_audio_video: bool = False,
    db=None
):
    content_type = (getattr(upload_file, "content_type", "") or "").lower()
    allowed_prefixes = (
        ("image/", "audio/", "video/") if allow_audio_video else ("image/",)
    )

    if content_type and not content_type.startswith(allowed_prefixes):
        detail = (
            "Only image, audio, or video uploads are supported"
            if allow_audio_video
            else "Only image uploads are supported"
        )
        raise HTTPException(status_code=400, detail=detail)

    data = read_upload_bytes(upload_file, max_bytes=max_bytes)

    return store_media_bytes(
        data,
        filename=upload_file.filename,
        static_dir=static_dir,
        storage_subdir=storage_subdir,
        allow_audio_video=allow_audio_video,
        db=db
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
    max_bytes=IMAGE_UPLOAD_MAX_BYTES,
    allow_audio_video: bool = False,
    db=None
):
    src = str(url or "").strip()
    parsed = urlparse(src)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Enter a valid http(s) media URL")

    assert_remote_url_has_public_host(parsed)

    accept_header = (
        "image/*,audio/*,video/*,*/*;q=0.8"
        if allow_audio_video
        else "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    )
    allowed_prefixes = (
        ("image/", "audio/", "video/") if allow_audio_video else ("image/",)
    )

    request = Request(
        src,
        headers={
            "User-Agent": REMOTE_IMAGE_USER_AGENT,
            "Accept": accept_header
        }
    )

    try:
        with urlopen(request, timeout=REMOTE_IMAGE_TIMEOUT_SECONDS) as response:
            content_type = response.headers.get("Content-Type", "").lower()

            if content_type and not content_type.startswith(allowed_prefixes):
                detail = (
                    "URL did not return an image, audio, or video file"
                    if allow_audio_video
                    else "URL did not return an image"
                )
                raise HTTPException(status_code=400, detail=detail)

            data = read_remote_bytes(response, max_bytes=max_bytes)
    except HTTPException:
        raise
    except HTTPError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Media URL returned HTTP {error.code}"
        ) from error
    except (URLError, SocketTimeout, TimeoutError, ValueError) as error:
        raise HTTPException(
            status_code=400,
            detail="Media URL could not be downloaded"
        ) from error

    return store_media_bytes(
        data,
        filename=filename_from_url(src),
        static_dir=static_dir,
        storage_subdir=storage_subdir,
        allow_audio_video=allow_audio_video,
        db=db
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


def removed_media_refs(old_refs, new_refs):
    # Which of a question's old media refs are no longer pointed at by the new
    # set, so a replaced/removed pool image can be garbage-collected.
    return [
        old
        for old in old_refs
        if not any(
            media_points_to_same_static_file(old, new)
            for new in new_refs
        )
    ]


def is_static_media_referenced(db, relative_path):
    if not relative_path:
        return False

    # Pool images live in Question.data["media_pool"], so the scan has to reach
    # into data too or a still-referenced pool image would be pruned.
    question_media_rows = (
        db.query(Question.media, Question.answer_media, Question.data)
        .filter(
            or_(
                Question.media.isnot(None),
                Question.answer_media.isnot(None),
                Question.data.isnot(None)
            )
        )
        .all()
    )

    if any(
        static_relative_path_from_media(ref) == relative_path
        for (media, answer_media, data) in question_media_rows
        for ref in question_media_refs(media, answer_media, data)
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
        _unregister_media_file(db, relative_path)
        return True

    return False


def get_media_file_by_path(db, relative_path):
    if not relative_path:
        return None

    return (
        db.query(MediaFile)
        .filter(MediaFile.path == relative_path)
        .first()
    )


def _unregister_media_file(db, relative_path):
    # Keep the registry in step with the disk and leave a media tombstone so
    # sync can propagate the deletion (the guid of a media file is its hash).
    row = get_media_file_by_path(db, relative_path)

    if row is None:
        return

    still_referenced = (
        db.query(MediaFile)
        .filter(MediaFile.sha256 == row.sha256, MediaFile.id != row.id)
        .count()
    )

    if not still_referenced:
        record_tombstone(db, "media", row.sha256)

    db.delete(row)
    db.commit()


def delete_unreferenced_media_files(db, media_values, static_dir: Path | None = None):
    deleted = []

    for media in media_values:
        if delete_unreferenced_media_file(db, media, static_dir=static_dir):
            deleted.append(media)

    return deleted
