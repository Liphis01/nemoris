import io
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen
from zipfile import BadZipFile, ZipFile

from sqlalchemy.orm import joinedload

from ..models import Collection, PackSubscription, Question, QuestionGroup
from .map_zones import merge_tags
from .pack_publish_state import (
    is_pack_publisher_signed_in,
    load_pack_publish_state,
    save_pack_publish_state
)
from .packs import (
    GROUP_HASH_FIELDS,
    QUESTION_HASH_FIELDS,
    _read_manifest_and_content,
    content_hash,
    export_pack,
    export_playlist_pack
)
from .settings import get_pack_catalog_settings
from .tag_hierarchy import (
    CORE_ROOT_IDS,
    ancestors,
    ensure_stored_tag_ids,
    label_for_tag,
    load_tag_hierarchy,
    parent_map,
    resolve_tag_id
)
from .sync_state import (
    is_signed_in as is_sync_signed_in,
    load_sync_state,
    save_sync_state
)


CATALOG_BUCKET = "pack-zips"
POPULAR_THEME = "__popular__"
VALID_SORTS = {"pertinence", "populaires", "récents", "nom", "questions", "note"}
VALID_STATUSES = {
    "all",
    "not_installed",
    "update_available",
    "up_to_date",
    "local_copy"
}
MAX_LIMIT = 60
HEALTH_SAMPLE_LIMIT = 3
PUBLISH_TIMEOUT = 12
PUBLISH_TRANSFER_TIMEOUT = 60


class PackCatalogError(ValueError):
    pass


class PackCatalogAuthError(PackCatalogError):
    pass


def normalize_supabase_url(url):
    base = str(url or "").strip().rstrip("/")

    for suffix in ("/rest/v1", "/auth/v1", "/storage/v1"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]

    return base.rstrip("/")


def _catalog_check(id, label, status, detail):
    return {
        "id": id,
        "label": label,
        "status": status,
        "detail": detail
    }


def _catalog_status(checks):
    statuses = {check.get("status") for check in checks}

    if "error" in statuses:
        return "error"

    if "warning" in statuses:
        return "warning"

    return "ok"


def _key_type(key):
    value = str(key or "").strip()

    if value.startswith("sb_publishable_"):
        return "publishable"

    if value.startswith("sb_secret_"):
        return "secret"

    if value.startswith("eyJ"):
        return "legacy_jwt"

    return "unknown" if value else "missing"


def _url_problem(raw_url, project_url):
    raw = str(raw_url or "").strip()

    if not raw:
        return "missing", "URL du projet Supabase manquante."

    parsed = urlparse(project_url)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return "invalid", "URL Supabase invalide."

    if "/storage/v1/object/" in raw or raw.endswith(".json"):
        return (
            "storage_object",
            "Utilise l'URL du projet, pas une URL de fichier Storage."
        )

    return None, ""


def _message_from_body(body):
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None

    if isinstance(payload, dict):
        return (
            payload.get("message")
            or payload.get("msg")
            or payload.get("error_description")
            or payload.get("error")
        )

    return None


def _supabase_headers(key):
    headers = {
        "apikey": key,
        "Content-Type": "application/json"
    }

    # New Supabase publishable keys are not JWTs. Sending them as a bearer
    # token makes PostgREST try to parse them as JWTs and reject the request.
    if str(key or "").startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"

    return headers


def _post_json(url, key, payload):
    request = Request(
        f"{url}/rest/v1/rpc/search_pack_catalog",
        data=json.dumps(payload).encode("utf-8"),
        headers=_supabase_headers(key),
        method="POST"
    )

    try:
        with urlopen(request, timeout=12) as response:
            body = response.read()
    except HTTPError as error:
        body = error.read()
        raise PackCatalogError(
            _message_from_body(body)
            or f"Catalogue Supabase impossible à charger ({error.code})."
        ) from error
    except (TimeoutError, URLError, ValueError) as error:
        raise PackCatalogError(
            "Catalogue Supabase inaccessible."
        ) from error

    if not body:
        return {}

    try:
        return json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise PackCatalogError(
            "Réponse Supabase invalide."
        ) from error


def _probe_download_url(url):
    if not url:
        return "error", "URL ZIP absente."

    request = Request(url, method="HEAD")

    try:
        with urlopen(request, timeout=8) as response:
            return "ok", f"ZIP accessible ({response.status})."
    except HTTPError as error:
        # Some object hosts do not support HEAD. Confirm with a one-byte GET
        # before reporting a broken ZIP.
        if error.code in {400, 403, 405}:
            range_request = Request(
                url,
                headers={"Range": "bytes=0-0"},
                method="GET"
            )

            try:
                with urlopen(range_request, timeout=8) as response:
                    return "ok", f"ZIP accessible ({response.status})."
            except HTTPError as range_error:
                return "error", f"ZIP inaccessible ({range_error.code})."
            except (TimeoutError, URLError, ValueError) as range_error:
                return "error", f"ZIP inaccessible ({range_error})."

        return "error", f"ZIP inaccessible ({error.code})."
    except (TimeoutError, URLError, ValueError) as error:
        return "error", f"ZIP inaccessible ({error})."


def _installed_versions(db):
    subscriptions = db.query(PackSubscription).all()
    return {
        subscription.pack_guid: subscription.installed_version
        for subscription in subscriptions
    }


def _int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _local_pack_state(db):
    subscriptions = {
        subscription.pack_guid: {
            "installed_version": subscription.installed_version,
            "name": subscription.name
        }
        for subscription in db.query(PackSubscription).all()
    }
    groups = {}

    for group_id, guid, pack_guid, pack_version, name in (
        db.query(
            QuestionGroup.id,
            QuestionGroup.guid,
            QuestionGroup.pack_guid,
            QuestionGroup.pack_version,
            QuestionGroup.name
        )
        .all()
    ):
        groups[guid] = {
            "id": group_id,
            "pack_guid": pack_guid,
            "pack_version": pack_version,
            "name": name
        }

    return subscriptions, groups


