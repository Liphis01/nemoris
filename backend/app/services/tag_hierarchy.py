from ..models import AppSetting


TAG_HIERARCHY_KEY = "tag_hierarchy"

DEFAULT_TAG_HIERARCHY = {
    "parents": {},
    "labels": {},
    "positions": {}
}


def normalize_tag_key(value):
    return str(value or "").strip().casefold()


def _clean_label(value):
    return str(value or "").strip()


def _as_parent_list(value):
    if isinstance(value, (list, tuple, set)):
        return [normalize_tag_key(item) for item in value]
    # Backward-compatible with the old single-parent string shape.
    return [normalize_tag_key(value)]


def normalize_tag_hierarchy(value):
    """Coerce stored/incoming data into a valid DAG.

    Shape: {"parents": {child: [parents]}, "labels": {key: display},
    "positions": {key: {"x": float, "y": float}}}. Keys are normalized. Self-edges
    and any edge that would close a cycle are dropped so the graph stays acyclic.
    """
    data = value if isinstance(value, dict) else {}
    raw_parents = data.get("parents") if isinstance(data.get("parents"), dict) else {}
    raw_labels = data.get("labels") if isinstance(data.get("labels"), dict) else {}
    raw_positions = (
        data.get("positions") if isinstance(data.get("positions"), dict) else {}
    )

    labels = {}
    for key, label in raw_labels.items():
        normalized_key = normalize_tag_key(key)
        clean = _clean_label(label)
        if normalized_key and clean:
            labels.setdefault(normalized_key, clean)

    parents = {}
    for child, raw_parent_value in raw_parents.items():
        child_key = normalize_tag_key(child)

        if not child_key:
            continue

        for parent_key in _as_parent_list(raw_parent_value):
            if not parent_key or parent_key == child_key:
                continue

            if parent_key in parents.get(child_key, []):
                continue

            # Reject the edge if attaching child→parent would create a cycle, i.e.
            # the prospective parent already descends from the child.
            if _would_create_cycle(parents, child_key, parent_key):
                continue

            parents.setdefault(child_key, []).append(parent_key)
            labels.setdefault(child_key, _clean_label(child) or child_key)
            labels.setdefault(parent_key, parent_key)

    positions = {}
    for key, point in raw_positions.items():
        normalized_key = normalize_tag_key(key)
        coords = _normalize_point(point)
        if normalized_key and coords is not None:
            positions[normalized_key] = coords
            labels.setdefault(normalized_key, normalized_key)

    return {"parents": parents, "labels": labels, "positions": positions}


def _normalize_point(point):
    if not isinstance(point, dict):
        return None

    try:
        return {"x": float(point["x"]), "y": float(point["y"])}
    except (KeyError, TypeError, ValueError):
        return None


def _would_create_cycle(parents, child_key, parent_key):
    # A cycle forms when the prospective parent is reachable as an ancestor of the
    # child — equivalently, when the child is already an ancestor of the parent.
    return child_key in ancestors(parent_key, parents)


def get_or_create_tag_hierarchy_row(db):
    setting = (
        db.query(AppSetting)
        .filter(AppSetting.key == TAG_HIERARCHY_KEY)
        .first()
    )

    if setting:
        return setting

    setting = AppSetting(
        key=TAG_HIERARCHY_KEY,
        value=dict(DEFAULT_TAG_HIERARCHY)
    )
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
    setting = get_or_create_tag_hierarchy_row(db)
    normalized = normalize_tag_hierarchy(payload)
    setting.value = normalized

    return normalized


def parent_map(hierarchy):
    parents = (hierarchy or {}).get("parents")

    if not isinstance(parents, dict):
        return {}

    return {child: list(value or []) for child, value in parents.items()}


def _children_map(pmap):
    children = {}
    for child, parents in pmap.items():
        for parent in parents or []:
            children.setdefault(parent, []).append(child)
    return children


def descendants(tag_key, pmap):
    """All descendant keys of tag_key (following parent→child), including itself."""
    children = _children_map(pmap)
    result = set()
    stack = [tag_key]

    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(children.get(current, []))

    return result


def ancestors(tag_key, pmap):
    """All ancestor keys of tag_key (following child→parent), including itself."""
    result = set()
    stack = [tag_key]

    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(pmap.get(current, []) or [])

    return result
