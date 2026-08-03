from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
import hashlib
import json
import math
import re
import time
from xml.etree import ElementTree as StdElementTree

from defusedxml import ElementTree

from .canonicalize import (
    CanonicalizationError,
    CanonicalizationResult,
    DEFINITION_TAGS,
    MAX_CODE_LENGTH,
    PAINTABLE_TAGS_LOWER,
    SOFT_DEADLINE_SECONDS,
    SVG_NS,
    canonicalize_svg,
    local_name,
)
from .contracts import (
    MapImportDiagnostic,
    MapImportEvidence,
    MapImportInterpretation,
    MapImportOntology,
    MapPackageV2,
    MapSourceV2,
    MapZoneProposal,
    MapZoneV2,
)
from .ontologies import (
    AMBIGUOUS_SUBDIVISION_CODES,
    ONTOLOGY_OPTIONS,
    infer_ontology,
    ontology_matches_code,
    proposal_for,
)


GENERATED_ID_RE = re.compile(
    r"^(?:\d+|(?:path|rect|circle|ellipse|polygon|polyline|line|g|layer|shape|svg)"
    r"[-_]?\d+(?:[-_]\d+)*|"
    r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$",
    re.IGNORECASE,
)
LABEL_TOKEN_RE = re.compile(
    r"(?:^|[-_])(?:answer|answers|label|labels|legend|text|texts)(?:$|[-_])",
    re.IGNORECASE,
)
COUNTRY_ID_RE = re.compile(r"^[a-z]{2}$")
CAPITAL_ID_RE = re.compile(r"^([a-z]{2})-c([0-9]*)$")
COUNTRY_AUX_ID_RE = re.compile(r"^([a-z]{2})-(?:d|w)$")
STATE_ID_RE = re.compile(r"^[A-Z]{2}$")
CSS_CLASS_RE = re.compile(r"\.([A-Za-z_][\w-]*)")
NUMBER_RE = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")
PATH_TOKEN_RE = re.compile(
    r"[AaCcHhLlMmQqSsTtVvZz]|"
    r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
)
TRANSFORM_PART_RE = re.compile(r"([A-Za-z]+)\s*\(([^)]*)\)")

JETPUNK_STYLE_CLASSES = {
    "border", "borders", "country", "dccircle", "map-correct",
    "map-hidden", "map-highlight",
    "map-incorrect", "random-svg-highlight", "small-stroke", "svg-correct",
    "state", "svg-hidden", "svg-highlight", "svg-incorrect",
    "zoomable-circle",
}


@dataclass
class InventoryShape:
    index: int
    parent_index: int | None
    tag: str
    source_id: str
    classes: tuple[str, ...]
    ancestry_ids: tuple[str, ...]
    ancestry_classes: tuple[str, ...]
    texts: tuple[str, ...]
    semantic_texts: tuple[tuple[str, str], ...]
    visible: bool
    closed: bool
    filled: bool
    fill: str
    stroke: str
    in_defs: bool
    bbox: tuple[float, float, float, float] | None
    data_code: str = ""
    label_path: bool = False

    def as_json(self):
        return {
            "index": self.index,
            "parent_index": self.parent_index,
            "tag": self.tag,
            "source_id": self.source_id,
            "classes": list(self.classes),
            "ancestry_ids": list(self.ancestry_ids),
            "ancestry_classes": list(self.ancestry_classes),
            "texts": list(self.texts),
            "semantic_texts": [
                {"kind": kind, "value": value}
                for kind, value in self.semantic_texts
            ],
            "visible": self.visible,
            "closed": self.closed,
            "filled": self.filled,
            "fill": self.fill,
            "stroke": self.stroke,
            "in_defs": self.in_defs,
            "bbox": list(self.bbox) if self.bbox else None,
            "data_code": self.data_code,
            "label_path": self.label_path,
        }


@dataclass
class SvgInventory:
    source_sha256: str
    shapes: list[InventoryShape]
    css_classes: set[str]
    duplicate_ids: set[str]
    semantic_duplicate_ids: set[str]
    element_count: int
    has_raster: bool
    data_codes: list[str]
    local_references: list[dict] = field(default_factory=list)
    text_records: list[dict] = field(default_factory=list)
    source_ids: dict[int, str] = field(default_factory=dict)
    source_classes: dict[int, tuple[str, ...]] = field(default_factory=dict)
    group_descendants: dict[int, tuple[int, ...]] = field(default_factory=dict)

    def as_json(self):
        return {
            "source_sha256": self.source_sha256,
            "element_count": self.element_count,
            "has_raster": self.has_raster,
            "css_classes": sorted(self.css_classes),
            "duplicate_ids": sorted(self.duplicate_ids),
            "semantic_duplicate_ids": sorted(self.semantic_duplicate_ids),
            "data_codes": self.data_codes,
            "local_references": self.local_references,
            "text_records": self.text_records,
            "shapes": [shape.as_json() for shape in self.shapes],
        }


@dataclass
class SvgAnalysisResult(CanonicalizationResult):
    ontology: MapImportOntology = "auto"
    selection_required: bool = False
    selected_interpretation_id: str | None = None
    interpretations: list[MapImportInterpretation] = field(default_factory=list)
    zones: list[MapZoneProposal] = field(default_factory=list)
    question_defaults: dict[str, dict] = field(default_factory=dict)
    inventory: dict = field(default_factory=dict)
    inventory_model: SvgInventory | None = None


def _diagnostic(code, severity="info", *, parameters=None, acknowledgement=False):
    return MapImportDiagnostic(
        code=code,
        severity=severity,
        stage="detect",
        parameters=parameters or {},
        shape_ids=[],
        requires_acknowledgement=acknowledgement,
    )


def _ensure_deadline(deadline_at):
    if deadline_at is not None and time.monotonic() > deadline_at:
        raise CanonicalizationError(
            "svg.processing_deadline",
            "SVG processing deadline exceeded",
            status_code=408,
        )


def _matrix_multiply(left, right):
    a, b, c, d, e, f = left
    g, h, i, j, k, l = right
    return (
        a * g + c * h,
        b * g + d * h,
        a * i + c * j,
        b * i + d * j,
        a * k + c * l + e,
        b * k + d * l + f,
    )


def _transform_matrix(raw_value):
    matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    for name, values_text in TRANSFORM_PART_RE.findall(str(raw_value or "")):
        values = [float(value) for value in NUMBER_RE.findall(values_text)]
        lowered = name.lower()
        if lowered == "matrix" and len(values) == 6:
            current = tuple(values)
        elif lowered == "translate" and len(values) in {1, 2}:
            current = (1, 0, 0, 1, values[0], values[1] if len(values) == 2 else 0)
        elif lowered == "scale" and len(values) in {1, 2}:
            current = (values[0], 0, 0, values[-1], 0, 0)
        elif lowered == "rotate" and len(values) in {1, 3}:
            angle = math.radians(values[0])
            cosine, sine = math.cos(angle), math.sin(angle)
            rotation = (cosine, sine, -sine, cosine, 0, 0)
            if len(values) == 3:
                before = (1, 0, 0, 1, values[1], values[2])
                after = (1, 0, 0, 1, -values[1], -values[2])
                current = _matrix_multiply(
                    before, _matrix_multiply(rotation, after)
                )
            else:
                current = rotation
        elif lowered == "skewx" and len(values) == 1:
            current = (1, 0, math.tan(math.radians(values[0])), 1, 0, 0)
        elif lowered == "skewy" and len(values) == 1:
            current = (1, math.tan(math.radians(values[0])), 0, 1, 0, 0)
        else:
            continue
        matrix = _matrix_multiply(matrix, current)
    return matrix


def _apply_matrix(point, matrix):
    x, y = point
    a, b, c, d, e, f = matrix
    return a * x + c * y + e, b * x + d * y + f


def _float_attr(element, name, default=0):
    try:
        return float(element.attrib.get(name, default))
    except (TypeError, ValueError):
        return float(default)