def _annotate_publication_sources(db, publications):
    """Link each published pack back to the local content it came from.

    Deliberately separate from _annotate_local_pack_status: that answers "have
    I installed this pack", which is a different question from "does the group
    or playlist I published from still exist". Deleting the source locally
    never touches the catalog row, so a published pack can outlive it and stay
    installable by everyone else -- the dashboard has to be able to say so.
    """
    guids = [
        entry.get("pack_guid")
        for entry in publications
        if entry.get("pack_guid")
    ]

    if not guids:
        return publications

    groups = {
        guid: {"id": group_id, "name": name}
        for group_id, guid, name in (
            db.query(QuestionGroup.id, QuestionGroup.guid, QuestionGroup.name)
            .filter(QuestionGroup.guid.in_(guids))
            .all()
        )
    }
    collections = {
        guid: {"id": collection_id, "name": name}
        for collection_id, guid, name in (
            db.query(Collection.id, Collection.guid, Collection.name)
            .filter(Collection.guid.in_(guids))
            .all()
        )
    }

    for entry in publications:
        pack_guid = entry.get("pack_guid")
        group = groups.get(pack_guid)
        collection = collections.get(pack_guid)
        source = group or collection

        entry["source"] = {
            "kind": "group" if group else ("playlist" if collection else None),
            "id": source["id"] if source else None,
            "name": source["name"] if source else None
        }
        entry["orphaned"] = source is None

    return publications


def _annotate_local_pack_status(db, packs):
    subscriptions, groups = _local_pack_state(db)

    for entry in packs:
        pack_guid = entry.get("pack_guid")
        subscription = subscriptions.get(pack_guid)
        group = groups.get(pack_guid)
        catalog_version = _int_or_none(entry.get("version"))
        installed_version = (
            _int_or_none(subscription.get("installed_version"))
            if subscription else None
        )
        local_pack_version = (
            _int_or_none(group.get("pack_version"))
            if group else None
        )
        status = "not_installed"

        if subscription:
            status = (
                "update_available"
                if (
                    installed_version is not None
                    and catalog_version is not None
                    and installed_version < catalog_version
                )
                else "up_to_date"
            )
        elif group:
            status = "local_copy"

        is_mine = bool(entry.get("is_mine")) or bool(
            group and not group.get("pack_guid")
        )
        entry["is_mine"] = is_mine
        entry["local_status"] = {
            "status": status,
            "is_mine": is_mine,
            "has_local_content": bool(subscription or group),
            "installed_version": installed_version,
            "local_pack_version": local_pack_version,
            "local_group_id": group.get("id") if group else None,
            "local_group_name": group.get("name") if group else None
        }


def _clamp_limit(limit):
    try:
        parsed = int(limit)
    except (TypeError, ValueError):
        parsed = 24

    return max(1, min(parsed, MAX_LIMIT))


def _cursor_offset(cursor):
    if cursor in (None, ""):
        return 0

    try:
        return max(0, int(cursor))
    except (TypeError, ValueError):
        return 0


def _public_storage_url(project_url, storage_path):
    path = str(storage_path or "").strip().lstrip("/")

    if not path:
        return ""

    return (
        f"{project_url}/storage/v1/object/public/"
        f"{CATALOG_BUCKET}/{quote(path, safe='/')}"
    )


def _normalize_pack(row, project_url):
    if not isinstance(row, dict):
        return None

    entry = {
        "pack_guid": str(row.get("pack_guid") or row.get("blueprint_guid") or ""),
        "name": str(row.get("name") or "Pack sans titre"),
        "description": str(row.get("description") or ""),
        "type_group": str(row.get("type_group") or "text"),
        "question_count": row.get("question_count"),
        "version": row.get("version") or 1,
        "size_bytes": row.get("size_bytes"),
        "license": str(row.get("license") or ""),
        "tags": row.get("tags") if isinstance(row.get("tags"), list) else [],
        "themes": row.get("themes") if isinstance(row.get("themes"), list) else [],
        "download_count": row.get("download_count"),
        "featured": bool(row.get("featured")),
        "is_mine": bool(row.get("is_mine")),
        "published_at": row.get("published_at"),
        "updated_at": row.get("updated_at"),
        "avg_rating": _float_or_none(row.get("avg_rating")),
        "rating_count": _int_or_none(row.get("rating_count")) or 0,
        "comment_count": _int_or_none(row.get("comment_count")) or 0
    }
    entry["download_url"] = (
        str(row.get("download_url") or "").strip()
        or _public_storage_url(project_url, row.get("storage_path"))
    )

    if not entry["pack_guid"]:
        return None

    return entry


def _theme_label(value):
    return str(value or "").replace("-", " ").strip().capitalize()


def _normalize_theme(raw):
    if isinstance(raw, str):
        value = raw.strip()
        return {
            "value": value,
            "label": _theme_label(value),
            "result_count": None,
            "download_count": 0,
            "featured": False,
            "pinned": False
        }

    if not isinstance(raw, dict):
        return None

    value = str(raw.get("value") or raw.get("theme") or "").strip()

    if not value:
        return None

    result_count = raw.get("result_count")

    if result_count is None:
        result_count = raw.get("count")

    download_count = raw.get("download_count")

    if download_count is None:
        download_count = 0

    return {
        "value": value,
        "label": str(raw.get("label") or _theme_label(value)),
        "result_count": _int_or_none(result_count),
        "download_count": _int_or_none(download_count) or 0,
        "featured": bool(raw.get("featured")),
        "pinned": bool(raw.get("pinned"))
    }


def _theme_score(theme):
    return (
        int(theme.get("download_count") or 0),
        int(theme.get("result_count") or 0),
        1 if theme.get("pinned") else 0,
        1 if theme.get("featured") else 0
    )


def _ordered_themes(themes, total, global_total=None):
    normalized = []
    seen = set()
    popular_count = _int_or_none(global_total)

    if popular_count is None:
        popular_count = _int_or_none(total)

    if popular_count is None:
        popular_count = 0

    for raw in themes:
        theme = _normalize_theme(raw)

        if not theme or theme["value"] in seen:
            continue

        seen.add(theme["value"])
        normalized.append(theme)

    normalized.sort(
        key=lambda theme: (
            -_theme_score(theme)[0],
            -_theme_score(theme)[1],
            -_theme_score(theme)[2],
            -_theme_score(theme)[3],
            theme["label"].casefold()
        )
    )

    if popular_count or normalized:
        return [
            {
                "value": POPULAR_THEME,
                "label": "Populaires",
                "result_count": popular_count,
                "download_count": None,
                "featured": True,
                "pinned": True
            },
            *normalized
        ]

    return normalized


