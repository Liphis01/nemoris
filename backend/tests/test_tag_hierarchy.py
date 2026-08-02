import unittest
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Question
from app.services.tag_hierarchy import (
    CORE_ROOT_IDS,
    TagRevisionConflict,
    TagValidationError,
    ancestors,
    apply_tag_actions,
    descendants,
    ensure_stored_tag_ids,
    ensure_tag_ids,
    label_for_node,
    load_tag_hierarchy,
    normalize_tag_hierarchy,
    parent_map,
    resolve_tag_id,
    tag_snapshot
)


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def custom_id():
    return str(uuid.uuid4())


class TagHierarchyV3Tests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()

    def tearDown(self):
        self.db.close()

    def apply(self, actions, revision=None):
        hierarchy = load_tag_hierarchy(self.db)
        return apply_tag_actions(
            self.db,
            hierarchy["revision"] if revision is None else revision,
            actions
        )

    def add_question(self, question_id, tags):
        question = Question(
            id=question_id,
            type_q="text",
            question=f"Question {question_id}",
            answer="Réponse",
            tags=tags,
            data={}
        )
        self.db.add(question)
        self.db.flush()
        return question

    def test_default_contains_only_the_seventeen_reserved_roots(self):
        hierarchy = load_tag_hierarchy(self.db)

        self.assertEqual(hierarchy["version"], 3)
        self.assertEqual(set(hierarchy["nodes"]), set(CORE_ROOT_IDS))
        self.assertEqual(len(CORE_ROOT_IDS), 17)
        self.assertEqual(resolve_tag_id(hierarchy, "Géographie"), "core:geography")
        self.assertEqual(resolve_tag_id(hierarchy, "geographie"), "core:geography")

    def test_custom_tag_identity_is_an_opaque_uuid(self):
        tag_id = custom_id()
        hierarchy, created = self.apply([{
            "type": "create",
            "tag_id": tag_id,
            "label": "Linux",
            "locale": "fr",
            "parent_ids": ["core:technology"]
        }])

        self.assertEqual(created, [tag_id])
        self.assertEqual(uuid.UUID(tag_id).version, 4)
        self.assertEqual(hierarchy["nodes"][tag_id]["labels"], {"fr": "Linux"})
        self.assertEqual(hierarchy["nodes"][tag_id]["parents"], ["core:technology"])
        self.assertEqual(hierarchy["nodes"][tag_id]["classification"], "placed")

    def test_parentless_create_defaults_unplaced_unless_root_is_explicit(self):
        unplaced = custom_id()
        root = custom_id()
        hierarchy, _ = self.apply([
            {"type": "create", "tag_id": unplaced, "label": "Shrek"},
            {
                "type": "create",
                "tag_id": root,
                "label": "Cuisine",
                "classification": "root"
            }
        ])

        self.assertEqual(hierarchy["nodes"][unplaced]["parents"], [])
        self.assertEqual(hierarchy["nodes"][unplaced]["classification"], "unplaced")
        self.assertEqual(hierarchy["nodes"][root]["parents"], [])
        self.assertEqual(hierarchy["nodes"][root]["classification"], "root")

    def test_creation_locale_becomes_the_default_fallback_locale(self):
        tag_id = custom_id()
        hierarchy, _ = self.apply([{
            "type": "create",
            "tag_id": tag_id,
            "label": "Computing",
            "locale": "en",
            "parent_ids": ["core:technology"]
        }])

        self.assertEqual(hierarchy["nodes"][tag_id]["default_locale"], "en")
        self.assertEqual(label_for_node(hierarchy["nodes"][tag_id], "ja"), "Computing")

    def test_renaming_and_translating_never_change_identity(self):
        tag_id = custom_id()
        self.apply([{"type": "create", "tag_id": tag_id, "label": "Allemagne"}])
        hierarchy, _ = self.apply([
            {"type": "set_label", "tag_id": tag_id, "locale": "fr", "label": "République fédérale d’Allemagne"},
            {"type": "set_label", "tag_id": tag_id, "locale": "de", "label": "Deutschland"}
        ])

        self.assertIn(tag_id, hierarchy["nodes"])
        self.assertEqual(hierarchy["nodes"][tag_id]["labels"]["de"], "Deutschland")
        self.assertEqual(label_for_node(hierarchy["nodes"][tag_id], "de-AT"), "Deutschland")
        self.assertEqual(label_for_node(hierarchy["nodes"][tag_id], "it"), "République fédérale d’Allemagne")

    def test_write_path_accepts_ids_and_redirects_but_rejects_unknown_labels(self):
        source_id = custom_id()
        target_id = custom_id()
        self.apply([
            {"type": "create", "tag_id": source_id, "label": "GNU Linux"},
            {"type": "create", "tag_id": target_id, "label": "Linux"},
            {"type": "merge", "tag_id": source_id, "target_id": target_id}
        ])

        self.assertEqual(ensure_tag_ids(self.db, [source_id, target_id]), [target_id])
        with self.assertRaises(TagValidationError):
            ensure_tag_ids(self.db, ["Linux"])
        with self.assertRaises(TagValidationError):
            ensure_tag_ids(self.db, [custom_id()])

    def test_core_roots_cannot_be_reparented_deleted_or_merged(self):
        for action in [
            {"type": "set_parents", "tag_id": "core:geography", "parent_ids": ["core:science"]},
            {"type": "delete", "tag_id": "core:geography"},
            {"type": "merge", "tag_id": "core:geography", "target_id": "core:science"}
        ]:
            with self.assertRaises(TagValidationError):
                self.apply([action])
            self.db.rollback()

    def test_missing_parent_self_parent_and_cycles_are_explicit_errors(self):
        first = custom_id()
        second = custom_id()
        self.apply([
            {"type": "create", "tag_id": first, "label": "Premier"},
            {"type": "create", "tag_id": second, "label": "Second", "parent_ids": [first]}
        ])

        invalid_actions = [
            {"type": "set_parents", "tag_id": first, "parent_ids": [custom_id()]},
            {"type": "set_parents", "tag_id": first, "parent_ids": [first]},
            {"type": "set_parents", "tag_id": first, "parent_ids": [second]}
        ]
        for action in invalid_actions:
            with self.assertRaises(TagValidationError):
                self.apply([action])
            self.db.rollback()

    def test_revision_conflict_rejects_stale_actions(self):
        revision = load_tag_hierarchy(self.db)["revision"]
        self.apply([{"type": "create", "tag_id": custom_id(), "label": "Un"}], revision)

        with self.assertRaises(TagRevisionConflict):
            self.apply([{"type": "create", "tag_id": custom_id(), "label": "Deux"}], revision)

    def test_multi_parent_traversal_and_direct_rolled_counts(self):
        europe = custom_id()
        capitals = custom_id()
        paris = custom_id()
        self.apply([
            {"type": "create", "tag_id": europe, "label": "Europe", "parent_ids": ["core:geography"]},
            {"type": "create", "tag_id": capitals, "label": "Capitales", "parent_ids": ["core:geography"]},
            {"type": "create", "tag_id": paris, "label": "Paris", "parent_ids": [europe, capitals]}
        ])
        self.add_question(1, [paris])
        self.add_question(2, [europe])

        snapshot = tag_snapshot(self.db)
        by_id = {entry["id"]: entry for entry in snapshot["nodes"]}
        self.assertEqual(by_id[paris]["direct_count"], 1)
        self.assertEqual(by_id[europe]["direct_count"], 1)
        self.assertEqual(by_id[europe]["total_count"], 2)
        self.assertEqual(by_id["core:geography"]["total_count"], 2)
        self.assertIn(paris, descendants("core:geography", parent_map(load_tag_hierarchy(self.db))))
        self.assertEqual(ancestors(paris, parent_map(load_tag_hierarchy(self.db))), {paris, europe, capitals, "core:geography"})

    def test_unfiling_and_removing_assignments_are_separate(self):
        tag_id = custom_id()
        child_id = custom_id()
        self.apply([
            {"type": "create", "tag_id": tag_id, "label": "Parent", "parent_ids": ["core:science"]},
            {"type": "create", "tag_id": child_id, "label": "Enfant", "parent_ids": [tag_id]}
        ])
        question = self.add_question(1, [tag_id])

        hierarchy, _ = self.apply([{"type": "unfile", "tag_id": tag_id}])
        self.assertEqual(hierarchy["nodes"][tag_id]["parents"], [])
        self.assertEqual(hierarchy["nodes"][tag_id]["classification"], "unplaced")
        self.assertEqual(hierarchy["nodes"][child_id]["parents"], [tag_id])
        self.assertEqual(question.tags, [tag_id])

        self.apply([{"type": "remove_assignments", "tag_id": tag_id}])
        self.assertEqual(question.tags, [])
        with self.assertRaises(TagValidationError):
            self.apply([{"type": "delete", "tag_id": tag_id}])

    def test_unused_unfiled_leaf_can_be_deleted(self):
        tag_id = custom_id()
        self.apply([{"type": "create", "tag_id": tag_id, "label": "Jetable"}])
        hierarchy, _ = self.apply([{"type": "delete", "tag_id": tag_id}])
        self.assertNotIn(tag_id, hierarchy["nodes"])

    def test_accept_root_is_the_explicit_parentless_root_action(self):
        tag_id = custom_id()
        hierarchy, _ = self.apply([{"type": "create", "tag_id": tag_id, "label": "Cuisine"}])
        self.assertEqual(hierarchy["nodes"][tag_id]["classification"], "unplaced")

        hierarchy, _ = self.apply([{"type": "accept_root", "tag_id": tag_id}])
        self.assertEqual(hierarchy["nodes"][tag_id]["parents"], [])
        self.assertEqual(hierarchy["nodes"][tag_id]["classification"], "root")

        hierarchy, _ = self.apply([{"type": "set_parents", "tag_id": tag_id, "parent_ids": []}])
        self.assertEqual(hierarchy["nodes"][tag_id]["classification"], "unplaced")

    def test_normalizer_preserves_explicit_roots_but_does_not_promote_parentless_custom_tags(self):
        unplaced = custom_id()
        root = custom_id()
        migrated = custom_id()
        hierarchy = normalize_tag_hierarchy({
            "version": 3,
            "revision": 1,
            "nodes": {
                unplaced: {"labels": {"fr": "Shrek"}, "parents": []},
                root: {"labels": {"fr": "Cuisine"}, "parents": [], "classification": "root"},
                migrated: {
                    "labels": {"fr": "Tintin"},
                    "parents": [],
                    "classification": "root",
                    "origin": "migration"
                }
            },
            "hidden_core_roots": [],
            "redirects": {},
            "legacy_ids": {}
        })

        self.assertEqual(hierarchy["nodes"][unplaced]["classification"], "unplaced")
        self.assertEqual(hierarchy["nodes"][root]["classification"], "root")
        self.assertEqual(hierarchy["nodes"][migrated]["classification"], "unplaced")

    def test_merge_rewrites_questions_edges_translations_and_redirect(self):
        source = custom_id()
        target = custom_id()
        child = custom_id()
        self.apply([
            {"type": "create", "tag_id": source, "label": "Chats", "parent_ids": ["core:nature"]},
            {"type": "set_label", "tag_id": source, "locale": "en", "label": "Cats"},
            {"type": "create", "tag_id": target, "label": "Félins"},
            {"type": "create", "tag_id": child, "label": "Siamois", "parent_ids": [source]}
        ])
        question = self.add_question(1, [source, target, source])

        hierarchy, _ = self.apply([{"type": "merge", "tag_id": source, "target_id": target}])

        self.assertEqual(question.tags, [target])
        self.assertEqual(hierarchy["redirects"][source], target)
        self.assertEqual(hierarchy["nodes"][child]["parents"], [target])
        self.assertEqual(hierarchy["nodes"][target]["labels"]["en"], "Cats")

    def test_unused_core_root_can_be_hidden_but_used_root_cannot(self):
        hierarchy, _ = self.apply([{"type": "hide_root", "tag_id": "core:art", "hidden": True}])
        self.assertIn("core:art", hierarchy["hidden_core_roots"])

        child = custom_id()
        self.apply([{"type": "create", "tag_id": child, "label": "Peinture", "parent_ids": ["core:art"]}])
        self.add_question(1, [child])
        with self.assertRaises(TagValidationError):
            self.apply([{"type": "hide_root", "tag_id": "core:art", "hidden": True}])

    def test_snapshot_uses_explicit_localized_objects_and_no_raw_uuid_fallback(self):
        tag_id = custom_id()
        self.apply([{"type": "create", "tag_id": tag_id, "label": "Cartes"}])
        self.add_question(1, [tag_id])

        entry = next(item for item in tag_snapshot(self.db)["nodes"] if item["id"] == tag_id)
        self.assertEqual(entry["label"], "Cartes")
        self.assertEqual(entry["labels"], {"fr": "Cartes"})
        self.assertEqual(entry["parents"], [])
        self.assertEqual(entry["kind"], "custom")
        self.assertEqual(entry["classification"], "unplaced")
        self.assertEqual(entry["representative_questions"][0]["question"], "Question 1")

    def test_legacy_text_bridge_converts_only_unresolved_rows_and_is_idempotent(self):
        question = self.add_question(1, ["Géographie", "Sujet local"])

        self.assertTrue(ensure_stored_tag_ids(self.db))
        first_tags = list(question.tags)
        first_revision = load_tag_hierarchy(self.db)["revision"]

        self.assertEqual(first_tags[0], "core:geography")
        self.assertEqual(str(uuid.UUID(first_tags[1])), first_tags[1])
        self.assertFalse(ensure_stored_tag_ids(self.db))
        self.assertEqual(question.tags, first_tags)
        self.assertEqual(load_tag_hierarchy(self.db)["revision"], first_revision)


class TraversalTests(unittest.TestCase):
    def test_diamond_dag_walks_every_path_once(self):
        pmap = {
            "paris": ["france", "capitals"],
            "france": ["europe"],
            "capitals": ["geography"],
            "europe": ["geography"]
        }
        self.assertEqual(descendants("geography", pmap), {"geography", "europe", "capitals", "france", "paris"})
        self.assertEqual(ancestors("paris", pmap), {"paris", "france", "capitals", "europe", "geography"})

    def test_normalizer_drops_cycle_edges_from_legacy_documents(self):
        hierarchy = normalize_tag_hierarchy({
            "parents": {"a": ["b"], "b": ["c"], "c": ["a"]},
            "labels": {"a": "A", "b": "B", "c": "C"}
        })
        pmap = parent_map(hierarchy)
        self.assertLessEqual(sum(len(values) for values in pmap.values()), 2)


if __name__ == "__main__":
    unittest.main()
