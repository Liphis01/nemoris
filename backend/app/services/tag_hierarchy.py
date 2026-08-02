import copy
import difflib
import re
import unicodedata
import uuid

from ..models import AppSetting, PackSubscription, Question
from .tag_seed import SEED_ALIASES, SEED_NODES, SEED_VERSION


TAG_HIERARCHY_KEY = "tag_hierarchy"
HIERARCHY_VERSION = 3
DEFAULT_LOCALE = "fr"

LOCAL_LEGACY_NAMESPACE = uuid.UUID("6571dbbf-82b9-45f6-ae45-a8aa24394214")
PACK_LEGACY_NAMESPACE = uuid.UUID("cd8d34a6-f883-4458-966a-2ffb0860bb88")

CORE_ROOTS = {
    f"core:{slug}": {"fr": label}
    for slug, label, parents in SEED_NODES
    if not parents
}
CORE_ROOT_IDS = frozenset(CORE_ROOTS)
CORE_ID_BY_SLUG = {
    tag_id.removeprefix("core:"): tag_id
    for tag_id in CORE_ROOT_IDS
}


class TagRevisionConflict(ValueError):
    pass


class TagValidationError(ValueError):
    pass


def _strip_accents(value):
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(
        char for char in decomposed if not unicodedata.combining(char)
    )


def comparison_key(value):
    collapsed = re.sub(r"[\s_-]+", " ", str(value or "").strip())
    return _strip_accents(collapsed).strip().casefold()


def slugify_tag(value):
    slug = re.sub(r"[^a-z0-9]+", "-", comparison_key(value))
    return slug.strip("-")


def build_slug_map(values):
    """Legacy migration helper retained for the v1/v2 database migration."""
    by_comparison = {}
    for value in values:
        key = comparison_key(value)
        if key:
            by_comparison.setdefault(key, []).append(value)

    slug_by_comparison = {}
    claimed = {}
    for key in sorted(by_comparison):
        base = slugify_tag(key) or "tag"
        slug = base
        suffix = 2
        while slug in claimed and claimed[slug] != key:
            slug = f"{base}-{suffix}"
            suffix += 1
        claimed[slug] = key
        slug_by_comparison[key] = slug

    return {
        value: slug_by_comparison[comparison_key(value)]
        for values_ in by_comparison.values()
        for value in values_
    }


def _core_aliases():
    aliases = {}
    root_slugs = set(CORE_ID_BY_SLUG)

    for tag_id, labels in CORE_ROOTS.items():
        slug = tag_id.removeprefix("core:")
        aliases[slugify_tag(slug)] = tag_id
        for label in labels.values():
            aliases[slugify_tag(label)] = tag_id

    for alias, target in SEED_ALIASES.items():
        if target in root_slugs:
            aliases[slugify_tag(alias)] = CORE_ID_BY_SLUG[target]

    return aliases


CORE_ALIAS_MAP = _core_aliases()


def core_id_for_value(value):
    text = str(value or "").strip()
    if text in CORE_ROOT_IDS:
        return text
    return CORE_ALIAS_MAP.get(slugify_tag(text))


def is_custom_tag_id(value):
    try:
        uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return False
    return True


def new_custom_tag_id():
    return str(uuid.uuid4())


def legacy_local_tag_id(value):
    key = comparison_key(value)
    return str(uuid.uuid5(LOCAL_LEGACY_NAMESPACE, key or str(value)))


def legacy_pack_tag_id(pack_guid, value):
    key = comparison_key(value)
    return str(uuid.uuid5(PACK_LEGACY_NAMESPACE, f"{pack_guid}:{key}"))


def normalize_tag_key(value):
    """Compatibility normalizer.

    Identity is no longer derived from labels. Existing IDs pass through and
    only the reserved roots are recognized from display text. Callers that may
    receive a new user label must use ``ensure_tag_ids`` with a database.
    """
    text = str(value or "").strip()
    if not text:
        return ""
    return core_id_for_value(text) or text


def resolve_seed_alias(slug):
    """Legacy helper used by migration 0021 and old pack tests."""
    normalized = slugify_tag(slug)
    return SEED_ALIASES.get(normalized, normalized)


def normalize_tag_list(tags):
    """Legacy text normalization retained for formats 1-3 and migration 0021.

    New application writes use ``ensure_tag_ids``. Keeping this function pure
    prevents old migrations from changing meaning after the v3 rollout.
    """
    normalized = []
    for tag in tags or []:
        key = resolve_seed_alias(slugify_tag(tag))
        if key and key not in normalized:
            normalized.append(key)
    return normalized


def _clean_label(value):
    return str(value or "").strip()


def _clean_locale(value):
    locale = str(value or DEFAULT_LOCALE).strip().replace("_", "-").lower()
    return locale or DEFAULT_LOCALE


def _normalize_labels(value, fallback=None, locale=DEFAULT_LOCALE):
    if isinstance(value, str):
        value = {locale: value}
    if not isinstance(value, dict):
        value = {}

    labels = {}
    for key, label in value.items():
        clean = _clean_label(label)
        if clean:
            labels[_clean_locale(key)] = clean

    clean_fallback = _clean_label(fallback)
    if not labels and clean_fallback:
        labels[_clean_locale(locale)] = clean_fallback
    return labels


def _default_node(tag_id, *, labels=None, default_locale=DEFAULT_LOCALE,
                  parents=None, origin="local", pack_ids=None,
                  classification=None, suggestion_key=None):
    default_locale = _clean_locale(default_locale)
    clean_labels = _normalize_labels(labels, locale=default_locale)
    if tag_id in CORE_ROOT_IDS:
        clean_labels = {**CORE_ROOTS[tag_id], **clean_labels}
        origin = "core"
        parents = []
        classification = "root"

    parent_ids = []
    for parent_id in parents or []:
        parent_id = str(parent_id or "").strip()
        if parent_id and parent_id not in parent_ids:
            parent_ids.append(parent_id)

    return {
        "labels": clean_labels,
        "default_locale": default_locale,
        "parents": parent_ids,
        "origin": origin if origin in {"core", "local", "pack", "migration", "suggestion"} else "local",
        "pack_ids": sorted({str(value) for value in (pack_ids or []) if value}),
        "classification": classification or ("placed" if parent_ids else "unplaced"),
        **({"suggestion_key": suggestion_key} if suggestion_key else {})
    }


