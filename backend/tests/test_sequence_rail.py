"""
M1 1.2: the rail is the single home for "what does the learner see".

The invariants ported here previously lived on the `anchors` list. They are the
load-bearing part of the feature: an unstarted item revealed once is a card
taught before its first review, and there is no way to undo that.
"""

import random
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup
from app.services.sequence import dense_positions
from app.services.sequence_rail import (
    SLOT_ANCHOR,
    SLOT_BLANK,
    SLOT_DECOY,
    SLOT_HIDDEN,
    build_rail,
    build_recitation_presentations,
    rail_graded_ids,
    rail_true_order,
    rail_window_for
)


class RailTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.group = QuestionGroup(type_group="sequence", name="Alphabet grec")
        self.db.add(self.group)
        self.db.flush()
        self.questions = []

    def tearDown(self):
        self.db.close()

    def add(self, answer, position, started=True):
        question = Question(
            type_q="sequence",
            question=answer,
            answer=answer,
            tags=[],
            data={"position": position},
            group=self.group
        )

        if started:
            question.progress = Progress(
                reps=2,
                stability=1.0,
                difficulty=5.0,
                lapses=0,
                interval=1,
                next_review=date.today(),
                history=[]
            )

        self.db.add(question)
        self.db.flush()
        self.questions.append(question)

        return question

    def rail(self, due_ids, chunk_due_ids=None, **kwargs):
        positions = dense_positions(self.questions)

        return build_rail(
            self.questions,
            positions,
            due_ids,
            chunk_due_ids=chunk_due_ids,
            **kwargs
        )

    def kinds(self, rail):
        return [slot["kind"] for slot in rail]

    def labels(self, rail):
        return {slot.get("label") for slot in rail if slot.get("label")}


class RailVisibilityTests(RailTestCase):
    def test_an_unstarted_item_is_never_labelled(self):
        # Ported from test_anchors_are_started_peers_only_and_hide_new_items.
        # The single most important invariant in the feature.
        alpha = self.add("Alpha", 1)
        self.add("Beta", 2)
        self.add("Gamma", 3, started=False)

        rail = self.rail({alpha.id})

        self.assertEqual(self.kinds(rail), [SLOT_BLANK, SLOT_ANCHOR, SLOT_HIDDEN])
        self.assertNotIn("Gamma", self.labels(rail))

    def test_a_due_item_from_another_chunk_is_never_labelled(self):
        # Ported from test_chunked_lists_do_not_leak_the_other_chunks_due_items.
        # The decoy/anchor pool must key off the GROUP's due set: an item due
        # later this session is an answer the learner still owes.
        alpha = self.add("Alpha", 1)
        beta = self.add("Beta", 2)
        self.add("Gamma", 3)

        rail = self.rail({alpha.id, beta.id}, chunk_due_ids={alpha.id})

        self.assertEqual(self.kinds(rail), [SLOT_BLANK, SLOT_HIDDEN, SLOT_ANCHOR])
        self.assertNotIn("Beta", self.labels(rail))

    def test_a_blank_never_carries_its_own_label(self):
        # The structural replacement for the has_adjacent_due_positions guard.
        # next_in_sequence needed that filter because it PRINTED a predecessor's
        # label as a prompt; the rail prints no blank's label, so two adjacent
        # blanks are merely harder rather than leaky.
        alpha = self.add("Alpha", 1)
        beta = self.add("Beta", 2)
        self.add("Gamma", 3)

        rail = self.rail({alpha.id, beta.id})

        self.assertEqual(self.kinds(rail), [SLOT_BLANK, SLOT_BLANK, SLOT_ANCHOR])
        self.assertEqual(self.labels(rail), {"Gamma"})

    def test_every_slot_is_blank_when_the_whole_list_is_due(self):
        ids = {self.add(label, index + 1).id for index, label in enumerate("ABC")}

        rail = self.rail(ids)

        self.assertEqual(self.kinds(rail), [SLOT_BLANK] * 3)
        self.assertEqual(self.labels(rail), set())