def _path_envelope_points(path_data):
    tokens = PATH_TOKEN_RE.findall(str(path_data or ""))
    points = []
    current = (0.0, 0.0)
    subpath_start = current
    command = None
    previous_command = None
    cubic_control = None
    quadratic_control = None
    position = 0
    parameter_counts = {
        "M": 2, "L": 2, "H": 1, "V": 1,
        "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7,
    }

    def absolute_pair(x, y, relative):
        if relative:
            return current[0] + x, current[1] + y
        return x, y

    while position < len(tokens):
        token = tokens[position]
        if len(token) == 1 and token.isalpha():
            command = token
            position += 1
            if command.upper() == "Z":
                points.extend((current, subpath_start))
                current = subpath_start
                cubic_control = None
                quadratic_control = None
                previous_command = command
                command = None
                continue
        if command is None:
            break

        upper = command.upper()
        count = parameter_counts.get(upper)
        if count is None or position + count > len(tokens):
            break
        if any(
            len(value) == 1 and value.isalpha()
            for value in tokens[position:position + count]
        ):
            break
        values = [
            float(value) for value in tokens[position:position + count]
        ]
        position += count
        relative = command.islower()
        start = current

        if upper == "M":
            current = absolute_pair(values[0], values[1], relative)
            subpath_start = current
            points.append(current)
            command = "l" if relative else "L"
            cubic_control = None
            quadratic_control = None
        elif upper == "L":
            current = absolute_pair(values[0], values[1], relative)
            points.extend((start, current))
            cubic_control = None
            quadratic_control = None
        elif upper == "H":
            current = (
                start[0] + values[0] if relative else values[0],
                start[1],
            )
            points.extend((start, current))
            cubic_control = None
            quadratic_control = None
        elif upper == "V":
            current = (
                start[0],
                start[1] + values[0] if relative else values[0],
            )
            points.extend((start, current))
            cubic_control = None
            quadratic_control = None
        elif upper == "C":
            first = absolute_pair(values[0], values[1], relative)
            second = absolute_pair(values[2], values[3], relative)
            current = absolute_pair(values[4], values[5], relative)
            points.extend((start, first, second, current))
            cubic_control = second
            quadratic_control = None
        elif upper == "S":
            if previous_command and previous_command.upper() in {"C", "S"}:
                first = (
                    2 * start[0] - cubic_control[0],
                    2 * start[1] - cubic_control[1],
                )
            else:
                first = start
            second = absolute_pair(values[0], values[1], relative)
            current = absolute_pair(values[2], values[3], relative)
            points.extend((start, first, second, current))
            cubic_control = second
            quadratic_control = None
        elif upper == "Q":
            control = absolute_pair(values[0], values[1], relative)
            current = absolute_pair(values[2], values[3], relative)
            points.extend((start, control, current))
            quadratic_control = control
            cubic_control = None
        elif upper == "T":
            if previous_command and previous_command.upper() in {"Q", "T"}:
                control = (
                    2 * start[0] - quadratic_control[0],
                    2 * start[1] - quadratic_control[1],
                )
            else:
                control = start
            current = absolute_pair(values[0], values[1], relative)
            points.extend((start, control, current))
            quadratic_control = control
            cubic_control = None
        elif upper == "A":
            radius_x, radius_y = abs(values[0]), abs(values[1])
            angle = math.radians(values[2] % 360)
            current = absolute_pair(values[5], values[6], relative)
            extent_x = math.sqrt(
                (radius_x * math.cos(angle)) ** 2
                + (radius_y * math.sin(angle)) ** 2
            )
            extent_y = math.sqrt(
                (radius_x * math.sin(angle)) ** 2
                + (radius_y * math.cos(angle)) ** 2
            )
            for endpoint in (start, current):
                points.extend((
                    (endpoint[0] - 2 * extent_x, endpoint[1] - 2 * extent_y),
                    (endpoint[0] + 2 * extent_x, endpoint[1] + 2 * extent_y),
                ))
            cubic_control = None
            quadratic_control = None
        previous_command = command
    return points


def _raw_bbox(element, tag):
    if tag == "rect":
        x, y = _float_attr(element, "x"), _float_attr(element, "y")
        return x, y, x + _float_attr(element, "width"), y + _float_attr(element, "height")
    if tag == "circle":
        cx, cy, radius = (
            _float_attr(element, "cx"),
            _float_attr(element, "cy"),
            _float_attr(element, "r"),
        )
        return cx - radius, cy - radius, cx + radius, cy + radius
    if tag == "ellipse":
        cx, cy, rx, ry = (
            _float_attr(element, "cx"),
            _float_attr(element, "cy"),
            _float_attr(element, "rx"),
            _float_attr(element, "ry"),
        )
        return cx - rx, cy - ry, cx + rx, cy + ry
    if tag == "line":
        xs = [_float_attr(element, "x1"), _float_attr(element, "x2")]
        ys = [_float_attr(element, "y1"), _float_attr(element, "y2")]
        return min(xs), min(ys), max(xs), max(ys)
    if tag in {"polygon", "polyline"}:
        numbers = [float(value) for value in NUMBER_RE.findall(element.attrib.get("points", ""))]
    elif tag == "path":
        points = _path_envelope_points(element.attrib.get("d", ""))
        if not points:
            return None
        return (
            min(point[0] for point in points),
            min(point[1] for point in points),
            max(point[0] for point in points),
            max(point[1] for point in points),
        )
    else:
        return None
    if len(numbers) < 2:
        return None
    xs, ys = numbers[0::2], numbers[1::2]
    if not xs or not ys:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _transformed_bbox(element, tag, matrix):
    bbox = _raw_bbox(element, tag)
    if not bbox:
        return None
    min_x, min_y, max_x, max_y = bbox
    points = [
        _apply_matrix((min_x, min_y), matrix),
        _apply_matrix((min_x, max_y), matrix),
        _apply_matrix((max_x, min_y), matrix),
        _apply_matrix((max_x, max_y), matrix),
    ]
    return (
        min(point[0] for point in points),
        min(point[1] for point in points),
        max(point[0] for point in points),
        max(point[1] for point in points),
    )


def _is_closed(element, tag):
    if tag in {"rect", "circle", "ellipse", "polygon"}:
        return True
    if tag == "path":
        return bool(re.search(r"[zZ]\s*$", element.attrib.get("d", "")))
    if tag == "use":
        return True
    return False


def _style_value(element, cascaded, name, default=""):
    return str(cascaded.get(id(element), {}).get(
        name, element.attrib.get(name, default)
    )).strip()


def _text_evidence(element):
    values = []
    for name in ("aria-label", "aria-labelledby"):
        value = element.attrib.get(name)
        if value:
            values.append(("aria", str(value).strip()))
    for name, value in element.attrib.items():
        if local_name(name).lower() in {"label", "name"} and value:
            values.append(("title", str(value).strip()))
    for child in element:
        tag = local_name(child.tag).lower()
        if tag in {"title", "desc"}:
            value = " ".join(part.strip() for part in child.itertext() if part.strip())
            if value:
                values.append(("title", value))
    return tuple(dict.fromkeys(
        (kind, value) for kind, value in values if value
    ))


