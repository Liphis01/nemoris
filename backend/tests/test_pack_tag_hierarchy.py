import json
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import PackSubscription, Question, QuestionGroup
from app.services.packs import (
    PACK_FORMAT,
    SUPPORTED_PACK_FORMATS,
    export_pack,
    import_pack,
    update_pack
)
from app.services.tag_hierarchy import (
    apply_tag_actions,
    hierarchy_slice_for_tags,
    label_for_tag,
    load_tag_hierarchy,
    merge_pack_hierarchy,
    normalize_pack_hierarchy,
    parent_map,
    tag_inbox
)


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def tag_id():
    return str(uuid.uuid4())


def node(labels, parents=None, *, origin="pack", pack_ids=None):
    return {
        "labels": labels,
        "default_locale": next(iter(labels)),
        "parents": list(parents or []),
        "origin": origin,
        "pack_ids": list(pack_ids or []),
        "classification": "placed" if parents else "root"
    }


def hierarchy(nodes):
    return {
        "version": 3,
        "revision": 0,
        "nodes": nodes,
        "hidden_core_roots": [],
        "redirects": {},
        "legacy_ids": {},
        "seed": {"version": 1}
    }


class HierarchySliceV4Tests(unittest.TestCase):
    def test_exports_only_used_tags_and_their_ancestor_chain(self):
        linux = tag_id()
        computing = tag_id()
        unused = tag_id()
        source = hierarchy({
            "core:technology": node({"fr": "Technologie"}, origin="core"),
            linux: node({"fr": "Linux", "en": "Linux"}, [computing]),
            computing: node({"fr": "Informatique"}, ["core:technology"]),
            unused: node({"fr": "Inutilisé"}, ["core:technology"])
        })

        sliced = hierarchy_slice_for_tags(source, [linux])

        self.assertEqual(sliced["version"], 3)
        self.assertEqual(set(sliced["nodes"]), {linux, computing, "core:technology"})
        self.assertEqual(sliced["nodes"][linux]["labels"]["en"], "Linux")
        self.assertNotIn(unused, sliced["nodes"])

    def test_empty_pack_has_an_empty_slice(self):
        sliced = hierarchy_slice_for_tags(load_tag_hierarchy(make_db()), [])
        self.assertEqual(sliced["nodes"], {})


class LegacyPackIdentityTests(unittest.TestCase):
    def test_formats_one_through_four_remain_supported(self):
        self.assertEqual(PACK_FORMAT, 4)
        self.assertEqual(SUPPORTED_PACK_FORMATS, (1, 2, 3, 4))

    def test_legacy_identity_is_deterministic_per_pack(self):
        incoming = {
            "parents": {"linux": ["computing"]},
            "labels": {"linux": "Linux", "computing": "Computing"}
        }
        first, first_map = normalize_pack_hierarchy(
            incoming, "pack-a", tag_values=["linux"]
        )
        repeated, repeated_map = normalize_pack_hierarchy(
            incoming, "pack-a", legacy_map=first_map, tag_values=["linux"]
        )
        _other, other_map = normalize_pack_hierarchy(
            incoming, "pack-b", tag_values=["linux"]
        )

        self.assertEqual(first_map["linux"], repeated_map["linux"])
        self.assertIn(first_map["linux"], repeated["nodes"])
        self.assertNotEqual(first_map["linux"], other_map["linux"])

    def test_only_reserved_root_aliases_converge_across_legacy_packs(self):
        french, _ = normalize_pack_hierarchy(
            {"labels": {"Géographie": "Géographie"}},
            "pack-fr",
            tag_values=["Géographie"]
        )
        english, _ = normalize_pack_hierarchy(
            {"labels": {"geography": "Geography"}},
            "pack-en",
            tag_values=["geography"]
        )

        self.assertIn("core:geography", french["nodes"])
        self.assertIn("core:geography", english["nodes"])


