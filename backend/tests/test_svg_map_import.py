import asyncio
import hashlib
import json
import tempfile
import unittest
from datetime import date
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, MediaFile, Progress, Question, QuestionGroup
from app.routers import map_imports
from app.routers.groups import get_groups
from app.schemas import (
    MapImportCommitRequest,
    MapImportPatchRequest,
    MapRepairActionRequest,
    MapRepairInitializeRequest,
    MapZonesBulkUpdate,
)
from app.services.map_zones import save_map_group_zones
from app.services.svg_maps import commit as commit_service
from app.services.svg_maps import drafts as draft_service
from app.services.svg_maps import remote as remote_service
from app.services.svg_maps.analyze import analyze_svg
from app.services.svg_maps.canonicalize import (
    CanonicalizationError,
    canonicalize_svg,
)
from app.services.svg_maps.commit import commit_draft
from app.services.svg_maps.contracts import MapPackageV2, MapRepairState
from app.services.svg_maps.drafts import create_draft, load_draft
from app.services.svg_maps.repair import (
    apply_repair_action,
    get_repair,
    initialize_repair,
)
from app.services.svg_maps.ontologies import (
    COUNTRIES,
    FR_DEPARTMENTS,
    US_STATES,
    proposal_for,
)
from app.services.training import get_training_items
from app.services.packs import export_pack, import_pack


FIXTURES = Path(__file__).parent / "fixtures" / "map_import"


