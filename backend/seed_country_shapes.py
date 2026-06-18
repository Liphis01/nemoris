#!/usr/bin/env python3
"""Seed an image group with silhouettes of the world's country shapes.

Fetches per-country geometry and names from the open mledoze/countries dataset,
renders each country to a normalized silhouette SVG, stores those SVGs under the
app static directory, and creates one image group ("Formes des pays du monde")
holding one image question per country (French name as the answer, English name
and ISO codes as accepted aliases).

Run from the backend/ directory:

    python seed_country_shapes.py            # create (aborts if the group exists)
    python seed_country_shapes.py --replace  # delete the existing group first
    python seed_country_shapes.py --limit 5  # only the first N countries (testing)
"""

import argparse
import json
import math
import re
import unicodedata
import urllib.request
from pathlib import Path

from app.config import STATIC_DIR
from app.database import SessionLocal
from app.models import Question, QuestionGroup
from app.services.image_groups import (
    build_image_item_data,
    build_image_question_text,
)
from app.services.questions import delete_question_dependents


GROUP_NAME = "Formes des pays du monde"
RAW_BASE = "https://raw.githubusercontent.com/mledoze/countries/master"
COUNTRIES_URL = f"{RAW_BASE}/countries.json"
GEO_URL = RAW_BASE + "/data/{code}.geo.json"

VIEWBOX = 100.0
PADDING = 6.0
FILL = "#475569"
COORD_DECIMALS = 2
REQUEST_TIMEOUT = 30


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def fetch_json(url, retries=3):
    last_error = None

    for _ in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT) as response:
                return json.loads(response.read())
        except Exception as error:  # noqa: BLE001 - retried, then re-raised
            last_error = error

    raise last_error


# ---------------------------------------------------------------------------
# Names / aliases (mirror the frontend answer normalization)
# ---------------------------------------------------------------------------

def normalize(value):
    text = unicodedata.normalize("NFD", str(value or "").lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[-\s]+", " ", text.strip())


def french_name(entry):
    fra = entry.get("translations", {}).get("fra", {})
    return (
        fra.get("common")
        or entry.get("name", {}).get("common")
        or entry.get("cca3")
    )


def build_aliases(entry, answer):
    name = entry.get("name", {})
    fra = entry.get("translations", {}).get("fra", {})
    candidates = [
        name.get("common"),
        name.get("official"),
        fra.get("official"),
        *(entry.get("altSpellings") or []),
        entry.get("cca2"),
        entry.get("cca3"),
    ]

    seen = {normalize(answer)}
    aliases = []

    for candidate in candidates:
        if not candidate:
            continue

        normalized = normalize(candidate)

        if normalized and normalized not in seen:
            seen.add(normalized)
            aliases.append(candidate)

    return aliases


# ---------------------------------------------------------------------------
# GeoJSON -> normalized silhouette SVG
# ---------------------------------------------------------------------------

def geometry_polygons(geometry):
    """Return a list of polygons; each polygon is a list of [lon, lat] rings."""
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []

    if geometry_type == "Polygon":
        return [coordinates]

    if geometry_type == "MultiPolygon":
        return coordinates

    return []


def fix_antimeridian(polygons):
    """Shift western longitudes east so countries crossing 180 stay contiguous."""
    longitudes = [point[0] for polygon in polygons for ring in polygon for point in ring]

    if longitudes and (max(longitudes) - min(longitudes)) > 180:
        for polygon in polygons:
            for ring in polygon:
                for point in ring:
                    if point[0] < 0:
                        point[0] += 360


def mercator(lon, lat):
    lat = max(-85.0, min(85.0, lat))
    y = math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))
    return lon, y