def label_for_node(node, locale=DEFAULT_LOCALE):
    node = node if isinstance(node, dict) else {}
    labels = node.get("labels") if isinstance(node.get("labels"), dict) else {}
    locale = _clean_locale(locale)
    language = locale.split("-", 1)[0]
    default_locale = _clean_locale(node.get("default_locale"))

    return (
        labels.get(locale)
        or labels.get(language)
        or labels.get(default_locale)
        or next(iter(labels.values()), "Tag sans nom")
    )


def label_for_tag(hierarchy, tag_id, locale=DEFAULT_LOCALE):
    resolved = resolve_tag_id(hierarchy, tag_id)
    node = (hierarchy or {}).get("nodes", {}).get(resolved)
    return label_for_node(node, locale) if node else "Tag sans nom"


def _legacy_values(value):
    if isinstance(value, (list, tuple, set)):
        return list(value)
    return [value]


def _legacy_hierarchy_to_v3(data):
    raw_parents = data.get("parents") if isinstance(data.get("parents"), dict) else {}
    raw_labels = data.get("labels") if isinstance(data.get("labels"), dict) else {}
    values = set(raw_labels) | set(raw_parents)
    for parents in raw_parents.values():
        values.update(_legacy_values(parents))

    id_by_legacy = {}
    legacy_ids = {}
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        tag_id = core_id_for_value(text) or legacy_local_tag_id(text)
        id_by_legacy[text] = tag_id
        legacy_ids[slugify_tag(text)] = tag_id

    nodes = {
        tag_id: _default_node(tag_id, labels=labels, origin="core")
        for tag_id, labels in CORE_ROOTS.items()
    }
    for text, tag_id in id_by_legacy.items():
        label = raw_labels.get(text)
        if label is None:
            for raw_key, raw_label in raw_labels.items():
                if slugify_tag(raw_key) == slugify_tag(text):
                    label = raw_label
                    break
        node = nodes.setdefault(
            tag_id,
            _default_node(
                tag_id,
                labels={DEFAULT_LOCALE: label or text},
                origin="migration"
            )
        )
        clean = _clean_label(label)
        if clean and tag_id not in CORE_ROOT_IDS:
            node["labels"].setdefault(DEFAULT_LOCALE, clean)

    for raw_child, raw_parent_values in raw_parents.items():
        child_id = id_by_legacy.get(str(raw_child).strip())
        if not child_id or child_id in CORE_ROOT_IDS:
            continue
        for raw_parent in _legacy_values(raw_parent_values):
            parent_id = id_by_legacy.get(str(raw_parent).strip())
            if parent_id and parent_id != child_id:
                nodes[child_id]["parents"].append(parent_id)
        nodes[child_id]["parents"] = list(dict.fromkeys(nodes[child_id]["parents"]))
        nodes[child_id]["classification"] = (
            "placed" if nodes[child_id]["parents"] else "unplaced"
        )

    return {
        "version": HIERARCHY_VERSION,
        "revision": int(data.get("revision") or 0),
        "nodes": nodes,
        "hidden_core_roots": [],
        "redirects": {},
        "legacy_ids": legacy_ids,
        "seed": {"version": SEED_VERSION}
    }


def _resolve_raw_id(value, known_ids, legacy_ids):
    text = str(value or "").strip()
    if not text:
        return None
    if text in known_ids:
        return text
    core_id = core_id_for_value(text)
    if core_id:
        return core_id
    return legacy_ids.get(text) or legacy_ids.get(slugify_tag(text))


def _would_create_cycle(parents, child_id, parent_id):
    return child_id in ancestors(parent_id, parents)


def _validate_parent_map(parents, nodes):
    accepted = {}
    for child_id in sorted(parents):
        if child_id not in nodes:
            raise TagValidationError(f"Unknown tag: {child_id}")
        if child_id in CORE_ROOT_IDS and parents.get(child_id):
            raise TagValidationError("Les thèmes de base ne peuvent pas être déplacés")
        for parent_id in parents.get(child_id) or []:
            if parent_id not in nodes:
                raise TagValidationError(f"Unknown parent tag: {parent_id}")
            if parent_id == child_id:
                raise TagValidationError("Un tag ne peut pas être son propre parent")
            if _would_create_cycle(accepted, child_id, parent_id):
                raise TagValidationError("Ce lien créerait une boucle")
            accepted.setdefault(child_id, []).append(parent_id)
    return accepted


def _with_compatibility_fields(hierarchy):
    nodes = hierarchy.get("nodes", {})
    reverse_legacy = {}
    for legacy_key, tag_id in (hierarchy.get("legacy_ids") or {}).items():
        candidate = slugify_tag(legacy_key)
        if candidate and (
            tag_id not in reverse_legacy
            or len(candidate) < len(reverse_legacy[tag_id])
        ):
            reverse_legacy[tag_id] = candidate

    def legacy_key(tag_id):
        if tag_id in CORE_ROOT_IDS:
            return tag_id.removeprefix("core:")
        return reverse_legacy.get(tag_id, tag_id)

    hierarchy["parents"] = {
        legacy_key(tag_id): [legacy_key(parent) for parent in node.get("parents") or []]
        for tag_id, node in nodes.items()
        if node.get("parents")
    }
    hierarchy["labels"] = {
        legacy_key(tag_id): label_for_node(node)
        for tag_id, node in nodes.items()
    }
    return hierarchy


