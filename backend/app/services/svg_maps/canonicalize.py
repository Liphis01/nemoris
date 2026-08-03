from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import hashlib
import re
import time
from xml.etree import ElementTree as StdElementTree

from defusedxml import ElementTree
import cssselect2
import tinycss2

from .contracts import (
    MapImportDiagnostic,
    MapImportSummary,
    MapPackageV2,
    MapSourceV2,
    MapZoneV2,
)


SVG_NS = "http://www.w3.org/2000/svg"
MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_ELEMENTS = 50_000
MAX_DEPTH = 128
MAX_PATH_BYTES = 8 * 1024 * 1024
MAX_CSS_BYTES = 1 * 1024 * 1024
MAX_OUTPUT_BYTES = 12 * 1024 * 1024
SOFT_DEADLINE_SECONDS = 5
MAX_CODE_LENGTH = 128

SAFE_TAGS = {
    "svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse",
    "line", "polyline", "polygon", "clipPath", "mask", "linearGradient",
    "radialGradient", "stop", "pattern",
}
PAINTABLE_TAGS = {
    "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"
}
SAFE_TAGS_LOWER = {value.lower() for value in SAFE_TAGS}
PAINTABLE_TAGS_LOWER = {value.lower() for value in PAINTABLE_TAGS}
DEFINITION_TAGS = {
    "defs", "symbol", "clipPath", "mask", "linearGradient", "radialGradient",
    "pattern",
}
TEXT_TAGS = {"text", "tspan", "textPath"}
MANUAL_TAGS = {"image"}
SAFE_PRESENTATION = {
    "clip-path", "clip-rule", "color", "display", "fill", "fill-opacity",
    "fill-rule", "filter", "mask", "opacity", "paint-order", "pointer-events",
    "shape-rendering", "stop-color", "stop-opacity", "stroke",
    "stroke-dasharray", "stroke-dashoffset", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width",
    "visibility",
}
SAFE_GEOMETRY_ATTRS = {
    "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "points", "viewBox", "preserveAspectRatio", "transform",
    "gradientTransform", "gradientUnits", "spreadMethod", "offset",
    "patternUnits", "patternContentUnits", "patternTransform",
    "clipPathUnits", "maskUnits", "maskContentUnits",
}
LOCAL_REFERENCE_ATTRS = {
    "clip-path", "filter", "mask", "fill", "stroke", "href",
}
UNSAFE_CSS_RE = re.compile(r"(?:@import|expression\s*\(|javascript:|data:)", re.I)
LOCAL_URL_RE = re.compile(r"^url\(\s*(['\"]?)#([A-Za-z_][\w:.-]*)\1\s*\)$")
TRANSFORM_RE = re.compile(
    r"^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)"
    r"\(\s*[-+0-9eE.,\s]+\s*\)\s*)+$"
)
DIMENSION_RE = re.compile(
    r"^\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(?:px)?\s*$"
)