class MergePackHierarchyV3Tests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()

    def tearDown(self):
        self.db.close()

    def test_unknown_custom_root_enters_inbox_but_placed_descendants_do_not(self):
        root = tag_id()
        child = tag_id()
        merged, pending, conflicts = merge_pack_hierarchy(
            self.db,
            hierarchy({
                root: node({"en": "My subject"}),
                child: node({"en": "A chapter"}, [root])
            }),
            pack_guid="pack-a"
        )

        self.assertEqual([entry["tag_id"] for entry in pending], [root])
        self.assertEqual(conflicts, [])
        self.assertEqual(merged["nodes"][child]["parents"], [root])
        self.assertIn("pack-a", merged["nodes"][root]["pack_ids"])

    def test_identical_labels_never_merge_distinct_custom_ids(self):
        first = tag_id()
        second = tag_id()
        merge_pack_hierarchy(
            self.db,
            hierarchy({first: node({"fr": "Capitales"})}),
            pack_guid="pack-a"
        )
        merged, pending, _ = merge_pack_hierarchy(
            self.db,
            hierarchy({second: node({"fr": "Capitales"})}),
            pack_guid="pack-b"
        )

        self.assertIn(first, merged["nodes"])
        self.assertIn(second, merged["nodes"])
        self.assertEqual([entry["tag_id"] for entry in pending], [second])

    def test_pack_can_add_a_missing_translation_to_a_reserved_root(self):
        merged, _, _ = merge_pack_hierarchy(
            self.db,
            hierarchy({
                "core:geography": node({"fr": "Géographie", "en": "Geography"}, origin="core")
            }),
            pack_guid="pack-en"
        )
        self.assertEqual(merged["nodes"]["core:geography"]["labels"]["en"], "Geography")

    def test_three_way_update_applies_untouched_fields_and_persists_conflicts(self):
        imported = tag_id()
        baseline = hierarchy({
            imported: node(
                {"fr": "Linux", "en": "Linux"},
                ["core:technology"]
            )
        })
        merge_pack_hierarchy(self.db, baseline, pack_guid="pack-a")
        current = load_tag_hierarchy(self.db)
        apply_tag_actions(self.db, current["revision"], [
            {"type": "set_label", "tag_id": imported, "locale": "fr", "label": "Mon Linux"},
            {"type": "set_parents", "tag_id": imported, "parent_ids": ["core:science"]}
        ])

        upstream = hierarchy({
            imported: node(
                {"fr": "GNU/Linux", "en": "Linux operating system"},
                ["core:nature"]
            )
        })
        merged, _pending, conflicts = merge_pack_hierarchy(
            self.db,
            upstream,
            pack_guid="pack-a",
            previous=baseline
        )

        self.assertEqual(merged["nodes"][imported]["labels"]["fr"], "Mon Linux")
        self.assertEqual(merged["nodes"][imported]["labels"]["en"], "Linux operating system")
        self.assertEqual(merged["nodes"][imported]["parents"], ["core:science"])
        self.assertEqual({entry["field"] for entry in conflicts}, {"label:fr", "parents"})

        # Once the subscription advances its baseline to this upstream slice,
        # the unchanged update does not produce the same conflict again.
        _merged, _pending, repeated = merge_pack_hierarchy(
            self.db,
            upstream,
            pack_guid="pack-a",
            previous=upstream
        )
        self.assertEqual(repeated, [])

    def test_removed_upstream_parent_is_applied_when_local_value_is_untouched(self):
        imported = tag_id()
        baseline = hierarchy({
            imported: node({"fr": "Linux"}, ["core:technology"])
        })
        merge_pack_hierarchy(self.db, baseline, pack_guid="pack-a")
        incoming = hierarchy({imported: node({"fr": "Linux"}, [])})

        merged, _pending, conflicts = merge_pack_hierarchy(
            self.db, incoming, pack_guid="pack-a", previous=baseline
        )

        self.assertEqual(merged["nodes"][imported]["parents"], [])
        self.assertEqual(conflicts, [])


