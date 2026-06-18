import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services.tag_hierarchy import (
    ancestors,
    descendants,
    load_tag_hierarchy,
    normalize_tag_hierarchy,
    parent_map,
    save_tag_hierarchy
)


class TagHierarchyNormalizeTests(unittest.TestCase):
    def test_normalizes_keys_and_keeps_labels(self):
        result = normalize_tag_hierarchy({
            "parents": {" Paris ": ["France"]},
            "labels": {"Paris": "Paris", "FRANCE": "France"}
        })

        self.assertEqual(result["parents"], {"paris": ["france"]})
        self.assertEqual(result["labels"]["paris"], "Paris")
        self.assertEqual(result["labels"]["france"], "France")

    def test_supports_multiple_parents(self):
        result = normalize_tag_hierarchy({
            "parents": {"paris": ["france", "capitals"]}
        })

        self.assertEqual(set(result["parents"]["paris"]), {"france", "capitals"})

    def test_backward_compatible_with_single_string_parent(self):
        result = normalize_tag_hierarchy({"parents": {"paris": "france"}})

        self.assertEqual(result["parents"], {"paris": ["france"]})

    def test_drops_self_parent(self):
        result = normalize_tag_hierarchy({"parents": {"paris": ["paris"]}})

        self.assertEqual(result["parents"], {})

    def test_rejects_cycles(self):
        result = normalize_tag_hierarchy({
            "parents": {
                "paris": ["france"],
                "france": ["europe"],
                "europe": ["paris"]
            }
        })

        pmap = result["parents"]
        self.assertEqual(pmap.get("paris"), ["france"])
        self.assertEqual(pmap.get("france"), ["europe"])
        self.assertNotIn("europe", pmap)

    def test_validates_positions(self):
        result = normalize_tag_hierarchy({
            "positions": {
                "Paris": {"x": 10, "y": 20.5},
                "bad": {"x": "nope"},
                "missing": {"x": 1}
            }
        })

        self.assertEqual(result["positions"], {"paris": {"x": 10.0, "y": 20.5}})


class TagHierarchyTraversalTests(unittest.TestCase):
    def setUp(self):
        # Diamond DAG: paris has two parents that share an ancestor.
        self.pmap = {
            "paris": ["france", "capitals"],
            "france": ["europe"],
            "capitals": ["geography"],
            "europe": ["geography"]
        }

    def test_descendants_includes_self_and_all_below(self):
        self.assertEqual(
            descendants("geography", self.pmap),
            {"geography", "europe", "capitals", "france", "paris"}
        )

    def test_descendants_via_distinct_parents(self):
        self.assertEqual(descendants("capitals", self.pmap), {"capitals", "paris"})
        self.assertEqual(descendants("france", self.pmap), {"france", "paris"})

    def test_descendants_of_leaf_is_just_itself(self):
        self.assertEqual(descendants("paris", self.pmap), {"paris"})

    def test_ancestors_walk_all_paths_and_dedupe(self):
        self.assertEqual(
            ancestors("paris", self.pmap),
            {"paris", "france", "capitals", "europe", "geography"}
        )


class TagHierarchyPersistenceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def test_save_and_load_round_trip(self):
        save_tag_hierarchy(self.db, {
            "parents": {"Paris": ["France", "Capitals"], "France": ["Europe"]},
            "labels": {"Paris": "Paris"},
            "positions": {"Paris": {"x": 5, "y": 6}}
        })
        self.db.commit()

        loaded = load_tag_hierarchy(self.db)
        pmap = parent_map(loaded)

        self.assertEqual(set(pmap["paris"]), {"france", "capitals"})
        self.assertEqual(pmap["france"], ["europe"])
        self.assertEqual(loaded["labels"]["paris"], "Paris")
        self.assertEqual(loaded["positions"]["paris"], {"x": 5.0, "y": 6.0})

    def test_load_creates_default_when_missing(self):
        loaded = load_tag_hierarchy(self.db)

        self.assertEqual(loaded, {"parents": {}, "labels": {}, "positions": {}})


if __name__ == "__main__":
    unittest.main()