def render_svg(geometry):
    polygons = geometry_polygons(geometry)

    if not polygons:
        return None

    # Work on a mutable copy so the antimeridian fix does not touch source data.
    polygons = [
        [[list(point) for point in ring] for ring in polygon]
        for polygon in polygons
    ]
    fix_antimeridian(polygons)

    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    projected = []

    for polygon in polygons:
        projected_rings = []

        for ring in polygon:
            projected_ring = []

            for lon, lat in ring:
                x, y = mercator(lon, lat)
                projected_ring.append((x, y))
                min_x, max_x = min(min_x, x), max(max_x, x)
                min_y, max_y = min(min_y, y), max(max_y, y)

            projected_rings.append(projected_ring)

        projected.append(projected_rings)

    width = max_x - min_x
    height = max_y - min_y

    if width <= 0 and height <= 0:
        return None

    scale = (VIEWBOX - 2 * PADDING) / max(width, height, 1e-9)
    offset_x = (VIEWBOX - width * scale) / 2
    offset_y = (VIEWBOX - height * scale) / 2

    def to_x(x):
        return round((x - min_x) * scale + offset_x, COORD_DECIMALS)

    def to_y(y):
        # Flip Y so north is up in the SVG coordinate system.
        return round((max_y - y) * scale + offset_y, COORD_DECIMALS)

    sub_paths = []

    for projected_rings in projected:
        for ring in projected_rings:
            points = []
            previous = None

            for x, y in ring:
                point = (to_x(x), to_y(y))

                if point != previous:
                    points.append(point)
                    previous = point

            if len(points) < 2:
                continue

            head = f"M{points[0][0]} {points[0][1]}"
            tail = "".join(f"L{x} {y}" for x, y in points[1:])
            sub_paths.append(f"{head}{tail}Z")

    if not sub_paths:
        return None

    box = int(VIEWBOX)

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}">'
        f'<path d="{"".join(sub_paths)}" fill="{FILL}" fill-rule="evenodd"/>'
        "</svg>"
    )


# ---------------------------------------------------------------------------
# Group lifecycle
# ---------------------------------------------------------------------------

def remove_existing_group(db, group):
    question_ids = [question.id for question in group.questions]
    delete_question_dependents(db, question_ids)

    for question in list(group.questions):
        db.delete(question)

    folder = STATIC_DIR / "image-groups" / str(group.id)
    db.delete(group)
    db.commit()

    if folder.exists():
        for file in folder.glob("*"):
            file.unlink()
        try:
            folder.rmdir()
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete an existing group of the same name before recreating it.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N countries (for testing).",
    )
    args = parser.parse_args()

    db = SessionLocal()

    existing = (
        db.query(QuestionGroup)
        .filter(QuestionGroup.name == GROUP_NAME)
        .first()
    )

    if existing:
        if not args.replace:
            print(
                f"Group '{GROUP_NAME}' already exists (id={existing.id}). "
                "Use --replace to recreate it."
            )
            db.close()
            return

        print(f"Removing existing group id={existing.id} ...")
        remove_existing_group(db, existing)

    print("Fetching countries.json ...")
    countries = fetch_json(COUNTRIES_URL)

    if args.limit:
        countries = countries[: args.limit]

    print(f"Processing {len(countries)} countries ...")

    group = QuestionGroup(type_group="image", name=GROUP_NAME, data={})
    db.add(group)
    db.commit()

    folder = STATIC_DIR / "image-groups" / str(group.id)
    folder.mkdir(parents=True, exist_ok=True)

    created = 0
    skipped = []

    for entry in countries:
        cca3 = (entry.get("cca3") or "").upper()
        code = cca3.lower()
        answer = french_name(entry)

        try:
            geo = fetch_json(GEO_URL.format(code=code))
        except Exception as error:  # noqa: BLE001 - logged and skipped
            skipped.append((cca3, f"geometry fetch failed: {error}"))
            continue

        feature = geo["features"][0] if geo.get("type") == "FeatureCollection" else geo
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        svg = render_svg(geometry) if geometry else None

        if not svg:
            skipped.append((cca3, "no usable geometry"))
            continue

        (folder / f"{code}.svg").write_text(svg, encoding="utf-8")

        question = Question(
            type_q="image",
            question=build_image_question_text(group, answer),
            answer=answer,
            media=f"/static/image-groups/{group.id}/{code}.svg",
            tags=[],
            data=build_image_item_data({}, {}, build_aliases(entry, answer)),
            group_id=group.id,
        )
        db.add(question)
        created += 1

        if created % 25 == 0:
            print(f"  {created} countries rendered ...")

    db.commit()
    group_id = group.id
    db.close()

    print(
        f"\nDone. Group id={group_id} '{GROUP_NAME}' "
        f"created with {created} questions ({len(skipped)} skipped)."
    )

    for cca3, reason in skipped:
        print(f"  SKIP {cca3}: {reason}")


if __name__ == "__main__":
    main()