class PackV4RoundTripTests(unittest.TestCase):
    def make_dir(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        return Path(temp.name)

    def test_v4_round_trip_preserves_id_labels_and_minimal_ancestry(self):
        source = make_db()
        custom = tag_id()
        hierarchy_ = load_tag_hierarchy(source)
        apply_tag_actions(source, hierarchy_["revision"], [
            {
                "type": "create",
                "tag_id": custom,
                "label": "Linux",
                "locale": "fr",
                "parent_ids": ["core:technology"]
            },
            {"type": "set_label", "tag_id": custom, "locale": "en", "label": "Linux"}
        ])
        group = QuestionGroup(type_group="text", name="Informatique", data={})
        source.add(group)
        source.flush()
        source.add(Question(
            type_q="text", question="Noyau ?", answer="Linux",
            tags=[custom], data={}, group_id=group.id
        ))
        source.commit()

        archive = export_pack(
            source,
            group.id,
            version=1,
            name="Informatique",
            static_dir=self.make_dir(),
            pack_dir=self.make_dir()
        )
        with ZipFile(archive) as zip_file:
            manifest = json.loads(zip_file.read("manifest.json"))
            content = json.loads(zip_file.read("content.json"))

        self.assertEqual(manifest["format"], 4)
        self.assertEqual(content["questions"][0]["tags"], [custom])
        self.assertEqual(set(manifest["tag_hierarchy"]["nodes"]), {custom, "core:technology"})
        self.assertEqual(manifest["tag_hierarchy"]["nodes"][custom]["labels"]["en"], "Linux")

        target = make_db()
        result = import_pack(target, archive, static_dir=self.make_dir())
        imported = target.query(Question).one()
        imported_hierarchy = load_tag_hierarchy(target)

        self.assertEqual(result["status"], "imported")
        self.assertEqual(result["unplaced_tag_roots"], [])
        self.assertEqual(imported.tags, [custom])
        self.assertEqual(label_for_tag(imported_hierarchy, custom, "en"), "Linux")
        self.assertEqual(parent_map(imported_hierarchy)[custom], ["core:technology"])

    def test_deferred_root_remains_in_persistent_inbox_with_pack_context(self):
        db = make_db()
        root = tag_id()
        merged, pending, _ = merge_pack_hierarchy(
            db,
            hierarchy({root: node({"fr": "Sujet importé"})}),
            pack_guid="pack-a"
        )
        db.add(PackSubscription(
            pack_guid="pack-a",
            installed_version=2,
            name="Mon pack",
            source="pack.zip",
            subscribed_at=datetime.now(timezone.utc).isoformat(),
            tag_hierarchy_base=hierarchy({root: node({"fr": "Sujet importé"})}),
            tag_pending=[{**pending[0], "status": "deferred"}],
            tag_conflicts=[],
            tag_legacy_map={}
        ))
        db.add(Question(
            type_q="text", question="Exemple", answer="Réponse",
            tags=[root], data={}, pack_guid="pack-a"
        ))
        db.commit()

        inbox = tag_inbox(db, merged)
        self.assertEqual(inbox["count"], 1)
        self.assertEqual(inbox["pending"][0]["pack_name"], "Mon pack")
        self.assertEqual(inbox["pending"][0]["pack_version"], 2)
        self.assertEqual(inbox["pending"][0]["question_count"], 1)
        self.assertEqual(inbox["pending"][0]["sample_questions"], ["Exemple"])

    def test_explicit_merge_survives_pack_update_without_false_fork(self):
        source = make_db()
        source_tag = tag_id()
        local_target = tag_id()
        source_hierarchy = load_tag_hierarchy(source)
        apply_tag_actions(source, source_hierarchy["revision"], [{
            "type": "create",
            "tag_id": source_tag,
            "label": "Capitals",
            "locale": "en",
            "parent_ids": ["core:geography"]
        }])
        group = QuestionGroup(type_group="text", name="Capitals", data={})
        source.add(group)
        source.flush()
        source_question = Question(
            type_q="text",
            question="Capital of France?",
            answer="Paris",
            tags=[source_tag],
            data={},
            group_id=group.id
        )
        source.add(source_question)
        source.commit()

        source_static = self.make_dir()
        archive_v1 = export_pack(
            source,
            group.id,
            version=1,
            name="Capitals",
            static_dir=source_static,
            pack_dir=self.make_dir()
        )
        target = make_db()
        target_static = self.make_dir()
        import_pack(target, archive_v1, static_dir=target_static)

        target_hierarchy = load_tag_hierarchy(target)
        apply_tag_actions(target, target_hierarchy["revision"], [
            {
                "type": "create",
                "tag_id": local_target,
                "label": "Capitales locales",
                "parent_ids": ["core:geography"]
            },
            {
                "type": "merge",
                "tag_id": source_tag,
                "target_id": local_target
            }
        ])
        target.commit()
        imported = target.query(Question).one()
        self.assertEqual(imported.tags, [local_target])

        source_question.question = "Quelle est la capitale de la France ?"
        source.commit()
        archive_v2 = export_pack(
            source,
            group.id,
            version=2,
            name="Capitals",
            static_dir=source_static,
            pack_dir=self.make_dir()
        )
        result = update_pack(target, archive_v2, static_dir=target_static)
        target.refresh(imported)

        self.assertEqual(result["forked"], [])
        self.assertEqual(result["updated"], [source_question.guid])
        self.assertEqual(imported.question, "Quelle est la capitale de la France ?")
        self.assertEqual(imported.tags, [local_target])
        subscription = target.query(PackSubscription).one()
        self.assertIn(local_target, subscription.tag_hierarchy_base["nodes"])
        self.assertNotIn(source_tag, subscription.tag_hierarchy_base["nodes"])


if __name__ == "__main__":
    unittest.main()