def normalize_tag_hierarchy(value):
    data = copy.deepcopy(value) if isinstance(value, dict) else {}
    if not isinstance(data.get("nodes"), dict):
        data = _legacy_hierarchy_to_v3(data)

    raw_nodes = data.get("nodes") or {}
    raw_legacy = data.get("legacy_ids") if isinstance(data.get("legacy_ids"), dict) else {}
    legacy_ids = {}
    provisional_ids = set(CORE_ROOT_IDS)

    for raw_id in raw_nodes:
        text = str(raw_id or "").strip()
        if not text:
            continue
        tag_id = core_id_for_value(text) or (text if is_custom_tag_id(text) else legacy_local_tag_id(text))
        provisional_ids.add(tag_id)
        if tag_id != text:
            legacy_ids[slugify_tag(text)] = tag_id

    for old, target in raw_legacy.items():
        target_id = core_id_for_value(target) or str(target or "").strip()
        if target_id in provisional_ids:
            legacy_ids[str(old)] = target_id
            legacy_ids[slugify_tag(old)] = target_id

    nodes = {
        tag_id: _default_node(tag_id, labels=labels, origin="core")
        for tag_id, labels in CORE_ROOTS.items()
    }

    for raw_id, raw_node in raw_nodes.items():
        raw_node = raw_node if isinstance(raw_node, dict) else {}
        tag_id = core_id_for_value(raw_id) or (
            str(raw_id).strip() if is_custom_tag_id(raw_id)
            else legacy_local_tag_id(raw_id)
        )
        labels = _normalize_labels(
            raw_node.get("labels"),
            fallback=raw_node.get("label") or raw_id,
            locale=raw_node.get("default_locale") or DEFAULT_LOCALE
        )
        node = _default_node(
            tag_id,
            labels=labels,
            default_locale=raw_node.get("default_locale") or DEFAULT_LOCALE,
            origin=raw_node.get("origin") or ("core" if tag_id in CORE_ROOT_IDS else "local"),
            pack_ids=raw_node.get("pack_ids"),
            classification=raw_node.get("classification"),
            suggestion_key=raw_node.get("suggestion_key")
        )
        if tag_id in nodes:
            nodes[tag_id]["labels"].update(node["labels"])
        else:
            nodes[tag_id] = node

    parents = {}
    for raw_id, raw_node in raw_nodes.items():
        raw_node = raw_node if isinstance(raw_node, dict) else {}
        child_id = _resolve_raw_id(raw_id, nodes, legacy_ids)
        if not child_id or child_id in CORE_ROOT_IDS:
            continue
        for raw_parent in _legacy_values(raw_node.get("parents") or []):
            parent_id = _resolve_raw_id(raw_parent, nodes, legacy_ids)
            if parent_id and parent_id != child_id and parent_id not in parents.get(child_id, []):
                parents.setdefault(child_id, []).append(parent_id)

    # A transitional v3 document may still carry the compatibility parent map.
    raw_parent_map = data.get("parents") if isinstance(data.get("parents"), dict) else {}
    for raw_child, raw_parents in raw_parent_map.items():
        child_id = _resolve_raw_id(raw_child, nodes, legacy_ids)
        if not child_id or child_id in CORE_ROOT_IDS:
            continue
        for raw_parent in _legacy_values(raw_parents):
            parent_id = _resolve_raw_id(raw_parent, nodes, legacy_ids)
            if parent_id and parent_id != child_id and parent_id not in parents.get(child_id, []):
                parents.setdefault(child_id, []).append(parent_id)

    accepted = {}
    for child_id in sorted(parents):
        for parent_id in parents[child_id]:
            if parent_id not in nodes or _would_create_cycle(accepted, child_id, parent_id):
                continue
            accepted.setdefault(child_id, []).append(parent_id)

    for tag_id, node in nodes.items():
        node["parents"] = accepted.get(tag_id, [])
        if tag_id in CORE_ROOT_IDS:
            node["classification"] = "root"
        elif node["parents"]:
            node["classification"] = "placed"
        elif node.get("origin") == "migration" and node.get("classification") == "root":
            node["classification"] = "unplaced"
        elif node.get("classification") not in {"root", "unplaced"}:
            node["classification"] = "unplaced"

    redirects = {}
    raw_redirects = data.get("redirects") if isinstance(data.get("redirects"), dict) else {}
    for raw_source, raw_target in raw_redirects.items():
        source = _resolve_raw_id(raw_source, nodes | {str(raw_source): {}}, legacy_ids) or str(raw_source)
        target = _resolve_raw_id(raw_target, nodes, legacy_ids)
        if source and target and source != target:
            redirects[source] = target

    hidden = sorted({
        core_id_for_value(value)
        for value in (data.get("hidden_core_roots") or [])
        if core_id_for_value(value)
    })

    try:
        revision = max(0, int(data.get("revision") or 0))
    except (TypeError, ValueError):
        revision = 0

    hierarchy = {
        "version": HIERARCHY_VERSION,
        "revision": revision,
        "nodes": nodes,
        "hidden_core_roots": hidden,
        "redirects": redirects,
        "legacy_ids": legacy_ids,
        "seed": {"version": SEED_VERSION}
    }
    return _with_compatibility_fields(hierarchy)


DEFAULT_TAG_HIERARCHY = normalize_tag_hierarchy({})


def get_or_create_tag_hierarchy_row(db):
    setting = db.query(AppSetting).filter(AppSetting.key == TAG_HIERARCHY_KEY).first()
    if setting:
        return setting
    setting = AppSetting(key=TAG_HIERARCHY_KEY, value=copy.deepcopy(DEFAULT_TAG_HIERARCHY))
    db.add(setting)
    db.flush()
    return setting


def load_tag_hierarchy(db):
    setting = get_or_create_tag_hierarchy_row(db)
    hierarchy = normalize_tag_hierarchy(setting.value)
    if setting.value != hierarchy:
        setting.value = hierarchy
    return hierarchy


def save_tag_hierarchy(db, payload):
    """Compatibility whole-document save with optimistic revision support."""
    setting = get_or_create_tag_hierarchy_row(db)
    current = normalize_tag_hierarchy(setting.value)
    if payload.get("revision") is not None and int(payload["revision"]) != current["revision"]:
        raise TagRevisionConflict("La hiérarchie a été modifiée ailleurs")
    normalized = normalize_tag_hierarchy(payload)
    normalized["revision"] = current["revision"] + 1
    setting.value = _with_compatibility_fields(normalized)
    return normalized


def parent_map(hierarchy):
    if isinstance((hierarchy or {}).get("nodes"), dict):
        return {
            tag_id: list(node.get("parents") or [])
            for tag_id, node in hierarchy["nodes"].items()
            if node.get("parents")
        }
    parents = (hierarchy or {}).get("parents")
    return {child: list(value or []) for child, value in (parents or {}).items()}


def _children_map(parents):
    children = {}
    for child, parent_ids in parents.items():
        for parent in parent_ids or []:
            children.setdefault(parent, []).append(child)
    return children


def descendants(tag_id, parents):
    children = _children_map(parents)
    result = set()
    stack = [tag_id]
    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(children.get(current, []))
    return result


def ancestors(tag_id, parents):
    result = set()
    stack = [tag_id]
    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(parents.get(current, []) or [])
    return result


