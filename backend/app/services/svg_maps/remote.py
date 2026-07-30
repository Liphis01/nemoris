from ipaddress import ip_address
from socket import gaierror, getaddrinfo, timeout as SocketTimeout
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import HTTPException

from .canonicalize import MAX_INPUT_BYTES


MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10
CHUNK_SIZE = 1024 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _validate_public_url(url):
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Enter a valid public http(s) SVG URL")
    hostname = str(parsed.hostname or "").rstrip(".").lower()
    if not hostname or hostname in {"localhost", "localhost.localdomain"}:
        raise HTTPException(status_code=400, detail="SVG URL host is not allowed")
    try:
        infos = getaddrinfo(hostname, parsed.port or 443)
    except gaierror as error:
        raise HTTPException(status_code=400, detail="SVG URL host could not be resolved") from error
    if any(not ip_address(info[4][0]).is_global for info in infos):
        raise HTTPException(status_code=400, detail="SVG URL host is not allowed")
    return parsed.geturl()


def _read_bounded(response):
    content_length = response.headers.get("Content-Length")
    if content_length:
        try:
            if int(content_length) > MAX_INPUT_BYTES:
                raise HTTPException(status_code=413, detail="SVG is larger than 10 MiB")
        except ValueError:
            pass
    chunks = []
    total = 0
    while True:
        chunk = response.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_INPUT_BYTES:
            raise HTTPException(status_code=413, detail="SVG is larger than 10 MiB")
        chunks.append(chunk)
    return b"".join(chunks)


def fetch_svg_url(url):
    current = _validate_public_url(url)
    opener = build_opener(_NoRedirect)

    for redirect_count in range(MAX_REDIRECTS + 1):
        request = Request(
            current,
            headers={
                "User-Agent": "Nemoris SVG map importer",
                "Accept": "image/svg+xml,application/xml,text/xml;q=0.9",
            },
        )
        try:
            response = opener.open(request, timeout=TIMEOUT_SECONDS)
        except HTTPError as error:
            if error.code in {301, 302, 303, 307, 308}:
                location = error.headers.get("Location")
                if not location or redirect_count >= MAX_REDIRECTS:
                    raise HTTPException(
                        status_code=400, detail="SVG URL redirected too many times"
                    ) from error
                current = _validate_public_url(urljoin(current, location))
                continue
            hostname = str(urlparse(current).hostname or "").lower()
            if error.code == 403 and (
                hostname == "jetpunk.com" or hostname.endswith(".jetpunk.com")
            ):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "svg.jetpunk_fetch_blocked",
                        "message": (
                            "JetPunk blocked the server download. Download the SVG "
                            "in your browser, then upload the file to Nemoris."
                        ),
                    },
                ) from error
            raise HTTPException(
                status_code=400,
                detail=f"SVG URL returned HTTP {error.code}"
            ) from error
        except (URLError, SocketTimeout, TimeoutError, ValueError) as error:
            raise HTTPException(
                status_code=400, detail="SVG URL could not be downloaded"
            ) from error

        with response:
            content_type = response.headers.get("Content-Type", "").lower()
            if content_type and not any(
                value in content_type
                for value in ("svg", "xml", "text/plain", "application/octet-stream")
            ):
                raise HTTPException(status_code=400, detail="URL did not return an SVG")
            return _read_bounded(response)

    raise HTTPException(status_code=400, detail="SVG URL redirected too many times")