def _normalize_response(payload, project_url):
    if isinstance(payload, list):
        payload = payload[0] if payload else {}

    if not isinstance(payload, dict):
        raise PackCatalogError("Réponse Supabase invalide.")

    rows = payload.get("packs")
    if rows is None:
        rows = payload.get("blueprints")
    if rows is None and isinstance(payload.get("data"), list):
        rows = payload["data"]

    packs = [
        entry
        for entry in (
            _normalize_pack(row, project_url)
            for row in (rows if isinstance(rows, list) else [])
        )
        if entry
    ]
    facets = payload.get("facets") if isinstance(payload.get("facets"), dict) else {}
    total = _int_or_none(payload.get("total"))

    if total is None:
        total = len(packs)

    global_total = facets.get("global_total")

    if global_total is None:
        global_total = payload.get("global_total")

    global_total = _int_or_none(global_total)

    if global_total is None:
        global_total = total

    return {
        "packs": packs,
        "facets": {
            "themes": _ordered_themes(
                facets.get("themes") or [],
                total,
                global_total=global_total
            ),
            "global_total": global_total
        },
        "total": total,
        "next_cursor": (
            str(payload.get("next_cursor"))
            if payload.get("next_cursor") not in (None, "")
            else None
        )
    }


def search_pack_catalog(
    db,
    *,
    query="",
    theme="",
    type_group="",
    status="all",
    sort="pertinence",
    limit=24,
    cursor=None
):
    settings = get_pack_catalog_settings()
    project_url = normalize_supabase_url(settings.get("url"))
    key = str(settings.get("key") or "").strip()

    if not project_url or not key:
        raise PackCatalogError(
            "Catalogue Supabase non configuré."
        )

    normalized_status = status if status in VALID_STATUSES else "all"
    remote_status = (
        "all" if normalized_status == "local_copy" else normalized_status
    )
    normalized_sort = sort if sort in VALID_SORTS else "pertinence"
    normalized_theme = str(theme or "").strip()

    if normalized_theme == POPULAR_THEME:
        normalized_theme = ""
        normalized_sort = "populaires"

    payload = {
        "p_query": str(query or "").strip(),
        "p_theme": normalized_theme,
        "p_type_group": str(type_group or "").strip(),
        "p_status": remote_status,
        "p_sort": normalized_sort,
        "p_limit": _clamp_limit(limit),
        "p_cursor": _cursor_offset(cursor),
        "p_installed_versions": _installed_versions(db)
    }

    response = _post_json(project_url, key, payload)
    result = _normalize_response(response, project_url)
    _annotate_local_pack_status(db, result["packs"])

    if normalized_status in {"local_copy", "not_installed"}:
        result["packs"] = [
            entry
            for entry in result["packs"]
            if entry.get("local_status", {}).get("status") == normalized_status
        ]

        if normalized_status == "local_copy":
            result["total"] = len(result["packs"])
            result["next_cursor"] = None

    return result


def check_pack_catalog_health(db):
    settings = get_pack_catalog_settings()
    raw_url = str(settings.get("url") or "").strip()
    project_url = normalize_supabase_url(raw_url)
    key = str(settings.get("key") or "").strip()
    key_type = _key_type(key)
    checks = []
    packs = []
    total = 0
    next_cursor = None

    problem, detail = _url_problem(raw_url, project_url)
    if problem:
        checks.append(_catalog_check("project_url", "URL projet", "error", detail))
    elif ".supabase.co" not in urlparse(project_url).netloc:
        checks.append(_catalog_check(
            "project_url",
            "URL projet",
            "warning",
            "URL valide, mais ce n'est pas un domaine Supabase standard."
        ))
    else:
        checks.append(_catalog_check(
            "project_url",
            "URL projet",
            "ok",
            "URL projet Supabase valide."
        ))

    if key_type == "missing":
        checks.append(_catalog_check(
            "api_key",
            "Clé publique",
            "error",
            "Clé publishable Supabase manquante."
        ))
    elif key_type == "secret":
        checks.append(_catalog_check(
            "api_key",
            "Clé publique",
            "error",
            "Clé secrète détectée : utilise une clé publishable."
        ))
    elif key_type == "unknown":
        checks.append(_catalog_check(
            "api_key",
            "Clé publique",
            "warning",
            "Format de clé non reconnu."
        ))
    else:
        checks.append(_catalog_check(
            "api_key",
            "Clé publique",
            "ok",
            "Clé publique reconnue."
        ))

    if not any(check["status"] == "error" for check in checks):
        payload = {
            "p_query": "",
            "p_theme": "",
            "p_type_group": "",
            "p_status": "all",
            "p_sort": "populaires",
            "p_limit": HEALTH_SAMPLE_LIMIT,
            "p_cursor": 0,
            "p_installed_versions": _installed_versions(db)
        }

        try:
            response = _post_json(project_url, key, payload)
            normalized = _normalize_response(response, project_url)
            packs = normalized["packs"]
            total = normalized["total"]
            next_cursor = normalized["next_cursor"]
            checks.append(_catalog_check(
                "search_rpc",
                "Recherche Supabase",
                "ok",
                "Fonction search_pack_catalog disponible."
            ))
        except PackCatalogError as error:
            checks.append(_catalog_check(
                "search_rpc",
                "Recherche Supabase",
                "error",
                str(error)
            ))

    if any(check["id"] == "search_rpc" and check["status"] == "ok" for check in checks):
        if total > 0:
            checks.append(_catalog_check(
                "public_rows",
                "Packs publics",
                "ok",
                f"{total} pack{'s' if total != 1 else ''} public{'s' if total != 1 else ''}."
            ))
        else:
            checks.append(_catalog_check(
                "public_rows",
                "Packs publics",
                "warning",
                "Aucun pack public trouvé."
            ))

    samples = []
    if packs:
        download_checks = []

        for entry in packs[:HEALTH_SAMPLE_LIMIT]:
            download_status, download_detail = _probe_download_url(
                entry.get("download_url")
            )
            download_checks.append(download_status)
            samples.append({
                "pack_guid": entry.get("pack_guid"),
                "name": entry.get("name"),
                "download_url": entry.get("download_url"),
                "download_status": download_status,
                "download_detail": download_detail
            })

        if "error" in download_checks:
            checks.append(_catalog_check(
                "zip_files",
                "Fichiers ZIP",
                "error",
                "Au moins un ZIP public est inaccessible."
            ))
        else:
            checks.append(_catalog_check(
                "zip_files",
                "Fichiers ZIP",
                "ok",
                f"{len(samples)} ZIP testés."
            ))

    status = _catalog_status(checks)
    summary_by_status = {
        "ok": "Catalogue prêt.",
        "warning": "Catalogue utilisable, avec points à vérifier.",
        "error": "Catalogue bloqué."
    }

    return {
        "status": status,
        "summary": summary_by_status[status],
        "configured": bool(raw_url and key),
        "project_url": project_url,
        "key_type": key_type,
        "total": total,
        "next_cursor": next_cursor,
        "checks": checks,
        "sample_packs": samples
    }