def resolve_tag_id(hierarchy, value):
    text = str(value or "").strip()
    if not text:
        return None
    nodes = (hierarchy or {}).get("nodes") or {}
    redirects = (hierarchy or {}).get("redirects") or {}
    if text in redirects:
        text = redirects[text]
    if text in nodes:
        return text
    core_id = core_id_for_value(text)
    if core_id:
        return core_id
    legacy = (hierarchy or {}).get("legacy_ids") or {}
    mapped = legacy.get(text) or legacy.get(slugify_tag(text))
    if mapped:
        return redirects.get(mapped, mapped)

    # Localized labels are presentation and search data, never identity.
    # Legacy mappings and the reserved core aliases above are the only
    # compatibility paths from human text to an ID.
    return None


def ensure_tag_ids(
    db,
    tags,
    *,
    locale=DEFAULT_LOCALE,
    origin="local",
    pack_guid=None,
    create_missing=False
):
    setting = get_or_create_tag_hierarchy_row(db)
    hierarchy = normalize_tag_hierarchy(setting.value)
    result = []
    changed = False

    for value in tags or []:
        text = str(value or "").strip()
        if not text:
            continue
        tag_id = hierarchy.get("redirects", {}).get(text, text)
        if tag_id not in hierarchy["nodes"]:
            tag_id = core_id_for_value(text)
        if not tag_id:
            legacy = hierarchy.get("legacy_ids", {})
            tag_id = legacy.get(text) or legacy.get(slugify_tag(text))
            if tag_id:
                tag_id = hierarchy.get("redirects", {}).get(tag_id, tag_id)
                if tag_id not in hierarchy["nodes"]:
                    tag_id = None
        if not tag_id:
            if not create_missing:
                raise TagValidationError(f"Tag introuvable: {text}")
            tag_id = new_custom_tag_id()
            hierarchy["nodes"][tag_id] = _default_node(
                tag_id,
                labels={locale: text},
                default_locale=locale,
                origin=origin,
                pack_ids=[pack_guid] if pack_guid else [],
                classification="unplaced"
            )
            hierarchy["legacy_ids"].setdefault(slugify_tag(text), tag_id)
            changed = True
        if tag_id not in result:
            result.append(tag_id)

    if changed:
        hierarchy["revision"] += 1
        setting.value = _with_compatibility_fields(hierarchy)
    return result


def ensure_stored_tag_ids(db):
    """Upgrade legacy free-text rows encountered outside the migration path.

    Normal application writes already store IDs. This bridge mainly protects
    older databases restored from partial backups and test/import fixtures that
    inserted Question rows directly, without turning labels back into identity
    for normal writes.
    """
    changed = False
    hierarchy = load_tag_hierarchy(db)
    for question in db.query(Question).all():
        current = list(question.tags or [])
        normalized = []
        unresolved = False
        for value in current:
            tag_id = resolve_tag_id(hierarchy, value)
            if not tag_id:
                unresolved = True
                break
            if tag_id not in normalized:
                normalized.append(tag_id)

        if unresolved:
            # Partial restores and direct fixture inserts can still contain
            # free text. Take the mutating compatibility path only for those
            # exceptional rows; normal v3 reads stay linear in question tags.
            normalized = ensure_tag_ids(db, current, create_missing=True)
            hierarchy = load_tag_hierarchy(db)
        if normalized != current:
            question.tags = normalized
            changed = True
    if changed:
        db.flush()
    return changed


def tag_usage_counts(db, parents=None):
    hierarchy = load_tag_hierarchy(db)
    counts = {}
    displays = {}
    for (tags,) in db.query(Question.tags).all():
        seen = set()
        for raw_tag in tags or []:
            tag_id = resolve_tag_id(hierarchy, raw_tag) or str(raw_tag or "").strip()
            if not tag_id:
                continue
            effective = ancestors(tag_id, parents) if parents else {tag_id}
            for effective_id in effective:
                displays.setdefault(effective_id, label_for_tag(hierarchy, effective_id))
                if effective_id not in seen:
                    seen.add(effective_id)
                    counts[effective_id] = counts.get(effective_id, 0) + 1
    return counts, displays


def _replace_tag_id(values, source_id, target_id):
    result = []
    for value in values or []:
        value = target_id if value == source_id else value
        if value and value not in result:
            result.append(value)
    return result


def _replace_tag_in_slice(value, source_id, target_id):
    if not isinstance(value, dict):
        return value
    data = copy.deepcopy(value)
    nodes = data.get("nodes") if isinstance(data.get("nodes"), dict) else {}
    if source_id in nodes:
        source = nodes.pop(source_id)
        if target_id not in nodes:
            nodes[target_id] = source
        else:
            target = nodes[target_id]
            for locale, label in (source.get("labels") or {}).items():
                target.setdefault("labels", {}).setdefault(locale, label)
            target["parents"] = list(dict.fromkeys(
                list(target.get("parents") or []) + list(source.get("parents") or [])
            ))
    for node in nodes.values():
        node["parents"] = _replace_tag_id(node.get("parents"), source_id, target_id)
    data["nodes"] = nodes
    return data