def build_inventory(source, *, started_at=None):
    from .canonicalize import (
        _cascade_styles,
        _has_css_sources,
        _parse_css,
        _validate_limits,
    )

    started_at = started_at if started_at is not None else time.monotonic()
    try:
        root = ElementTree.fromstring(source)
    except Exception as error:
        raise CanonicalizationError("svg.invalid_xml", "SVG could not be parsed") from error
    if local_name(root.tag).lower() != "svg":
        raise CanonicalizationError("svg.invalid_root", "Document root must be svg")

    element_count = _validate_limits(root, started_at)
    temporary_diagnostics = []
    if _has_css_sources(root):
        matcher = _parse_css(root, temporary_diagnostics)
        cascaded = _cascade_styles(root, matcher, temporary_diagnostics)
    else:
        cascaded = {}

    css_classes = set()
    for element in root.iter():
        if local_name(element.tag).lower() == "style":
            css_classes.update(CSS_CLASS_RE.findall("".join(element.itertext())))

    indexed_elements = list(root.iter())
    element_index = {id(element): index for index, element in enumerate(indexed_elements)}
    id_counts = Counter(
        str(element.attrib.get("id") or "").strip()
        for element in indexed_elements
        if str(element.attrib.get("id") or "").strip()
    )
    shapes = []
    source_ids = {}
    source_classes = {}
    group_descendants = defaultdict(list)
    data_codes = []
    local_references = []
    text_records = []
    has_raster = False

    for element in indexed_elements:
        index = element_index[id(element)]
        for name, raw_value in element.attrib.items():
            value = str(raw_value or "").strip()
            target = None
            if local_name(name).lower() == "href" and value.startswith("#"):
                target = value[1:]
            else:
                match = re.fullmatch(
                    r"url\(\s*(['\"]?)#([^)'\"\s]+)\1\s*\)",
                    value,
                    re.IGNORECASE,
                )
                if match:
                    target = match.group(2)
            if target:
                local_references.append({
                    "element_index": index,
                    "attribute": local_name(name),
                    "target": target,
                })

    def visit(
        element,
        parent_index=None,
        *,
        ancestry_ids=(),
        ancestry_classes=(),
        inherited_texts=(),
        inherited_semantic_texts=(),
        inherited_matrix=(1, 0, 0, 1, 0, 0),
        inherited_data_code="",
        inherited_visible=True,
        inherited_fill="black",
        inherited_stroke="",
        in_defs=False,
        group_stack=(),
    ):
        nonlocal has_raster
        index = element_index[id(element)]
        if (
            index % 256 == 0
            and time.monotonic() - started_at > SOFT_DEADLINE_SECONDS
        ):
            raise CanonicalizationError(
                "svg.processing_deadline",
                "SVG processing deadline exceeded",
                status_code=408,
            )
        tag = local_name(element.tag).lower()
        source_id = str(element.attrib.get("id") or "").strip()
        classes = tuple(
            value for value in str(element.attrib.get("class") or "").split()
            if value
        )
        own_semantic_texts = _text_evidence(element)
        semantic_texts = tuple(dict.fromkeys(
            (*inherited_semantic_texts, *own_semantic_texts)
        ))
        texts = tuple(dict.fromkeys((
            *inherited_texts,
            *(value for _, value in own_semantic_texts),
        )))
        current_matrix = _matrix_multiply(
            inherited_matrix, _transform_matrix(element.attrib.get("transform"))
        )
        own_data_code = next(
            (
                str(value or "").strip()
                for name, value in element.attrib.items()
                if local_name(name).lower() == "data-code"
                and str(value or "").strip()
            ),
            "",
        )
        data_code = own_data_code or inherited_data_code
        next_in_defs = in_defs or tag in {value.lower() for value in DEFINITION_TAGS}
        display = _style_value(element, cascaded, "display")
        visibility = _style_value(element, cascaded, "visibility")
        opacity = _style_value(element, cascaded, "opacity", "1")
        current_visible = (
            inherited_visible
            and display.lower() != "none"
            and visibility.lower() not in {"hidden", "collapse"}
            and opacity not in {"0", "0.0"}
        )
        fill = _style_value(element, cascaded, "fill", inherited_fill).lower()
        stroke = _style_value(element, cascaded, "stroke", inherited_stroke)

        if own_data_code:
            data_codes.append(own_data_code)
        if tag == "image":
            has_raster = True
        if tag == "text":
            value = " ".join(
                part.strip() for part in element.itertext() if part.strip()
            )
            coordinate_element = element
            if not (
                element.attrib.get("x") is not None
                and element.attrib.get("y") is not None
            ):
                coordinate_element = next(
                    (
                        child for child in element
                        if (
                            local_name(child.tag).lower() == "tspan"
                            and child.attrib.get("x") is not None
                            and child.attrib.get("y") is not None
                        )
                    ),
                    element,
                )
            if value:
                point = _apply_matrix((
                    _float_attr(coordinate_element, "x"),
                    _float_attr(coordinate_element, "y"),
                ), current_matrix)
                text_records.append({
                    "element_index": index,
                    "value": value,
                    "point": [point[0], point[1]],
                })

        if source_id:
            source_ids[index] = source_id
        if classes:
            source_classes[index] = classes

        next_groups = group_stack
        if tag in {"g", "svg"}:
            next_groups = (*group_stack, index)

        if tag in PAINTABLE_TAGS_LOWER:
            semantic_tokens = (
                source_id, *classes, *ancestry_ids, *ancestry_classes
            )
            is_filled = fill not in {"", "none", "transparent"}
            bbox = _transformed_bbox(element, tag, current_matrix)
            shape = InventoryShape(
                index=index,
                parent_index=parent_index,
                tag=tag,
                source_id=source_id,
                classes=classes,
                ancestry_ids=ancestry_ids,
                ancestry_classes=ancestry_classes,
                texts=texts,
                semantic_texts=semantic_texts,
                visible=current_visible,
                closed=(
                    _is_closed(element, tag)
                    or (
                        tag in {"path", "polyline"}
                        and is_filled
                        and bbox is not None
                        and bbox[2] > bbox[0]
                        and bbox[3] > bbox[1]
                    )
                ),
                filled=is_filled,
                fill=fill,
                stroke=stroke,
                in_defs=next_in_defs,
                bbox=bbox,
                data_code=data_code,
                label_path=any(
                    LABEL_TOKEN_RE.search(token or "") for token in semantic_tokens
                ),
            )
            shapes.append(shape)
            for group_index in next_groups:
                group_descendants[group_index].append(index)

        next_ids = ancestry_ids + ((source_id,) if source_id else ())
        next_classes = ancestry_classes + classes
        for child in element:
            visit(
                child,
                index,
                ancestry_ids=next_ids,
                ancestry_classes=next_classes,
                inherited_texts=texts,
                inherited_semantic_texts=semantic_texts,
                inherited_matrix=current_matrix,
                inherited_data_code=data_code,
                inherited_visible=current_visible,
                inherited_fill=fill,
                inherited_stroke=stroke,
                in_defs=next_in_defs,
                group_stack=next_groups,
            )

    visit(root)
    eligible_shape_indices = {
        shape.index
        for shape in shapes
        if shape.visible and not shape.in_defs and not shape.label_path
    }
    semantic_owner_indices = set(eligible_shape_indices)
    semantic_owner_indices.update(
        group_index
        for group_index, descendants in group_descendants.items()
        if eligible_shape_indices.intersection(descendants)
    )
    semantic_id_counts = Counter(
        source_ids[index]
        for index in semantic_owner_indices
        if index in source_ids
    )
    return SvgInventory(
        source_sha256=hashlib.sha256(source).hexdigest(),
        shapes=shapes,
        css_classes=css_classes,
        duplicate_ids={key for key, count in id_counts.items() if count > 1},
        semantic_duplicate_ids={
            key for key, count in semantic_id_counts.items() if count > 1
        },
        element_count=element_count,
        has_raster=has_raster,
        data_codes=list(dict.fromkeys(data_codes)),
        local_references=local_references,
        text_records=text_records,
        source_ids=source_ids,
        source_classes=source_classes,
        group_descendants={
            key: tuple(values) for key, values in group_descendants.items()
        },
    )


def _meaningful_identifier(value, inventory):
    return bool(
        value
        and len(value) <= MAX_CODE_LENGTH
        and value not in inventory.semantic_duplicate_ids
        and not GENERATED_ID_RE.fullmatch(value)
        and not LABEL_TOKEN_RE.search(value)
    )


def _meaningful_class_identifier(value):
    return bool(
        value
        and len(value) <= MAX_CODE_LENGTH
        and any(character.isalpha() for character in value)
        and not GENERATED_ID_RE.fullmatch(value)
        and not LABEL_TOKEN_RE.search(value)
    )


def _eligible_shapes(inventory):
    return [
        shape for shape in inventory.shapes
        if shape.visible and not shape.in_defs and not shape.label_path
    ]


def _zone_like_shapes(inventory):
    return [
        shape for shape in _eligible_shapes(inventory)
        if shape.closed and shape.filled and shape.bbox
    ]


def _has_incomplete_semantic_layer(inventory, assigned_indices):
    """Detect a selected subset inside one visually consistent zone layer."""
    assigned = [
        shape for shape in _zone_like_shapes(inventory)
        if shape.index in assigned_indices
    ]
    unassigned = [
        shape for shape in _zone_like_shapes(inventory)
        if shape.index not in assigned_indices
    ]
    if not assigned or not unassigned:
        return False
    assigned_tags = {shape.tag for shape in assigned}
    unassigned = [
        shape for shape in unassigned if shape.tag in assigned_tags
    ]
    if not unassigned:
        return False

    assigned_strokes = {
        shape.stroke.lower()
        for shape in assigned
        if shape.stroke.lower() not in {"", "none", "transparent"}
    }
    if assigned_strokes and any(
        shape.stroke.lower() in assigned_strokes for shape in unassigned
    ):
        return True

    assigned_paints = {
        (shape.fill.lower(), shape.stroke.lower()) for shape in assigned
    }
    return any(
        (shape.fill.lower(), shape.stroke.lower()) in assigned_paints
        for shape in unassigned
    )


