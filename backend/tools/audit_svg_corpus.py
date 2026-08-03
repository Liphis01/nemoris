#!/usr/bin/env python3
"""Deterministic SVG corpus inventory; analysis only, never imports content."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from defusedxml import ElementTree


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.svg_maps.analyze import analyze_svg  # noqa: E402
from app.services.svg_maps.canonicalize import (  # noqa: E402
    CanonicalizationError, local_name,
)
from app.services.svg_maps.repair import audit_repairability  # noqa: E402


EXTERNAL_REF_RE = re.compile(
    r"(?:https?://|//|data:|javascript:|@import)", re.IGNORECASE
)
SAFE_CASE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
FORBIDDEN_CANONICAL_TAGS = {
    "animate", "discard", "foreignobject", "iframe", "image", "script",
    "set", "style", "text", "tspan",
}
ACTIVE_ATTRIBUTE_PREFIXES = ("on",)
AUDIT_FORMAT = "nemoris-svg-corpus-audit-v3"
BASELINE_FORMAT = "nemoris-svg-corpus-baseline-v1"
DOWNLOAD_USER_AGENT = (
    "NemorisQuizApp/1.0 SVG compatibility audit "
    "(https://github.com/Liphis01/quiz-app)"
)


class SvgLinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name.lower() == "href" and value and ".svg" in value.lower():
                self.links.append(value)


def _canonical_checks(canonical_svg, source_ids):
    checks = {
        "parseable": False,
        "root_is_svg": False,
        "scalable_viewbox": False,
        "forbidden_element_count": 0,
        "active_attribute_count": 0,
        "external_reference_count": 0,
        "ordinary_text_count": 0,
        "source_id_leak_count": 0,
        "shape_annotation_count": 0,
        "safety_pass": False,
    }
    try:
        root = ElementTree.fromstring(canonical_svg)
    except Exception:
        return checks

    checks["parseable"] = True
    checks["root_is_svg"] = local_name(root.tag).lower() == "svg"
    checks["scalable_viewbox"] = bool(root.attrib.get("viewBox"))
    canonical_ids = set()
    for element in root.iter():
        tag = local_name(element.tag).lower()
        if tag in FORBIDDEN_CANONICAL_TAGS:
            checks["forbidden_element_count"] += 1
        if tag in {"text", "tspan"}:
            checks["ordinary_text_count"] += 1
        canonical_id = str(element.attrib.get("id") or "").strip()
        if canonical_id:
            canonical_ids.add(canonical_id)
        if element.attrib.get("data-nemoris-shape"):
            checks["shape_annotation_count"] += 1
        for name, value in element.attrib.items():
            attribute = local_name(name).lower()
            if attribute.startswith(ACTIVE_ATTRIBUTE_PREFIXES):
                checks["active_attribute_count"] += 1
            if EXTERNAL_REF_RE.search(str(value or "")):
                checks["external_reference_count"] += 1

    checks["source_id_leak_count"] = len(canonical_ids.intersection(source_ids))
    checks["safety_pass"] = all((
        checks["parseable"],
        checks["root_is_svg"],
        checks["forbidden_element_count"] == 0,
        checks["active_attribute_count"] == 0,
        checks["external_reference_count"] == 0,
        checks["ordinary_text_count"] == 0,
        checks["source_id_leak_count"] == 0,
    ))
    return checks


def _actual_workflow(record):
    if record.get("route") == "automatic":
        return "automatic"
    if (
        record.get("route") == "assisted"
        and record.get("interpretations")
    ):
        return "selectable"
    if record.get("route") == "manual":
        return "manual"
    if record.get("parse_error"):
        return "parser_failure"
    return "unsupported"


def _target_evaluation(record, metadata):
    target_workflow = metadata.get("target_workflow")
    target_count = metadata.get("target_zone_count")
    workflows = {
        "automatic": {"automatic"},
        "selectable": {"automatic", "selectable"},
        "manual": {"manual"},
        "parser_failure": {"parser_failure"},
    }
    actual_workflow = _actual_workflow(record)
    workflow_match = (
        target_workflow is None
        or actual_workflow in workflows.get(target_workflow, {target_workflow})
    )
    proposed_counts = {
        item.get("zone_count")
        for item in record.get("interpretations", [])
        if item.get("selectable", True)
    }
    if record.get("active_zone_count") is not None:
        proposed_counts.add(record["active_zone_count"])
    count_match = (
        target_count is None or target_count in proposed_counts
    )
    expected_ontology = metadata.get("expected_ontology")
    observed_ontologies = {
        item.get("ontology")
        for item in record.get("interpretations", [])
        if item.get("ontology")
    }
    ontology_match = (
        expected_ontology in {None, "generic", "unknown"}
        or expected_ontology in observed_ontologies
    )
    canonical_checks = record.get("canonical_checks") or {}
    canonical_match = (
        actual_workflow in {"manual", "parser_failure", "unsupported"}
        or (
            canonical_checks.get("safety_pass", False)
            and canonical_checks.get("scalable_viewbox", False)
            and canonical_checks.get("shape_annotation_count", 0) > 0
        )
    )
    reasons = []
    if not workflow_match:
        reasons.append("target.workflow_mismatch")
    if not count_match:
        reasons.append("target.zone_count_mismatch")
    if not ontology_match:
        reasons.append("target.ontology_mismatch")
    if not canonical_match:
        reasons.append("target.canonical_output_incomplete")
    return {
        "workflow": target_workflow,
        "zone_count": target_count,
        "expected_ontology": expected_ontology,
        "actual_workflow": actual_workflow,
        "workflow_match": workflow_match,
        "zone_count_match": count_match,
        "ontology_match": ontology_match,
        "canonical_match": canonical_match,
        "pass": not reasons,
        "reason_codes": reasons,
    }


def _record_analysis_result(record, result, source_ids):
    record["route"] = result.route
    record["active_zone_count"] = result.summary.zone_count
    record["canonical_sha256"] = hashlib.sha256(
        result.canonical_svg
    ).hexdigest()
    record["canonical_byte_size"] = len(result.canonical_svg)
    record["canonical_checks"] = _canonical_checks(
        result.canonical_svg, source_ids
    )
    record["diagnostic_codes"] = sorted({
        item.code for item in result.diagnostics
    })
    record["ontology"] = result.ontology
    record["selection_required"] = result.selection_required
    record["selected_interpretation_id"] = result.selected_interpretation_id
    record["interpretations"] = [
        {
            key: value
            for key, value in interpretation.model_dump(mode="json").items()
            if key != "zones"
        }
        for interpretation in result.interpretations
    ]
    coverage = Counter(
        item["status"]
        for item in result.inventory.get("identifier_records", [])
    )
    record["selector_coverage"] = {
        status: coverage.get(status, 0)
        for status in ("assigned", "ignored", "unresolved")
    }
    record["repairability"] = audit_repairability(result)


def _inventory(source, identity, metadata=None):
    metadata = dict(metadata or {})
    started_at = time.monotonic()
    digest = hashlib.sha256(source).hexdigest()
    record = {
        "identity": identity,
        "source_kind": metadata.get("source_kind", "local"),
        "category": metadata.get("category"),
        "license": metadata.get("license"),
        "source_url": metadata.get("source_url"),
        "download_url": metadata.get("download_url"),
        "sha256": digest,
        "byte_size": len(source),
        "parse_error": None,
        "tags": {},
        "ids": [],
        "classes": [],
        "codes": [],
        "css_byte_size": 0,
        "external_reference_count": 0,
        "candidate_counts": {
            "data_code": 0,
            "unique_id": 0,
            "unique_class": 0,
        },
        "route": "parser_failure",
        "diagnostic_codes": [],
    }
    try:
        root = ElementTree.fromstring(source)
    except Exception as error:
        record["parse_error"] = f"{type(error).__name__}: {error}"
        record["processing_ms"] = round(
            (time.monotonic() - started_at) * 1000, 3
        )
        record["target"] = _target_evaluation(record, metadata)
        pinned_sha256 = metadata.get("sha256")
        record["source_hash_match"] = (
            pinned_sha256 is None or pinned_sha256 == digest
        )
        return record

    tags = Counter()
    ids = set()
    classes = set()
    codes = []
    external_refs = 0
    css_size = 0

    for element in root.iter():
        tag = local_name(element.tag)
        tags[tag] += 1
        source_id = str(element.attrib.get("id") or "").strip()
        if source_id:
            ids.add(source_id)
        classes.update(
            value for value in str(element.attrib.get("class") or "").split()
            if value
        )
        for name, value in element.attrib.items():
            if local_name(name).lower() == "data-code":
                code = str(value or "").strip()
                if code:
                    codes.append(code)
            if EXTERNAL_REF_RE.search(str(value or "")):
                external_refs += 1
        if tag.lower() == "style":
            css = "".join(element.itertext())
            css_size += len(css.encode("utf-8"))
            external_refs += len(EXTERNAL_REF_RE.findall(css))

    record.update({
        "tags": dict(sorted(tags.items())),
        "ids": sorted(ids),
        "classes": sorted(classes),
        "codes": list(dict.fromkeys(codes)),
        "css_byte_size": css_size,
        "external_reference_count": external_refs,
        "candidate_counts": {
            "data_code": len(set(codes)),
            "unique_id": len(ids),
            "unique_class": len(classes),
        },
    })
    try:
        retry_count = 0
        while True:
            try:
                result = analyze_svg(source)
                break
            except CanonicalizationError as error:
                if error.code != "svg.processing_deadline" or retry_count:
                    raise
                retry_count += 1
        record["analysis_retry_count"] = retry_count
        _record_analysis_result(record, result, ids)
    except CanonicalizationError as error:
        record["parse_error"] = f"{error.code}: {error}"
    except Exception as error:  # One broken case must not abort the full audit.
        record["parse_error"] = (
            f"audit.internal_error:{type(error).__name__}: {error}"
        )
    record["processing_ms"] = round(
        (time.monotonic() - started_at) * 1000, 3
    )
    record["target"] = _target_evaluation(record, metadata)
    pinned_sha256 = metadata.get("sha256")
    record["source_hash_match"] = (
        pinned_sha256 is None or pinned_sha256 == digest
    )
    return record


def _local_sources(paths):
    files = set()
    for raw_path in paths:
        path = Path(raw_path)
        if path.is_dir():
            files.update(path.rglob("*.svg"))
        elif path.is_file():
            files.add(path)
    for path in sorted(files, key=lambda item: item.as_posix()):
        yield path.as_posix(), path.read_bytes()


def _read_manifest(path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("format") != "nemoris-svg-real-world-corpus-v1":
        raise ValueError("Unsupported real-world corpus manifest format")
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise ValueError("Corpus manifest cases must be a list")
    identities = set()
    for case in cases:
        identity = str(case.get("id") or "")
        if not SAFE_CASE_ID_RE.fullmatch(identity):
            raise ValueError(f"Invalid corpus case id: {identity!r}")
        if identity in identities:
            raise ValueError(f"Duplicate corpus case id: {identity}")
        identities.add(identity)
        download_url = str(case.get("download_url") or "")
        if urlparse(download_url).scheme not in {"http", "https"}:
            raise ValueError(
                f"Corpus case {identity} requires an HTTP(S) download_url"
            )
        if not case.get("license"):
            raise ValueError(f"Corpus case {identity} requires a license")
        source_url = str(case.get("source_url") or "")
        if urlparse(source_url).scheme not in {"http", "https"}:
            raise ValueError(
                f"Corpus case {identity} requires an HTTP(S) source_url"
            )
        pinned_sha256 = str(case.get("sha256") or "")
        if not SHA256_RE.fullmatch(pinned_sha256):
            raise ValueError(
                f"Corpus case {identity} requires a lowercase SHA-256"
            )
        if case.get("target_workflow") not in {
            "automatic", "selectable", "manual", "parser_failure",
        }:
            raise ValueError(
                f"Corpus case {identity} has an invalid target_workflow"
            )
        target_count = case.get("target_zone_count")
        if (
            target_count is not None
            and (
                not isinstance(target_count, int)
                or isinstance(target_count, bool)
                or target_count < 1
            )
        ):
            raise ValueError(
                f"Corpus case {identity} has an invalid target_zone_count"
            )
    return cases


def _atomic_cache_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def _manifest_sources(
    manifest_path,
    *,
    cache_directory=None,
    offline=False,
    refresh=False,
    download_delay=0.0,
):
    last_download_at = None
    for case in _read_manifest(manifest_path):
        identity = case["id"]
        cache_path = (
            cache_directory / f"{identity}.svg"
            if cache_directory is not None else None
        )
        source = None
        origin = "network"
        if cache_path is not None and cache_path.is_file() and not refresh:
            source = cache_path.read_bytes()
            origin = "cache"
        elif offline:
            yield identity, None, "offline cache miss", case, "cache-miss"
            continue
        else:
            try:
                if last_download_at is not None and download_delay:
                    elapsed = time.monotonic() - last_download_at
                    if elapsed < download_delay:
                        time.sleep(download_delay - elapsed)
                source, _ = _download(case["download_url"])
                last_download_at = time.monotonic()
                if cache_path is not None:
                    _atomic_cache_write(cache_path, source)
            except (HTTPError, URLError, OSError, ValueError) as error:
                yield (
                    identity,
                    None,
                    f"{type(error).__name__}: {error}",
                    case,
                    "network",
                )
                continue
        yield identity, source, None, case, origin


def _json_svg_paths(value):
    if isinstance(value, str) and value.lower().endswith(".svg"):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _json_svg_paths(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _json_svg_paths(item)


def _jetpunk_sources(raw_directory):
    directory = Path(raw_directory)
    if not directory.is_dir():
        raise ValueError("JetPunk corpus directory does not exist")
    excluded = {
        "svg-guide", "tutorial", "tutorials", "user-map", "user-maps",
    }
    candidates = set()
    catalogue = directory / "data.json"
    if catalogue.is_file():
        try:
            payload = json.loads(catalogue.read_text(encoding="utf-8"))
            for relative in _json_svg_paths(payload):
                candidate = directory / relative.lstrip("/")
                if candidate.is_file():
                    candidates.add(candidate)
        except (OSError, ValueError):
            pass
    if not candidates:
        candidates.update(directory.glob("*.svg"))
        dark_mode = directory / "dark-mode"
        if dark_mode.is_dir():
            candidates.update(dark_mode.rglob("*.svg"))
    for path in sorted(candidates, key=lambda item: item.as_posix()):
        if excluded.intersection(path.relative_to(directory).parts):
            continue
        yield f"jetpunk:{path.relative_to(directory).as_posix()}", path.read_bytes()


def _download(url):
    request = Request(url, headers={"User-Agent": DOWNLOAD_USER_AGENT})
    with urlopen(request, timeout=15) as response:
        if int(response.headers.get("Content-Length") or 0) > 10 * 1024 * 1024:
            raise ValueError("response exceeds 10 MiB")
        data = response.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024:
            raise ValueError("response exceeds 10 MiB")
        return data, response.headers.get("Content-Type", "")


def _remote_sources(urls):
    for catalogue_url in sorted(set(urls)):
        try:
            data, content_type = _download(catalogue_url)
            is_svg = (
                "svg" in content_type.lower()
                or urlparse(catalogue_url).path.lower().endswith(".svg")
            )
            if is_svg:
                yield catalogue_url, data, None
                continue
            parser = SvgLinkParser()
            parser.feed(data.decode("utf-8", errors="replace"))
            links = sorted({
                urljoin(catalogue_url, link) for link in parser.links
            })
            if not links:
                yield catalogue_url, None, "catalogue contained no SVG links"
            for svg_url in links:
                try:
                    svg_data, _ = _download(svg_url)
                    yield svg_url, svg_data, None
                except (HTTPError, URLError, OSError, ValueError) as error:
                    yield svg_url, None, f"{type(error).__name__}: {error}"
        except (HTTPError, URLError, OSError, ValueError) as error:
            yield catalogue_url, None, f"{type(error).__name__}: {error}"


def _summary(cases):
    available = [
        case for case in cases if not case.get("download_error")
    ]
    evaluated = [
        case for case in available if case.get("target", {}).get("workflow")
    ]
    target_passed = sum(
        case.get("target", {}).get("pass", False) for case in evaluated
    )
    scalable = sum(
        case.get("canonical_checks", {}).get("scalable_viewbox", False)
        for case in available
    )
    safe = sum(
        case.get("canonical_checks", {}).get("safety_pass", False)
        for case in available
    )
    baseline_counts = Counter(
        case.get("baseline_status", "not_checked") for case in cases
    )
    return {
        "total_cases": len(cases),
        "available_cases": len(available),
        "download_failures": len(cases) - len(available),
        "source_hash_mismatches": sum(
            case.get("source_hash_match") is False for case in available
        ),
        "parser_failures": sum(
            bool(case.get("parse_error")) for case in available
        ),
        "route_counts": dict(sorted(Counter(
            case.get("route", "download_failure") for case in cases
        ).items())),
        "source_counts": dict(sorted(Counter(
            case.get("source_kind", "unknown") for case in cases
        ).items())),
        "target_evaluated": len(evaluated),
        "target_passed": target_passed,
        "target_failed": len(evaluated) - target_passed,
        "target_pass_rate": (
            round(target_passed / len(evaluated), 4) if evaluated else None
        ),
        "canonical_safe_cases": safe,
        "canonical_scalable_cases": scalable,
        "baseline_counts": dict(sorted(baseline_counts.items())),
    }


def _baseline_projection(case):
    interpretations = [
        {
            "adapter": item.get("adapter"),
            "ontology": item.get("ontology"),
            "strength": item.get("strength"),
            "automatic_eligible": item.get("automatic_eligible"),
            "selectable": item.get("selectable"),
            "zone_count": item.get("zone_count"),
            "shape_count": item.get("shape_count"),
            "unassigned_shape_count": item.get("unassigned_shape_count"),
            "verified_label_count": item.get("verified_label_count"),
            "reason_codes": item.get("reason_codes", []),
        }
        for item in case.get("interpretations", [])
    ]
    interpretation_sha256 = hashlib.sha256(json.dumps(
        interpretations,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    canonical_checks = case.get("canonical_checks") or {}
    target = case.get("target") or {}
    repairability = case.get("repairability") or {}
    parse_error = case.get("parse_error")
    return {
        "identity": case["identity"],
        "sha256": case.get("sha256"),
        "canonical_sha256": case.get("canonical_sha256"),
        "route": case.get("route"),
        "parse_error_code": (
            str(parse_error).split(":", 1)[0] if parse_error else None
        ),
        "diagnostic_codes": case.get("diagnostic_codes", []),
        "active_zone_count": case.get("active_zone_count"),
        "interpretation_zone_counts": [
            item["zone_count"] for item in interpretations
        ],
        "interpretation_sha256": interpretation_sha256,
        "canonical_safety_pass": canonical_checks.get("safety_pass", False),
        "canonical_scalable_viewbox": canonical_checks.get(
            "scalable_viewbox", False
        ),
        "canonical_shape_annotation_count": canonical_checks.get(
            "shape_annotation_count", 0
        ),
        "target_workflow": target.get("workflow"),
        "target_zone_count": target.get("zone_count"),
        "target_actual_workflow": target.get("actual_workflow"),
        "target_pass": target.get("pass"),
        "target_reason_codes": target.get("reason_codes", []),
        "repairability_available": repairability.get("available", False),
        "repair_interpretations": [
            {
                "zone_count": item.get("zone_count"),
                "assigned_shape_count": item.get("assigned_shape_count"),
                "required_unresolved_count": item.get(
                    "required_unresolved_count"
                ),
                "optional_unresolved_count": item.get(
                    "optional_unresolved_count"
                ),
                "multipart_zone_count": item.get("multipart_zone_count"),
                "suggested_bulk_action_count": item.get(
                    "suggested_bulk_action_count"
                ),
                "blocker_codes": item.get("blocker_codes", []),
            }
            for item in repairability.get("interpretations", [])
        ],
    }


def _baseline_document(cases):
    return {
        "format": BASELINE_FORMAT,
        "generated_with": "backend/tools/audit_svg_corpus.py",
        "cases": [
            _baseline_projection(case)
            for case in sorted(cases, key=lambda item: item["identity"])
        ],
    }


def _apply_baseline(cases, baseline_path):
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    if baseline.get("format") not in {AUDIT_FORMAT, BASELINE_FORMAT}:
        raise ValueError("Unsupported SVG audit baseline format")
    if baseline["format"] == BASELINE_FORMAT:
        expected = {
            case["identity"]: case for case in baseline.get("cases", [])
        }
    else:
        expected = {
            case["identity"]: _baseline_projection(case)
            for case in baseline.get("cases", [])
        }
    for case in cases:
        projection = _baseline_projection(case)
        previous = expected.get(case["identity"])
        if previous is None:
            case["baseline_status"] = "new"
        elif previous == projection:
            case["baseline_status"] = "match"
        else:
            case["baseline_status"] = "changed"
    current_ids = {case["identity"] for case in cases}
    return sorted(set(expected) - current_ids)


def _markdown(report):
    summary = report["summary"]
    rate = summary.get("target_pass_rate")
    formatted_rate = "n/a" if rate is None else f"{rate:.1%}"
    lines = [
        "# SVG corpus audit",
        "",
        f"Cases: {summary['total_cases']}",
        "",
        f"Available: {summary['available_cases']}",
        "",
        f"Source hash mismatches: {summary['source_hash_mismatches']}",
        "",
        (
            f"Target compatibility: {summary['target_passed']}/"
            f"{summary['target_evaluated']} ({formatted_rate})"
        ),
        "",
        (
            f"Canonical safety: {summary['canonical_safe_cases']}/"
            f"{summary['available_cases']}"
        ),
        "",
        (
            f"Scalable previews: {summary['canonical_scalable_cases']}/"
            f"{summary['available_cases']}"
        ),
        "",
        (
            "| Source | Route | Workflow | Target | Zones | Target zones | "
            "Safe | Scalable | Baseline | Error |"
        ),
        "| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |",
    ]
    for case in report["cases"]:
        error = case.get("download_error") or case.get("parse_error") or ""
        target = case.get("target") or {}
        checks = case.get("canonical_checks") or {}
        zone_counts = sorted({
            item.get("zone_count")
            for item in case.get("interpretations", [])
            if item.get("zone_count") is not None
        })
        if not zone_counts and case.get("active_zone_count") is not None:
            zone_counts = [case["active_zone_count"]]
        lines.append(
            (
                "| {source} | {route} | {workflow} | {target} | {zones} | "
                "{target_zones} | {safe} | {scalable} | {baseline} | "
                "{error} |"
            ).format(
                source=case["identity"].replace("|", "\\|"),
                route=case.get("route") or "download_failure",
                workflow=target.get("actual_workflow", ""),
                target=(
                    "—"
                    if not target.get("workflow")
                    else ("pass" if target.get("pass") else "FAIL")
                ),
                zones=", ".join(str(value) for value in zone_counts),
                target_zones=target.get("zone_count") or "",
                safe="yes" if checks.get("safety_pass") else "no",
                scalable="yes" if checks.get("scalable_viewbox") else "no",
                baseline=case.get("baseline_status", ""),
                error=str(error).replace("|", "\\|"),
            )
        )
    failures = [
        case for case in report["cases"]
        if case.get("target", {}).get("workflow")
        and not case.get("target", {}).get("pass")
    ]
    if failures:
        lines.extend(["", "## Target misses", ""])
        for case in failures:
            reasons = ", ".join(case["target"]["reason_codes"])
            lines.append(f"- `{case['identity']}`: {reasons}")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="*")
    parser.add_argument(
        "--url", action="append", default=[],
        help="Direct SVG or catalogue page URL; failures are recorded.",
    )
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--markdown-out", type=Path)
    parser.add_argument(
        "--manifest",
        type=Path,
        help=(
            "Real-world corpus manifest. SVG assets may be cached locally but "
            "are never added to the report."
        ),
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        help="Untracked local cache used with --manifest.",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Use manifest cache only; record missing files as failures.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Refresh manifest assets even when the cache contains a copy.",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        help="Compare stable results against a previous audit or baseline JSON.",
    )
    parser.add_argument(
        "--baseline-out",
        type=Path,
        help=(
            "Write a deterministic semantic baseline without timings, "
            "cache paths, or presentation-only fields."
        ),
    )
    parser.add_argument(
        "--download-delay",
        type=float,
        default=0.75,
        help="Minimum seconds between uncached manifest downloads (default 0.75).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero on downloads, internal errors, or baseline drift.",
    )
    parser.add_argument(
        "--require-targets",
        action="store_true",
        help="With --check, also fail when desired compatibility targets miss.",
    )
    parser.add_argument(
        "--jetpunk-dir",
        help=(
            "Locally downloaded standard catalogue. Assets remain untracked; "
            "only this command's hashes/results should be committed."
        ),
    )
    args = parser.parse_args()

    cases = [
        _inventory(source, identity)
        for identity, source in _local_sources(args.inputs)
    ]
    if args.manifest:
        for identity, source, error, metadata, origin in _manifest_sources(
            args.manifest,
            cache_directory=args.cache_dir,
            offline=args.offline,
            refresh=args.refresh,
            download_delay=max(args.download_delay, 0.0),
        ):
            if source is None:
                cases.append({
                    "identity": identity,
                    "source_kind": metadata.get(
                        "source_kind", "real-world"
                    ),
                    "category": metadata.get("category"),
                    "license": metadata.get("license"),
                    "source_url": metadata.get("source_url"),
                    "download_url": metadata.get("download_url"),
                    "sha256": None,
                    "route": "download_failure",
                    "download_error": error,
                    "candidate_counts": {},
                    "target": _target_evaluation(
                        {"route": "download_failure"}, metadata
                    ),
                    "cache_origin": origin,
                })
            else:
                case = _inventory(source, identity, metadata)
                case["cache_origin"] = origin
                cases.append(case)
    if args.jetpunk_dir:
        cases.extend(
            _inventory(source, identity)
            for identity, source in _jetpunk_sources(args.jetpunk_dir)
        )
    for identity, source, error in _remote_sources(args.url):
        if source is None:
            cases.append({
                "identity": identity,
                "sha256": None,
                "route": "download_failure",
                "download_error": error,
                "candidate_counts": {},
            })
        else:
            cases.append(_inventory(source, identity))

    cases = sorted(cases, key=lambda item: item["identity"])
    missing_baseline_cases = []
    if args.baseline:
        missing_baseline_cases = _apply_baseline(cases, args.baseline)
    report = {
        "format": AUDIT_FORMAT,
        "generated_with": "backend/tools/audit_svg_corpus.py",
        "summary": _summary(cases),
        "missing_baseline_cases": missing_baseline_cases,
        "cases": cases,
    }
    encoded = json.dumps(
        report, ensure_ascii=False, indent=2, sort_keys=True
    ) + "\n"
    markdown = _markdown(report)

    if args.json_out:
        args.json_out.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")
    if args.markdown_out:
        args.markdown_out.write_text(markdown, encoding="utf-8")
    if args.baseline_out:
        baseline_encoded = json.dumps(
            _baseline_document(cases),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ) + "\n"
        args.baseline_out.write_text(baseline_encoded, encoding="utf-8")

    if args.check:
        has_download_failure = any(
            case.get("download_error") for case in cases
        )
        has_internal_error = any(
            str(case.get("parse_error") or "").startswith(
                "audit.internal_error:"
            )
            for case in cases
        )
        has_source_hash_mismatch = any(
            case.get("source_hash_match") is False for case in cases
        )
        has_baseline_drift = bool(missing_baseline_cases) or any(
            case.get("baseline_status") in {"changed", "new"}
            for case in cases
        )
        has_target_miss = args.require_targets and any(
            case.get("target", {}).get("workflow")
            and not case.get("target", {}).get("pass")
            for case in cases
        )
        if any((
            has_download_failure,
            has_internal_error,
            has_source_hash_mismatch,
            has_baseline_drift,
            has_target_miss,
        )):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