def _merge_nodes(hierarchy, source_id, target_id, db):
    nodes = hierarchy["nodes"]
    if source_id in CORE_ROOT_IDS:
        raise TagValidationError("Un thème de base ne peut pas être fusionné vers un autre tag")
    if source_id not in nodes or target_id not in nodes:
        raise TagValidationError("Tag introuvable")
    if source_id == target_id:
        raise TagValidationError("Choisissez deux tags différents")

    source = nodes[source_id]
    target = nodes[target_id]
    for locale, label in source.get("labels", {}).items():
        target.setdefault("labels", {}).setdefault(locale, label)
    target["pack_ids"] = sorted(set(target.get("pack_ids", [])) | set(source.get("pack_ids", [])))

    target_parents = _replace_tag_id(
        list(target.get("parents", [])) + list(source.get("parents", [])),
        source_id,
        target_id
    )
    target["parents"] = [parent for parent in target_parents if parent != target_id]

    for tag_id, node in nodes.items():
        if tag_id != source_id:
            node["parents"] = _replace_tag_id(node.get("parents"), source_id, target_id)

    prospective = {tag_id: node.get("parents", []) for tag_id, node in nodes.items() if tag_id != source_id}
    _validate_parent_map(prospective, {key: value for key, value in nodes.items() if key != source_id})

    for question in db.query(Question).all():
        hash_was_current = False
        if question.pack_guid and question.content_hash:
            try:
                from ..config import STATIC_DIR
                from .packs import (
                    QUESTION_HASH_FIELDS,
                    _row_canonical_payload,
                    content_hash
                )
                hash_was_current = content_hash(
                    _row_canonical_payload(
                        db, question, QUESTION_HASH_FIELDS, STATIC_DIR
                    ),
                    QUESTION_HASH_FIELDS
                ) == question.content_hash
            except (OSError, TypeError, ValueError):
                hash_was_current = False
        replaced = _replace_tag_id(question.tags, source_id, target_id)
        if replaced != (question.tags or []):
            question.tags = replaced
            if hash_was_current:
                question.content_hash = content_hash(
                    _row_canonical_payload(
                        db, question, QUESTION_HASH_FIELDS, STATIC_DIR
                    ),
                    QUESTION_HASH_FIELDS
                )

    hierarchy["redirects"][source_id] = target_id
    for old_source, old_target in list(hierarchy["redirects"].items()):
        if old_target == source_id:
            hierarchy["redirects"][old_source] = target_id
    for key, value in list(hierarchy["legacy_ids"].items()):
        if value == source_id:
            hierarchy["legacy_ids"][key] = target_id
    del nodes[source_id]

    for subscription in db.query(PackSubscription).all():
        if hasattr(subscription, "tag_hierarchy_base"):
            subscription.tag_hierarchy_base = _replace_tag_in_slice(
                subscription.tag_hierarchy_base, source_id, target_id
            )
        if hasattr(subscription, "tag_legacy_map"):
            subscription.tag_legacy_map = {
                key: target_id if value == source_id else value
                for key, value in (subscription.tag_legacy_map or {}).items()
            }
        if hasattr(subscription, "tag_pending"):
            subscription.tag_pending = [
                {**entry, "tag_id": target_id if entry.get("tag_id") == source_id else entry.get("tag_id")}
                for entry in (subscription.tag_pending or [])
            ]
        if hasattr(subscription, "tag_conflicts"):
            subscription.tag_conflicts = [
                {
                    **entry,
                    "tag_id": target_id if entry.get("tag_id") == source_id else entry.get("tag_id"),
                    "local": _replace_tag_id(entry.get("local"), source_id, target_id)
                    if entry.get("field") == "parents" else entry.get("local"),
                    "incoming": _replace_tag_id(entry.get("incoming"), source_id, target_id)
                    if entry.get("field") == "parents" else entry.get("incoming")
                }
                for entry in (subscription.tag_conflicts or [])
            ]


def apply_tag_actions(db, base_revision, actions):
    setting = get_or_create_tag_hierarchy_row(db)
    hierarchy = normalize_tag_hierarchy(setting.value)
    if int(base_revision) != hierarchy["revision"]:
        raise TagRevisionConflict("La hiérarchie a été modifiée ailleurs")

    created = []
    for action in actions or []:
        action_type = action.get("type")
        tag_id = str(action.get("tag_id") or "").strip()
        nodes = hierarchy["nodes"]

        if action_type == "create":
            tag_id = tag_id or new_custom_tag_id()
            if not is_custom_tag_id(tag_id) or tag_id in nodes:
                raise TagValidationError("Identifiant de tag invalide ou déjà utilisé")
            label = _clean_label(action.get("label"))
            if not label:
                raise TagValidationError("Le nom du tag est requis")
            parents = list(dict.fromkeys(action.get("parent_ids") or []))
            for parent_id in parents:
                if parent_id not in nodes:
                    raise TagValidationError("Parent introuvable")
            nodes[tag_id] = _default_node(
                tag_id,
                labels={action.get("locale") or DEFAULT_LOCALE: label},
                default_locale=action.get("locale") or DEFAULT_LOCALE,
                parents=parents,
                origin="local",
                classification=(
                    "placed" if parents
                    else ("root" if action.get("classification") == "root" else "unplaced")
                )
            )
            suggestion_key = str(action.get("suggestion_key") or "").strip()
            if suggestion_key:
                nodes[tag_id]["suggestion_key"] = suggestion_key
            created.append(tag_id)

        elif action_type == "set_label":
            if tag_id not in nodes:
                raise TagValidationError("Tag introuvable")
            label = _clean_label(action.get("label"))
            if not label:
                raise TagValidationError("Le nom du tag est requis")
            nodes[tag_id]["labels"][_clean_locale(action.get("locale"))] = label

        elif action_type == "remove_label":
            if tag_id not in nodes:
                raise TagValidationError("Tag introuvable")
            locale = _clean_locale(action.get("locale"))
            labels = nodes[tag_id].get("labels") or {}
            if locale in labels and len(labels) <= 1:
                raise TagValidationError("Un tag doit conserver au moins un nom")
            labels.pop(locale, None)
            if nodes[tag_id].get("default_locale") not in labels and labels:
                nodes[tag_id]["default_locale"] = next(iter(labels))

        elif action_type in {"set_parents", "unfile", "accept_root"}:
            if tag_id not in nodes:
                raise TagValidationError("Tag introuvable")
            if tag_id in CORE_ROOT_IDS:
                raise TagValidationError("Les thèmes de base ne peuvent pas être déplacés")
            parents = [] if action_type != "set_parents" else list(dict.fromkeys(action.get("parent_ids") or []))
            prospective = parent_map(hierarchy)
            if parents:
                prospective[tag_id] = parents
            else:
                prospective.pop(tag_id, None)
            _validate_parent_map(prospective, nodes)
            nodes[tag_id]["parents"] = parents
            nodes[tag_id]["classification"] = (
                "placed" if parents else ("root" if action_type == "accept_root" else "unplaced")
            )

        elif action_type == "hide_root":
            if tag_id not in CORE_ROOT_IDS:
                raise TagValidationError("Seuls les thèmes de base peuvent être masqués")
            totals, _ = tag_usage_counts(db, parent_map(hierarchy))
            hidden = set(hierarchy["hidden_core_roots"])
            if action.get("hidden"):
                if totals.get(tag_id, 0):
                    raise TagValidationError("Un thème utilisé ne peut pas être masqué")
                hidden.add(tag_id)
            else:
                hidden.discard(tag_id)
            hierarchy["hidden_core_roots"] = sorted(hidden)

        elif action_type == "remove_assignments":
            if tag_id not in nodes:
                raise TagValidationError("Tag introuvable")
            for question in db.query(Question).all():
                if tag_id in (question.tags or []):
                    question.tags = [value for value in question.tags if value != tag_id]

        elif action_type == "delete":
            if tag_id in CORE_ROOT_IDS:
                raise TagValidationError("Un thème de base ne peut pas être supprimé")
            if tag_id not in nodes:
                raise TagValidationError("Tag introuvable")
            direct, _ = tag_usage_counts(db)
            has_children = any(tag_id in node.get("parents", []) for node in nodes.values())
            if direct.get(tag_id, 0) or has_children or nodes[tag_id].get("parents"):
                raise TagValidationError("Retirez d’abord ce tag des questions et de l’arborescence")
            del nodes[tag_id]

        elif action_type == "merge":
            _merge_nodes(hierarchy, tag_id, str(action.get("target_id") or ""), db)

        else:
            raise TagValidationError(f"Action de tag inconnue: {action_type}")

    _validate_parent_map(parent_map(hierarchy), hierarchy["nodes"])
    hierarchy["revision"] += 1
    setting.value = _with_compatibility_fields(hierarchy)
    db.flush()
    return hierarchy, created