def _zone_proposal(code, shape_indices, inventory, source_keys, ontology, evidence):
    by_index = {shape.index: shape for shape in inventory.shapes}
    ordered_indices = sorted(set(shape_indices))
    evidence_texts = [
        text for index in ordered_indices for text in by_index[index].texts
    ]
    semantic_evidence = []
    for index in ordered_indices:
        for kind, value in by_index[index].semantic_texts:
            item = MapImportEvidence(
                kind=kind,
                value=value,
                strength="weak" if kind == "text" else "medium",
            )
            if item not in semantic_evidence:
                semantic_evidence.append(item)
    proposal = proposal_for(ontology, code, evidence_texts)
    proposed_answer = proposal.answer
    proposal_source = proposal.source
    if not proposed_answer and evidence_texts:
        proposed_answer = evidence_texts[0]
        proposal_source = "source-title"
    return {
        "code": code,
        "indices": ordered_indices,
        "source_keys": list(dict.fromkeys(source_keys)),
        "proposed_answer": proposed_answer,
        "proposed_aliases": list(proposal.aliases),
        "proposal_verified": proposal.verified,
        "proposal_source": proposal_source,
        "evidence": [*evidence, *semantic_evidence],
    }


def _minimum_cost_pairs(costs):
    """Return a deterministic minimum-cost one-to-one pairing.

    This is the rectangular Hungarian algorithm. Text labels are often crowded
    around small neighbouring zones, where choosing each nearest pair greedily
    can consume the only plausible label for the next zone.
    """
    if not costs or not costs[0]:
        return []
    row_count = len(costs)
    column_count = len(costs[0])
    transposed = row_count > column_count
    matrix = (
        [
            [costs[row][column] for row in range(row_count)]
            for column in range(column_count)
        ]
        if transposed
        else costs
    )
    rows = len(matrix)
    columns = len(matrix[0])
    row_potential = [0.0] * (rows + 1)
    column_potential = [0.0] * (columns + 1)
    matching = [0] * (columns + 1)
    previous_column = [0] * (columns + 1)

    for row in range(1, rows + 1):
        matching[0] = row
        current_column = 0
        minimums = [math.inf] * (columns + 1)
        visited = [False] * (columns + 1)
        while True:
            visited[current_column] = True
            current_row = matching[current_column]
            delta = math.inf
            next_column = 0
            for column in range(1, columns + 1):
                if visited[column]:
                    continue
                reduced_cost = (
                    matrix[current_row - 1][column - 1]
                    - row_potential[current_row]
                    - column_potential[column]
                )
                if reduced_cost < minimums[column]:
                    minimums[column] = reduced_cost
                    previous_column[column] = current_column
                if minimums[column] < delta:
                    delta = minimums[column]
                    next_column = column
            for column in range(columns + 1):
                if visited[column]:
                    row_potential[matching[column]] += delta
                    column_potential[column] -= delta
                else:
                    minimums[column] -= delta
            current_column = next_column
            if matching[current_column] == 0:
                break
        while True:
            next_column = previous_column[current_column]
            matching[current_column] = matching[next_column]
            current_column = next_column
            if current_column == 0:
                break

    pairs = [
        (matching[column] - 1, column - 1)
        for column in range(1, columns + 1)
        if matching[column]
    ]
    if transposed:
        pairs = [(column, row) for row, column in pairs]
    return sorted(pairs)


def _assign_nearby_text_proposals(raw_zones, inventory):
    if not inventory.text_records:
        return
    shapes_by_index = {shape.index: shape for shape in inventory.shapes}
    zone_boxes = []
    for zone_position, zone in enumerate(raw_zones):
        boxes = [
            shapes_by_index[index].bbox
            for index in zone["indices"]
            if index in shapes_by_index and shapes_by_index[index].bbox
        ]
        if not boxes or zone["proposed_answer"]:
            continue
        zone_boxes.append((
            zone_position,
            (
                min(box[0] for box in boxes),
                min(box[1] for box in boxes),
                max(box[2] for box in boxes),
                max(box[3] for box in boxes),
            ),
        ))
    if not zone_boxes:
        return

    all_shape_boxes = [
        shape.bbox for shape in _eligible_shapes(inventory) if shape.bbox
    ]
    map_box = (
        min(box[0] for box in all_shape_boxes),
        min(box[1] for box in all_shape_boxes),
        max(box[2] for box in all_shape_boxes),
        max(box[3] for box in all_shape_boxes),
    )
    map_diagonal = math.hypot(
        map_box[2] - map_box[0], map_box[3] - map_box[1]
    )
    measurements = {}
    costs = []
    for zone_position, box in zone_boxes:
        center = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        zone_diagonal = math.hypot(box[2] - box[0], box[3] - box[1])
        maximum_distance = max(zone_diagonal * 1.5, map_diagonal * 0.08)
        row = []
        for text_position, record in enumerate(inventory.text_records):
            point_x, point_y = record["point"]
            delta_x = max(box[0] - point_x, 0, point_x - box[2])
            delta_y = max(box[1] - point_y, 0, point_y - box[3])
            edge_distance = math.hypot(delta_x, delta_y)
            center_distance = math.hypot(
                point_x - center[0], point_y - center[1]
            )
            measurements[(zone_position, text_position)] = (
                edge_distance,
                maximum_distance,
            )
            # Edge distance is the primary signal. Centre distance breaks ties
            # when several labels fall inside overlapping bounding boxes.
            row.append(edge_distance * (map_diagonal + 1) + center_distance)
        costs.append(row)

    for row_position, text_position in _minimum_cost_pairs(costs):
        zone_position = zone_boxes[row_position][0]
        edge_distance, maximum_distance = measurements[
            (zone_position, text_position)
        ]
        if edge_distance > maximum_distance:
            continue
        record = inventory.text_records[text_position]
        zone = raw_zones[zone_position]
        zone["proposed_answer"] = record["value"]
        zone["proposal_source"] = "source-text-nearby"
        zone["evidence"].append(MapImportEvidence(
            kind="text", value=record["value"], strength="weak"
        ))


