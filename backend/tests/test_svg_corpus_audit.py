import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import audit_svg_corpus as audit


FIXTURES = Path(__file__).parent / "fixtures" / "map_import"


class SvgCorpusManifestTests(unittest.TestCase):
    def test_real_world_manifest_is_diverse_licensed_and_content_pinned(self):
        cases = audit._read_manifest(FIXTURES / "real-world-corpus.json")
        baseline = json.loads(
            (FIXTURES / "real-world-audit-baseline.json").read_text()
        )

        self.assertGreaterEqual(len(cases), 30)
        self.assertGreaterEqual(
            len({case["category"] for case in cases}), 3
        )
        self.assertTrue(
            {"automatic", "selectable", "manual"}.issubset({
                case["target_workflow"] for case in cases
            })
        )
        self.assertEqual(len(cases), len({case["id"] for case in cases}))
        for case in cases:
            self.assertRegex(case["sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(case["license"])
            self.assertTrue(case["source_url"].startswith("https://"))
            self.assertTrue(case["download_url"].startswith("https://"))
        baseline_by_id = {
            case["identity"]: case for case in baseline["cases"]
        }
        self.assertEqual(
            {case["id"] for case in cases}, set(baseline_by_id)
        )
        for case in cases:
            self.assertEqual(
                case["sha256"], baseline_by_id[case["id"]]["sha256"]
            )

    def test_manifest_rejects_unpinned_or_duplicate_cases(self):
        case = {
            "id": "example",
            "source_kind": "test",
            "category": "test",
            "source_url": "https://example.test/source",
            "download_url": "https://example.test/map.svg",
            "license": "CC0-1.0",
            "target_workflow": "automatic",
            "target_zone_count": 2,
            "expected_ontology": "generic",
        }
        with tempfile.TemporaryDirectory() as raw_directory:
            manifest = Path(raw_directory) / "manifest.json"
            manifest.write_text(json.dumps({
                "format": "nemoris-svg-real-world-corpus-v1",
                "cases": [case],
            }))
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                audit._read_manifest(manifest)

            case["sha256"] = "a" * 64
            manifest.write_text(json.dumps({
                "format": "nemoris-svg-real-world-corpus-v1",
                "cases": [case, case],
            }))
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                audit._read_manifest(manifest)


class SvgCorpusAuditTests(unittest.TestCase):
    def test_inventory_measures_target_and_canonical_safety(self):
        source = (FIXTURES / "dimensions_without_viewbox.svg").read_bytes()
        record = audit._inventory(source, "dimensions", {
            "sha256": (
                "c57ce8ae6644bc78e849ace72880fb1ba"
                "4dff76d7694c1655400eb10c408a580"
            ),
            "target_workflow": "automatic",
            "target_zone_count": 2,
            "expected_ontology": "generic",
        })

        self.assertEqual(record["route"], "automatic")
        self.assertTrue(record["source_hash_match"])
        self.assertTrue(record["target"]["pass"])
        self.assertTrue(record["canonical_checks"]["safety_pass"])
        self.assertTrue(record["canonical_checks"]["scalable_viewbox"])
        self.assertEqual(
            record["canonical_checks"]["shape_annotation_count"], 2
        )
        self.assertTrue(record["repairability"]["available"])
        self.assertEqual(
            record["repairability"]["interpretations"][0][
                "required_unresolved_count"
            ],
            0,
        )

    def test_audit_records_bulk_repair_action_estimates(self):
        source = (FIXTURES / "simplemaps_duplicate_labels.svg").read_bytes()
        record = audit._inventory(source, "duplicate-points")
        candidate = record["repairability"]["interpretations"][0]

        self.assertEqual(candidate["zone_count"], 2)
        self.assertEqual(candidate["required_unresolved_count"], 2)
        self.assertEqual(candidate["suggested_bulk_action_count"], 1)
        self.assertIn("repair.required_unresolved", candidate["blocker_codes"])

    def test_parser_failure_is_a_complete_audit_record(self):
        source = (FIXTURES / "malicious.svg").read_bytes()
        record = audit._inventory(source, "malicious", {
            "sha256": (
                "5c91704a1cb66836ba7acd90df4123265"
                "b21997b5350729ce017cb7f7ca16562"
            ),
            "target_workflow": "parser_failure",
        })

        self.assertIsNotNone(record["parse_error"])
        self.assertTrue(record["source_hash_match"])
        self.assertTrue(record["target"]["pass"])
        self.assertIn("processing_ms", record)

    def test_soft_deadline_is_retried_once_for_stable_corpus_results(self):
        source = (FIXTURES / "generic_ids.svg").read_bytes()
        real_analyze = audit.analyze_svg
        calls = 0

        def flaky_analyze(payload):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise audit.CanonicalizationError(
                    "svg.processing_deadline",
                    "transient test deadline",
                    status_code=408,
                )
            return real_analyze(payload)

        with patch.object(audit, "analyze_svg", side_effect=flaky_analyze):
            record = audit._inventory(source, "retry")

        self.assertEqual(calls, 2)
        self.assertEqual(record["analysis_retry_count"], 1)
        self.assertEqual(record["route"], "automatic")

    def test_semantic_baseline_ignores_timing_and_cache_origin(self):
        source = (FIXTURES / "generic_ids.svg").read_bytes()
        first = audit._inventory(source, "generic")
        second = dict(first)
        second["processing_ms"] = first["processing_ms"] + 1000
        second["cache_origin"] = "network"

        self.assertEqual(
            audit._baseline_projection(first),
            audit._baseline_projection(second),
        )

        second["route"] = "manual"
        self.assertNotEqual(
            audit._baseline_projection(first),
            audit._baseline_projection(second),
        )

        with tempfile.TemporaryDirectory() as raw_directory:
            baseline = Path(raw_directory) / "baseline.json"
            baseline.write_text(json.dumps(
                audit._baseline_document([first])
            ))
            missing = audit._apply_baseline([first], baseline)

        self.assertEqual(missing, [])
        self.assertEqual(first["baseline_status"], "match")

    def test_offline_manifest_cache_never_uses_the_network(self):
        source = (FIXTURES / "generic_ids.svg").read_bytes()
        digest = hashlib.sha256(source).hexdigest()
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            cache = directory / "cache"
            cache.mkdir()
            (cache / "cached-case.svg").write_bytes(source)
            manifest = directory / "manifest.json"
            manifest.write_text(json.dumps({
                "format": "nemoris-svg-real-world-corpus-v1",
                "cases": [{
                    "id": "cached-case",
                    "sha256": digest,
                    "source_kind": "test",
                    "category": "test",
                    "source_url": "https://example.test/source",
                    "download_url": "https://example.test/map.svg",
                    "license": "CC0-1.0",
                    "target_workflow": "automatic",
                    "target_zone_count": 2,
                    "expected_ontology": "generic",
                }],
            }))

            records = list(audit._manifest_sources(
                manifest,
                cache_directory=cache,
                offline=True,
            ))

        self.assertEqual(len(records), 1)
        identity, cached_source, error, metadata, origin = records[0]
        self.assertEqual(identity, "cached-case")
        self.assertEqual(cached_source, source)
        self.assertIsNone(error)
        self.assertEqual(metadata["sha256"], digest)
        self.assertEqual(origin, "cache")


if __name__ == "__main__":
    unittest.main()
