import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from ..models import BlueprintSubscription
from .settings import get_blueprint_catalog_settings


CATALOG_BUCKET = "blueprint-zips"
POPULAR_THEME = "__popular__"
VALID_SORTS = {"pertinence", "populaires", "récents", "nom", "questions"}
VALID_STATUSES = {"all", "not_installed", "update_available", "up_to_date"}
MAX_LIMIT = 60


class BlueprintCatalogError(ValueError):
    pass


def normalize_supabase_url(url):
    base = str(url or "").strip().rstrip("/")

    for suffix in ("/rest/v1", "/auth/v1", "/storage/v1"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]

    return base.rstrip("/")


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


def _post_json(url, key, payload):
    request = Request(
        f"{url}/rest/v1/rpc/search_blueprint_catalog",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:
        with urlopen(request, timeout=12) as response:
            body = response.read()
    except HTTPError as error:
        body = error.read()
        raise BlueprintCatalogError(
            _message_from_body(body)
            or f"Catalogue Supabase impossible à charger ({error.code})."
        ) from error
    except (TimeoutError, URLError, ValueError) as error:
        raise BlueprintCatalogError(
            "Catalogue Supabase inaccessible."
        ) from error

    if not body:
        return {}

    try:
        return json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise BlueprintCatalogError(
            "Réponse Supabase invalide."
        ) from error


def _installed_versions(db):
    subscriptions = db.query(BlueprintSubscription).all()
    return {
        subscription.blueprint_guid: subscription.installed_version
        for subscription in subscriptions
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


def _normalize_blueprint(row, project_url):
    if not isinstance(row, dict):
        return None

    entry = {
        "blueprint_guid": str(row.get("blueprint_guid") or ""),
        "name": str(row.get("name") or "Blueprint sans titre"),
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
        "published_at": row.get("published_at"),
        "updated_at": row.get("updated_at")
    }
    entry["download_url"] = (
        str(row.get("download_url") or "").strip()
        or _public_storage_url(project_url, row.get("storage_path"))
    )

    if not entry["blueprint_guid"]:
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

    return {
        "value": value,
        "label": str(raw.get("label") or _theme_label(value)),
        "result_count": raw.get("result_count") or raw.get("count"),
        "download_count": raw.get("download_count") or 0,
        "featured": bool(raw.get("featured")),
        "pinned": bool(raw.get("pinned"))
    }


def _theme_score(theme):
    return (
        1 if theme.get("pinned") else 0,
        int(theme.get("result_count") or 0),
        int(theme.get("download_count") or 0),
        1 if theme.get("featured") else 0
    )


def _ordered_themes(themes, total):
    normalized = []
    seen = set()

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

    if total or normalized:
        return [
            {
                "value": POPULAR_THEME,
                "label": "Populaires",
                "result_count": total,
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
        raise BlueprintCatalogError("Réponse Supabase invalide.")

    rows = payload.get("blueprints")
    if rows is None and isinstance(payload.get("data"), list):
        rows = payload["data"]

    blueprints = [
        entry
        for entry in (
            _normalize_blueprint(row, project_url)
            for row in (rows if isinstance(rows, list) else [])
        )
        if entry
    ]
    facets = payload.get("facets") if isinstance(payload.get("facets"), dict) else {}
    total = payload.get("total")

    if not isinstance(total, int):
        total = len(blueprints)

    return {
        "blueprints": blueprints,
        "facets": {
            "themes": _ordered_themes(facets.get("themes") or [], total)
        },
        "total": total,
        "next_cursor": (
            str(payload.get("next_cursor"))
            if payload.get("next_cursor") not in (None, "")
            else None
        )
    }


def search_blueprint_catalog(
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
    settings = get_blueprint_catalog_settings(db)
    project_url = normalize_supabase_url(settings.get("url"))
    key = str(settings.get("key") or "").strip()

    if not project_url or not key:
        raise BlueprintCatalogError(
            "Catalogue Supabase non configuré."
        )

    normalized_status = status if status in VALID_STATUSES else "all"
    normalized_sort = sort if sort in VALID_SORTS else "pertinence"
    normalized_theme = str(theme or "").strip()

    if normalized_theme == POPULAR_THEME:
        normalized_theme = ""
        normalized_sort = "populaires"

    payload = {
        "p_query": str(query or "").strip(),
        "p_theme": normalized_theme,
        "p_type_group": str(type_group or "").strip(),
        "p_status": normalized_status,
        "p_sort": normalized_sort,
        "p_limit": _clamp_limit(limit),
        "p_cursor": _cursor_offset(cursor),
        "p_installed_versions": _installed_versions(db)
    }

    response = _post_json(project_url, key, payload)
    return _normalize_response(response, project_url)