def hierarchy_slice_for_tags(hierarchy, tag_ids):
    hierarchy = normalize_tag_hierarchy(hierarchy)
    parents = parent_map(hierarchy)
    keep = set()
    for value in tag_ids or []:
        tag_id = resolve_tag_id(hierarchy, value)
        if tag_id:
            keep |= ancestors(tag_id, parents)

    nodes = {}
    for tag_id in sorted(keep):
        source = hierarchy["nodes"].get(tag_id)
        if not source:
            continue
        node = copy.deepcopy(source)
        node["parents"] = [parent for parent in node.get("parents", []) if parent in keep]
        nodes[tag_id] = node
    return _with_compatibility_fields({
        "version": HIERARCHY_VERSION,
        "revision": 0,
        "nodes": nodes,
        "hidden_core_roots": [],
        "redirects": {},
        "legacy_ids": {
            key: value
            for key, value in hierarchy.get("legacy_ids", {}).items()
            if value in keep
        },
        "seed": {"version": SEED_VERSION}
    })


def normalize_pack_hierarchy(incoming, pack_guid, legacy_map=None, tag_values=None):
    legacy_map = dict(legacy_map or {})
    incoming = incoming if isinstance(incoming, dict) else {}
    if incoming.get("version") == HIERARCHY_VERSION and isinstance(incoming.get("nodes"), dict):
        normalized = normalize_tag_hierarchy(incoming)
        normalized["nodes"] = {
            tag_id: node for tag_id, node in normalized["nodes"].items()
            if tag_id in incoming.get("nodes", {})
        }
        return _with_compatibility_fields(normalized), legacy_map

    raw_parents = incoming.get("parents") if isinstance(incoming.get("parents"), dict) else {}
    raw_labels = incoming.get("labels") if isinstance(incoming.get("labels"), dict) else {}
    values = set(tag_values or []) | set(raw_labels) | set(raw_parents)
    for parent_values in raw_parents.values():
        values.update(_legacy_values(parent_values))

    id_by_slug = {}
    for value in values:
        slug = slugify_tag(value)
        if not slug:
            continue
        tag_id = core_id_for_value(value) or legacy_map.get(slug) or legacy_pack_tag_id(pack_guid, slug)
        id_by_slug[slug] = tag_id
        legacy_map[slug] = tag_id

    nodes = {}
    for value in values:
        slug = slugify_tag(value)
        tag_id = id_by_slug.get(slug)
        if not tag_id:
            continue
        label = raw_labels.get(value)
        if label is None:
            label = next((v for k, v in raw_labels.items() if slugify_tag(k) == slug), value)
        nodes.setdefault(tag_id, _default_node(
            tag_id,
            labels={DEFAULT_LOCALE: label or value},
            origin="core" if tag_id in CORE_ROOT_IDS else "pack",
            pack_ids=[pack_guid] if tag_id not in CORE_ROOT_IDS else []
        ))

    for raw_child, raw_parent_values in raw_parents.items():
        child_id = id_by_slug.get(slugify_tag(raw_child))
        if not child_id or child_id in CORE_ROOT_IDS:
            continue
        parent_ids = [
            id_by_slug.get(slugify_tag(value))
            for value in _legacy_values(raw_parent_values)
        ]
        nodes[child_id]["parents"] = [value for value in parent_ids if value and value != child_id]
        nodes[child_id]["classification"] = "placed" if nodes[child_id]["parents"] else "unplaced"

    hierarchy = _with_compatibility_fields({
        "version": HIERARCHY_VERSION,
        "revision": 0,
        "nodes": nodes,
        "hidden_core_roots": [],
        "redirects": {},
        "legacy_ids": {},
        "seed": {"version": SEED_VERSION}
    })
    return hierarchy, legacy_map


def map_legacy_pack_tags(tags, pack_guid, legacy_map):
    mapped = []
    for value in tags or []:
        if str(value) in CORE_ROOT_IDS or is_custom_tag_id(value):
            tag_id = str(value)
        else:
            slug = slugify_tag(value)
            tag_id = core_id_for_value(value) or legacy_map.get(slug) or legacy_pack_tag_id(pack_guid, slug)
            legacy_map[slug] = tag_id
        if tag_id and tag_id not in mapped:
            mapped.append(tag_id)
    return mapped


def _conflict(pack_guid, tag_id, field, local, incoming):
    return {
        "id": str(uuid.uuid4()),
        "pack_guid": pack_guid,
        "tag_id": tag_id,
        "field": field,
        "local": local,
        "incoming": incoming,
        "status": "pending"
    }