def _publish_config(db):
    settings = get_pack_catalog_settings()
    project_url = normalize_supabase_url(settings.get("url"))
    key = str(settings.get("key") or "").strip()

    if not project_url or not key:
        raise PackCatalogError("Catalogue Supabase non configuré.")

    return project_url, key


def _supabase_request_headers(key, access_token=None, content_type=None):
    headers = {"apikey": key}

    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    elif str(key or "").startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"

    if content_type:
        headers["Content-Type"] = content_type

    return headers


def _supabase_request(
    project_url,
    key,
    path,
    *,
    method="GET",
    access_token=None,
    payload=None,
    body=None,
    headers=None,
    timeout=PUBLISH_TIMEOUT
):
    data = body
    all_headers = _supabase_request_headers(
        key,
        access_token=access_token,
        content_type="application/json" if payload is not None else None
    )

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    if headers:
        all_headers.update(headers)

    request = Request(
        f"{project_url}{path}",
        data=data,
        headers=all_headers,
        method=method
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except HTTPError as error:
        return error.code, dict(error.headers), error.read()
    except (TimeoutError, URLError, ValueError) as error:
        raise PackCatalogError("Catalogue Supabase inaccessible.") from error


def _decode_json_body(body):
    if not body:
        return {}

    try:
        return json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise PackCatalogError("Réponse Supabase invalide.") from error


def _raise_supabase_status(status, body, fallback):
    if status < 400:
        return

    raise PackCatalogError(
        _message_from_body(body) or f"{fallback} ({status})."
    )


def _verify_payloads(email, value):
    value = str(value or "").strip()

    if "://" in value or "verify?" in value:
        query = parse_qs(urlparse(value).query)
        token_hash = (query.get("token") or [None])[0]
        link_type = (query.get("type") or ["magiclink"])[0]

        if not token_hash:
            raise PackCatalogAuthError(
                "Lien invalide : colle le lien complet de l'e-mail."
            )

        return [
            {"type": link_type, "token_hash": token_hash},
            {"type": "email", "token_hash": token_hash}
        ]

    return [{"type": "email", "email": email, "token": value}]


def _refresh_publish_token(project_url, key, token):
    refresh_token = (token or {}).get("refresh_token")

    if not refresh_token:
        raise PackCatalogAuthError("Session expirée : reconnecte-toi.")

    status, _, body = _supabase_request(
        project_url,
        key,
        "/auth/v1/token?grant_type=refresh_token",
        method="POST",
        payload={"refresh_token": refresh_token}
    )

    if status >= 400:
        raise PackCatalogAuthError(
            _message_from_body(body) or "Session expirée : reconnecte-toi."
        )

    data = _decode_json_body(body)

    if not data.get("access_token"):
        raise PackCatalogAuthError("Session expirée : reconnecte-toi.")

    return {
        **token,
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or refresh_token
    }


def _valid_token_state(state):
    return (
        isinstance(state, dict)
        and isinstance(state.get("token"), dict)
        and bool(state["token"].get("access_token"))
        and bool(state["token"].get("user_id"))
    )


def _sync_state_matches_catalog(state, project_url):
    return (
        is_sync_signed_in(state)
        and _valid_token_state(state)
        and normalize_supabase_url(state.get("server_url")) == project_url
    )


def _effective_publish_state(project_url, *, required=True):
    sync_state = load_sync_state()

    if _sync_state_matches_catalog(sync_state, project_url):
        return sync_state, "sync"

    publish_state = load_pack_publish_state()

    if is_pack_publisher_signed_in(publish_state) and _valid_token_state(
        publish_state
    ):
        return publish_state, "catalog"

    if required:
        raise PackCatalogAuthError("Connexion Supabase requise.")

    return None, None


def _save_effective_publish_state(state, source):
    if source == "sync":
        save_sync_state(state)
    else:
        save_pack_publish_state(state)


def _authed_supabase_request(
    db,
    path,
    *,
    method="GET",
    payload=None,
    body=None,
    headers=None,
    timeout=PUBLISH_TIMEOUT
):
    project_url, key = _publish_config(db)
    state, source = _effective_publish_state(project_url)
    token = state["token"]

    status, response_headers, response_body = _supabase_request(
        project_url,
        key,
        path,
        method=method,
        access_token=token["access_token"],
        payload=payload,
        body=body,
        headers=headers,
        timeout=timeout
    )

    if status == 401:
        token = _refresh_publish_token(project_url, key, token)
        state["token"] = token
        _save_effective_publish_state(state, source)
        status, response_headers, response_body = _supabase_request(
            project_url,
            key,
            path,
            method=method,
            access_token=token["access_token"],
            payload=payload,
            body=body,
            headers=headers,
            timeout=timeout
        )

    if status == 401:
        raise PackCatalogAuthError(
            _message_from_body(response_body)
            or "Session expirée : reconnecte-toi."
        )

    return project_url, token, status, response_headers, response_body


def _authed_json(db, path, *, method="GET", payload=None):
    _, _, status, _, body = _authed_supabase_request(
        db,
        path,
        method=method,
        payload=payload
    )
    _raise_supabase_status(status, body, "Action Supabase impossible")

    return _decode_json_body(body)


def _normalize_terms(values, max_items):
    terms = []
    seen = set()

    for raw in values or []:
        for chunk in str(raw or "").split(","):
            value = chunk.strip()
            key = value.casefold()

            if not value or key in seen:
                continue

            seen.add(key)
            terms.append(value)

            if len(terms) >= max_items:
                return terms

    return terms


def _filename_slug(value):
    slug = "".join(
        char.lower() if char.isalnum() else "-"
        for char in str(value or "")
    ).strip("-")

    return slug[:64] or "pack"


def _catalog_themes_for_tags(db, tag_values):
    ensure_stored_tag_ids(db)
    hierarchy = load_tag_hierarchy(db)
    parents = parent_map(hierarchy)
    root_ids = set()
    for value in tag_values or []:
        tag_id = resolve_tag_id(hierarchy, value)
        if tag_id:
            root_ids |= ancestors(tag_id, parents) & set(CORE_ROOT_IDS)
    return [label_for_tag(hierarchy, tag_id) for tag_id in sorted(root_ids)]


def _group_publish_summary(db, group_id):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions))
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise ValueError("Question group not found")

    questions = list(group.questions or [])
    tags = merge_tags(*[
        question.tags or []
        for question in questions
    ])

    return {
        "pack_guid": group.guid,
        "type_group": group.type_group,
        "question_count": len(questions),
        "tags": tags,
        "themes": _catalog_themes_for_tags(db, tags),
        "source_kind": "group",
        "group_count": 1
    }