class RailDecoyTests(RailTestCase):
    def setUp(self):
        super().setUp()
        self.items = [
            self.add(label, index + 1)
            for index, label in enumerate("ABCDEFGH")
        ]

    def test_decoys_are_blanked_known_slots_and_are_never_graded(self):
        due = {self.items[0].id}

        rail = self.rail(due, decoy_count=2, rng=random.Random(0))

        self.assertEqual(self.kinds(rail).count(SLOT_DECOY), 2)
        self.assertEqual(rail_graded_ids(rail), due)

    def test_decoys_are_drawn_from_slots_near_a_blank(self):
        # A decoy out in an unvisited part of the list is invisible after
        # windowing and costs the learner a detour for nothing.
        due = {self.items[0].id}

        rail = self.rail(due, decoy_count=2, rng=random.Random(0))
        decoys = [slot["position"] for slot in rail if slot["kind"] == SLOT_DECOY]

        self.assertTrue(all(position <= 7 for position in decoys), decoys)

    def test_the_decoy_count_degrades_to_the_pool_that_exists(self):
        # First pass over a new list, or training: everything is due, so there
        # are no known slots to blank. Must degrade silently, not crash.
        due = {item.id for item in self.items}

        rail = self.rail(due, decoy_count=3, rng=random.Random(0))

        self.assertEqual(self.kinds(rail).count(SLOT_DECOY), 0)
        self.assertEqual(rail_graded_ids(rail), due)

    def test_a_decoy_never_consumes_a_due_item(self):
        due = {self.items[0].id, self.items[1].id}

        rail = self.rail(due, decoy_count=4, rng=random.Random(1))
        decoy_ids = {
            slot["question_id"] for slot in rail if slot["kind"] == SLOT_DECOY
        }

        self.assertEqual(decoy_ids & due, set())


class RailWindowTests(RailTestCase):
    def test_a_short_list_is_never_windowed(self):
        self.assertIsNone(rail_window_for(8))

    def test_a_long_list_is_windowed(self):
        self.assertEqual(rail_window_for(40), 3)

    def test_windowing_keeps_only_the_neighbourhood_of_each_blank(self):
        items = [self.add(f"item-{index}", index + 1) for index in range(40)]
        due = {items[10].id, items[30].id}

        rail = self.rail(due, window=3)
        positions = [slot["position"] for slot in rail]

        self.assertEqual(positions, list(range(8, 15)) + list(range(28, 35)))

    def test_overlapping_windows_merge_into_one_run(self):
        items = [self.add(f"item-{index}", index + 1) for index in range(40)]
        due = {items[10].id, items[12].id}

        rail = self.rail(due, window=3)
        positions = [slot["position"] for slot in rail]

        self.assertEqual(positions, list(range(8, 17)))

    def test_a_window_at_the_list_edge_does_not_run_off_the_end(self):
        items = [self.add(f"item-{index}", index + 1) for index in range(40)]
        due = {items[0].id, items[39].id}

        rail = self.rail(due, window=3)
        positions = [slot["position"] for slot in rail]

        self.assertEqual(positions, [1, 2, 3, 4, 37, 38, 39, 40])

    def test_the_true_order_follows_the_rail_not_the_full_list(self):
        items = [self.add(f"item-{index}", index + 1) for index in range(40)]
        due = {items[10].id}

        rail = self.rail(due, window=3)

        self.assertEqual(
            rail_true_order(rail),
            [item.id for item in items[7:14]]
        )


class RecitationPresentationTests(RailTestCase):
    def test_a_short_run_has_one_safe_cue_and_hides_every_target_label(self):
        items = [self.add(label, index + 1) for index, label in enumerate("ABCDE")]
        rail = self.rail({items[2].id})

        presentations = build_recitation_presentations(rail)

        self.assertEqual(len(presentations), 1)
        self.assertEqual(
            presentations[0]["cue"],
            {
                "question_id": items[1].id,
                "position": 2,
                "label": "B"
            }
        )
        self.assertEqual(
            [target["question_id"] for target in presentations[0]["targets"]],
            [item.id for item in items[2:]]
        )
        self.assertEqual(presentations[0]["scheduled_ids"], [items[2].id])
        self.assertTrue(all(
            "label" not in target
            for target in presentations[0]["targets"]
        ))

    def test_an_unstarted_item_ends_the_current_run(self):
        items = [
            self.add("A", 1),
            self.add("B", 2),
            self.add("C", 3),
            self.add("D", 4, started=False),
            self.add("E", 5),
            self.add("F", 6)
        ]
        rail = self.rail({items[1].id, items[5].id})

        presentations = build_recitation_presentations(rail)

        self.assertEqual(
            [
                [target["question_id"] for target in presentation["targets"]]
                for presentation in presentations
            ],
            [[items[1].id, items[2].id], [items[5].id]]
        )

    def test_distant_windowed_due_regions_become_separate_presentations(self):
        items = [self.add(f"item-{index}", index + 1) for index in range(40)]
        rail = self.rail({items[10].id, items[30].id}, window=3)

        presentations = build_recitation_presentations(rail)

        self.assertEqual(len(presentations), 2)
        self.assertEqual(
            [presentation["run_start"] for presentation in presentations],
            [10, 30]
        )
        self.assertEqual(
            [presentation["scheduled_ids"] for presentation in presentations],
            [[items[10].id], [items[30].id]]
        )


if __name__ == "__main__":
    unittest.main()
