"""
Derived ordering for sequence groups (M1.5).

For presidents, dynasties, discographies and Astérix the order *is* the sort by
a date or a number. Hand-ranking such a list authors the same knowledge twice and
turns every insertion into a manual reshuffle.

A group can therefore declare an ordering attribute and have its ranks computed.
The derivation runs at WRITE time, in save_sequence_group_items, replacing the
`position = index + 1` that array order otherwise supplies. Deriving at read time
instead would mean threading the group into dense_positions() and its six call
sites, and would break the "sequence items require an integer data.position"
contract that PATCH /questions/{id} enforces. This way every downstream consumer
-- the graders, the rail, the serializer, training -- keeps reading
`data["position"]` and none of them changes.
"""

from .timeline import date_lower_value, normalize_timeline_date


SEQUENCE_ORDER_KEY = "order"
SEQUENCE_ORDER_VALUE_KEY = "order_value"

ORDER_MODE_MANUAL = "manual"
ORDER_MODE_DERIVED = "derived"
ORDER_MODES = (ORDER_MODE_MANUAL, ORDER_MODE_DERIVED)

ORDER_KIND_DATE = "date"
ORDER_KIND_NUMBER = "number"
ORDER_KINDS = (ORDER_KIND_DATE, ORDER_KIND_NUMBER)


def normalize_sequence_order(value):
    """Coerce a group's order setting, or None for the manual default.

    Absent means manual, the convention `training_record` already uses -- so an
    existing hand-ranked group needs no migration and no backfill.
    """
    if not isinstance(value, dict):
        return None

    mode = str(value.get("mode") or "").strip()

    if mode != ORDER_MODE_DERIVED:
        return None

    kind = str(value.get("kind") or "").strip()

    if kind not in ORDER_KINDS:
        kind = ORDER_KIND_DATE

    label = str(value.get("label") or "").strip()

    return {
        "mode": ORDER_MODE_DERIVED,
        "kind": kind,
        **({"label": label} if label else {})
    }


def merge_sequence_order(group_data, order):
    """Replace only the order key, preserving the rest of group.data.

    Mirrors merge_map_package. The group blob also carries `training_record` and
    `training_records`, so a whole-dict replace here would silently destroy a
    learner's best times.
    """
    merged = dict(group_data or {})
    normalized = normalize_sequence_order(order)

    if normalized is None:
        merged.pop(SEQUENCE_ORDER_KEY, None)
    else:
        merged[SEQUENCE_ORDER_KEY] = normalized

    return merged


def sequence_order_settings(group):
    return normalize_sequence_order((getattr(group, "data", None) or {}).get(
        SEQUENCE_ORDER_KEY
    ))


def order_sort_value(value, kind):
    """The comparable scalar for one item's ordering attribute, or None.

    Dates reuse the timeline representation wholesale: date_lower_value handles
    BC years and mixed precision, so a reign known only to the year still sorts
    correctly against one known to the day.
    """
    if value is None:
        return None

    if kind == ORDER_KIND_NUMBER:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    try:
        return float(date_lower_value(normalize_timeline_date(value)))
    except (TypeError, ValueError):
        return None


def derive_sequence_positions(entries, kind):
    """Rank entries by their ordering attribute.

    `entries` is a list of (key, order_value) in the editor's array order.
    Returns {key: position}, dense from 1.

    Items with a missing or unparseable value sort LAST rather than failing the
    save, and ties fall back to the array order -- the same shape as
    dense_positions' (is_none, value, id) rule, so the two agree about what an
    unusable value means.
    """
    decorated = [
        (index, key, order_sort_value(value, kind))
        for index, (key, value) in enumerate(entries or [])
    ]
    ordered = sorted(
        decorated,
        key=lambda entry: (entry[2] is None, entry[2] or 0, entry[0])
    )

    return {
        key: rank + 1
        for rank, (_, key, _value) in enumerate(ordered)
    }