def _collection_publish_summary(db, collection_id):
    collection = (
        db.query(Collection)
        .options(joinedload(Collection.questions).joinedload(Question.group))
        .filter(Collection.id == collection_id)
        .first()
    )

    if not collection:
        raise ValueError("Playlist not found")

    questions = [
        question
        for question in (collection.questions or [])
        if question.group is not None or question.type_q in {"numeric", "enumeration"}
    ]
    source_types = {
        question.group.type_group if question.group is not None else question.type_q
        for question in questions
    }
    tags = merge_tags(*[
        question.tags or []
        for question in questions
        if question.type_q in {"map", "media", "text", "numeric", "enumeration", "cloze", "grid", "set", "sequence"}
    ])

    return {
        "pack_guid": collection.guid,
        # "mixed" rather than the dominant type: a part-map playlist
        # advertised as MAP would misdescribe what installers receive.
        "type_group": (
            next(iter(source_types)) if len(source_types) == 1 else "mixed"
        ),
        "question_count": len(questions),
        "tags": tags,
        "themes": _catalog_themes_for_tags(db, tags),
        "source_kind": "playlist",
        "group_count": len({question.group.id for question in questions if question.group})
    }


def _normalize_publication(row, project_url):
    if isinstance(row, list):
        row = row[0] if row else {}

    if not isinstance(row, dict):
        raise PackCatalogError("Réponse Supabase invalide.")

    storage_path = str(row.get("storage_path") or "").strip()

    return {
        "pack_guid": str(row.get("pack_guid") or ""),
        "name": str(row.get("name") or "Pack sans titre"),
        "description": str(row.get("description") or ""),
        "type_group": str(row.get("type_group") or "text"),
        "question_count": row.get("question_count"),
        "version": row.get("version") or 1,
        "size_bytes": row.get("size_bytes"),
        "license": str(row.get("license") or ""),
        "tags": row.get("tags") if isinstance(row.get("tags"), list) else [],
        "themes": (
            row.get("themes") if isinstance(row.get("themes"), list) else []
        ),
        "storage_path": storage_path,
        "download_url": _public_storage_url(project_url, storage_path),
        "is_public": bool(row.get("is_public")),
        "publication_status": str(
            row.get("publication_status")
            or ("published" if row.get("is_public") else "draft")
        ),
        "published_at": row.get("published_at"),
        "updated_at": row.get("updated_at"),
        "avg_rating": _float_or_none(row.get("avg_rating")),
        "rating_count": _int_or_none(row.get("rating_count")) or 0,
        "comment_count": _int_or_none(row.get("comment_count")) or 0
    }


def _owned_publication_select_path(pack_guid, owner_id):
    return (
        "/rest/v1/pack_catalog"
        "?select=pack_guid,name,description,type_group,question_count,"
        "version,size_bytes,license,tags,themes,storage_path,is_public,"
        "publication_status,published_at,updated_at,avg_rating,"
        "rating_count,comment_count"
        f"&pack_guid=eq.{quote(str(pack_guid or '').strip(), safe='')}"
        f"&owner_id=eq.{quote(str(owner_id or '').strip(), safe='')}"
        "&limit=1"
    )


def _get_owned_publication(db, pack_guid, *, required=False):
    clean_guid = str(pack_guid or "").strip()

    if not clean_guid:
        raise PackCatalogError("Pack introuvable.")

    project_url, _ = _publish_config(db)
    state, _ = _effective_publish_state(project_url)
    owner_id = state["token"].get("user_id")
    project_url, _, status, _, body = _authed_supabase_request(
        db,
        _owned_publication_select_path(clean_guid, owner_id)
    )
    _raise_supabase_status(status, body, "Publication introuvable")
    rows = _decode_json_body(body)

    if not isinstance(rows, list):
        raise PackCatalogError("Réponse Supabase invalide.")

    if not rows:
        if required:
            raise PackCatalogError("Publication introuvable.")

        return None

    return _normalize_publication(rows[0], project_url)


def _release_version_for_publication(publication, version=None):
    current_version = _int_or_none(
        publication.get("version") if publication else None
    )
    requested_version = _int_or_none(version) if version is not None else None

    if version is not None and requested_version is None:
        raise PackCatalogError("Publication invalide.")

    if requested_version is None:
        if publication and publication.get("is_public"):
            return (current_version or 0) + 1

        return current_version or 1

    if requested_version < 1:
        raise PackCatalogError("Publication invalide.")

    if (
        publication
        and publication.get("is_public")
        and current_version is not None
        and requested_version <= current_version
    ):
        raise PackCatalogError(
            "Cette publication a déjà des changements plus récents."
        )

    return requested_version


def _resolve_release_version(db, pack_guid, version=None):
    publication = _get_owned_publication(db, pack_guid)
    return publication, _release_version_for_publication(publication, version)


def _local_publication_source(db, pack_guid):
    group = (
        db.query(QuestionGroup)
        .options(joinedload(QuestionGroup.questions))
        .filter(QuestionGroup.guid == pack_guid)
        .first()
    )

    if group:
        return {
            "kind": "group",
            "id": group.id,
            "name": group.name,
            "question_count": len(group.questions or [])
        }

    collection = (
        db.query(Collection)
        .options(joinedload(Collection.questions).joinedload(Question.group))
        .filter(Collection.guid == pack_guid)
        .first()
    )

    if collection:
        question_count = len([
            question
            for question in (collection.questions or [])
            if question.group is not None
        ])

        return {
            "kind": "playlist",
            "id": collection.id,
            "name": collection.name,
            "question_count": question_count
        }

    raise PackCatalogError(
        "Source supprimée localement : impossible de préparer les changements."
    )


def _pack_content_from_zip_bytes(zip_bytes):
    try:
        with ZipFile(io.BytesIO(zip_bytes)) as zip_file:
            _, _, version, group_entries, question_entries = (
                _read_manifest_and_content(zip_file)
            )
    except (BadZipFile, ValueError) as error:
        raise PackCatalogError("ZIP publié impossible à lire.") from error

    return {
        "version": version,
        "groups": group_entries,
        "questions": question_entries
    }