def merge_pack_hierarchy(db, incoming, *, pack_guid=None, previous=None):
    raw_incoming = incoming if isinstance(incoming, dict) else {}
    setting = get_or_create_tag_hierarchy_row(db)
    hierarchy = normalize_tag_hierarchy(setting.value)
    incoming = normalize_tag_hierarchy(incoming)
    previous = normalize_tag_hierarchy(previous) if previous else None
    known_before = set(hierarchy["nodes"])
    conflicts = []
    changed = False

    # A slice normalizer always installs core roots. Limit work to nodes the
    # archive actually mentioned, plus roots referenced as parents.
    if int(raw_incoming.get("version") or 0) >= HIERARCHY_VERSION and isinstance(raw_incoming.get("nodes"), dict):
        raw_ids = set(raw_incoming["nodes"])
        for raw_node in raw_incoming["nodes"].values():
            if isinstance(raw_node, dict):
                raw_ids.update(raw_node.get("parents") or [])
    else:
        raw_ids = set((raw_incoming.get("labels") or {})) | set((raw_incoming.get("parents") or {}))
        for values in (raw_incoming.get("parents") or {}).values():
            raw_ids.update(_legacy_values(values))
    incoming_ids = {
        resolved
        for raw_id in raw_ids
        if (resolved := resolve_tag_id(incoming, raw_id))
    }

    for tag_id in sorted(incoming_ids):
        incoming_node = incoming["nodes"].get(tag_id)
        if not incoming_node:
            continue
        current = hierarchy["nodes"].get(tag_id)
        old = (previous or {}).get("nodes", {}).get(tag_id) if previous else None

        if current is None:
            node = copy.deepcopy(incoming_node)
            if tag_id not in CORE_ROOT_IDS and pack_guid:
                node["pack_ids"] = sorted(set(node.get("pack_ids", [])) | {pack_guid})
            hierarchy["nodes"][tag_id] = node
            changed = True
            continue

        if tag_id not in CORE_ROOT_IDS and pack_guid and pack_guid not in current.get("pack_ids", []):
            current["pack_ids"] = sorted(set(current.get("pack_ids", [])) | {pack_guid})
            changed = True

        locales = set(incoming_node.get("labels", {})) | set((old or {}).get("labels", {}))
        for locale in locales:
            new_value = incoming_node.get("labels", {}).get(locale)
            old_value = (old or {}).get("labels", {}).get(locale)
            current_value = current.get("labels", {}).get(locale)
            if tag_id in CORE_ROOT_IDS:
                if current_value is None and new_value:
                    current.setdefault("labels", {})[locale] = new_value
                    changed = True
                continue
            if previous:
                if current_value == old_value:
                    if new_value is None:
                        current.get("labels", {}).pop(locale, None)
                    else:
                        current.setdefault("labels", {})[locale] = new_value
                    changed = changed or new_value != old_value
                elif new_value not in {old_value, current_value}:
                    conflicts.append(_conflict(pack_guid, tag_id, f"label:{locale}", current_value, new_value))
            elif current_value is None and new_value:
                current.setdefault("labels", {})[locale] = new_value
                changed = True

        new_parents = list(incoming_node.get("parents") or [])
        current_parents = list(current.get("parents") or [])
        old_parents = list((old or {}).get("parents") or [])
        if tag_id not in CORE_ROOT_IDS:
            if previous:
                if set(current_parents) == set(old_parents):
                    prospective = parent_map(hierarchy)
                    if new_parents:
                        prospective[tag_id] = new_parents
                    else:
                        prospective.pop(tag_id, None)
                    try:
                        _validate_parent_map(prospective, hierarchy["nodes"])
                    except TagValidationError:
                        conflicts.append(_conflict(pack_guid, tag_id, "parents", current_parents, new_parents))
                    else:
                        current["parents"] = new_parents
                        current["classification"] = "placed" if new_parents else "unplaced"
                        changed = changed or set(new_parents) != set(old_parents)
                elif frozenset(new_parents) not in {frozenset(old_parents), frozenset(current_parents)}:
                    conflicts.append(_conflict(pack_guid, tag_id, "parents", current_parents, new_parents))
            elif tag_id not in known_before:
                current["parents"] = new_parents
                current["classification"] = "placed" if new_parents else "unplaced"

    pending = []
    incoming_parents = parent_map(incoming)
    for tag_id in sorted(incoming_ids):
        if tag_id in CORE_ROOT_IDS or tag_id in known_before:
            continue
        if not incoming_parents.get(tag_id):
            hierarchy["nodes"][tag_id]["classification"] = "unplaced"
            pending.append({
                "id": f"{pack_guid}:{tag_id}",
                "pack_guid": pack_guid,
                "tag_id": tag_id,
                "status": "pending"
            })

    if changed or pending or conflicts:
        hierarchy["revision"] += 1
        setting.value = _with_compatibility_fields(hierarchy)
    return hierarchy, pending, conflicts


def seed_slice(known_slugs=None):
    """Compatibility view used only by migration 0021 tests."""
    labels = {slug: label for slug, label, _parents in SEED_NODES}
    parents = {slug: list(parent_ids) for slug, _label, parent_ids in SEED_NODES if parent_ids}
    return {"labels": labels, "parents": parents}


def merge_hierarchy_slice(hierarchy, incoming, removed_slugs=None):
    """Legacy v2 merge helper retained so migration 0021 stays reproducible."""
    current = hierarchy if isinstance(hierarchy, dict) else {}
    parents = copy.deepcopy(current.get("parents") or {})
    labels = copy.deepcopy(current.get("labels") or {})
    blocked = {slugify_tag(value) for value in (removed_slugs or [])}
    for key, label in (incoming.get("labels") or {}).items():
        normalized = slugify_tag(key)
        if normalized and normalized not in blocked:
            labels.setdefault(normalized, label)
    for child, parent_values in (incoming.get("parents") or {}).items():
        child_id = slugify_tag(child)
        if not child_id or child_id in blocked or parents.get(child_id):
            continue
        for parent in _legacy_values(parent_values):
            parent_id = slugify_tag(parent)
            if parent_id and parent_id not in blocked and parent_id != child_id:
                parents.setdefault(child_id, []).append(parent_id)
    return {"version": 2, "parents": parents, "labels": labels, "seed": current.get("seed", {"version": 0, "removed": []})}


def apply_tag_seed(db):
    """Ensure only the universal roots exist; descendants remain suggestions."""
    setting = get_or_create_tag_hierarchy_row(db)
    hierarchy = normalize_tag_hierarchy(setting.value)
    changed = False
    for tag_id, labels in CORE_ROOTS.items():
        if tag_id not in hierarchy["nodes"]:
            hierarchy["nodes"][tag_id] = _default_node(tag_id, labels=labels, origin="core")
            changed = True
    if changed:
        hierarchy["revision"] += 1
        setting.value = _with_compatibility_fields(hierarchy)
    return hierarchy