def _finalize_interpretation(
    *,
    title,
    adapter,
    ontology,
    strength,
    automatic_eligible,
    reason_codes,
    raw_zones,
    inventory,
    deadline_at=None,
):
    raw_zones = sorted(raw_zones, key=lambda zone: min(zone["indices"]))
    _assign_nearby_text_proposals(raw_zones, inventory)
    owners = {}
    conflict = False
    for position, zone in enumerate(raw_zones):
        if position % 256 == 0:
            _ensure_deadline(deadline_at)
        for index in zone["indices"]:
            if index in owners and owners[index] != zone["code"]:
                conflict = True
            owners[index] = zone["code"]
    if conflict or not raw_zones:
        return None

    if (
        automatic_eligible
        and _has_incomplete_semantic_layer(inventory, set(owners))
    ):
        automatic_eligible = False
        if "detect.incomplete_semantic_layer" not in reason_codes:
            reason_codes = [
                *reason_codes, "detect.incomplete_semantic_layer"
            ]

    shape_ids = {
        index: f"s{position:06d}"
        for position, index in enumerate(sorted(owners), start=1)
    }
    zones = []
    for position, zone in enumerate(raw_zones):
        if position % 256 == 0:
            _ensure_deadline(deadline_at)
        ids = [shape_ids[index] for index in zone["indices"]]
        zones.append(MapZoneProposal(
            code=zone["code"],
            shape_ids=ids,
            hit_shape_ids=[],
            source_keys=zone["source_keys"],
            source_shape_indices=zone["indices"],
            proposed_answer=zone["proposed_answer"],
            proposed_aliases=zone["proposed_aliases"],
            proposal_verified=zone["proposal_verified"],
            proposal_source=zone["proposal_source"],
            evidence=zone["evidence"],
        ))

    identity = {
        "adapter": adapter,
        "ontology": ontology,
        "zones": [
            [zone.code, zone.source_keys, zone.shape_ids] for zone in zones
        ],
    }
    interpretation_id = "i-" + hashlib.sha256(
        json.dumps(identity, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    eligible_count = len(_eligible_shapes(inventory))
    result = MapImportInterpretation(
        id=interpretation_id,
        title=title,
        adapter=adapter,
        ontology=ontology,
        strength=strength,
        automatic_eligible=automatic_eligible,
        selectable=True,
        zone_count=len(zones),
        shape_count=len(shape_ids),
        unassigned_shape_count=max(eligible_count - len(shape_ids), 0),
        verified_label_count=sum(zone.proposal_verified for zone in zones),
        reason_codes=reason_codes,
        zones=zones,
    )
    _ensure_deadline(deadline_at)
    return result


def _selector_interpretation(
    inventory,
    *,
    keys,
    title,
    adapter,
    ontology,
    reason_codes,
    include_aux=False,
    prefix_ids=False,
    include_group_ids=False,
    selector_keys_by_code=None,
    automatic_eligible=True,
    deadline_at=None,
):
    ordered_keys = list(dict.fromkeys(keys))
    selectors_by_code = {
        code: set(
            (selector_keys_by_code or {}).get(code, (code,))
        )
        for code in ordered_keys
    }
    codes_by_selector = defaultdict(set)
    for code, selectors in selectors_by_code.items():
        for selector in selectors:
            codes_by_selector[selector].add(code)
    indices_by_key = defaultdict(set)
    ids_present = set()
    classes_present = set()
    groups_present = set()
    aux_ids_by_key = defaultdict(list)
    for position, shape in enumerate(_eligible_shapes(inventory)):
        if position % 256 == 0:
            _ensure_deadline(deadline_at)
        source_id = shape.source_id
        if source_id:
            ids_present.add(source_id)
            for code in codes_by_selector.get(source_id, ()):
                indices_by_key[code].add(shape.index)
            if prefix_ids and (match := CAPITAL_ID_RE.fullmatch(source_id)):
                grouped_key = match.group(1) + "-c"
                if grouped_key in selectors_by_code:
                    indices_by_key[grouped_key].add(shape.index)
            if include_aux and (match := COUNTRY_AUX_ID_RE.fullmatch(source_id)):
                aux_key = match.group(1)
                if aux_key in selectors_by_code:
                    indices_by_key[aux_key].add(shape.index)
                    aux_ids_by_key[aux_key].append(source_id)
        for class_name in shape.classes:
            classes_present.add(class_name)
            for code in codes_by_selector.get(class_name, ()):
                indices_by_key[code].add(shape.index)
        if include_group_ids:
            for group_id in shape.ancestry_ids:
                groups_present.add(group_id)
                for code in codes_by_selector.get(group_id, ()):
                    indices_by_key[code].add(shape.index)

    raw_zones = []
    for position, key in enumerate(ordered_keys):
        if position % 256 == 0:
            _ensure_deadline(deadline_at)
        indices = sorted(indices_by_key.get(key, ()))
        if not indices:
            continue
        source_keys = []
        for selector in sorted(selectors_by_code[key]):
            if selector in ids_present:
                source_keys.append(f"id:{selector}")
            if selector in classes_present:
                source_keys.append(f"class:{selector}")
            if include_group_ids and selector in groups_present:
                source_keys.append(f"group:{selector}")
        if include_aux:
            source_keys.extend(
                f"id:{source_id}"
                for source_id in dict.fromkeys(aux_ids_by_key.get(key, ()))
            )
        raw_zones.append(_zone_proposal(
            key,
            indices,
            inventory,
            source_keys or [f"selector:{key}"],
            ontology,
            [
                MapImportEvidence(
                    kind="ontology" if ontology != "generic" else "id",
                    value=key,
                    strength="strong",
                )
            ],
        ))
    return _finalize_interpretation(
        title=title,
        adapter=adapter,
        ontology=ontology,
        strength="strong",
        automatic_eligible=automatic_eligible,
        reason_codes=reason_codes,
        raw_zones=raw_zones,
        inventory=inventory,
        deadline_at=deadline_at,
    )


def _detect_jetpunk(inventory, deadline_at=None):
    shapes = _eligible_shapes(inventory)
    ids = {
        shape.source_id for shape in shapes
        if shape.source_id
    }
    classes = {
        class_name for shape in shapes for class_name in shape.classes
        if class_name not in JETPUNK_STYLE_CLASSES
    }
    selector_values = ids | classes
    results = []
    # Half of these codes are also ISO alpha-2 country codes, so a complete
    # lowercase subdivision layer would otherwise detect as a partial country
    # layer. Recognising the collision is the only thing this set is for.
    subdivision_selectors = defaultdict(set)
    for value in selector_values:
        if STATE_ID_RE.fullmatch(value) and value in AMBIGUOUS_SUBDIVISION_CODES:
            subdivision_selectors[value].add(value)
        elif (
            re.fullmatch(r"[a-z]{2}", value)
            and value.upper() in AMBIGUOUS_SUBDIVISION_CODES
        ):
            subdivision_selectors[value.upper()].add(value)
    has_complete_lowercase_subdivision_layer = (
        len({
            code for code, selectors in subdivision_selectors.items()
            if code != "DC" and any(value.islower() for value in selectors)
        }) == 50
    )
    country_syntax = {
        value for value in selector_values if COUNTRY_ID_RE.fullmatch(value)
    }
    countries = sorted({
        value for value in selector_values
        if COUNTRY_ID_RE.fullmatch(value)
        and ontology_matches_code("iso3166-alpha2", value)
    })
    aux_countries = {
        match.group(1)
        for value in ids
        if (match := COUNTRY_AUX_ID_RE.fullmatch(value))
    }
    country_keys = (
        []
        if has_complete_lowercase_subdivision_layer
        else sorted(set(countries) | aux_countries)
    )
    capitals = sorted({
        value for value in selector_values
        if CAPITAL_ID_RE.fullmatch(value)
        and ontology_matches_code("country-capitals", value)
    })
    capital_groups = sorted({
        match.group(1) + "-c"
        for value in capitals
        if (match := CAPITAL_ID_RE.fullmatch(value))
    } | {
        value for value in classes
        if re.fullmatch(r"[a-z]{2}-c", value)
        and ontology_matches_code("country-capitals", value)
    })

    if country_keys:
        selector_purity = (
            len(countries) / len(country_syntax) if country_syntax else 1
        )
        country_automatic = selector_purity >= 0.8
        country_reasons = [
            "jetpunk.country_selectors", "selector.id_class_union"
        ]
        if not country_automatic:
            country_reasons.append("detect.low_selector_purity")
        interpretation = _selector_interpretation(
            inventory,
            keys=country_keys,
            title="Pays et territoires",
            adapter="jetpunk-id-class-v1",
            ontology="iso3166-alpha2",
            reason_codes=country_reasons,
            include_aux=True,
            automatic_eligible=country_automatic,
            deadline_at=deadline_at,
        )
        if interpretation:
            results.append(interpretation)
    if capitals:
        interpretation = _selector_interpretation(
            inventory,
            keys=capitals,
            title="Capitales — un marqueur par identifiant",
            adapter="jetpunk-id-class-v1",
            ontology="country-capitals",
            reason_codes=["jetpunk.capital_ids", "selector.id_class_union"],
            automatic_eligible=not country_keys,
            deadline_at=deadline_at,
        )
        if interpretation:
            results.append(interpretation)
    if capital_groups and any(
        key in shape.classes
        or any(
            CAPITAL_ID_RE.fullmatch(shape.source_id)
            and shape.source_id.startswith(key)
            for shape in inventory.shapes
        )
        for key in capital_groups for shape in inventory.shapes
    ):
        interpretation = _selector_interpretation(
            inventory,
            keys=capital_groups,
            title="Capitales — marqueurs regroupés par pays",
            adapter="jetpunk-id-class-v1",
            ontology="country-capitals",
            reason_codes=["jetpunk.capital_classes", "selector.multipart_class"],
            prefix_ids=True,
            automatic_eligible=not country_keys and not capitals,
            deadline_at=deadline_at,
        )
        if interpretation and {
            tuple(zone.shape_ids) for zone in interpretation.zones
        } != {
            tuple(zone.shape_ids)
            for item in results
            for zone in item.zones
            if item.ontology == "country-capitals"
        }:
            results.append(interpretation)
    return results


def _detect_explicit_ontology(inventory, ontology, deadline_at=None):
    if ontology in {"auto", "generic"}:
        return []
    keys = sorted({
        source_id
        for source_id in inventory.source_ids.values()
        if source_id
        and len(source_id) <= MAX_CODE_LENGTH
        and source_id not in inventory.semantic_duplicate_ids
        and not LABEL_TOKEN_RE.search(source_id)
        and ontology_matches_code(ontology, source_id)
    } | {
        class_name
        for classes in inventory.source_classes.values()
        for class_name in classes
        if class_name not in JETPUNK_STYLE_CLASSES
        and ontology_matches_code(ontology, class_name)
    })
    if not keys:
        return []
    interpretation = _selector_interpretation(
        inventory,
        keys=keys,
        title=next(
            option.label for option in ONTOLOGY_OPTIONS if option.id == ontology
        ),
        adapter=(
            "jetpunk-id-class-v1"
            if ontology in {"iso3166-alpha2", "country-capitals"}
            else "generic-svg-v1"
        ),
        ontology=ontology,
        reason_codes=["ontology.explicit", "selector.id_class_union"],
        include_group_ids=True,
        deadline_at=deadline_at,
    )
    return [interpretation] if interpretation else []


def _detect_scoped_group_layers(inventory, deadline_at=None):
    zone_shapes = _zone_like_shapes(inventory)
    if len(zone_shapes) < 2:
        return []
    shapes_by_index = {shape.index: shape for shape in zone_shapes}
    zone_indices = set(shapes_by_index)
    results = []
    for position, (group_index, descendants) in enumerate(
        inventory.group_descendants.items()
    ):
        if position % 128 == 0:
            _ensure_deadline(deadline_at)
        root_id = inventory.source_ids.get(group_index, "")
        owned = sorted(zone_indices.intersection(descendants))
        if (
            len(owned) < 2
            or not _meaningful_identifier(root_id, inventory)
            or len(owned) / len(zone_shapes) < 0.65
        ):
            continue

        indices_by_code = defaultdict(list)
        source_kind_by_code = {}
        for index in owned:
            shape = shapes_by_index[index]
            ancestry = list(shape.ancestry_ids)
            try:
                root_position = ancestry.index(root_id)
            except ValueError:
                continue
            nested_groups = [
                value for value in ancestry[root_position + 1:]
                if _meaningful_identifier(value, inventory)
                and value not in JETPUNK_STYLE_CLASSES
            ]
            if nested_groups:
                code = nested_groups[-1]
                source_kind_by_code[code] = "group"
            elif _meaningful_identifier(shape.source_id, inventory):
                code = shape.source_id
                source_kind_by_code.setdefault(code, "id")
            else:
                continue
            indices_by_code[code].append(index)

        assigned_count = sum(len(indices) for indices in indices_by_code.values())
        if (
            len(indices_by_code) < 2
            or assigned_count / len(owned) < 0.9
        ):
            continue
        ontology = infer_ontology(indices_by_code) or "generic"
        raw_zones = [
            _zone_proposal(
                code,
                indices,
                inventory,
                [f"{source_kind_by_code[code]}:{code}"],
                ontology,
                [MapImportEvidence(
                    kind=source_kind_by_code[code],
                    value=code,
                    strength="strong",
                )],
            )
            for code, indices in indices_by_code.items()
        ]
        interpretation = _finalize_interpretation(
            title=f"Couche structurée « {root_id} »",
            adapter="generic-svg-v1",
            ontology=ontology,
            strength="strong",
            automatic_eligible=False,
            reason_codes=["generic.scoped_group_layer"],
            raw_zones=raw_zones,
            inventory=inventory,
            deadline_at=deadline_at,
        )
        if interpretation:
            results.append(interpretation)
    return results


def _detect_semantic_class_partition(inventory, deadline_at=None):
    zone_shapes = _zone_like_shapes(inventory)
    if len(zone_shapes) < 2:
        return None
    class_indices = defaultdict(set)
    for position, shape in enumerate(zone_shapes):
        if position % 256 == 0:
            _ensure_deadline(deadline_at)
        for class_name in set((*shape.classes, *shape.ancestry_classes)):
            if (
                _meaningful_class_identifier(class_name)
                and class_name not in JETPUNK_STYLE_CLASSES
                and not LABEL_TOKEN_RE.search(class_name)
            ):
                class_indices[class_name].add(shape.index)
    if len(class_indices) < 2:
        return None

    broad_classes = set()
    for class_name, indices in class_indices.items():
        strict_subsets = [
            other_indices
            for other_name, other_indices in class_indices.items()
            if other_name != class_name and other_indices < indices
        ]
        if (
            len(strict_subsets) >= 2
            and set().union(*strict_subsets) == indices
        ):
            broad_classes.add(class_name)
    partitions = {
        class_name: indices
        for class_name, indices in class_indices.items()
        if class_name not in broad_classes
    }
    memberships = Counter(
        index for indices in partitions.values() for index in indices
    )
    covered = set(memberships)
    if (
        len(partitions) < 2
        or any(count > 1 for count in memberships.values())
        or len(covered) / len(zone_shapes) < 0.5
    ):
        return None

    raw_zones = [
        _zone_proposal(
            class_name,
            sorted(indices),
            inventory,
            [f"class:{class_name}"],
            "generic",
            [MapImportEvidence(
                kind="class", value=class_name, strength="medium"
            )],
        )
        for class_name, indices in partitions.items()
    ]
    return _finalize_interpretation(
        title="Partition par classes SVG",
        adapter="generic-svg-v1",
        ontology="generic",
        strength="mixed",
        automatic_eligible=False,
        reason_codes=[
            "generic.semantic_classes",
            "generic.exclusive_class_partition",
        ],
        raw_zones=raw_zones,
        inventory=inventory,
        deadline_at=deadline_at,
    )


def _detect_generic(inventory, deadline_at=None):
    shapes = _eligible_shapes(inventory)
    results = []
    leaf_ids = sorted({
        shape.source_id for shape in shapes
        if _meaningful_identifier(shape.source_id, inventory)
    })
    if len(leaf_ids) >= 2:
        leaf_id_set = set(leaf_ids)
        inferred = infer_ontology(leaf_ids) or "generic"
        identified_shapes = [
            shape for shape in shapes
            if shape.source_id in leaf_id_set
            or leaf_id_set.intersection(shape.classes)
        ]
        interpretation = _selector_interpretation(
            inventory,
            keys=leaf_ids,
            title="Identifiants SVG",
            adapter="generic-svg-v1",
            ontology=inferred,
            reason_codes=["generic.meaningful_ids", "selector.id_class_union"],
            automatic_eligible=all(
                shape.closed and shape.filled for shape in identified_shapes
            ),
            deadline_at=deadline_at,
        )
        if interpretation:
            results.append(interpretation)

    group_zones = []
    shape_indices = {shape.index for shape in shapes}
    shapes_by_index = {shape.index: shape for shape in shapes}
    for position, (group_index, descendants) in enumerate(
        inventory.group_descendants.items()
    ):
        if position % 256 == 0:
            _ensure_deadline(deadline_at)
        source_id = inventory.source_ids.get(group_index, "")
        owned = sorted(shape_indices.intersection(descendants))
        if (
            owned
            and _meaningful_identifier(source_id, inventory)
            and not any(
                shapes_by_index[index].source_id
                and _meaningful_identifier(
                    shapes_by_index[index].source_id, inventory
                )
                for index in owned
            )
        ):
            group_zones.append(_zone_proposal(
                source_id,
                owned,
                inventory,
                [f"group:{source_id}"],
                "generic",
                [MapImportEvidence(
                    kind="group", value=source_id, strength="strong"
                )],
            ))
    if len(group_zones) >= 2:
        grouped_indices = {
            index for zone in group_zones for index in zone["indices"]
        }
        interpretation = _finalize_interpretation(
            title="Groupes SVG",
            adapter="generic-svg-v1",
            ontology="generic",
            strength="strong",
            automatic_eligible=all(
                shape.closed and shape.filled
                for shape in shapes if shape.index in grouped_indices
            ),
            reason_codes=["generic.meaningful_group_ids"],
            raw_zones=group_zones,
            inventory=inventory,
            deadline_at=deadline_at,
        )
        if interpretation:
            results.append(interpretation)

    results.extend(_detect_scoped_group_layers(inventory, deadline_at))
    class_interpretation = _detect_semantic_class_partition(
        inventory, deadline_at
    )
    if class_interpretation:
        results.append(class_interpretation)

    if not results:
        painted_layers = defaultdict(list)
        for shape in shapes:
            if (
                shape.filled
                and shape.stroke.lower() not in {"", "none", "transparent"}
                and shape.bbox
                and (
                    (shape.bbox[2] - shape.bbox[0])
                    * (shape.bbox[3] - shape.bbox[1])
                ) > 1e-9
            ):
                painted_layers[shape.stroke.lower()].append(shape)
        for stroke, layer_shapes in sorted(
            painted_layers.items(),
            key=lambda item: min(shape.index for shape in item[1]),
        ):
            if len(layer_shapes) < 2:
                continue
            raw_zones = [
                _zone_proposal(
                    f"z{position:06d}",
                    [shape.index],
                    inventory,
                    [f"style:filled-stroke:{stroke}"],
                    "generic",
                    [
                        MapImportEvidence(
                            kind="style",
                            value=f"fill + stroke {stroke}",
                            strength="medium",
                        ),
                        MapImportEvidence(
                            kind="geometry",
                            value=(
                                ",".join(
                                    str(round(value, 3))
                                    for value in shape.bbox
                                )
                            ),
                            strength="weak",
                        ),
                    ],
                )
                for position, shape in enumerate(layer_shapes, start=1)
            ]
            interpretation = _finalize_interpretation(
                title="Objets remplis avec contour commun",
                adapter="generic-svg-v1",
                ontology="generic",
                strength="weak",
                automatic_eligible=False,
                reason_codes=["generic.consistent_filled_stroke_layer"],
                raw_zones=raw_zones,
                inventory=inventory,
                deadline_at=deadline_at,
            )
            if interpretation:
                results.append(interpretation)

    if not results:
        geometry_shapes = [
            shape for shape in shapes if shape.closed and shape.filled
        ]
        if len(geometry_shapes) >= 2:
            raw_zones = [
                _zone_proposal(
                    f"z{position:06d}",
                    [shape.index],
                    inventory,
                    [f"geometry:{shape.index}"],
                    "generic",
                    [MapImportEvidence(
                        kind="geometry",
                        value=(
                            ",".join(str(round(value, 3)) for value in shape.bbox)
                            if shape.bbox else str(shape.index)
                        ),
                        strength="weak",
                    )],
                )
                for position, shape in enumerate(geometry_shapes, start=1)
            ]
            interpretation = _finalize_interpretation(
                title="Objets géométriques",
                adapter="generic-svg-v1",
                ontology="generic",
                strength="weak",
                automatic_eligible=False,
                reason_codes=["generic.geometry_sibling_layer"],
                raw_zones=raw_zones,
                inventory=inventory,
                deadline_at=deadline_at,
            )
            if interpretation:
                results.append(interpretation)
    return results


def _legacy_interpretation(result, inventory, deadline_at=None):
    if not result.manifest:
        return None
    zones = []
    shapes_by_code = defaultdict(list)
    for shape in inventory.shapes:
        if shape.data_code:
            shapes_by_code[shape.data_code].append(shape.index)
    for position, zone in enumerate(result.manifest.zones):
        if position % 256 == 0:
            _ensure_deadline(deadline_at)
        proposal = proposal_for(
            infer_ontology([zone.code]) or "generic", zone.code
        )
        zones.append(MapZoneProposal(
            **zone.model_dump(mode="json"),
            source_shape_indices=shapes_by_code.get(zone.code, []),
            proposed_answer=proposal.answer,
            proposed_aliases=list(proposal.aliases),
            proposal_verified=proposal.verified,
            proposal_source=proposal.source,
            evidence=[MapImportEvidence(
                kind="data-code", value=zone.code, strength="strong"
            )],
        ))
    identity = hashlib.sha256(
        json.dumps(
            [[zone.code, zone.source_keys] for zone in zones],
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:16]
    interpretation = MapImportInterpretation(
        id=f"i-{identity}",
        title="Zones Nemoris data-code",
        adapter="nemoris-data-code-v1",
        ontology=infer_ontology([zone.code for zone in zones]) or "generic",
        strength="strong",
        automatic_eligible=True,
        zone_count=len(zones),
        shape_count=len({
            shape_id
            for zone in zones
            for shape_id in zone.shape_ids + zone.hit_shape_ids
        }),
        unassigned_shape_count=max(
            len(_eligible_shapes(inventory))
            - sum(len(zone.shape_ids) + len(zone.hit_shape_ids) for zone in zones),
            0,
        ),
        verified_label_count=sum(zone.proposal_verified for zone in zones),
        reason_codes=["nemoris.explicit_data_code"],
        zones=zones,
    )
    _ensure_deadline(deadline_at)
    return interpretation


def _probable_uncoded_zone_shapes(inventory):
    probable = []
    for shape in _eligible_shapes(inventory):
        identifiers = (shape.source_id, *shape.ancestry_ids)
        meaningful = any(
            _meaningful_identifier(value, inventory)
            and value not in JETPUNK_STYLE_CLASSES
            for value in identifiers
        )
        if not shape.data_code and shape.closed and shape.filled and meaningful:
            probable.append(shape)
    return probable


def _probable_unassigned_path_labels(inventory, interpretations):
    candidates = [
        shape for shape in _eligible_shapes(inventory)
        if (
            shape.tag == "path"
            and shape.closed
            and shape.filled
            and shape.bbox
            and not shape.label_path
            and not any(
                _meaningful_identifier(value, inventory)
                for value in (shape.source_id, *shape.classes)
                if value not in inventory.css_classes
            )
        )
    ]
    all_boxes = [
        shape.bbox for shape in _eligible_shapes(inventory) if shape.bbox
    ]
    if len(candidates) < 3 or not all_boxes:
        return set()
    map_box = (
        min(box[0] for box in all_boxes),
        min(box[1] for box in all_boxes),
        max(box[2] for box in all_boxes),
        max(box[3] for box in all_boxes),
    )
    map_area = max(
        (map_box[2] - map_box[0]) * (map_box[3] - map_box[1]), 1e-9
    )

    by_parent = defaultdict(list)
    for shape in candidates:
        box = shape.bbox
        area = max((box[2] - box[0]) * (box[3] - box[1]), 0)
        if area <= map_area * 0.01:
            by_parent[shape.parent_index].append(shape)

    probable = set()
    for siblings in by_parent.values():
        if len(siblings) < 3:
            continue
        group_box = (
            min(shape.bbox[0] for shape in siblings),
            min(shape.bbox[1] for shape in siblings),
            max(shape.bbox[2] for shape in siblings),
            max(shape.bbox[3] for shape in siblings),
        )
        group_area = (
            (group_box[2] - group_box[0]) * (group_box[3] - group_box[1])
        )
        if group_area <= map_area * 0.15:
            probable.update(shape.index for shape in siblings)

    assigned = {
        index
        for interpretation in interpretations
        for zone in interpretation.zones
        for index in zone.source_shape_indices
    }
    return probable - assigned


def _identifier_classification(inventory, interpretations):
    assigned_by_shape = defaultdict(list)
    for interpretation in interpretations:
        for zone in interpretation.zones:
            for index in zone.source_shape_indices:
                assigned_by_shape[index].append(interpretation.id)

    records = []
    for shape in inventory.shapes:
        identifiers = list(dict.fromkeys((
            *((shape.source_id,) if shape.source_id else ()),
            *shape.classes,
            *shape.ancestry_ids,
            *shape.ancestry_classes,
        )))
        if not identifiers or not shape.visible or shape.in_defs:
            continue
        assigned = sorted(set(assigned_by_shape.get(shape.index, [])))
        reasons = []
        if shape.source_id in inventory.semantic_duplicate_ids:
            reasons.append("identifier.duplicate_id")
        if shape.source_id and GENERATED_ID_RE.fullmatch(shape.source_id):
            reasons.append("identifier.editor_generated")
        if shape.label_path:
            reasons.append("identifier.strong_label_layer")
        if identifiers and all(
            value in inventory.css_classes or value in JETPUNK_STYLE_CLASSES
            for value in identifiers
        ):
            reasons.append("identifier.presentation_only")
        status = "assigned" if assigned else "ignored" if reasons else "unresolved"
        records.append({
            "shape_index": shape.index,
            "identifiers": identifiers,
            "status": status,
            "reason_codes": reasons,
            "interpretation_ids": assigned,
        })
    return records


def _compile_selected(
    source,
    interpretation,
    inventory,
    expected_zone_count,
    started_at,
):
    if interpretation.adapter == "nemoris-data-code-v1":
        return canonicalize_svg(
            source, expected_zone_count, _started_at=started_at
        )

    root = ElementTree.fromstring(source)
    elements = list(root.iter())
    assigned = {}
    for zone in interpretation.zones:
        for document_index in zone.source_shape_indices:
            assigned[document_index] = zone.code

    removable_indices = {
        shape.index for shape in inventory.shapes if shape.label_path
    }
    for index, element in enumerate(elements):
        for attr_name in list(element.attrib):
            if local_name(attr_name).lower() in {"data-code", "data-hit-area"}:
                element.attrib.pop(attr_name, None)
        if index in assigned:
            element.set("data-code", assigned[index])

    parents = {
        id(child): parent for parent in root.iter() for child in parent
    }
    for index in sorted(removable_indices, reverse=True):
        if index >= len(elements):
            continue
        element = elements[index]
        parent = parents.get(id(element))
        if parent is not None and element in list(parent):
            parent.remove(element)

    encoded = StdElementTree.tostring(root, encoding="utf-8")
    result = canonicalize_svg(
        encoded, expected_zone_count, _started_at=started_at
    )
    if not result.manifest:
        return result
    zones_by_code = {zone.code: zone for zone in interpretation.zones}
    manifest_zones = []
    for zone in result.manifest.zones:
        proposal = zones_by_code[zone.code]
        manifest_zones.append(MapZoneV2(
            code=zone.code,
            shape_ids=zone.shape_ids,
            hit_shape_ids=zone.hit_shape_ids,
            source_keys=proposal.source_keys,
        ))
    result.manifest = MapPackageV2(
        asset_sha256=result.manifest.asset_sha256,
        zones=manifest_zones,
        source=MapSourceV2(
            sha256=inventory.source_sha256,
            adapter=interpretation.adapter,
            expected_zone_count=expected_zone_count,
            warning_codes=result.manifest.source.warning_codes,
        ),
    )
    return result


def _dedupe_interpretations(items):
    seen = set()
    result = []
    for item in items:
        signature = tuple(
            (zone.code, tuple(zone.shape_ids)) for zone in item.zones
        )
        if signature in seen:
            continue
        seen.add(signature)
        result.append(item)
    return result


def analyze_svg(
    source: bytes,
    expected_zone_count: int | None = None,
    *,
    ontology: MapImportOntology = "auto",
    selected_interpretation_id: str | None = None,
):
    started_at = time.monotonic()
    deadline_at = started_at + SOFT_DEADLINE_SECONDS
    inventory = build_inventory(source, started_at=started_at)
    base = canonicalize_svg(
        source, expected_zone_count, _started_at=started_at
    )
    interpretations = []
    legacy = _legacy_interpretation(base, inventory, deadline_at)
    if legacy:
        interpretations.append(legacy)

    legacy_is_complete = bool(
        legacy
        and not _probable_uncoded_zone_shapes(inventory)
        and ontology in {"auto", "generic", legacy.ontology}
        and (
            expected_zone_count is None
            or legacy.zone_count == expected_zone_count
        )
    )
    if not legacy_is_complete:
        if ontology not in {"auto", "generic"}:
            interpretations.extend(_detect_explicit_ontology(
                inventory, ontology, deadline_at
            ))
        elif ontology == "generic":
            interpretations.extend(_detect_generic(inventory, deadline_at))
        else:
            jetpunk = _detect_jetpunk(inventory, deadline_at)
            interpretations.extend(jetpunk)
            if (
                not jetpunk
                or not any(
                    item.automatic_eligible for item in jetpunk
                )
            ):
                interpretations.extend(_detect_generic(
                    inventory, deadline_at
                ))
    interpretations = _dedupe_interpretations(interpretations)
    probable_path_labels = _probable_unassigned_path_labels(
        inventory, interpretations
    )
    if probable_path_labels:
        for interpretation in interpretations:
            interpretation.automatic_eligible = False
            if "detect.probable_path_labels" not in interpretation.reason_codes:
                interpretation.reason_codes.append(
                    "detect.probable_path_labels"
                )

    if ontology not in {"auto", "generic"}:
        interpretations = [
            item for item in interpretations if item.ontology == ontology
        ]
    if expected_zone_count is not None:
        for item in interpretations:
            if item.zone_count != expected_zone_count:
                item.automatic_eligible = False

    auto_candidates = [
        item for item in interpretations
        if item.automatic_eligible
        and (
            expected_zone_count is None
            or item.zone_count == expected_zone_count
        )
    ]
    selected = None
    if selected_interpretation_id:
        selected = next(
            (
                item for item in interpretations
                if item.id == selected_interpretation_id and item.selectable
            ),
            None,
        )
        if selected is None:
            raise CanonicalizationError(
                "svg.interpretation_not_found",
                "Selected SVG interpretation no longer exists",
                status_code=422,
            )
    elif len(auto_candidates) == 1 and (
        len([
            item for item in interpretations
            if (
                expected_zone_count is None
                or item.zone_count == expected_zone_count
            )
        ]) == 1
        or legacy is auto_candidates[0]
    ):
        selected = auto_candidates[0]

    matching_expected = [
        item for item in interpretations
        if (
            expected_zone_count is not None
            and item.zone_count == expected_zone_count
        )
    ]
    active = (
        selected
        or (matching_expected[0] if matching_expected else None)
        or (interpretations[0] if interpretations else None)
    )
    if time.monotonic() - started_at > SOFT_DEADLINE_SECONDS:
        raise CanonicalizationError(
            "svg.processing_deadline",
            "SVG processing deadline exceeded",
            status_code=408,
        )
    compiled = (
        _compile_selected(
            source,
            active,
            inventory,
            expected_zone_count,
            started_at,
        )
        if active else base
    )
    diagnostics = [
        item for item in compiled.diagnostics
        if item.code != "svg.no_usable_data_code" or not interpretations
    ]
    if inventory.semantic_duplicate_ids:
        diagnostics.append(_diagnostic(
            "svg.duplicate_source_ids",
            "warning",
            parameters={
                "ids": sorted(inventory.semantic_duplicate_ids)[:20]
            },
        ))
    generated_count = sum(
        bool(shape.source_id and GENERATED_ID_RE.fullmatch(shape.source_id))
        for shape in inventory.shapes
    )
    if generated_count:
        diagnostics.append(_diagnostic(
            "svg.generated_ids_ignored",
            parameters={"count": generated_count},
        ))
    label_paths = sum(shape.label_path for shape in inventory.shapes)
    if label_paths:
        diagnostics.append(_diagnostic(
            "svg.semantic_label_layer_removed",
            "warning",
            parameters={"count": label_paths},
            acknowledgement=True,
        ))
    if probable_path_labels:
        diagnostics.append(_diagnostic(
            "svg.probable_path_labels",
            "error",
            parameters={
                "count": len(probable_path_labels),
                "source_shape_indices": sorted(probable_path_labels)[:100],
            },
        ))
    incomplete_layers = [
        item.id for item in interpretations
        if "detect.incomplete_semantic_layer" in item.reason_codes
    ]
    if incomplete_layers:
        diagnostics.append(_diagnostic(
            "svg.incomplete_semantic_layer",
            "warning",
            parameters={
                "interpretation_ids": incomplete_layers,
                "count": len(incomplete_layers),
            },
        ))
    if len(interpretations) > 1 and selected is None:
        diagnostics.append(_diagnostic(
            "svg.multiple_interpretations",
            parameters={"count": len(interpretations)},
        ))
    if ontology not in {"auto", "generic"} and not interpretations:
        diagnostics.append(_diagnostic(
            "svg.ontology_mismatch",
            "error",
            parameters={"ontology": ontology},
        ))
    if expected_zone_count is not None and active and active.zone_count != expected_zone_count:
        if not any(item.code == "svg.expected_zone_count_mismatch" for item in diagnostics):
            diagnostics.append(_diagnostic(
                "svg.expected_zone_count_mismatch",
                "error",
                parameters={
                    "expected": expected_zone_count,
                    "actual": active.zone_count,
                },
            ))

    selection_required = bool(interpretations and selected is None)
    route = (
        "manual" if inventory.has_raster
        else "automatic" if (
            selected
            and len(interpretations) == 1
            and selected.automatic_eligible
        )
        else "assisted"
    )
    zones = active.zones if active else []
    question_defaults = {
        zone.code: {
            "answer": zone.proposed_answer if zone.proposal_verified else "",
            "aliases": zone.proposed_aliases if zone.proposal_verified else [],
        }
        for zone in zones
    }
    inventory_json = inventory.as_json()
    inventory_json["identifier_records"] = _identifier_classification(
        inventory, interpretations
    )
    if time.monotonic() - started_at > SOFT_DEADLINE_SECONDS:
        raise CanonicalizationError(
            "svg.processing_deadline",
            "SVG processing deadline exceeded",
            status_code=408,
        )
    return SvgAnalysisResult(
        canonical_svg=compiled.canonical_svg,
        manifest=compiled.manifest,
        summary=compiled.summary,
        diagnostics=diagnostics,
        route=route,
        ontology=ontology,
        selection_required=selection_required,
        selected_interpretation_id=selected.id if selected else None,
        interpretations=interpretations,
        zones=zones,
        question_defaults=question_defaults,
        inventory=inventory_json,
        inventory_model=inventory,
    )