def _publication_zip_bytes(db, publication):
    storage_path = str(publication.get("storage_path") or "").strip()

    if not storage_path:
        raise PackCatalogError("ZIP publié introuvable.")

    _, _, status, _, body = _authed_supabase_request(
        db,
        f"/storage/v1/object/{CATALOG_BUCKET}/"
        f"{quote(storage_path, safe='/')}",
        timeout=PUBLISH_TRANSFER_TIMEOUT
    )
    _raise_supabase_status(
        status, body, "Téléchargement du ZIP publié impossible"
    )

    return body


def _diff_entries(previous_entries, next_entries, fields):
    previous = {
        entry.get("guid"): content_hash(entry, fields)
        for entry in previous_entries
        if entry.get("guid")
    }
    next_values = {
        entry.get("guid"): content_hash(entry, fields)
        for entry in next_entries
        if entry.get("guid")
    }
    previous_guids = set(previous)
    next_guids = set(next_values)
    shared = previous_guids & next_guids

    return {
        "added": sorted(next_guids - previous_guids),
        "edited": sorted(
            guid for guid in shared if previous[guid] != next_values[guid]
        ),
        "removed": sorted(previous_guids - next_guids),
        "unchanged": len([
            guid for guid in shared if previous[guid] == next_values[guid]
        ])
    }


def _metadata_changes(publication, *, name, description, license, tags, themes):
    def comparable_terms(values, limit):
        return [
            value.casefold()
            for value in _normalize_terms(values, max_items=limit)
        ]

    comparisons = {
        "name": (
            str(publication.get("name") or "").strip(),
            str(name or "").strip()
        ),
        "description": (
            str(publication.get("description") or "").strip(),
            str(description or "").strip()
        ),
        "license": (
            str(publication.get("license") or "").strip(),
            str(license or "").strip()
        ),
        "tags": (
            comparable_terms(publication.get("tags") or [], 20),
            comparable_terms(tags, 20)
        ),
        "themes": (
            comparable_terms(publication.get("themes") or [], 12),
            comparable_terms(themes, 12)
        )
    }

    return [
        field
        for field, (previous, next_value) in comparisons.items()
        if previous != next_value
    ]


def _has_release_changes(diff):
    return bool(
        diff["questions"]["added"]
        or diff["questions"]["edited"]
        or diff["questions"]["removed"]
        or diff["groups"]["added"]
        or diff["groups"]["edited"]
        or diff["groups"]["removed"]
        or diff["metadata_changed"]
    )


def get_pack_publish_status(db):
    settings = get_pack_catalog_settings()
    project_url = normalize_supabase_url(settings.get("url"))
    key = str(settings.get("key") or "").strip()
    state, source = _effective_publish_state(project_url, required=False)

    return {
        "configured": bool(project_url and key),
        "project_url": project_url,
        "signed_in": bool(state),
        "account_email": state.get("account_email") if state else None,
        "auth_source": source
    }


def request_pack_publish_code(db, email):
    project_url, key = _publish_config(db)
    clean_email = str(email or "").strip().lower()

    if not clean_email:
        raise PackCatalogAuthError("E-mail requis.")

    status, _, body = _supabase_request(
        project_url,
        key,
        "/auth/v1/otp",
        method="POST",
        payload={"email": clean_email, "create_user": True}
    )
    _raise_supabase_status(status, body, "Impossible d'envoyer le code")

    return {}


def verify_pack_publish_code(db, email, code):
    project_url, key = _publish_config(db)
    clean_email = str(email or "").strip().lower()
    last_error = "Code invalide."

    for payload in _verify_payloads(clean_email, code):
        status, _, body = _supabase_request(
            project_url,
            key,
            "/auth/v1/verify",
            method="POST",
            payload=payload
        )

        if status >= 400:
            last_error = _message_from_body(body) or last_error
            continue

        data = _decode_json_body(body)
        user_id = (data.get("user") or {}).get("id")

        if not data.get("access_token") or not user_id:
            raise PackCatalogAuthError("Réponse de connexion invalide.")

        save_pack_publish_state({
            "account_email": clean_email,
            "token": {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token"),
                "user_id": user_id
            }
        })

        return get_pack_publish_status(db)

    raise PackCatalogAuthError(last_error)


def sign_out_pack_publisher():
    state = load_pack_publish_state()
    state["account_email"] = None
    state["token"] = None
    save_pack_publish_state(state)

    return state


def list_pack_publications(db):
    project_url, _ = _publish_config(db)
    state, _ = _effective_publish_state(project_url)
    owner_id = quote(str(state["token"].get("user_id") or ""), safe="")
    project_url, _, status, _, body = _authed_supabase_request(
        db,
        "/rest/v1/pack_catalog"
        "?select=pack_guid,name,description,type_group,question_count,"
        "version,size_bytes,license,tags,themes,storage_path,is_public,"
        "publication_status,published_at,updated_at,avg_rating,"
        "rating_count,comment_count"
        f"&owner_id=eq.{owner_id}"
        "&order=updated_at.desc"
        "&limit=50"
    )
    _raise_supabase_status(status, body, "Brouillons indisponibles")
    rows = _decode_json_body(body)

    if not isinstance(rows, list):
        raise PackCatalogError("Réponse Supabase invalide.")

    return {
        "publications": _annotate_publication_sources(db, [
            _normalize_publication(row, project_url)
            for row in rows
        ])
    }


def preview_pack_release(
    db,
    pack_guid,
    *,
    version=None,
    name,
    description="",
    license="",
    tags=None,
    themes=None
):
    publication = _get_owned_publication(db, pack_guid, required=True)
    safe_version = _release_version_for_publication(publication, version)
    current_version = _int_or_none(publication.get("version")) or 1

    source = _local_publication_source(db, publication["pack_guid"])
    source_summary = (
        _collection_publish_summary(db, source["id"])
        if source["kind"] == "playlist"
        else _group_publish_summary(db, source["id"])
    )
    themes = source_summary["themes"]
    previous_content = _pack_content_from_zip_bytes(
        _publication_zip_bytes(db, publication)
    )

    with tempfile.TemporaryDirectory() as temp_name:
        pack_dir = Path(temp_name)

        if source["kind"] == "playlist":
            next_zip = export_playlist_pack(
                db,
                source["id"],
                version=safe_version,
                name=name,
                description=description,
                license=license,
                pack_dir=pack_dir
            )
        else:
            next_zip = export_pack(
                db,
                source["id"],
                version=safe_version,
                name=name,
                description=description,
                license=license,
                pack_dir=pack_dir
            )

        next_content = _pack_content_from_zip_bytes(next_zip.read_bytes())

    diff = {
        "questions": _diff_entries(
            previous_content["questions"],
            next_content["questions"],
            QUESTION_HASH_FIELDS
        ),
        "groups": _diff_entries(
            previous_content["groups"],
            next_content["groups"],
            GROUP_HASH_FIELDS
        ),
        "metadata_changed": _metadata_changes(
            publication,
            name=name,
            description=description,
            license=license,
            tags=tags,
            themes=themes
        )
    }

    return {
        "status": "preview",
        "pack_guid": publication["pack_guid"],
        "source": source,
        "published_version": current_version,
        "next_version": safe_version,
        "question_count": {
            "published": len(previous_content["questions"]),
            "next": len(next_content["questions"])
        },
        "group_count": {
            "published": len(previous_content["groups"]),
            "next": len(next_content["groups"])
        },
        **diff,
        "unchanged": not _has_release_changes(diff)
    }