def tag_suggestions(hierarchy):
    materialized_keys = {
        node.get("suggestion_key")
        for node in (hierarchy or {}).get("nodes", {}).values()
        if node.get("suggestion_key")
    }
    result = []
    for slug, label, parent_slugs in SEED_NODES:
        if not parent_slugs or slug in materialized_keys:
            continue
        root_slug = parent_slugs[0]
        while root_slug not in CORE_ID_BY_SLUG:
            parent_node = next((item for item in SEED_NODES if item[0] == root_slug), None)
            if not parent_node or not parent_node[2]:
                break
            root_slug = parent_node[2][0]
        result.append({
            "key": slug,
            "label": label,
            "locale": DEFAULT_LOCALE,
            "suggested_parent_id": CORE_ID_BY_SLUG.get(root_slug),
            "path": parent_slugs
        })
    return result


def _suggested_matches(hierarchy, tag_id):
    source = hierarchy["nodes"].get(tag_id)
    if not source:
        return []
    source_labels = list((source.get("labels") or {}).values())
    scores = []
    for candidate_id, node in hierarchy["nodes"].items():
        if candidate_id == tag_id:
            continue
        ratio = max(
            (difflib.SequenceMatcher(None, comparison_key(a), comparison_key(b)).ratio()
             for a in source_labels for b in (node.get("labels") or {}).values()),
            default=0
        )
        if ratio >= 0.82:
            scores.append((ratio, candidate_id))
    return [candidate_id for _score, candidate_id in sorted(scores, reverse=True)[:3]]


def tag_inbox(db, hierarchy=None):
    hierarchy = hierarchy or load_tag_hierarchy(db)
    pending = []
    conflicts = []
    for subscription in db.query(PackSubscription).all():
        for entry in (getattr(subscription, "tag_pending", None) or []):
            if entry.get("status") not in {"pending", "deferred"}:
                continue
            tag_id = entry.get("tag_id")
            subtree = descendants(tag_id, parent_map(hierarchy))
            questions = [
                question for question in db.query(Question).filter(Question.pack_guid == subscription.pack_guid).all()
                if set(question.tags or []) & subtree
            ]
            pending.append({
                **entry,
                "pack_name": subscription.name,
                "pack_version": subscription.installed_version,
                "label": label_for_tag(hierarchy, tag_id),
                "question_count": len(questions),
                "sample_questions": [question.question for question in questions[:3]],
                "suggested_matches": _suggested_matches(hierarchy, tag_id)
            })
        conflicts.extend([
            {**entry, "pack_name": subscription.name}
            for entry in (getattr(subscription, "tag_conflicts", None) or [])
            if entry.get("status") == "pending"
        ])
    return {"pending": pending, "conflicts": conflicts, "count": len(pending) + len(conflicts)}


def tag_snapshot(db, locale=DEFAULT_LOCALE):
    ensure_stored_tag_ids(db)
    hierarchy = load_tag_hierarchy(db)
    parents = parent_map(hierarchy)
    direct, _ = tag_usage_counts(db)
    total, _ = tag_usage_counts(db, parents)
    samples = {}
    for question in db.query(Question).all():
        for raw_tag in question.tags or []:
            tag_id = resolve_tag_id(hierarchy, raw_tag)
            if tag_id and len(samples.setdefault(tag_id, [])) < 3:
                samples[tag_id].append({"id": question.id, "question": question.question})
    pack_names = {
        subscription.pack_guid: subscription.name
        for subscription in db.query(PackSubscription).all()
    }
    entries = []
    for tag_id, node in hierarchy["nodes"].items():
        entries.append({
            "id": tag_id,
            "label": label_for_node(node, locale),
            "labels": dict(node.get("labels") or {}),
            "default_locale": node.get("default_locale") or DEFAULT_LOCALE,
            "parents": list(node.get("parents") or []),
            "direct_count": direct.get(tag_id, 0),
            "total_count": total.get(tag_id, 0),
            "kind": "core" if tag_id in CORE_ROOT_IDS else "custom",
            "origin": node.get("origin") or "local",
            "pack_ids": list(node.get("pack_ids") or []),
            "source_packs": [
                {"guid": pack_guid, "name": pack_names.get(pack_guid, pack_guid)}
                for pack_guid in (node.get("pack_ids") or [])
            ],
            "representative_questions": samples.get(tag_id, []),
            "classification": node.get("classification") or ("placed" if node.get("parents") else "unplaced"),
            "hidden": tag_id in hierarchy.get("hidden_core_roots", [])
        })
    inbox = tag_inbox(db, hierarchy)
    return {
        "version": HIERARCHY_VERSION,
        "revision": hierarchy["revision"],
        "locale": locale,
        "hierarchy": hierarchy,
        "nodes": entries,
        "usage": direct,
        "total_usage": total,
        "displays": {entry["id"]: entry["label"] for entry in entries},
        "suggestions": tag_suggestions(hierarchy),
        "inbox": inbox
    }


def detach_pack_tag_state(db, pack_guid, *, keep_content):
    """Release a subscription's tag ownership without harming shared nodes."""
    setting = get_or_create_tag_hierarchy_row(db)
    hierarchy = normalize_tag_hierarchy(setting.value)
    changed = False

    for node in hierarchy["nodes"].values():
        pack_ids = [value for value in node.get("pack_ids", []) if value != pack_guid]
        if pack_ids != node.get("pack_ids", []):
            node["pack_ids"] = pack_ids
            changed = True
            if keep_content and not pack_ids and node.get("origin") == "pack":
                node["origin"] = "local"

    if not keep_content:
        direct, _ = tag_usage_counts(db)
        removed = True
        while removed:
            removed = False
            children = _children_map(parent_map(hierarchy))
            for tag_id, node in list(hierarchy["nodes"].items()):
                if tag_id in CORE_ROOT_IDS:
                    continue
                if node.get("origin") != "pack" or node.get("pack_ids"):
                    continue
                if direct.get(tag_id, 0) or children.get(tag_id):
                    continue
                del hierarchy["nodes"][tag_id]
                removed = True
                changed = True

    if changed:
        hierarchy["revision"] += 1
        setting.value = _with_compatibility_fields(hierarchy)
    return hierarchy
