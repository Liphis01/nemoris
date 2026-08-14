"""
M1.5: a sequence group can derive its ranks by sorting on an attribute.

The manual path is the one that must not regress -- alphabets, IPA and military
ranks have no attribute to sort on and are the lists that actually need the chain
machinery from 1.2/1.3.
"""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Question, QuestionGroup
from app.schemas import (
    SequenceGroupItemBulkItem,
    SequenceGroupItemsBulkUpdate,
    SequenceGroupItemsGroupUpdate,
    SequenceOrderSettings
)
from app.services.sequence_groups import (
    list_sequence_group_items,
    save_sequence_group_items
)
from app.services.sequence_order import (
    derive_sequence_positions,
    merge_sequence_order,
    normalize_sequence_order,
    order_sort_value
)


def year(value):
    return {"year": value, "month": None, "day": None, "precision": "year"}


class OrderSettingsTests(unittest.TestCase):
    def test_absent_or_manual_means_no_setting(self):
        # Absent means manual, so every pre-existing group keeps working with
        # no migration and no backfill.
        self.assertIsNone(normalize_sequence_order(None))
        self.assertIsNone(normalize_sequence_order({}))
        self.assertIsNone(normalize_sequence_order({"mode": "manual"}))

    def test_a_derived_setting_defaults_to_dates(self):
        self.assertEqual(
            normalize_sequence_order({"mode": "derived"}),
            {"mode": "derived", "kind": "date"}
        )

    def test_an_unknown_kind_falls_back_rather_than_failing(self):
        self.assertEqual(
            normalize_sequence_order({"mode": "derived", "kind": "nonsense"})["kind"],
            "date"
        )

    def test_merging_preserves_the_rest_of_the_group_blob(self):
        # group.data also carries training_record / training_records; a
        # whole-dict replace here would destroy a learner's best times.
        merged = merge_sequence_order(
            {"training_record": {"best_time_ms": 1234}},
            {"mode": "derived", "kind": "number"}
        )

        self.assertEqual(merged["training_record"], {"best_time_ms": 1234})
        self.assertEqual(merged["order"]["kind"], "number")

    def test_going_back_to_manual_drops_the_key(self):
        merged = merge_sequence_order(
            {"order": {"mode": "derived", "kind": "date"}},
            {"mode": "manual"}
        )

        self.assertNotIn("order", merged)


class OrderSortValueTests(unittest.TestCase):
    def test_numbers_parse(self):
        self.assertEqual(order_sort_value(12, "number"), 12.0)
        self.assertEqual(order_sort_value("3.5", "number"), 3.5)

    def test_unusable_values_are_none_rather_than_errors(self):
        self.assertIsNone(order_sort_value(None, "number"))
        self.assertIsNone(order_sort_value("abc", "number"))
        self.assertIsNone(order_sort_value({"year": None}, "date"))

    def test_bc_years_sort_before_ad(self):
        self.assertLess(
            order_sort_value(year(-44), "date"),
            order_sort_value(year(1804), "date")
        )

    def test_mixed_precision_compares(self):
        # A reign known only to the year must still sort correctly against one
        # known to the day -- the reason dates reuse the timeline shape.
        self.assertLess(
            order_sort_value(year(1804), "date"),
            order_sort_value(
                {"year": 1815, "month": 6, "day": 18, "precision": "day"},
                "date"
            )
        )


class DerivePositionsTests(unittest.TestCase):
    def test_entries_are_ranked_by_their_attribute(self):
        positions = derive_sequence_positions(
            [("c", year(1799)), ("a", year(1610)), ("b", year(1715))],
            "date"
        )

        self.assertEqual(positions, {"a": 1, "b": 2, "c": 3})

    def test_missing_values_sort_last_and_keep_array_order(self):
        positions = derive_sequence_positions(
            [("a", None), ("b", year(1715)), ("c", None)],
            "date"
        )

        self.assertEqual(positions, {"b": 1, "a": 2, "c": 3})

    def test_ties_fall_back_to_array_order(self):
        positions = derive_sequence_positions(
            [("a", 5), ("b", 5), ("c", 1)],
            "number"
        )

        self.assertEqual(positions, {"c": 1, "a": 2, "b": 3})


class SequenceOrderSaveTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.group = QuestionGroup(type_group="sequence", name="Rois de France")
        self.db.add(self.group)
        self.db.flush()

    def tearDown(self):
        self.db.close()

    def save(self, entries, order=None):
        return save_sequence_group_items(
            self.db,
            self.group.id,
            SequenceGroupItemsBulkUpdate(
                group=SequenceGroupItemsGroupUpdate(
                    **({"order": SequenceOrderSettings(**order)} if order else {})
                ),
                items=[
                    SequenceGroupItemBulkItem(
                        answer=label,
                        data={"order_value": value} if value is not None else {}
                    )
                    for label, value in entries
                ],
                deleted_item_ids=[]
            )
        )

    def labels_in_rank_order(self):
        return [
            item["label"]
            for item in list_sequence_group_items(self.db, self.group.id)
        ]

    def test_a_derived_group_ranks_by_date_not_array_order(self):
        self.save(
            [
                ("Louis XVI", year(1774)),
                ("Henri IV", year(1589)),
                ("Louis XIV", year(1643))
            ],
            order={"mode": "derived", "kind": "date"}
        )

        self.assertEqual(
            self.labels_in_rank_order(),
            ["Henri IV", "Louis XIV", "Louis XVI"]
        )

    def test_a_derived_group_ranks_by_number(self):
        self.save(
            [("Troisième", 3), ("Premier", 1), ("Deuxième", 2)],
            order={"mode": "derived", "kind": "number"}
        )

        self.assertEqual(
            self.labels_in_rank_order(),
            ["Premier", "Deuxième", "Troisième"]
        )

    def test_a_manual_group_still_ranks_by_array_order(self):
        # The contract SequenceRankTests pins. Alphabets have no attribute to
        # sort on and must keep working exactly as before.
        self.save([("Alpha", None), ("Bêta", None), ("Gamma", None)])

        self.assertEqual(self.labels_in_rank_order(), ["Alpha", "Bêta", "Gamma"])

    def test_an_item_without_a_derived_value_blocks_save(self):
        with self.assertRaises(HTTPException) as context:
            self.save(
                [("Sans date", None), ("Henri IV", year(1589))],
                order={"mode": "derived", "kind": "date"}
            )

        self.assertEqual(context.exception.status_code, 422)
        self.assertIn("Valeur d'ordre manquante", context.exception.detail)

    def test_every_item_still_gets_an_integer_rank(self):
        # PATCH /questions/{id} rejects a sequence item without an integer
        # data.position, so derivation must still write one.
        self.save(
            [("Louis XVI", year(1774)), ("Henri IV", year(1589))],
            order={"mode": "derived", "kind": "date"}
        )
        positions = sorted(
            question.data["position"]
            for question in self.db.query(Question).all()
        )

        self.assertEqual(positions, [1, 2])

    def test_switching_to_derived_reranks_an_existing_manual_group(self):
        saved = self.save(
            [("Louis XVI", year(1774)), ("Henri IV", year(1589))]
        )

        self.assertEqual(self.labels_in_rank_order(), ["Louis XVI", "Henri IV"])

        ids = [item["id"] for item in saved["items"]]
        save_sequence_group_items(
            self.db,
            self.group.id,
            SequenceGroupItemsBulkUpdate(
                group=SequenceGroupItemsGroupUpdate(
                    order=SequenceOrderSettings(mode="derived", kind="date")
                ),
                items=[
                    SequenceGroupItemBulkItem(id=item_id, answer=label)
                    for item_id, label in zip(ids, ["Louis XVI", "Henri IV"])
                ],
                deleted_item_ids=[]
            )
        )

        # The attribute was never resent, so this also proves the stored
        # order_value is what gets sorted on.
        self.assertEqual(self.labels_in_rank_order(), ["Henri IV", "Louis XVI"])

    def test_the_order_setting_is_echoed_back_to_the_editor(self):
        saved = self.save(
            [("Henri IV", year(1589))],
            order={"mode": "derived", "kind": "date"}
        )

        self.assertEqual(saved["group"]["data"]["order"]["mode"], "derived")

    def test_review_goal_override_can_be_saved_and_returned_to_auto(self):
        self.group.data = {"training_record": {"best_time_ms": 1234}}
        self.db.commit()

        save_sequence_group_items(
            self.db,
            self.group.id,
            SequenceGroupItemsBulkUpdate(
                group=SequenceGroupItemsGroupUpdate(
                    review_goal="random_access"
                ),
                items=[],
                deleted_item_ids=[]
            )
        )
        self.assertEqual(self.group.data["review_goal"], "random_access")
        self.assertEqual(
            self.group.data["training_record"],
            {"best_time_ms": 1234}
        )

        save_sequence_group_items(
            self.db,
            self.group.id,
            SequenceGroupItemsBulkUpdate(
                group=SequenceGroupItemsGroupUpdate(review_goal="auto"),
                items=[],
                deleted_item_ids=[]
            )
        )
        self.assertNotIn("review_goal", self.group.data)


if __name__ == "__main__":
    unittest.main()