def _group_publication_source(db, group_id):
    group = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.id == group_id)
        .first()
    )

    if not group:
        raise ValueError("Question group not found")

    return group


def _source_release_payload(publication, source):
    return {
        "name": source.name or publication.get("name") or "Pack sans titre",
        "description": publication.get("description") or "",
        "license": publication.get("license") or "",
        "tags": publication.get("tags") or []
    }


def get_group_pack_publication(db, group_id):
    group = _group_publication_source(db, group_id)
    settings = get_pack_catalog_settings()
    project_url = normalize_supabase_url(settings.get("url"))
    key = str(settings.get("key") or "").strip()

    if not project_url or not key:
        return {
            "status": "unavailable",
            "configured": False,
            "signed_in": False,
            "source": {"kind": "group", "id": group.id, "name": group.name},
            "publication": None,
            "can_publish_changes": False
        }

    state, _ = _effective_publish_state(project_url, required=False)

    if not state:
        return {
            "status": "signed_out",
            "configured": True,
            "signed_in": False,
            "source": {"kind": "group", "id": group.id, "name": group.name},
            "publication": None,
            "can_publish_changes": False
        }

    publication = _get_owned_publication(db, group.guid)

    return {
        "status": (
            publication.get("publication_status")
            if publication else "not_published"
        ),
        "configured": True,
        "signed_in": True,
        "source": {"kind": "group", "id": group.id, "name": group.name},
        "publication": publication,
        "can_publish_changes": bool(
            publication
            and publication.get("is_public")
            and publication.get("publication_status") != "archived"
        )
    }


def _published_group_publication(db, group_id):
    group = _group_publication_source(db, group_id)
    publication = _get_owned_publication(db, group.guid, required=True)

    if (
        not publication.get("is_public")
        or publication.get("publication_status") == "archived"
    ):
        raise PackCatalogError("Ce groupe n'a pas de pack publié actif.")

    return group, publication


def preview_group_pack_changes(db, group_id):
    group, publication = _published_group_publication(db, group_id)
    return preview_pack_release(
        db,
        publication["pack_guid"],
        version=None,
        **_source_release_payload(publication, group)
    )


def publish_group_pack_changes(db, group_id):
    group, publication = _published_group_publication(db, group_id)
    draft = save_pack_publish_draft(
        db,
        group.id,
        version=None,
        **_source_release_payload(publication, group)
    )
    published = publish_pack_publication(db, publication["pack_guid"])

    return {
        **published,
        "previous_version": publication.get("version"),
        "next_version": draft["publication"].get("version"),
        "draft": draft["publication"]
    }


def save_pack_publish_draft(
    db,
    group_id,
    *,
    version=None,
    name,
    description="",
    license="",
    tags=None,
    themes=None
):
    summary = _group_publish_summary(db, group_id)

    if summary["question_count"] <= 0:
        raise ValueError("Cannot publish an empty group")

    _publication, safe_version = _resolve_release_version(
        db, summary["pack_guid"], version
    )
    zip_path = export_pack(
        db,
        group_id,
        version=safe_version,
        name=name,
        description=description,
        license=license
    )

    return _upload_publish_draft(
        db,
        summary,
        zip_path,
        version=safe_version,
        name=name,
        description=description,
        license=license,
        tags=tags,
        themes=themes
    )


def save_playlist_publish_draft(
    db,
    collection_id,
    *,
    version=None,
    name,
    description="",
    license="",
    tags=None,
    themes=None
):
    """Publish a playlist as a multi-group pack.

    Same upload/RPC path as a group; only the source and the resulting
    pack_guid (the playlist's own guid) differ.
    """
    summary = _collection_publish_summary(db, collection_id)

    if summary["question_count"] <= 0:
        raise ValueError("Cannot publish an empty playlist")

    _publication, safe_version = _resolve_release_version(
        db, summary["pack_guid"], version
    )
    zip_path = export_playlist_pack(
        db,
        collection_id,
        version=safe_version,
        name=name,
        description=description,
        license=license
    )

    return _upload_publish_draft(
        db,
        summary,
        zip_path,
        version=safe_version,
        name=name,
        description=description,
        license=license,
        tags=tags,
        themes=themes
    )


def _upload_publish_draft(
    db,
    summary,
    zip_path,
    *,
    version,
    name,
    description="",
    license="",
    tags=None,
    themes=None
):
    safe_version = int(version)
    zip_bytes = zip_path.read_bytes()
    project_url, _ = _publish_config(db)
    state, _ = _effective_publish_state(project_url)
    token = state["token"]
    storage_path = (
        f"{token['user_id']}/{summary['pack_guid']}/"
        f"v{safe_version}-{_filename_slug(name)}.zip"
    )

    _, _, status, _, body = _authed_supabase_request(
        db,
        f"/storage/v1/object/{CATALOG_BUCKET}/"
        f"{quote(storage_path, safe='/')}",
        method="POST",
        body=zip_bytes,
        headers={"Content-Type": "application/zip", "x-upsert": "true"},
        timeout=PUBLISH_TRANSFER_TIMEOUT
    )
    _raise_supabase_status(status, body, "Téléversement du ZIP impossible")

    draft_tags = _normalize_terms(
        tags if tags else summary["tags"],
        max_items=20
    )
    # Themes are semantic roots from the exported questions. Manual catalog
    # terms remain available as search keywords, but cannot contradict the
    # hierarchy carried by the pack itself.
    draft_themes = _normalize_terms(summary.get("themes"), max_items=12)
    payload = {
        "p_pack_guid": summary["pack_guid"],
        "p_name": str(name or "").strip(),
        "p_description": str(description or "").strip(),
        "p_type_group": summary["type_group"],
        "p_question_count": summary["question_count"],
        "p_version": safe_version,
        "p_size_bytes": len(zip_bytes),
        "p_license": str(license or "").strip(),
        "p_tags": draft_tags,
        "p_themes": draft_themes,
        "p_storage_path": storage_path
    }

    project_url, _, status, _, body = _authed_supabase_request(
        db,
        "/rest/v1/rpc/upsert_my_pack_draft",
        method="POST",
        payload=payload
    )
    _raise_supabase_status(status, body, "Brouillon impossible à enregistrer")

    publication = _normalize_publication(_decode_json_body(body), project_url)

    return {
        "status": "draft",
        "publication": publication,
        "saved_at": datetime.now(timezone.utc).isoformat()
    }