class SvgCanonicalizationTests(unittest.TestCase):
    def test_tracked_corpus_hashes_and_expected_routes_are_stable(self):
        corpus = json.loads((FIXTURES / "corpus.json").read_text())
        baseline = json.loads((FIXTURES / "audit-baseline.json").read_text())
        self.assertEqual(baseline["format"], "nemoris-svg-corpus-audit-v2")
        baseline_m2 = {
            case["file"]: case for case in baseline["m2_synthetic_cases"]
        }
        for case in corpus["cases"]:
            source = (FIXTURES / case["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(source).hexdigest(), case["sha256"])
            if case["expected_route"] == "parser_failure":
                with self.assertRaises(CanonicalizationError):
                    canonicalize_svg(source, case["expected_count"])
            else:
                result = canonicalize_svg(source, case["expected_count"])
                self.assertEqual(result.route, case["expected_route"])
        for case in corpus["m2_cases"]:
            source = (FIXTURES / case["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(source).hexdigest(), case["sha256"])
            result = analyze_svg(source, case["expected_count"])
            self.assertEqual(result.route, case["expected_route"])
            self.assertEqual(result.summary.zone_count, case["expected_count"])
            audited = baseline_m2[case["file"]]
            self.assertEqual(audited["sha256"], case["sha256"])
            self.assertEqual(audited["route"], result.route)
            self.assertEqual(
                audited["interpretation_count"], len(result.interpretations)
            )
            self.assertEqual(
                audited["selection_required"], result.selection_required
            )

    def test_contract_rejects_cross_zone_shape_reuse(self):
        payload = {
            "schema_version": 2,
            "canonicalizer_version": 1,
            "asset_sha256": "a" * 64,
            "zones": [
                {
                    "code": "A",
                    "shape_ids": ["s000001"],
                    "hit_shape_ids": [],
                    "source_keys": ["data-code:A"],
                },
                {
                    "code": "B",
                    "shape_ids": ["s000001"],
                    "hit_shape_ids": [],
                    "source_keys": ["data-code:B"],
                },
            ],
            "source": {
                "sha256": "b" * 64,
                "adapter": "nemoris-data-code-v1",
                "expected_zone_count": 2,
                "warning_codes": [],
            },
        }
        with self.assertRaises(ValidationError):
            MapPackageV2.model_validate(payload)

        payload["zones"][1]["shape_ids"] = ["s000002"]
        payload["schema_version"] = 3
        with self.assertRaises(ValidationError):
            MapPackageV2.model_validate(payload)

    def test_canonicalization_is_deterministic_and_hides_answers(self):
        source = (FIXTURES / "multipart_group_hit_css.svg").read_bytes()
        first = canonicalize_svg(source, 1)
        second = canonicalize_svg(source, 1)

        self.assertEqual(first.canonical_svg, second.canonical_svg)
        self.assertEqual(first.manifest.asset_sha256, second.manifest.asset_sha256)
        self.assertEqual(first.summary.zone_count, 1)
        self.assertEqual(first.summary.multipart_zone_count, 1)
        self.assertEqual(first.summary.hit_shape_count, 1)
        self.assertEqual(first.summary.removed_text_count, 1)
        self.assertNotIn(b"data-code", first.canonical_svg)
        self.assertNotIn(b"ISLANDS", first.canonical_svg)
        self.assertNotIn(b"Visible answer", first.canonical_svg)
        self.assertNotIn(b"<style", first.canonical_svg)
        self.assertIn(b'data-nemoris-shape="s000001"', first.canonical_svg)
        self.assertEqual(
            first.manifest.zones[0].hit_shape_ids, ["s000003"]
        )

    def test_missing_viewbox_is_synthesized_from_root_dimensions(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg" width="569" height="392">
          <path data-code="A" d="M10 10h100v100H10z" />
        </svg>
        """

        result = canonicalize_svg(source, 1)

        self.assertIn(b'viewBox="0 0 569 392"', result.canonical_svg)
        self.assertEqual(result.summary.zone_count, 1)

    def test_m2_analysis_keeps_legacy_canonical_bytes_and_manifest_identical(self):
        for filename in (
            "clean_codes.svg",
            "multipart_group_hit_css.svg",
            "local_use.svg",
            "unsupported_constructs.svg",
            "unsafe_css.svg",
        ):
            source = (FIXTURES / filename).read_bytes()
            legacy = canonicalize_svg(source)
            analyzed = analyze_svg(source)
            self.assertEqual(analyzed.canonical_svg, legacy.canonical_svg)
            self.assertEqual(analyzed.manifest, legacy.manifest)
            self.assertEqual(analyzed.route, legacy.route)

    def test_expected_count_blocks_without_changing_detected_route(self):
        result = canonicalize_svg(
            (FIXTURES / "clean_codes.svg").read_bytes(), 101
        )
        self.assertEqual(result.route, "automatic")
        self.assertIn(
            "svg.expected_zone_count_mismatch",
            [item.code for item in result.diagnostics],
        )

    def test_raster_and_no_codes_route_to_future_workflows(self):
        raster = canonicalize_svg((FIXTURES / "raster_in_svg.svg").read_bytes())
        merged = canonicalize_svg((FIXTURES / "no_codes.svg").read_bytes())
        self.assertEqual(raster.route, "manual")
        self.assertEqual(merged.route, "assisted")
        self.assertIsNone(raster.manifest)
        self.assertIsNone(merged.manifest)

    def test_defused_parser_rejects_entities(self):
        with self.assertRaises(CanonicalizationError):
            canonicalize_svg((FIXTURES / "malicious.svg").read_bytes())

    def test_unsafe_css_events_and_unsupported_filters_are_removed(self):
        css = canonicalize_svg((FIXTURES / "unsafe_css.svg").read_bytes())
        unsupported = canonicalize_svg(
            (FIXTURES / "unsupported_constructs.svg").read_bytes()
        )
        self.assertNotIn(b"onclick", css.canonical_svg)
        self.assertNotIn(b"https://", css.canonical_svg)
        self.assertNotIn(b"<style", css.canonical_svg)
        self.assertIn(b'stroke="#fff"', css.canonical_svg)
        self.assertNotIn(b"<filter", unsupported.canonical_svg)
        self.assertNotIn(b"<animate", unsupported.canonical_svg)
        self.assertNotIn(b"foreignObject", unsupported.canonical_svg)
        self.assertNotIn(b"url(#", unsupported.canonical_svg)
        self.assertIn(
            "svg.unsupported_filter_removed",
            [item.code for item in unsupported.diagnostics],
        )


class SvgInterpretationTests(unittest.TestCase):
    def test_simplemaps_feature_ids_ignore_duplicate_label_anchors_and_points(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg"
             width="1000" height="1000" viewbox="0 0 1000 1000">
          <g id="features">
            <path id="COANT" name="Antioquia"
                  d="M100 100H300V300H100Z"/>
            <path id="COCUN" name="Cundinamarca"
                  d="M300 100H500V300H300Z"/>
          </g>
          <g id="points">
            <circle id="0" class="3.78|-73.55" cx="10" cy="10" r="2"/>
            <circle id="1" class="12.68|-67.61" cx="20" cy="20" r="2"/>
          </g>
          <g id="label_points">
            <circle id="COANT" class="Antioquia" cx="200" cy="200" r="1"/>
            <circle id="COCUN" class="Cundinamarca" cx="400" cy="200" r="1"/>
          </g>
        </svg>
        """
        result = analyze_svg(source)
        self.assertEqual(result.route, "automatic")
        self.assertEqual(len(result.interpretations), 1)
        self.assertEqual(
            [zone.code for zone in result.zones],
            ["COANT", "COCUN"],
        )
        self.assertEqual(
            [zone.proposed_answer for zone in result.zones],
            ["Antioquia", "Cundinamarca"],
        )
        self.assertTrue(all(
            not zone.proposal_verified for zone in result.zones
        ))
        self.assertEqual(
            result.inventory["duplicate_ids"],
            ["COANT", "COCUN"],
        )
        self.assertEqual(result.inventory["semantic_duplicate_ids"], [])
        self.assertNotIn(
            "svg.duplicate_source_ids",
            [item.code for item in result.diagnostics],
        )
        self.assertEqual(result.summary.zone_count, 2)
        self.assertEqual(result.canonical_svg.count(b"data-nemoris-shape"), 2)
        self.assertIn(b'viewBox="0 0 1000 1000"', result.canonical_svg)
        self.assertNotIn(b"Antioquia", result.canonical_svg)
        self.assertNotIn(b"label_points", result.canonical_svg)

    def test_meaningful_ids_import_automatically_and_titles_stay_out_of_svg(self):
        result = analyze_svg((FIXTURES / "generic_ids.svg").read_bytes())
        self.assertEqual(result.route, "automatic")
        self.assertEqual(result.manifest.source.adapter, "generic-svg-v1")
        self.assertEqual(
            [zone.code for zone in result.manifest.zones],
            ["west-zone", "east-zone"],
        )
        self.assertEqual(result.zones[0].proposed_answer, "Zone occidentale")
        self.assertFalse(result.zones[0].proposal_verified)
        self.assertIn(
            ("title", "Zone occidentale"),
            [(item.kind, item.value) for item in result.zones[0].evidence],
        )
        self.assertIn(
            ("aria", "Zone orientale"),
            [(item.kind, item.value) for item in result.zones[1].evidence],
        )
        self.assertNotIn(b"west-zone", result.canonical_svg)
        self.assertNotIn(b"Zone occidentale", result.canonical_svg)
        self.assertNotIn(b"class=", result.canonical_svg)
        self.assertIn(
            "svg.generated_ids_ignored",
            [item.code for item in result.diagnostics],
        )

    def test_group_ids_create_ordered_multipart_zones(self):
        result = analyze_svg((FIXTURES / "generic_groups.svg").read_bytes())
        self.assertEqual(result.route, "automatic")
        self.assertEqual(
            [(zone.code, len(zone.shape_ids)) for zone in result.zones],
            [("archipelago-a", 2), ("region-b", 1)],
        )
        self.assertEqual(result.summary.multipart_zone_count, 1)

    def test_jetpunk_selector_unions_ids_classes_and_auxiliary_dots(self):
        result = analyze_svg((FIXTURES / "jetpunk_countries.svg").read_bytes())
        self.assertEqual(result.route, "automatic")
        self.assertEqual(result.manifest.source.adapter, "jetpunk-id-class-v1")
        self.assertEqual(
            [zone.code for zone in result.zones], ["fr", "de", "mc"]
        )
        monaco = next(zone for zone in result.zones if zone.code == "mc")
        self.assertIn("id:mc-d", monaco.source_keys)
        self.assertEqual(monaco.proposed_answer, "Monaco")
        self.assertTrue(monaco.proposal_verified)

    def test_jetpunk_semantic_classes_work_without_source_ids(self):
        countries = analyze_svg(b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <style>.fr,.de { fill: #ddd; }</style>
          <path class="fr" d="M0 0H10V10H0Z"/>
          <path class="de" d="M10 0H20V10H10Z"/>
        </svg>
        """)
        capitals = analyze_svg(b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <circle class="za-c" cx="2" cy="2" r="1"/>
          <circle class="za-c" cx="5" cy="2" r="1"/>
          <circle class="za-c" cx="8" cy="2" r="1"/>
        </svg>
        """)
        self.assertEqual(countries.route, "automatic")
        self.assertEqual(
            [zone.code for zone in countries.zones], ["fr", "de"]
        )
        self.assertEqual(capitals.route, "automatic")
        self.assertEqual(capitals.zones[0].code, "za-c")
        self.assertEqual(len(capitals.zones[0].shape_ids), 3)
        self.assertEqual(capitals.zones[0].proposed_answer, "Pretoria")
        self.assertIn("Bloemfontein", capitals.zones[0].proposed_aliases)

    def test_multilayer_jetpunk_requires_and_persists_explicit_selection(self):
        source = (FIXTURES / "jetpunk_multilayer.svg").read_bytes()
        result = analyze_svg(source)
        self.assertEqual(result.route, "assisted")
        self.assertTrue(result.selection_required)
        self.assertIsNone(result.selected_interpretation_id)
        self.assertEqual(
            [item.zone_count for item in result.interpretations], [2, 2]
        )
        capitals = next(
            item for item in result.interpretations
            if item.ontology == "country-capitals"
        )
        selected = analyze_svg(
            source, selected_interpretation_id=capitals.id
        )
        self.assertEqual(selected.route, "assisted")
        self.assertFalse(selected.selection_required)
        self.assertEqual(
            [(zone.code, zone.proposed_answer) for zone in selected.zones],
            [("fr-c", "Paris"), ("de-c", "Berlin")],
        )
        self.assertIn(b'<circle', selected.canonical_svg)
        self.assertNotIn(b'id="fr-c"', selected.canonical_svg)

    def test_semantic_classes_and_geometry_need_confirmation(self):
        classes = analyze_svg((FIXTURES / "semantic_classes.svg").read_bytes())
        geometry = analyze_svg((FIXTURES / "geometry_layer.svg").read_bytes())
        self.assertEqual(classes.route, "assisted")
        self.assertTrue(classes.selection_required)
        self.assertEqual(classes.interpretations[0].strength, "mixed")
        self.assertEqual(
            [(zone.code, len(zone.shape_ids)) for zone in classes.zones],
            [("islands-a", 2), ("region-b", 1)],
        )
        self.assertEqual(geometry.route, "assisted")
        self.assertEqual(geometry.interpretations[0].strength, "weak")
        self.assertEqual(
            [zone.code for zone in geometry.zones],
            ["z000001", "z000002", "z000003"],
        )

    def test_open_filled_paths_with_common_stroke_form_a_labelled_layer(self):
        source = (FIXTURES / "generic_painted_labels.svg").read_bytes()
        result = analyze_svg(source, expected_zone_count=3)
        self.assertEqual(result.route, "assisted")
        self.assertTrue(result.selection_required)
        self.assertEqual(len(result.interpretations), 1)
        interpretation = result.interpretations[0]
        self.assertEqual(
            interpretation.reason_codes,
            ["generic.consistent_filled_stroke_layer"],
        )
        self.assertEqual(interpretation.zone_count, 3)
        self.assertEqual(
            [zone.proposed_answer for zone in interpretation.zones],
            ["Alpha", "Beta", "Gamma"],
        )
        self.assertTrue(all(
            zone.proposal_source == "source-text-nearby"
            for zone in interpretation.zones
        ))
        self.assertTrue(all(
            not zone.proposal_verified for zone in interpretation.zones
        ))

        selected = analyze_svg(
            source,
            expected_zone_count=3,
            selected_interpretation_id=interpretation.id,
        )
        self.assertFalse(selected.selection_required)
        self.assertEqual(len(selected.manifest.zones), 3)
        self.assertEqual(selected.canonical_svg.count(b"data-nemoris-shape"), 3)
        self.assertNotIn(b"<text", selected.canonical_svg)
        self.assertNotIn(b"Alpha", selected.canonical_svg)

    def test_semantic_path_label_layer_is_removed_with_acknowledgement(self):
        result = analyze_svg((FIXTURES / "path_label_layer.svg").read_bytes())
        self.assertEqual(result.route, "automatic")
        diagnostic = next(
            item for item in result.diagnostics
            if item.code == "svg.semantic_label_layer_removed"
        )
        self.assertTrue(diagnostic.requires_acknowledgement)
        self.assertNotIn(b"answer-labels", result.canonical_svg)
        self.assertEqual(result.canonical_svg.count(b"<path"), 2)

    def test_unidentified_path_label_cluster_blocks_silent_automatic_import(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <path id="west-zone" d="M0 0H45V100H0Z"/>
          <path id="east-zone" d="M55 0H100V100H55Z"/>
          <g>
            <path d="M47 40H48V42H47Z"/>
            <path d="M49 40H50V42H49Z"/>
            <path d="M51 40H52V42H51Z"/>
          </g>
        </svg>
        """
        result = analyze_svg(source)
        self.assertEqual(result.route, "assisted")
        self.assertTrue(result.selection_required)
        self.assertFalse(result.interpretations[0].automatic_eligible)
        diagnostic = next(
            item for item in result.diagnostics
            if item.code == "svg.probable_path_labels"
        )
        self.assertEqual(diagnostic.severity, "error")

    def test_partial_id_layer_cannot_be_mistaken_for_the_complete_map(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <path id="north" d="M0 0H10V10H0Z" fill="#ddd" stroke="#333"/>
          <path id="south" d="M10 0H20V10H10Z" fill="#ddd" stroke="#333"/>
          <path id="path100" d="M20 0H30V10H20Z" fill="#ddd" stroke="#333"/>
          <path id="path101-7" d="M30 0H40V10H30Z" fill="#ddd" stroke="#333"/>
        </svg>
        """

        result = analyze_svg(source)

        self.assertEqual(result.route, "assisted")
        self.assertFalse(result.interpretations[0].automatic_eligible)
        self.assertIn(
            "detect.incomplete_semantic_layer",
            result.interpretations[0].reason_codes,
        )
        self.assertIn(
            "svg.incomplete_semantic_layer",
            [item.code for item in result.diagnostics],
        )

    def test_inkscape_generated_id_suffixes_fall_back_to_geometry_layer(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <path id="path100" d="M0 0H10V10H0Z" fill="#ddd" stroke="#333"/>
          <path id="path101-7" d="M10 0H20V10H10Z" fill="#ddd" stroke="#333"/>
          <path id="path102_3" d="M20 0H30V10H20Z" fill="#ddd" stroke="#333"/>
          <path id="path200" d="M0 12H30" fill="none" stroke="#333"/>
        </svg>
        """

        result = analyze_svg(source, expected_zone_count=3)

        self.assertEqual(result.route, "assisted")
        self.assertEqual(len(result.interpretations), 1)
        self.assertEqual(result.interpretations[0].zone_count, 3)
        self.assertEqual(
            result.interpretations[0].reason_codes,
            ["generic.consistent_filled_stroke_layer"],
        )

    def test_structural_parent_layer_groups_multipart_leaf_ids(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <g id="Provinces">
            <g id="North">
              <path id="NorthMain" d="M0 0H10V10H0Z"/>
              <path id="NorthIsland" d="M0 12H3V15H0Z"/>
            </g>
            <path id="Central" d="M10 0H20V10H10Z"/>
            <g id="South">
              <path id="SouthMain" d="M20 0H30V10H20Z"/>
              <path id="SouthIsland" d="M27 12H30V15H27Z"/>
            </g>
          </g>
        </svg>
        """

        result = analyze_svg(source, expected_zone_count=3)

        self.assertEqual(result.route, "assisted")
        scoped = next(
            item for item in result.interpretations
            if "generic.scoped_group_layer" in item.reason_codes
        )
        self.assertEqual(
            [(zone.code, len(zone.shape_ids)) for zone in scoped.zones],
            [("North", 2), ("Central", 1), ("South", 2)],
        )
        self.assertEqual(
            [zone.code for zone in result.zones],
            ["North", "Central", "South"],
        )

    def test_css_classes_can_form_an_exclusive_multipart_partition(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <style>.WEST,.EAST { fill: #ddd; }</style>
          <g class="ALL">
            <path id="WestMain" class="WEST" d="M0 0H10V10H0Z"/>
            <path id="WestIsland" class="WEST" d="M0 12H3V15H0Z"/>
            <path id="EastMain" class="EAST" d="M10 0H20V10H10Z"/>
          </g>
        </svg>
        """

        result = analyze_svg(source, expected_zone_count=2)

        partition = next(
            item for item in result.interpretations
            if "generic.exclusive_class_partition" in item.reason_codes
        )
        self.assertEqual(
            [(zone.code, len(zone.shape_ids)) for zone in partition.zones],
            [("WEST", 2), ("EAST", 1)],
        )

    def test_complete_lowercase_state_layer_is_not_misread_as_countries(self):
        state_codes = [code for code in US_STATES if code != "DC"]
        shapes = "".join(
            (
                f'<rect class="state {code.lower()}" '
                f'x="{position}" y="0" width="1" height="1"/>'
            )
            for position, code in enumerate([*state_codes, "DC"])
        )
        source = (
            f'<svg xmlns="http://www.w3.org/2000/svg">{shapes}</svg>'
        ).encode()

        result = analyze_svg(source)

        self.assertEqual(result.route, "automatic")
        self.assertEqual(len(result.interpretations), 1)
        self.assertEqual(
            result.interpretations[0].ontology, "us-states-dc-51"
        )
        self.assertEqual(result.summary.zone_count, 51)
        self.assertEqual(result.zones[0].code, "AL")
        self.assertTrue(all(zone.proposal_verified for zone in result.zones))

    def test_partial_state_code_coincidences_remain_generic(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <path id="AL" d="M0 0H10V10H0Z"/>
          <path id="IN" d="M10 0H20V10H10Z"/>
          <path id="ME" d="M20 0H30V10H20Z"/>
          <path id="RU-OTHER" d="M30 0H40V10H30Z"/>
        </svg>
        """

        result = analyze_svg(source)

        self.assertTrue(result.interpretations)
        self.assertNotIn(
            "us-states-50",
            [item.ontology for item in result.interpretations],
        )

    def test_versioned_ontologies_cover_required_sets(self):
        self.assertGreaterEqual(len(COUNTRIES), 249)
        self.assertEqual(len(US_STATES), 51)
        self.assertEqual(len(FR_DEPARTMENTS), 101)
        france = proposal_for("iso3166-alpha2", "fr")
        department = proposal_for("fr-departments-101", "2A")
        grouped_capitals = proposal_for("country-capitals", "za-c")
        numbered_without_title = proposal_for("country-capitals", "za-c1")
        numbered_with_title = proposal_for(
            "country-capitals", "za-c1", ["Bloemfontein"]
        )
        self.assertEqual(france.answer, "France")
        self.assertEqual(department.answer, "Corse-du-Sud")
        self.assertIn("Bloemfontein", grouped_capitals.aliases)
        self.assertFalse(numbered_without_title.verified)
        self.assertEqual(numbered_with_title.answer, "Bloemfontein")
        self.assertTrue(all(
            proposal_for("fr-departments-101", code).verified
            for code in FR_DEPARTMENTS
        ))
        self.assertTrue(all(
            proposal_for("us-states-dc-51", code).verified
            for code in US_STATES
        ))

    def test_full_state_and_department_code_sets_compile_with_expected_ontology(self):
        state_codes = [code for code in US_STATES if code != "DC"]

        def svg_for(codes):
            shapes = "".join(
                (
                    f'<rect id="{code}" x="{position}" y="0" '
                    f'width="1" height="1"/>'
                )
                for position, code in enumerate(codes)
            )
            return (
                f'<svg xmlns="http://www.w3.org/2000/svg">{shapes}</svg>'
            ).encode()

        states_50 = analyze_svg(svg_for(state_codes))
        states_51 = analyze_svg(svg_for([*state_codes, "DC"]))
        departments = analyze_svg(
            svg_for(FR_DEPARTMENTS), ontology="fr-departments-101"
        )
        self.assertEqual(states_50.interpretations[0].ontology, "us-states-50")
        self.assertEqual(states_50.summary.zone_count, 50)
        self.assertEqual(
            states_51.interpretations[0].ontology, "us-states-dc-51"
        )
        self.assertEqual(states_51.summary.zone_count, 51)
        self.assertEqual(departments.summary.zone_count, 101)
        self.assertEqual(departments.interpretations[0].verified_label_count, 101)

    def test_explicit_department_ontology_accepts_group_code_prefixes(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <g id="FR-01"><path d="M0 0H10V10H0Z"/></g>
          <g id="dep-2A"><path d="M10 0H20V10H10Z"/></g>
        </svg>
        """
        result = analyze_svg(source, ontology="fr-departments-101")
        self.assertEqual(result.route, "automatic")
        self.assertEqual(
            [(zone.code, zone.proposed_answer) for zone in result.zones],
            [("FR-01", "Ain"), ("dep-2A", "Corse-du-Sud")],
        )

    def test_explicit_ontology_can_promote_css_used_semantic_classes(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <style>.FR-01,.dep-2A { fill: #ddd; }</style>
          <path class="FR-01" d="M0 0H10V10H0Z"/>
          <path class="dep-2A" d="M10 0H20V10H10Z"/>
        </svg>
        """
        result = analyze_svg(source, ontology="fr-departments-101")
        self.assertEqual(result.route, "automatic")
        self.assertEqual(
            [zone.proposed_answer for zone in result.zones],
            ["Ain", "Corse-du-Sud"],
        )

    def test_partial_data_codes_expose_alternative_interpretations_and_coverage(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg">
          <path id="coded-zone" data-code="A" d="M0 0H10V10H0Z"/>
          <path id="uncoded-zone" d="M10 0H20V10H10Z"/>
        </svg>
        """
        result = analyze_svg(source)
        self.assertEqual(result.route, "assisted")
        self.assertTrue(result.selection_required)
        self.assertEqual(
            [item.adapter for item in result.interpretations],
            ["nemoris-data-code-v1", "generic-svg-v1"],
        )
        coverage = {
            item["identifiers"][0]: item["status"]
            for item in result.inventory["identifier_records"]
        }
        self.assertEqual(
            coverage, {"coded-zone": "assigned", "uncoded-zone": "assigned"}
        )

    def test_identifier_inventory_explains_generated_and_css_only_exclusions(self):
        result = analyze_svg((FIXTURES / "generic_ids.svg").read_bytes())
        generated = next(
            item for item in result.inventory["identifier_records"]
            if "path123" in item["identifiers"]
        )
        self.assertEqual(generated["status"], "ignored")
        self.assertIn("identifier.editor_generated", generated["reason_codes"])


class SvgRepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.drafts = Path(self.temp.name) / "drafts"

    def tearDown(self):
        self.temp.cleanup()

    def _initialize(self, filename="semantic_classes.svg", **draft_options):
        draft = create_draft(
            (FIXTURES / filename).read_bytes(),
            root=self.drafts,
            **draft_options,
        )
        interpretation = next(
            item for item in draft.interpretations if item.selectable
        )
        repair = initialize_repair(
            draft.draft_id, interpretation.id, root=self.drafts
        )
        return draft, repair

    def test_repair_contract_rejects_non_opaque_or_unknown_history(self):
        payload = {
            "repair_version": 1,
            "revision": 1,
            "active_interpretation_id": "i-main",
            "branches": {
                "i-main": {
                    "interpretation_id": "i-main",
                    "adapter": "generic-svg-v1",
                    "ontology": "generic",
                    "base_zones": [{
                        "zone_id": "d000001",
                        "code": "A",
                        "source_keys": [],
                    }],
                    "base_assignments": {"p000001": "d000001"},
                    "base_roles": {},
                    "required_shape_refs": [],
                    "optional_shape_refs": [],
                    "operations": [{
                        "type": "set_role",
                        "shape_refs": ["source-answer-id"],
                        "role": "label",
                    }],
                    "cursor": 1,
                }
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        with self.assertRaises(ValidationError):
            MapRepairState.model_validate(payload)
        payload["branches"]["i-main"]["operations"][0] = {
            "type": "invented_action"
        }
        with self.assertRaises(ValidationError):
            MapRepairState.model_validate(payload)

    def test_tracked_m3a_repair_scripts_reach_declared_readiness(self):
        corpus = json.loads((FIXTURES / "corpus.json").read_text())
        for case in corpus["m3a_cases"]:
            with self.subTest(file=case["file"]):
                source = (FIXTURES / case["file"]).read_bytes()
                self.assertEqual(
                    hashlib.sha256(source).hexdigest(), case["sha256"]
                )
                draft = create_draft(
                    source,
                    expected_zone_count=case["expected_count"],
                    root=self.drafts,
                )
                self.assertEqual(draft.route, case["expected_route"])
                interpretation = next(
                    item for item in draft.interpretations if item.selectable
                )
                repair = initialize_repair(
                    draft.draft_id, interpretation.id, root=self.drafts
                )
                self.assertEqual(
                    repair["summary"]["zone_count"],
                    case["expected_initial_zone_count"],
                )
                self.assertEqual(
                    repair["summary"]["required_unresolved_count"],
                    case["expected_required_unresolved_count"],
                )

                action_count = 0
                for action in case.get("repair_script", []):
                    selector = action["select"]
                    refs = [
                        shape["ref"]
                        for shape in repair["shapes"]
                        if (
                            shape["risk"] == selector.get("risk")
                            and any(
                                evidence["kind"] == "group"
                                and evidence["value"] == selector.get("layer")
                                for evidence in shape["evidence"]
                            )
                        )
                    ]
                    repair = apply_repair_action(
                        draft.draft_id,
                        repair["revision"],
                        {
                            "type": action["type"],
                            "shape_refs": refs,
                            "role": action["role"],
                        },
                        root=self.drafts,
                    )
                    action_count += 1

                self.assertLessEqual(
                    action_count, case["maximum_repair_action_count"]
                )
                acknowledgements = [
                    item["code"]
                    for item in repair["diagnostics"]
                    if item["requires_acknowledgement"]
                ]
                ready = draft_service.update_draft(
                    draft.draft_id,
                    acknowledgements=acknowledgements,
                    root=self.drafts,
                )
                self.assertTrue(ready.can_commit)
                preview = (
                    self.drafts / draft.draft_id / "preview.svg"
                ).read_bytes()
                self.assertNotIn(b"data-nemoris-draft-shape", preview)

    def test_repair_initialization_is_local_persistent_and_opaque(self):
        draft, repair = self._initialize()
        directory = self.drafts / draft.draft_id

        self.assertEqual(repair["repair_version"], 1)
        self.assertEqual(repair["summary"]["zone_count"], 2)
        self.assertTrue((directory / "repair.json").is_file())
        self.assertTrue((directory / "inspection.svg").is_file())
        self.assertEqual(
            get_repair(draft.draft_id, root=self.drafts)["revision"],
            repair["revision"],
        )
        self.assertTrue(all(
            shape["ref"].startswith("p") and len(shape["ref"]) == 7
            for shape in repair["shapes"]
        ))

        inspection = (directory / "inspection.svg").read_bytes()
        preview = (directory / "preview.svg").read_bytes()
        self.assertIn(b"data-nemoris-draft-shape", inspection)
        self.assertNotIn(b"data-nemoris-draft-shape", preview)
        self.assertNotIn(b'class="islands-a"', inspection)
        self.assertNotIn(b'class="islands-a"', preview)
        self.assertNotIn(b"data-code", preview)

    def test_existing_hit_areas_survive_repair_compilation(self):
        draft, repair = self._initialize(
            "multipart_group_hit_css.svg",
            expected_zone_count=1,
        )
        self.assertEqual(repair["summary"]["zone_count"], 1)
        self.assertEqual(
            repair["preview_manifest"]["zones"][0]["hit_shape_ids"],
            ["s000003"],
        )

    def test_create_merge_explode_and_persistent_undo_redo(self):
        draft, repair = self._initialize()
        multipart = next(
            zone for zone in repair["zones"] if len(zone["shape_refs"]) == 2
        )
        moved_ref = multipart["shape_refs"][1]

        created = apply_repair_action(
            draft.draft_id,
            repair["revision"],
            {"type": "create_zone", "shape_refs": [moved_ref]},
            root=self.drafts,
        )
        neutral = next(zone for zone in created["zones"] if zone["code"] == "z000001")
        self.assertEqual(created["summary"]["zone_count"], 3)
        self.assertEqual(neutral["shape_refs"], [moved_ref])
        self.assertTrue(created["can_undo"])

        merged = apply_repair_action(
            draft.draft_id,
            created["revision"],
            {
                "type": "merge_zones",
                "zone_ids": [multipart["zone_id"], neutral["zone_id"]],
                "primary_zone_id": multipart["zone_id"],
            },
            root=self.drafts,
        )
        retained = next(
            zone for zone in merged["zones"]
            if zone["zone_id"] == multipart["zone_id"]
        )
        self.assertEqual(retained["code"], multipart["code"])
        self.assertEqual(len(retained["shape_refs"]), 2)
        self.assertEqual(
            retained["source_keys"],
            list(dict.fromkeys([
                *multipart["source_keys"],
                *neutral["source_keys"],
            ])),
        )

        exploded = apply_repair_action(
            draft.draft_id,
            merged["revision"],
            {"type": "explode_zone", "zone_id": multipart["zone_id"]},
            root=self.drafts,
        )
        self.assertEqual(exploded["summary"]["zone_count"], 3)
        self.assertEqual(
            next(
                zone for zone in exploded["zones"]
                if zone["zone_id"] == multipart["zone_id"]
            )["code"],
            multipart["code"],
        )

        undone = apply_repair_action(
            draft.draft_id,
            exploded["revision"],
            {"type": "undo"},
            root=self.drafts,
        )
        self.assertEqual(undone["summary"]["zone_count"], 2)
        self.assertTrue(undone["can_redo"])
        reloaded = get_repair(draft.draft_id, root=self.drafts)
        self.assertEqual(reloaded["revision"], undone["revision"])
        redone = apply_repair_action(
            draft.draft_id,
            reloaded["revision"],
            {"type": "redo"},
            root=self.drafts,
        )
        self.assertEqual(redone["summary"]["zone_count"], 3)

    def test_roles_readiness_expected_count_and_compilation(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 12">
          <path id="north" d="M0 0H10V10H0Z" fill="#ddd" stroke="#333"/>
          <path id="south" d="M10 0H20V10H10Z" fill="#ddd" stroke="#333"/>
          <path id="path100" d="M20 0H30V10H20Z" fill="#ddd" stroke="#333"/>
          <path id="path200" d="M0 11H30" fill="none" stroke="#333"/>
          <script>alert(1)</script>
        </svg>
        """
        draft = create_draft(source, expected_zone_count=2, root=self.drafts)
        interpretation = next(
            item for item in draft.interpretations if item.selectable
        )
        repair = initialize_repair(
            draft.draft_id, interpretation.id, root=self.drafts
        )
        unresolved = [
            shape for shape in repair["shapes"]
            if shape["role"] == "unresolved"
        ]
        self.assertEqual(len(unresolved), 1)
        self.assertEqual(unresolved[0]["risk"], "required")
        self.assertFalse(repair["can_commit"])

        repaired = apply_repair_action(
            draft.draft_id,
            repair["revision"],
            {
                "type": "set_role",
                "shape_refs": [unresolved[0]["ref"]],
                "role": "label",
            },
            root=self.drafts,
        )
        self.assertEqual(repaired["summary"]["required_unresolved_count"], 0)
        required_warnings = [
            item["code"]
            for item in repaired["diagnostics"]
            if item["requires_acknowledgement"]
        ]
        acknowledged = draft_service.update_draft(
            draft.draft_id,
            acknowledgements=required_warnings,
            root=self.drafts,
        )
        self.assertTrue(acknowledged.can_commit)
        preview = (
            self.drafts / draft.draft_id / "preview.svg"
        ).read_bytes()
        self.assertNotIn(b"script", preview)
        self.assertNotIn(b"north", preview)
        self.assertNotIn(b"path100", preview)
        self.assertNotIn(b"data-nemoris-draft-shape", preview)
        self.assertIn(b'pointer-events="none"', preview)

        mismatched = draft_service.update_draft(
            draft.draft_id,
            expected_zone_count=3,
            expected_count_was_set=True,
            root=self.drafts,
        )
        self.assertFalse(mismatched.can_commit)
        refreshed = get_repair(draft.draft_id, root=self.drafts)
        self.assertIn("repair.expected_count", refreshed["readiness_blockers"])

    def test_optional_unresolved_requires_acknowledgement(self):
        source = b"""
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10">
          <path id="north" d="M0 0H10V10H0Z" fill="#ddd"/>
          <path id="south" d="M10 0H20V10H10Z" fill="#ddd"/>
          <circle cx="35" cy="5" r="2" fill="#f00"/>
        </svg>
        """
        draft = create_draft(source, root=self.drafts)
        interpretation = next(
            item for item in draft.interpretations if item.selectable
        )
        repair = initialize_repair(
            draft.draft_id, interpretation.id, root=self.drafts
        )
        self.assertEqual(repair["summary"]["optional_unresolved_count"], 1)
        self.assertFalse(repair["can_commit"])
        warning = next(
            item for item in repair["diagnostics"]
            if item["code"] == "svg.repair_optional_unresolved"
        )
        self.assertTrue(warning["requires_acknowledgement"])

        acknowledged = draft_service.update_draft(
            draft.draft_id,
            acknowledgements=["svg.repair_optional_unresolved"],
            root=self.drafts,
        )
        self.assertTrue(acknowledged.can_commit)
        current = get_repair(draft.draft_id, root=self.drafts)
        self.assertTrue(current["can_commit"])
        preview = (
            self.drafts / draft.draft_id / "preview.svg"
        ).read_bytes()
        self.assertIn(b"<circle", preview)
        self.assertIn(b'pointer-events="none"', preview)

    def test_revision_conflict_and_failed_compile_preserve_confirmed_state(self):
        draft, repair = self._initialize()
        shape_ref = repair["zones"][0]["shape_refs"][0]
        directory = self.drafts / draft.draft_id
        before_state = (directory / "repair.json").read_bytes()
        before_preview = (directory / "preview.svg").read_bytes()

        with self.assertRaises(HTTPException) as conflict:
            apply_repair_action(
                draft.draft_id,
                repair["revision"] - 1,
                {
                    "type": "set_role",
                    "shape_refs": [shape_ref],
                    "role": "decoration",
                },
                root=self.drafts,
            )
        self.assertEqual(conflict.exception.status_code, 409)
        self.assertEqual(
            conflict.exception.detail["current_revision"], repair["revision"]
        )

        with (
            patch(
                "app.services.svg_maps.repair.canonicalize_svg",
                side_effect=CanonicalizationError(
                    "svg.repair_compile_failed", "compile failed"
                ),
            ),
            self.assertRaises(CanonicalizationError),
        ):
            apply_repair_action(
                draft.draft_id,
                repair["revision"],
                {
                    "type": "set_role",
                    "shape_refs": [shape_ref],
                    "role": "decoration",
                },
                root=self.drafts,
            )
        self.assertEqual((directory / "repair.json").read_bytes(), before_state)
        self.assertEqual((directory / "preview.svg").read_bytes(), before_preview)

    def test_manual_and_legacy_upgrade_drafts_cannot_enter_structural_repair(self):
        manual = create_draft(
            (FIXTURES / "raster_in_svg.svg").read_bytes(),
            root=self.drafts,
        )
        with self.assertRaises(HTTPException) as manual_error:
            initialize_repair(
                manual.draft_id, "i-missing", root=self.drafts
            )
        self.assertEqual(manual_error.exception.status_code, 409)

        upgrade = create_draft(
            (FIXTURES / "semantic_classes.svg").read_bytes(),
            target_group_id=42,
            root=self.drafts,
        )
        with self.assertRaises(HTTPException) as upgrade_error:
            initialize_repair(
                upgrade.draft_id,
                upgrade.interpretations[0].id,
                root=self.drafts,
            )
        self.assertEqual(upgrade_error.exception.status_code, 409)

    def test_switching_interpretations_preserves_independent_branches(self):
        draft = create_draft(
            (FIXTURES / "jetpunk_multilayer.svg").read_bytes(),
            root=self.drafts,
        )
        countries, capitals = draft.interpretations
        first = initialize_repair(
            draft.draft_id, countries.id, root=self.drafts
        )
        changed = apply_repair_action(
            draft.draft_id,
            first["revision"],
            {
                "type": "set_role",
                "shape_refs": [first["zones"][0]["shape_refs"][0]],
                "role": "excluded",
            },
            root=self.drafts,
        )
        self.assertEqual(changed["summary"]["zone_count"], 1)

        other = initialize_repair(
            draft.draft_id, capitals.id, root=self.drafts
        )
        self.assertEqual(other["summary"]["zone_count"], 2)
        restored = initialize_repair(
            draft.draft_id, countries.id, root=self.drafts
        )
        self.assertEqual(restored["summary"]["zone_count"], 1)
        self.assertEqual(
            set(restored["branch_interpretation_ids"]),
            {countries.id, capitals.id},
        )

    def test_active_repair_updates_expiry_and_is_listed_for_resume(self):
        draft, repair = self._initialize()
        directory = self.drafts / draft.draft_id
        persisted = load_draft(draft.draft_id, root=self.drafts)
        old = (
            datetime.now(timezone.utc) - timedelta(days=8)
        ).isoformat()
        stale_created = persisted.model_copy(update={"created_at": old})
        draft_service._atomic_write_json(
            directory / "draft.json",
            stale_created.model_dump(mode="json"),
        )

        resumed = draft_service.list_drafts(root=self.drafts)
        self.assertEqual([item["draft_id"] for item in resumed], [draft.draft_id])
        self.assertTrue(resumed[0]["repair_available"])
        self.assertEqual(resumed[0]["repair_revision"], repair["revision"])

    def test_exact_local_uploads_match_frozen_repair_acceptance(self):
        baseline = json.loads(
            (FIXTURES / "m3a-local-audit-baseline.json").read_text()
        )
        local_root = Path(__file__).parents[1] / "map-import-drafts"
        source_by_hash = {
            hashlib.sha256(path.read_bytes()).hexdigest(): path
            for path in local_root.glob("*/source.svg")
        }
        expected_hashes = {case["sha256"] for case in baseline["cases"]}
        if not expected_hashes.intersection(source_by_hash):
            self.skipTest("Exact user uploads are intentionally not redistributed")
        self.assertTrue(expected_hashes.issubset(source_by_hash))

        for case in baseline["cases"]:
            with self.subTest(identity=case["identity"]):
                source = source_by_hash[case["sha256"]].read_bytes()
                draft = create_draft(
                    source,
                    expected_zone_count=case["expected_zone_count"],
                    root=self.drafts,
                )
                interpretation = next(
                    item for item in draft.interpretations if item.selectable
                )
                repair = initialize_repair(
                    draft.draft_id, interpretation.id, root=self.drafts
                )
                self.assertEqual(
                    repair["summary"], case["initial_repair_summary"]
                )
                actions = 0
                for scripted in case["repair_script"]:
                    refs = [
                        shape["ref"]
                        for shape in repair["shapes"]
                        if (
                            shape["risk"] == scripted["select"]["risk"]
                            and any(
                                evidence["kind"] == "group"
                                and evidence["value"] == scripted["select"]["layer"]
                                for evidence in shape["evidence"]
                            )
                        )
                    ]
                    repair = apply_repair_action(
                        draft.draft_id,
                        repair["revision"],
                        {
                            "type": scripted["type"],
                            "shape_refs": refs,
                            "role": scripted["role"],
                        },
                        root=self.drafts,
                    )
                    actions += 1
                self.assertEqual(actions, case["repair_action_count"])
                acknowledgements = [
                    item["code"]
                    for item in repair["diagnostics"]
                    if item["requires_acknowledgement"]
                ]
                ready = draft_service.update_draft(
                    draft.draft_id,
                    acknowledgements=acknowledgements,
                    root=self.drafts,
                )
                self.assertEqual(
                    ready.can_commit,
                    case["ready_after_script_and_acknowledgements"],
                )
                preview = (
                    self.drafts / draft.draft_id / "preview.svg"
                ).read_bytes()
                expected_frame = (
                    f'viewBox="{case["expected_canonical_view_box"]}"'
                ).encode()
                self.assertIn(expected_frame, preview)
                self.assertEqual(
                    preview.count(b"data-nemoris-shape"),
                    case["expected_zone_count"],
                )


class SvgMapCommitTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.drafts = self.root / "drafts"
        self.static = self.root / "static"

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_draft_has_no_database_side_effect_and_commit_is_atomic(self):
        draft = create_draft(
            (FIXTURES / "clean_codes.svg").read_bytes(),
            expected_zone_count=3,
            root=self.drafts,
        )
        self.assertEqual(self.db.query(QuestionGroup).count(), 0)
        self.assertEqual(self.db.query(Question).count(), 0)
        self.assertTrue((self.drafts / draft.draft_id / "preview.svg").is_file())
        persisted = json.loads(
            (self.drafts / draft.draft_id / "draft.json").read_text()
        )
        self.assertNotIn("zones", persisted["interpretations"][0])
        analysis = json.loads(
            (self.drafts / draft.draft_id / "analysis.json").read_text()
        )
        self.assertIn("zones", analysis["interpretations"][0])

        response = commit_draft(
            self.db,
            draft.draft_id,
            name="Synthetic",
            draft_root=self.drafts,
            static_dir=self.static,
        )
        self.assertEqual(response["group"]["question_count"], 3)
        self.assertEqual(response["group"]["named_zone_count"], 0)
        self.assertEqual(
            [zone.data["code"] for zone in self.db.query(Question).order_by(Question.id)],
            ["AA", "BB", "CC"],
        )
        self.assertTrue(all(zone.answer == "" for zone in self.db.query(Question)))
        self.assertFalse((self.drafts / draft.draft_id).exists())

    def test_exact_local_repaired_uploads_commit_one_atomic_question_per_zone(self):
        baseline = json.loads(
            (FIXTURES / "m3a-local-audit-baseline.json").read_text()
        )
        local_root = Path(__file__).parents[1] / "map-import-drafts"
        source_by_hash = {
            hashlib.sha256(path.read_bytes()).hexdigest(): path
            for path in local_root.glob("*/source.svg")
        }
        expected_hashes = {case["sha256"] for case in baseline["cases"]}
        if not expected_hashes.intersection(source_by_hash):
            self.skipTest("Exact user uploads are intentionally not redistributed")
        self.assertTrue(expected_hashes.issubset(source_by_hash))

        for case in baseline["cases"]:
            source = source_by_hash[case["sha256"]].read_bytes()
            draft = create_draft(
                source,
                expected_zone_count=case["expected_zone_count"],
                root=self.drafts,
            )
            interpretation = next(
                item for item in draft.interpretations if item.selectable
            )
            repair = initialize_repair(
                draft.draft_id, interpretation.id, root=self.drafts
            )
            for scripted in case["repair_script"]:
                refs = [
                    shape["ref"]
                    for shape in repair["shapes"]
                    if (
                        shape["risk"] == scripted["select"]["risk"]
                        and any(
                            evidence["kind"] == "group"
                            and evidence["value"] == scripted["select"]["layer"]
                            for evidence in shape["evidence"]
                        )
                    )
                ]
                repair = apply_repair_action(
                    draft.draft_id,
                    repair["revision"],
                    {
                        "type": scripted["type"],
                        "shape_refs": refs,
                        "role": scripted["role"],
                    },
                    root=self.drafts,
                )
            acknowledgements = [
                item["code"]
                for item in repair["diagnostics"]
                if item["requires_acknowledgement"]
            ]
            ready = draft_service.update_draft(
                draft.draft_id,
                acknowledgements=acknowledgements,
                root=self.drafts,
            )
            self.assertTrue(ready.can_commit)
            committed = commit_draft(
                self.db,
                draft.draft_id,
                name=case["identity"],
                draft_root=self.drafts,
                static_dir=self.static,
            )
            questions = (
                self.db.query(Question)
                .filter(Question.group_id == committed["group"]["id"])
                .all()
            )
            self.assertEqual(
                len(questions), case["expected_zone_count"]
            )
            self.assertEqual(
                len(committed["group"]["data"]["map"]["zones"]),
                case["expected_zone_count"],
            )

    def test_warning_acknowledgements_and_expiry_are_persisted(self):
        draft = create_draft(
            (FIXTURES / "unsupported_constructs.svg").read_bytes(),
            root=self.drafts,
        )
        self.assertFalse(draft.can_commit)
        required = [
            item.code
            for item in draft.diagnostics
            if item.requires_acknowledgement
        ]
        acknowledged = draft_service.update_draft(
            draft.draft_id,
            acknowledgements=required,
            root=self.drafts,
        )
        self.assertTrue(acknowledged.can_commit)
        self.assertFalse(
            (self.drafts / draft.draft_id / "draft.tmp").exists()
        )

        expired = acknowledged.model_copy(update={
            "created_at": (
                datetime.now(timezone.utc) - timedelta(days=8)
            ).isoformat(),
            "updated_at": (
                datetime.now(timezone.utc) - timedelta(days=8)
            ).isoformat(),
        })
        draft_service._atomic_write_json(
            self.drafts / draft.draft_id / "draft.json",
            expired.model_dump(mode="json"),
        )
        with self.assertRaises(HTTPException):
            load_draft(draft.draft_id, root=self.drafts)
        self.assertFalse((self.drafts / draft.draft_id).exists())

    def test_upgrade_preserves_identity_progress_and_unrelated_data(self):
        self.static.mkdir()
        source = (FIXTURES / "clean_codes.svg").read_bytes()
        (self.static / "legacy.svg").write_bytes(source)
        group = QuestionGroup(
            type_group="map",
            name="Legacy",
            media="/static/legacy.svg",
            data={"layout": {"zoom": 2}},
        )
        existing = Question(
            type_q="map",
            question="Legacy - AA",
            answer="Alpha",
            tags=["geo"],
            data={"code": "AA", "aliases": ["A"], "favorite": True},
            group=group,
        )
        progress = Progress(
            question=existing,
            reps=4,
            interval=12,
            next_review=date(2026, 8, 1),
        )
        self.db.add_all([group, existing, progress])
        self.db.commit()
        existing_id = existing.id
        existing_guid = existing.guid

        draft = create_draft(
            source,
            target_group_id=group.id,
            root=self.drafts,
        )
        response = commit_draft(
            self.db,
            draft.draft_id,
            draft_root=self.drafts,
            static_dir=self.static,
        )
        self.db.expire_all()
        preserved = self.db.query(Question).filter(Question.id == existing_id).one()

        self.assertEqual(preserved.guid, existing_guid)
        self.assertEqual(preserved.answer, "Alpha")
        self.assertEqual(preserved.tags, ["geo"])
        self.assertEqual(preserved.data["aliases"], ["A"])
        self.assertTrue(preserved.data["favorite"])
        self.assertEqual(preserved.progress.reps, 4)
        self.assertEqual(response["group"]["question_count"], 3)
        self.assertEqual(group.data["layout"], {"zoom": 2})
        self.assertEqual(group.data["map"]["schema_version"], 2)

    def test_upgrade_identity_conflicts_leave_legacy_group_unchanged(self):
        group = QuestionGroup(
            type_group="map",
            name="Conflict",
            media="/static/legacy.svg",
            data={"keep": True},
        )
        first = Question(
            type_q="map",
            question="A",
            answer="Alpha",
            data={"code": "AA", "aliases": []},
            group=group,
        )
        duplicate = Question(
            type_q="map",
            question="A again",
            answer="Alpha bis",
            data={"code": "AA", "aliases": []},
            group=group,
        )
        self.db.add_all([group, first, duplicate])
        self.db.commit()
        draft = create_draft(
            (FIXTURES / "clean_codes.svg").read_bytes(),
            target_group_id=group.id,
            root=self.drafts,
        )

        with self.assertRaises(HTTPException):
            commit_draft(
                self.db,
                draft.draft_id,
                draft_root=self.drafts,
                static_dir=self.static,
            )
        self.db.refresh(group)
        self.assertEqual(group.media, "/static/legacy.svg")
        self.assertEqual(group.data, {"keep": True})
        self.assertEqual(self.db.query(Question).count(), 2)
        self.assertTrue((self.drafts / draft.draft_id).exists())

    def test_rollback_removes_new_media_and_keeps_draft(self):
        draft = create_draft(
            (FIXTURES / "clean_codes.svg").read_bytes(),
            root=self.drafts,
        )
        with (
            patch.object(self.db, "commit", side_effect=RuntimeError("boom")),
            self.assertRaises(RuntimeError),
        ):
            commit_draft(
                self.db,
                draft.draft_id,
                name="Rollback",
                draft_root=self.drafts,
                static_dir=self.static,
            )
        self.assertEqual(list(self.static.rglob("*.svg")), [])
        self.assertEqual(self.db.query(QuestionGroup).count(), 0)
        self.assertTrue((self.drafts / draft.draft_id).exists())

    def test_identical_imports_deduplicate_canonical_media(self):
        source = (FIXTURES / "clean_codes.svg").read_bytes()
        first = create_draft(source, root=self.drafts)
        second = create_draft(source, root=self.drafts)
        first_result = commit_draft(
            self.db,
            first.draft_id,
            name="First",
            draft_root=self.drafts,
            static_dir=self.static,
        )
        second_result = commit_draft(
            self.db,
            second.draft_id,
            name="Second",
            draft_root=self.drafts,
            static_dir=self.static,
        )
        self.assertEqual(
            first_result["group"]["media"], second_result["group"]["media"]
        )
        self.assertEqual(self.db.query(MediaFile).count(), 1)
        self.assertEqual(len(list(self.static.rglob("*.svg"))), 1)

    def test_assisted_selection_commits_verified_answers_and_aliases(self):
        draft = create_draft(
            (FIXTURES / "jetpunk_multilayer.svg").read_bytes(),
            root=self.drafts,
        )
        self.assertTrue(draft.selection_required)
        self.assertFalse(draft.can_commit)
        capitals = next(
            item for item in draft.interpretations
            if item.ontology == "country-capitals"
        )
        selected = draft_service.update_draft(
            draft.draft_id,
            selected_interpretation_id=capitals.id,
            selection_was_set=True,
            root=self.drafts,
        )
        self.assertFalse(selected.selection_required)
        self.assertTrue(selected.can_commit)
        self.assertTrue(
            (self.drafts / draft.draft_id / "analysis.json").is_file()
        )
        response = commit_draft(
            self.db,
            selected.draft_id,
            name="Capitales",
            draft_root=self.drafts,
            static_dir=self.static,
        )
        questions = self.db.query(Question).order_by(Question.id).all()
        self.assertEqual(response["group"]["named_zone_count"], 2)
        self.assertEqual(
            [(item.data["code"], item.answer) for item in questions],
            [("fr-c", "Paris"), ("de-c", "Berlin")],
        )
        self.assertTrue(all(item.question.endswith(item.answer) for item in questions))

    def test_blank_map_questions_are_excluded_from_training(self):
        group = QuestionGroup(type_group="map", name="Partial", media="map.svg")
        named = Question(
            type_q="map",
            question="Partial - A",
            answer="Alpha",
            data={"code": "A", "aliases": []},
            group=group,
        )
        blank = Question(
            type_q="map",
            question="Partial - B",
            answer=" ",
            data={"code": "B", "aliases": []},
            group=group,
        )
        self.db.add_all([group, named, blank])
        self.db.commit()

        items = get_training_items(
            self.db, scope_type="group", group_id=group.id
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(
            [item["code"] for item in items[0]["items"]], ["A"]
        )

    def test_known_194_of_252_upgrade_pattern_stays_progressively_playable(self):
        shapes = "".join(
            f'<rect data-code="Z{index:03d}" x="{index}" y="0" width="1" height="1"/>'
            for index in range(252)
        )
        source = (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 252 1">{shapes}</svg>'
        ).encode()
        group = QuestionGroup(
            type_group="map",
            name="World partial",
            media="/static/legacy-world.svg",
        )
        existing = [
            Question(
                type_q="map",
                question=f"World partial - Z{index:03d}",
                answer=f"Zone {index}",
                data={"code": f"Z{index:03d}", "aliases": []},
                group=group,
            )
            for index in range(194)
        ]
        self.db.add_all([group, *existing])
        self.db.commit()
        preserved_id = existing[0].id

        draft = create_draft(
            source, target_group_id=group.id, root=self.drafts
        )
        response = commit_draft(
            self.db,
            draft.draft_id,
            draft_root=self.drafts,
            static_dir=self.static,
        )
        questions = (
            self.db.query(Question)
            .filter(Question.group_id == group.id)
            .all()
        )
        self.assertEqual(response["group"]["question_count"], 252)
        self.assertEqual(response["group"]["named_zone_count"], 194)
        self.assertEqual(sum(not str(item.answer or "").strip() for item in questions), 58)
        self.assertEqual(existing[0].id, preserved_id)

        training = get_training_items(
            self.db, scope_type="group", group_id=group.id
        )
        self.assertEqual(
            sum(len(item.get("items", [])) for item in training), 194
        )

    def test_map_package_and_canonical_asset_round_trip_through_pack(self):
        draft = create_draft(
            (FIXTURES / "clean_codes.svg").read_bytes(),
            root=self.drafts,
        )
        committed = commit_draft(
            self.db,
            draft.draft_id,
            name="Pack map",
            draft_root=self.drafts,
            static_dir=self.static,
        )
        zip_path = export_pack(
            self.db,
            committed["group"]["id"],
            version=1,
            name="Pack map",
            static_dir=self.static,
            pack_dir=self.root / "packs",
        )

        target_engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(target_engine)
        target_db = sessionmaker(bind=target_engine)()
        target_static = self.root / "target-static"
        try:
            import_pack(target_db, zip_path, static_dir=target_static)
            imported = target_db.query(QuestionGroup).one()
            self.assertEqual(imported.data["map"]["schema_version"], 2)
            self.assertEqual(
                imported.data["map"]["asset_sha256"],
                committed["group"]["data"]["map"]["asset_sha256"],
            )
            imported_path = (
                target_static / imported.media.removeprefix("/static/")
            )
            self.assertTrue(imported_path.is_file())
            self.assertEqual(
                len(imported.data["map"]["zones"]),
                target_db.query(Question).count(),
            )
        finally:
            target_db.close()


class SvgMapImportApiTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.drafts = self.root / "drafts"
        self.static = self.root / "static"
        self.patches = [
            patch.object(draft_service, "MAP_IMPORT_DRAFT_DIR", self.drafts),
            patch.object(commit_service, "STATIC_DIR", self.static),
        ]
        for active_patch in self.patches:
            active_patch.start()

    def tearDown(self):
        for active_patch in reversed(self.patches):
            active_patch.stop()
        self.db.close()
        self.temp.cleanup()

    class Upload:
        def __init__(self, data):
            self.data = data

        async def read(self, size=-1):
            return self.data if size < 0 else self.data[:size]

    def test_upload_preview_patch_and_commit_flow(self):
        draft = asyncio.run(map_imports.upload_map_import(
            file=self.Upload((FIXTURES / "clean_codes.svg").read_bytes()),
            expected_zone_count=3,
            name="API map",
        ))
        self.assertTrue(draft["can_commit"])
        self.assertEqual(draft["summary"]["zone_count"], 3)
        self.assertEqual(self.db.query(QuestionGroup).count(), 0)

        preview = map_imports.get_map_import_preview(draft["draft_id"])
        self.assertIn(
            "default-src 'none'", preview.headers["content-security-policy"]
        )
        self.assertNotIn(b"data-code", Path(preview.path).read_bytes())

        mismatch = map_imports.patch_map_import(
            draft["draft_id"],
            MapImportPatchRequest(expected_zone_count=101),
        )
        self.assertFalse(mismatch["can_commit"])
        self.assertIn(
            "svg.expected_zone_count_mismatch",
            [item["code"] for item in mismatch["diagnostics"]],
        )
        corrected = map_imports.patch_map_import(
            draft["draft_id"],
            MapImportPatchRequest(expected_zone_count=None),
        )
        self.assertTrue(corrected["can_commit"])

        committed = map_imports.commit_map_import(
            draft["draft_id"],
            MapImportCommitRequest(name="API map"),
            self.db,
        )
        self.assertEqual(committed["group"]["question_count"], 3)
        self.assertEqual(self.db.query(QuestionGroup).count(), 1)
        self.assertEqual(self.db.query(Question).count(), 3)
        first_zone = committed["zones"][0]
        save_map_group_zones(
            self.db,
            committed["group"]["id"],
            MapZonesBulkUpdate(zones=[{
                "id": first_zone["id"],
                "code": first_zone["code"],
                "answer": "Alpha",
                "aliases": [],
            }]),
        )
        training = get_training_items(
            self.db,
            scope_type="group",
            group_id=committed["group"]["id"],
        )
        self.assertEqual(
            [item["code"] for item in training[0]["items"]], ["AA"]
        )
        reopened = next(
            group for group in get_groups(self.db)
            if group["id"] == committed["group"]["id"]
        )
        self.assertEqual(reopened["data"]["map"]["schema_version"], 2)
        replay = map_imports.commit_map_import(
            draft["draft_id"],
            MapImportCommitRequest(name="API map"),
            self.db,
        )
        self.assertTrue(replay["idempotent_replay"])
        self.assertEqual(self.db.query(QuestionGroup).count(), 1)
        with self.assertRaises(Exception):
            map_imports.get_map_import(draft["draft_id"])

    def test_assisted_draft_never_mutates_database(self):
        payload = asyncio.run(map_imports.upload_map_import(
            file=self.Upload((FIXTURES / "no_codes.svg").read_bytes()),
            expected_zone_count=None,
            name=None,
        ))
        self.assertEqual(payload["route"], "assisted")
        self.assertFalse(payload["can_commit"])
        self.assertEqual(self.db.query(QuestionGroup).count(), 0)
        cancelled = map_imports.cancel_map_import(payload["draft_id"])
        self.assertEqual(cancelled["status"], "cancelled")

    def test_multilayer_api_exposes_report_and_commits_selected_layer(self):
        payload = asyncio.run(map_imports.upload_map_import(
            file=self.Upload((FIXTURES / "jetpunk_multilayer.svg").read_bytes()),
            expected_zone_count=None,
            name="JetPunk",
            ontology="auto",
        ))
        self.assertEqual(payload["analysis_version"], 1)
        self.assertEqual(payload["route"], "assisted")
        self.assertTrue(payload["selection_required"])
        self.assertIsNone(payload["selected_interpretation_id"])
        self.assertEqual(len(payload["interpretations"]), 2)
        self.assertIsNotNone(payload["preview_manifest"])
        self.assertTrue((self.drafts / payload["draft_id"] / "analysis.json").is_file())

        capitals = next(
            item for item in payload["interpretations"]
            if item["ontology"] == "country-capitals"
        )
        selected = map_imports.patch_map_import(
            payload["draft_id"],
            MapImportPatchRequest(
                selected_interpretation_id=capitals["id"]
            ),
        )
        self.assertFalse(selected["selection_required"])
        self.assertTrue(selected["can_commit"])
        self.assertEqual(
            [zone["proposed_answer"] for zone in selected["zones"]],
            ["Paris", "Berlin"],
        )
        committed = map_imports.commit_map_import(
            payload["draft_id"],
            MapImportCommitRequest(name="JetPunk"),
            self.db,
        )
        self.assertEqual(committed["group"]["named_zone_count"], 2)

    def test_repair_api_lists_resumes_mutates_and_commits_local_draft(self):
        payload = asyncio.run(map_imports.upload_map_import(
            file=self.Upload((FIXTURES / "semantic_classes.svg").read_bytes()),
            expected_zone_count=2,
            name="Archipel",
            ontology="auto",
        ))
        self.assertEqual(payload["route"], "assisted")
        self.assertFalse(payload["repair_available"])
        listed = map_imports.get_map_imports()
        self.assertEqual(
            [item["draft_id"] for item in listed["drafts"]],
            [payload["draft_id"]],
        )

        interpretation = next(
            item for item in payload["interpretations"] if item["selectable"]
        )
        repair = map_imports.start_map_import_repair(
            payload["draft_id"],
            MapRepairInitializeRequest(
                interpretation_id=interpretation["id"]
            ),
        )
        self.assertEqual(repair["repair_version"], 1)
        self.assertEqual(repair["summary"]["zone_count"], 2)
        self.assertEqual(self.db.query(QuestionGroup).count(), 0)
        inspection = map_imports.get_map_import_inspection(payload["draft_id"])
        inspection_bytes = Path(inspection.path).read_bytes()
        self.assertIn(b"data-nemoris-draft-shape", inspection_bytes)
        self.assertNotIn(b"class=", inspection_bytes)

        shape_ref = repair["zones"][0]["shape_refs"][0]
        changed = map_imports.mutate_map_import_repair(
            payload["draft_id"],
            MapRepairActionRequest(
                base_revision=repair["revision"],
                action={
                    "type": "set_role",
                    "shape_refs": [shape_ref],
                    "role": "decoration",
                },
            ),
        )
        self.assertEqual(changed["revision"], repair["revision"] + 1)
        self.assertTrue(changed["can_undo"])
        with self.assertRaises(HTTPException) as stale:
            map_imports.mutate_map_import_repair(
                payload["draft_id"],
                MapRepairActionRequest(
                    base_revision=repair["revision"],
                    action={"type": "undo"},
                ),
            )
        self.assertEqual(stale.exception.status_code, 409)
        self.assertEqual(
            stale.exception.detail["current_revision"], changed["revision"]
        )

        restored = map_imports.mutate_map_import_repair(
            payload["draft_id"],
            MapRepairActionRequest(
                base_revision=changed["revision"],
                action={"type": "undo"},
            ),
        )
        self.assertTrue(restored["can_commit"])
        committed = map_imports.commit_map_import(
            payload["draft_id"],
            MapImportCommitRequest(name="Archipel"),
            self.db,
        )
        self.assertEqual(committed["group"]["question_count"], 2)
        self.assertEqual(self.db.query(Question).count(), 2)

    def test_repair_api_rejects_invalid_shape_reference_without_mutation(self):
        payload = asyncio.run(map_imports.upload_map_import(
            file=self.Upload((FIXTURES / "geometry_layer.svg").read_bytes()),
            expected_zone_count=3,
            name="Géométrie",
            ontology="auto",
        ))
        interpretation = payload["interpretations"][0]
        repair = map_imports.start_map_import_repair(
            payload["draft_id"],
            MapRepairInitializeRequest(
                interpretation_id=interpretation["id"]
            ),
        )
        with self.assertRaises(HTTPException) as invalid:
            map_imports.mutate_map_import_repair(
                payload["draft_id"],
                MapRepairActionRequest(
                    base_revision=repair["revision"],
                    action={
                        "type": "create_zone",
                        "shape_refs": ["p999999"],
                    },
                ),
            )
        self.assertEqual(invalid.exception.status_code, 422)
        current = map_imports.get_map_import_repair(payload["draft_id"])
        self.assertEqual(current["revision"], repair["revision"])


class SvgMapRemoteFetchTests(unittest.TestCase):
    def test_private_host_is_rejected(self):
        with patch.object(
            remote_service,
            "getaddrinfo",
            return_value=[(None, None, None, None, ("127.0.0.1", 80))],
        ):
            with self.assertRaises(HTTPException):
                remote_service.fetch_svg_url("http://example.test/map.svg")

    def test_redirect_target_is_revalidated_for_ssrf(self):
        class RedirectingOpener:
            def open(self, request, timeout):
                raise HTTPError(
                    request.full_url,
                    302,
                    "Found",
                    {"Location": "http://127.0.0.1/private.svg"},
                    None,
                )

        with (
            patch.object(
                remote_service,
                "getaddrinfo",
                side_effect=[
                    [(None, None, None, None, ("93.184.216.34", 443))],
                    [(None, None, None, None, ("127.0.0.1", 80))],
                ],
            ),
            patch.object(
                remote_service, "build_opener", return_value=RedirectingOpener()
            ),
        ):
            with self.assertRaises(HTTPException):
                remote_service.fetch_svg_url("https://example.test/map.svg")

    def test_jetpunk_forbidden_response_has_upload_guidance(self):
        class ForbiddenOpener:
            def open(self, request, timeout):
                raise HTTPError(
                    request.full_url, 403, "Forbidden", {}, None
                )

        with (
            patch.object(
                remote_service,
                "getaddrinfo",
                return_value=[
                    (None, None, None, None, ("104.18.0.1", 443))
                ],
            ),
            patch.object(
                remote_service, "build_opener", return_value=ForbiddenOpener()
            ),
        ):
            with self.assertRaises(HTTPException) as captured:
                remote_service.fetch_svg_url(
                    "https://www.jetpunk.com/img/jetpunk-svgs/world.svg"
                )
        self.assertEqual(
            captured.exception.detail["code"], "svg.jetpunk_fetch_blocked"
        )