class CanonicalizationError(ValueError):
    def __init__(self, code, message, *, status_code=400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass
class CanonicalizationResult:
    canonical_svg: bytes
    manifest: MapPackageV2 | None
    summary: MapImportSummary
    diagnostics: list[MapImportDiagnostic]
    route: str


def local_name(value):
    return str(value or "").rsplit("}", 1)[-1]


def _diagnostic(
    code,
    severity,
    stage,
    *,
    parameters=None,
    shape_ids=None,
    acknowledgement=False,
):
    return MapImportDiagnostic(
        code=code,
        severity=severity,
        stage=stage,
        parameters=parameters or {},
        shape_ids=shape_ids or [],
        requires_acknowledgement=acknowledgement,
    )


def _validate_limits(root, started_at):
    element_count = 0
    path_bytes = 0
    max_depth = 0
    stack = [(root, 1)]

    while stack:
        element, depth = stack.pop()
        element_count += 1
        max_depth = max(max_depth, depth)
        path_bytes += len(str(element.attrib.get("d", "")).encode("utf-8"))

        if element_count > MAX_ELEMENTS:
            raise CanonicalizationError(
                "svg.element_limit", "SVG contains too many elements", status_code=413
            )
        if max_depth > MAX_DEPTH:
            raise CanonicalizationError(
                "svg.depth_limit", "SVG nesting is too deep", status_code=413
            )
        if path_bytes > MAX_PATH_BYTES:
            raise CanonicalizationError(
                "svg.path_data_limit", "SVG path data is too large", status_code=413
            )
        if time.monotonic() - started_at > SOFT_DEADLINE_SECONDS:
            raise CanonicalizationError(
                "svg.processing_deadline", "SVG processing deadline exceeded",
                status_code=408,
            )

        stack.extend((child, depth + 1) for child in reversed(list(element)))

    return element_count


def _parse_css(root, diagnostics):
    matcher = cssselect2.Matcher()
    total_css_bytes = 0
    rule_order = 0

    for style_element in [
        element for element in root.iter() if local_name(element.tag) == "style"
    ]:
        css_text = "".join(style_element.itertext())
        total_css_bytes += len(css_text.encode("utf-8"))

        if total_css_bytes > MAX_CSS_BYTES:
            raise CanonicalizationError(
                "svg.css_limit", "SVG CSS is too large", status_code=413
            )

        if UNSAFE_CSS_RE.search(css_text):
            diagnostics.append(_diagnostic(
                "svg.unsafe_css_removed", "warning", "sanitize",
                acknowledgement=True,
            ))

        for rule in tinycss2.parse_stylesheet(
            css_text, skip_comments=True, skip_whitespace=True
        ):
            if rule.type != "qualified-rule":
                if rule.type == "at-rule":
                    diagnostics.append(_diagnostic(
                        "svg.css_at_rule_removed", "warning", "sanitize",
                        acknowledgement=True,
                    ))
                continue

            selector_text = tinycss2.serialize(rule.prelude).strip()
            declarations = _parse_declarations(rule.content, diagnostics)

            if not declarations:
                continue

            try:
                selectors = cssselect2.compile_selector_list(selector_text)
            except cssselect2.SelectorError:
                diagnostics.append(_diagnostic(
                    "svg.css_selector_unsupported", "warning", "sanitize",
                    parameters={"selector": selector_text[:200]},
                    acknowledgement=True,
                ))
                continue

            for selector in selectors:
                matcher.add_selector(selector, (rule_order, declarations))
            rule_order += 1

    return matcher


def _has_css_sources(root):
    return any(
        local_name(element.tag).lower() == "style"
        or "style" in element.attrib
        for element in root.iter()
    )


def _parse_declarations(tokens, diagnostics):
    result = []

    for declaration in tinycss2.parse_declaration_list(
        tokens, skip_comments=True, skip_whitespace=True
    ):
        if declaration.type != "declaration":
            continue

        name = declaration.lower_name
        value = tinycss2.serialize(declaration.value).strip()

        if name not in SAFE_PRESENTATION:
            continue
        if not _safe_presentation_value(name, value):
            diagnostics.append(_diagnostic(
                "svg.unsafe_css_value_removed", "warning", "sanitize",
                parameters={"property": name},
                acknowledgement=True,
            ))
            continue

        result.append((name, value, bool(declaration.important)))

    return result


def _safe_presentation_value(name, value):
    lowered = value.strip().lower()
    if not lowered or UNSAFE_CSS_RE.search(lowered):
        return False
    if "url(" not in lowered:
        return True
    return bool(LOCAL_URL_RE.fullmatch(value.strip()))


def _cascade_styles(root, matcher, diagnostics):
    cascaded = {}
    wrapper_root = cssselect2.ElementWrapper.from_xml_root(root)

    for wrapper in wrapper_root.iter_subtree():
        winners = {}

        for specificity, order, pseudo, payload in matcher.match(wrapper):
            if pseudo is not None:
                continue
            rule_order, declarations = payload
            for name, value, important in declarations:
                key = (important, specificity, order, rule_order)
                if name not in winners or key >= winners[name][0]:
                    winners[name] = (key, value)

        element = wrapper.etree_element
        inline_style = element.attrib.get("style")
        if inline_style:
            for name, value, important in _parse_declarations(
                tinycss2.parse_component_value_list(inline_style), diagnostics
            ):
                winners[name] = (((important, (1_000, 0, 0), 0, 0)), value)

        cascaded[id(element)] = {
            name: value for name, (_, value) in winners.items()
        }

    return cascaded


def _safe_attribute(name, value):
    if name in SAFE_GEOMETRY_ATTRS:
        if name in {"transform", "gradientTransform", "patternTransform"}:
            return bool(TRANSFORM_RE.fullmatch(value.strip()))
        return "<" not in value and ">" not in value
    if name in SAFE_PRESENTATION:
        return _safe_presentation_value(name, value)
    return False


def _root_dimension(value):
    match = DIMENSION_RE.fullmatch(str(value or ""))
    if not match:
        return None
    try:
        number = float(match.group(1))
    except ValueError:
        return None
    if number <= 0:
        return None
    return number


def _format_number(value):
    text = f"{value:.12g}"
    return "0" if text == "-0" else text


def _source_code(element):
    for name, value in element.attrib.items():
        if local_name(name).lower() == "data-code":
            return str(value or "").strip()
    return None


def _is_hit_area(element):
    return any(
        local_name(name).lower() == "data-hit-area" and str(value).strip() == "1"
        for name, value in element.attrib.items()
    )


def _has_geometry(element, tag):
    required = {
        "path": ("d",),
        "rect": ("width", "height"),
        "circle": ("r",),
        "ellipse": ("rx", "ry"),
        "line": ("x1", "y1", "x2", "y2"),
        "polyline": ("points",),
        "polygon": ("points",),
        "use": ("href",),
    }.get(tag, ())
    values = {
        local_name(name): str(value or "").strip()
        for name, value in element.attrib.items()
    }
    return all(values.get(name) for name in required)


def _has_use_cycle(source_ids):
    graph = {}
    for source_id, element in source_ids.items():
        targets = set()
        for descendant in element.iter():
            if local_name(descendant.tag).lower() != "use":
                continue
            for name, value in descendant.attrib.items():
                if local_name(name).lower() == "href" and str(value).startswith("#"):
                    targets.add(str(value)[1:])
        graph[source_id] = targets

    visiting = set()
    visited = set()

    def visit(source_id):
        if source_id in visiting:
            return True
        if source_id in visited:
            return False
        visiting.add(source_id)
        if any(
            target in graph and visit(target)
            for target in graph.get(source_id, ())
        ):
            return True
        visiting.remove(source_id)
        visited.add(source_id)
        return False

    return any(visit(source_id) for source_id in graph)


def canonicalize_svg(
    source: bytes,
    expected_zone_count: int | None = None,
    *,
    shape_assignments: dict[int, str] | None = None,
    removed_shape_indices: set[int] | None = None,
    draft_shape_refs: dict[int, str] | None = None,
    _started_at=None,
):
    started_at = _started_at if _started_at is not None else time.monotonic()
    if len(source) > MAX_INPUT_BYTES:
        raise CanonicalizationError(
            "svg.input_limit", "SVG is larger than 10 MiB", status_code=413
        )

    try:
        root = ElementTree.fromstring(source)
    except Exception as error:
        raise CanonicalizationError(
            "svg.invalid_xml", "SVG could not be parsed"
        ) from error

    if local_name(root.tag).lower() != "svg":
        raise CanonicalizationError("svg.invalid_root", "Document root must be svg")

    diagnostics = []
    element_count = _validate_limits(root, started_at)
    if _has_css_sources(root):
        matcher = _parse_css(root, diagnostics)
        cascaded = _cascade_styles(root, matcher, diagnostics)
    else:
        cascaded = {}
    source_sha256 = hashlib.sha256(source).hexdigest()
    source_document_indices = {
        id(element): index for index, element in enumerate(root.iter())
    }
    assignment_override = shape_assignments is not None
    assignments = dict(shape_assignments or {})
    removed_indices = set(removed_shape_indices or ())
    inspection_refs = dict(draft_shape_refs or {})

    source_ids = {}
    for element in root.iter():
        source_id = element.attrib.get("id")
        if source_id and source_id not in source_ids:
            source_ids[source_id] = element

    if _has_use_cycle(source_ids):
        raise CanonicalizationError(
            "svg.use_cycle", "SVG contains a cyclic local use reference"
        )

    referenced_ids = OrderedDict()
    for element in root.iter():
        for attr_name, raw_value in element.attrib.items():
            name = local_name(attr_name)
            value = str(raw_value or "").strip()
            match = LOCAL_URL_RE.fullmatch(value)
            if name in LOCAL_REFERENCE_ATTRS and match:
                referenced_ids.setdefault(match.group(2), None)
            if name == "href" and value.startswith("#"):
                referenced_ids.setdefault(value[1:], None)

    missing_references = [
        source_id for source_id in referenced_ids if source_id not in source_ids
    ]
    if missing_references:
        diagnostics.append(_diagnostic(
            "svg.local_reference_missing", "error", "validate",
            parameters={"ids": missing_references[:20]},
        ))

    rewritten_ids = {
        source_id: f"r{index:06d}"
        for index, source_id in enumerate(referenced_ids, start=1)
    }
    zones = OrderedDict()
    shape_counter = 0
    shape_count = 0
    hit_shape_count = 0
    removed_text_count = 0
    manual_raster = False
    unsupported_tags = set()
    conflicting_code = False
    coded_definition = False

    output_root = StdElementTree.Element(f"{{{SVG_NS}}}svg")
    root_style = {}
    for attr_name, raw_value in root.attrib.items():
        name = local_name(attr_name)
        value = str(raw_value or "").strip()
        if name in SAFE_PRESENTATION and _safe_attribute(name, value):
            root_style[name] = value
    root_style.update(cascaded.get(id(root), {}))
    for name in sorted(root_style):
        value = root_style[name]
        if "url(" not in value.lower():
            output_root.set(name, value)

    def copy_element(source_element, output_parent, inherited_code=None, in_defs=False):
        nonlocal shape_counter, shape_count, hit_shape_count
        nonlocal removed_text_count, manual_raster, conflicting_code
        nonlocal coded_definition

        tag = local_name(source_element.tag)
        lowered_tag = tag.lower()
        document_index = source_document_indices[id(source_element)]

        if lowered_tag in {value.lower() for value in TEXT_TAGS}:
            removed_text_count += 1
            return
        if lowered_tag == "style":
            # Its safe cascade was already applied before tree reconstruction.
            return
        if lowered_tag in MANUAL_TAGS:
            manual_raster = True
            return
        if lowered_tag not in SAFE_TAGS_LOWER:
            unsupported_tags.add(tag)
            return

        own_code = None if assignment_override else _source_code(source_element)
        effective_code = own_code or inherited_code
        if assignment_override and lowered_tag in PAINTABLE_TAGS_LOWER:
            effective_code = assignments.get(document_index)

        if own_code is not None:
            if not own_code or len(own_code) > MAX_CODE_LENGTH:
                diagnostics.append(_diagnostic(
                    "svg.invalid_zone_code", "error", "detect",
                    parameters={"code": own_code[:140]},
                ))
                effective_code = None
            elif inherited_code and own_code != inherited_code:
                conflicting_code = True
                diagnostics.append(_diagnostic(
                    "svg.nested_conflicting_codes", "error", "detect",
                    parameters={"outer": inherited_code, "inner": own_code},
                ))

        next_in_defs = in_defs or tag in DEFINITION_TAGS
        if (
            effective_code
            and next_in_defs
            and lowered_tag in PAINTABLE_TAGS_LOWER
        ):
            coded_definition = True

        if (
            lowered_tag in PAINTABLE_TAGS_LOWER
            and not next_in_defs
            and document_index in removed_indices
        ):
            return

        output_element = StdElementTree.SubElement(
            output_parent, f"{{{SVG_NS}}}{tag}"
        )

        source_id = source_element.attrib.get("id")
        if source_id in rewritten_ids:
            output_element.set("id", rewritten_ids[source_id])

        combined_style = {}
        for attr_name, raw_value in source_element.attrib.items():
            name = local_name(attr_name)
            value = str(raw_value or "").strip()
            if name in SAFE_PRESENTATION and _safe_attribute(name, value):
                combined_style[name] = value
            elif name in SAFE_GEOMETRY_ATTRS and _safe_attribute(name, value):
                output_element.set(name, value)
            elif name == "href":
                reference = value[1:] if value.startswith("#") else None
                if reference in rewritten_ids:
                    output_element.set("href", f"#{rewritten_ids[reference]}")

        combined_style.update(cascaded.get(id(source_element), {}))
        for name in sorted(combined_style):
            value = combined_style[name]
            match = LOCAL_URL_RE.fullmatch(value)
            if match:
                reference = match.group(2)
                if reference not in rewritten_ids:
                    continue
                target = source_ids.get(reference)
                if (
                    target is None
                    or local_name(target.tag).lower() not in SAFE_TAGS_LOWER
                ):
                    diagnostics.append(_diagnostic(
                        "svg.unsupported_filter_removed",
                        "warning",
                        "sanitize",
                        parameters={"property": name},
                        acknowledgement=True,
                    ))
                    continue
                value = f"url(#{rewritten_ids[reference]})"
            output_element.set(name, value)

        is_paintable = lowered_tag in PAINTABLE_TAGS_LOWER
        if is_paintable:
            shape_count += 1
            draft_ref = inspection_refs.get(document_index)
            if draft_ref and not next_in_defs:
                output_element.set("data-nemoris-draft-shape", draft_ref)
            if effective_code and not next_in_defs:
                if not _has_geometry(source_element, lowered_tag):
                    diagnostics.append(_diagnostic(
                        "svg.missing_zone_geometry", "error", "detect",
                        parameters={"code": effective_code},
                    ))
                    output_parent.remove(output_element)
                    return
                shape_counter += 1
                shape_id = f"s{shape_counter:06d}"
                output_element.set("data-nemoris-shape", shape_id)
                zone = zones.setdefault(effective_code, {
                    "shape_ids": [],
                    "hit_shape_ids": [],
                    "source_keys": [f"data-code:{effective_code}"],
                })
                if _is_hit_area(source_element):
                    zone["hit_shape_ids"].append(shape_id)
                    hit_shape_count += 1
                else:
                    zone["shape_ids"].append(shape_id)
            elif draft_ref and not next_in_defs:
                output_element.set("pointer-events", "all")
            elif not next_in_defs:
                output_element.set("pointer-events", "none")

        for child in source_element:
            copy_element(
                child, output_element, effective_code, next_in_defs
            )

    for child in root:
        copy_element(child, output_root)

    for root_attr in ("viewBox", "width", "height", "preserveAspectRatio"):
        value = root.attrib.get(root_attr)
        if value and _safe_attribute(root_attr, str(value)):
            output_root.set(root_attr, str(value))
    if not output_root.get("viewBox"):
        root_width = _root_dimension(root.attrib.get("width"))
        root_height = _root_dimension(root.attrib.get("height"))
        if root_width is not None and root_height is not None:
            output_root.set(
                "viewBox",
                f"0 0 {_format_number(root_width)} {_format_number(root_height)}",
            )

    if unsupported_tags:
        diagnostics.append(_diagnostic(
            "svg.unsupported_elements_removed", "warning", "sanitize",
            parameters={"tags": sorted(unsupported_tags)},
            acknowledgement=True,
        ))
    if removed_text_count:
        diagnostics.append(_diagnostic(
            "svg.labels_removed", "info", "sanitize",
            parameters={"count": removed_text_count},
        ))
    if manual_raster:
        diagnostics.append(_diagnostic(
            "svg.embedded_raster_requires_manual", "error", "detect"
        ))
    if coded_definition:
        diagnostics.append(_diagnostic(
            "svg.unrendered_coded_definition", "error", "detect"
        ))
    if conflicting_code:
        pass

    zone_models = [
        MapZoneV2(code=code, **zone)
        for code, zone in zones.items()
        if zone["shape_ids"] or zone["hit_shape_ids"]
    ]
    if not zone_models:
        diagnostics.append(_diagnostic(
            "svg.no_usable_data_code", "error", "detect"
        ))
    if expected_zone_count is not None and len(zone_models) != expected_zone_count:
        diagnostics.append(_diagnostic(
            "svg.expected_zone_count_mismatch", "error", "validate",
            parameters={
                "expected": expected_zone_count,
                "actual": len(zone_models),
            },
        ))

    StdElementTree.register_namespace("", SVG_NS)
    canonical_svg = StdElementTree.tostring(
        output_root, encoding="utf-8", short_empty_elements=True
    )
    if len(canonical_svg) > MAX_OUTPUT_BYTES:
        raise CanonicalizationError(
            "svg.output_limit", "Canonical SVG is too large", status_code=413
        )
    if time.monotonic() - started_at > SOFT_DEADLINE_SECONDS:
        raise CanonicalizationError(
            "svg.processing_deadline", "SVG processing deadline exceeded",
            status_code=408,
        )

    asset_sha256 = hashlib.sha256(canonical_svg).hexdigest()
    route = (
        "manual" if manual_raster
        else "automatic" if zone_models
        else "assisted"
    )
    manifest = None
    if zone_models:
        manifest = MapPackageV2(
            asset_sha256=asset_sha256,
            zones=zone_models,
            source=MapSourceV2(
                sha256=source_sha256,
                adapter="nemoris-data-code-v1",
                expected_zone_count=expected_zone_count,
                warning_codes=list(dict.fromkeys([
                    item.code
                    for item in diagnostics
                    if item.severity == "warning"
                ])),
            ),
        )

    return CanonicalizationResult(
        canonical_svg=canonical_svg,
        manifest=manifest,
        summary=MapImportSummary(
            element_count=element_count,
            shape_count=shape_count,
            zone_count=len(zone_models),
            multipart_zone_count=sum(
                1 for zone in zone_models
                if len(zone.shape_ids) + len(zone.hit_shape_ids) > 1
            ),
            hit_shape_count=hit_shape_count,
            removed_text_count=removed_text_count,
        ),
        diagnostics=diagnostics,
        route=route,
    )