def publish_pack_publication(db, pack_guid):
    project_url, _, status, _, body = _authed_supabase_request(
        db,
        "/rest/v1/rpc/publish_my_pack",
        method="POST",
        payload={"p_pack_guid": str(pack_guid or "").strip()}
    )
    _raise_supabase_status(status, body, "Publication impossible")

    publication = _normalize_publication(_decode_json_body(body), project_url)

    return {
        "status": "published",
        "publication": publication
    }


def unpublish_pack_publication(db, pack_guid):
    """Owner-only soft delete: the row and its storage zip are kept so the
    creator can see/republish it later, only its catalog visibility is
    cleared (RPC unpublish_my_pack sets is_public=false)."""
    project_url, _, status, _, body = _authed_supabase_request(
        db,
        "/rest/v1/rpc/unpublish_my_pack",
        method="POST",
        payload={"p_pack_guid": str(pack_guid or "").strip()}
    )
    _raise_supabase_status(status, body, "Dépublication impossible")

    publication = _normalize_publication(_decode_json_body(body), project_url)

    return {
        "status": "unpublished",
        "publication": publication
    }


def delete_pack_publication(db, pack_guid):
    """Owner-only hard delete for already-archived catalog rows."""
    publication = _get_owned_publication(db, pack_guid, required=True)

    if publication.get("publication_status") != "archived":
        raise PackCatalogError(
            "Dépublie ce pack avant de le supprimer définitivement."
        )

    storage_path = str(publication.get("storage_path") or "").strip()
    project_url, _, status, _, body = _authed_supabase_request(
        db,
        "/rest/v1/rpc/delete_my_pack",
        method="POST",
        payload={"p_pack_guid": str(pack_guid or "").strip()}
    )
    _raise_supabase_status(status, body, "Suppression impossible")
    deleted_publication = _normalize_publication(
        _decode_json_body(body), project_url
    )
    zip_deleted = False

    if storage_path:
        _, _, storage_status, _, _ = _authed_supabase_request(
            db,
            f"/storage/v1/object/{CATALOG_BUCKET}/"
            f"{quote(storage_path, safe='/')}",
            method="DELETE",
            timeout=PUBLISH_TRANSFER_TIMEOUT
        )
        zip_deleted = storage_status < 400 or storage_status == 404

    return {
        "status": "deleted",
        "pack_guid": deleted_publication["pack_guid"],
        "zip_deleted": zip_deleted
    }


def record_pack_install(db, pack_guid, *, installed_version):
    """Best-effort by design -- the caller must not await/block on this or
    surface its errors, since installing a pack must stay account-free
    (only signed-in users end up with a tracked install)."""
    _, _, status, _, body = _authed_supabase_request(
        db,
        "/rest/v1/rpc/record_pack_install",
        method="POST",
        payload={
            "p_pack_guid": str(pack_guid or "").strip(),
            "p_installed_version": int(installed_version or 1)
        }
    )
    _raise_supabase_status(status, body, "Enregistrement de l'installation impossible")

    return {"recorded": True}


def backfill_pack_installs(db):
    """One-shot, called right after a successful sign-in. Reads local
    PackSubscription rows (already-known local truth) and bulk-upserts
    them as this account's installs, so packs installed anonymously before
    this sign-in become retroactively eligible to rate/comment."""
    installed_versions = _installed_versions(db)

    if not installed_versions:
        return {"recorded": 0}

    payload = {
        "p_installs": [
            {"pack_guid": guid, "installed_version": version}
            for guid, version in installed_versions.items()
        ]
    }

    _, _, status, _, body = _authed_supabase_request(
        db,
        "/rest/v1/rpc/record_pack_installs_bulk",
        method="POST",
        payload=payload
    )
    _raise_supabase_status(status, body, "Synchronisation des installations impossible")

    return {"recorded": _decode_json_body(body)}


def get_my_pack_status(db, pack_guid):
    body = _authed_json(
        db,
        "/rest/v1/rpc/get_my_pack_status",
        method="POST",
        payload={"p_pack_guid": str(pack_guid or "").strip()}
    )

    return {
        "is_installed": bool(body.get("is_installed")),
        "my_rating": _int_or_none(body.get("my_rating"))
    }


def rate_pack(db, pack_guid, rating):
    body = _authed_json(
        db,
        "/rest/v1/rpc/rate_pack",
        method="POST",
        payload={
            "p_pack_guid": str(pack_guid or "").strip(),
            "p_rating": int(rating)
        }
    )

    return {
        "my_rating": _int_or_none(body.get("my_rating")),
        "avg_rating": _float_or_none(body.get("avg_rating")),
        "rating_count": _int_or_none(body.get("rating_count")) or 0
    }


def list_pack_comments(db, pack_guid, *, limit=50):
    """No auth required -- same anonymous request shape as
    search_pack_catalog, since reading the thread needs no sign-in."""
    project_url, key = _publish_config(db)
    status, _, body = _supabase_request(
        project_url,
        key,
        "/rest/v1/pack_comments"
        "?select=id,author_label,body,created_at"
        f"&pack_guid=eq.{quote(str(pack_guid or ''))}"
        f"&order=created_at.desc&limit={_clamp_limit(limit)}"
    )
    _raise_supabase_status(status, body, "Commentaires indisponibles")
    rows = _decode_json_body(body)

    if not isinstance(rows, list):
        raise PackCatalogError("Réponse Supabase invalide.")

    return {"comments": rows}


def add_pack_comment(db, pack_guid, body_text):
    body = _authed_json(
        db,
        "/rest/v1/rpc/add_pack_comment",
        method="POST",
        payload={
            "p_pack_guid": str(pack_guid or "").strip(),
            "p_body": str(body_text or "").strip()
        }
    )

    return {"comment": body}
