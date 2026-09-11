import random
import unittest
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import AppSetting, Progress, Question, QuestionGroup, ReviewLog
from app.routers.review import get_review, update_intake_plan
from app.schemas import IntakePlanActionsRequest
from app.services.intake import due_question_count
from app.services.intake_plan import (
    LOOSE_DECK_KEY,
    IntakePlanConflict,
    _eta_bucket,
    apply_intake_plan_actions,
    build_intake_deck_detail,
    build_intake_plan_snapshot,
    interleave,
    planned_new_question_ids
)
from app.services.review import _item_question_ids, get_review_summary
from app.services.settings import (
    INTAKE_PLAN_KEY,
    SYNC_SETTING_KEYS,
    load_intake_plan,
    sync_settings_payload
)


class InterleaveTests(unittest.TestCase):
    def test_focus_one_feeds_decks_in_sequence(self):
        self.assertEqual(
            interleave([("a", [1, 2]), ("b", [3, 4])], 1),
            [1, 2, 3, 4]
        )

    def test_focus_two_alternates_and_gives_the_remainder_to_the_top_deck(self):
        order = interleave([("a", [1, 2, 3]), ("b", [4, 5, 6])], 2)

        self.assertEqual(order, [1, 4, 2, 5, 3, 6])
        # A five-question day: the top deck is the priority, so it gets 3.
        self.assertEqual(sorted(order[:5]), [1, 2, 3, 4, 5])

    def test_focus_zero_round_robins_every_deck(self):
        self.assertEqual(
            interleave([("a", [1, 2]), ("b", [3, 4]), ("c", [5, 6])], 0),
            [1, 3, 5, 2, 4, 6]
        )

    def test_an_exhausted_deck_hands_its_slot_to_the_next_one(self):
        # C joins level with B instead of at zero, so it cannot flood the day.
        self.assertEqual(
            interleave([("a", [1]), ("b", [2, 3, 4]), ("c", [5, 6])], 2),
            [1, 2, 5, 3, 6, 4]
        )

    def test_served_counts_continue_the_day_instead_of_restarting_it(self):
        # A already introduced two today: reopening the session must let B
        # catch up rather than hand A the top slot again.
        order = interleave(
            [("a", [3, 4, 5]), ("b", [6, 7])],
            2,
            served={"a": 2}
        )

        self.assertEqual(order[:3], [6, 7, 3])

    def test_empty_decks_are_skipped(self):
        self.assertEqual(interleave([("a", []), ("b", [1])], 1), [1])


class IntakePlanTestCase(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self):
        self.db.close()

    def add_group(self, group_id, name=None, type_group="text"):
        group = QuestionGroup(
            id=group_id,
            guid=f"guid-{group_id}",
            type_group=type_group,
            name=name or f"Group {group_id}",
            media=None,
            data={}
        )
        self.db.add(group)
        return group

    def add_question(
        self,
        question_id,
        group=None,
        suspended=False,
        intake_order=None,
        type_q="text",
        answer=None
    ):
        question = Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=f"Answer {question_id}" if answer is None else answer,
            tags=[],
            data={},
            group=group,
            suspended=suspended,
            intake_order=intake_order
        )
        self.db.add(question)
        return question

    def start(self, question_id, next_review=None, reviewed_on=None):
        reviewed_on = reviewed_on or date.today() - timedelta(days=3)
        self.db.add(Progress(
            question_id=question_id,
            stability=1.0,
            difficulty=5.0,
            reps=1,
            lapses=0,
            interval=1,
            next_review=next_review or date.today() + timedelta(days=5),
            ideal_next_review=next_review or date.today() + timedelta(days=5),
            last_review=reviewed_on,
            history=[]
        ))
        self.db.add(ReviewLog(
            question_id=question_id,
            seq=1,
            reviewed_on=reviewed_on,
            quality=2,
            data={}
        ))

    def act(self, *actions, rng=None):
        revision = load_intake_plan(self.db)["revision"]
        snapshot = apply_intake_plan_actions(
            self.db,
            revision,
            list(actions),
            rng=rng
        )
        self.db.commit()
        return snapshot

    def deck_keys(self, snapshot=None):
        snapshot = snapshot or build_intake_plan_snapshot(self.db)
        return [deck["key"] for deck in snapshot["decks"]]

    def two_decks(self):
        # Legacy order puts B's first question ahead of A's.
        group_a = self.add_group(1, "A")
        group_b = self.add_group(2, "B")
        self.add_question(10, group=group_a, intake_order=2)
        self.add_question(11, group=group_a, intake_order=3)
        self.add_question(20, group=group_b, intake_order=1)
        self.add_question(21, group=group_b, intake_order=4)
        self.db.commit()
        return group_a, group_b


class DeckModelTests(IntakePlanTestCase):
    def test_loose_questions_and_singleton_groups_share_one_deck(self):
        group = self.add_group(1, "Real deck")
        singleton = self.add_group(2, "Alone")
        self.add_question(1, group=group)
        self.add_question(2, group=group)
        self.add_question(3, group=singleton)
        self.add_question(4)
        self.db.commit()

        self.assertEqual(self.deck_keys(), ["group:guid-1", LOOSE_DECK_KEY])
        loose = build_intake_deck_detail(self.db, LOOSE_DECK_KEY)
        self.assertEqual([item["id"] for item in loose["questions"]], [3, 4])

    def test_group_size_counts_started_questions_too(self):
        # A deck whose other members are already started is still a deck.
        group = self.add_group(1)
        self.add_question(1, group=group)
        self.add_question(2, group=group)
        self.start(1)
        self.db.commit()

        self.assertEqual(self.deck_keys(), ["group:guid-1"])

    def test_deck_lists_split_active_suspended_and_skip_started_or_unready(self):
        self.add_question(1, intake_order=2)
        self.add_question(2, intake_order=1)
        self.add_question(3, suspended=True)
        self.add_question(4)
        self.start(4)
        self.add_question(5, type_q="map", answer="")
        self.db.commit()

        detail = build_intake_deck_detail(self.db, LOOSE_DECK_KEY)
        snapshot = build_intake_plan_snapshot(self.db)

        self.assertEqual([item["id"] for item in detail["questions"]], [2, 1])
        self.assertEqual([item["id"] for item in detail["suspended"]], [3])
        self.assertEqual(snapshot["counts"]["waiting"], 2)
        self.assertEqual(snapshot["counts"]["suspended"], 1)

    def test_manual_order_falls_back_to_id_after_ordered_questions(self):
        self.add_question(1)
        self.add_question(2, intake_order=20)
        self.add_question(3, intake_order=10)
        self.add_question(4)
        self.db.commit()

        self.assertEqual(planned_new_question_ids(self.db), [3, 2, 1, 4])

    def test_map_zones_are_labelled_by_their_answer(self):
        group = self.add_group(1, type_group="map")
        self.add_question(1, group=group, type_q="map", answer="Lyon")
        self.add_question(2, group=group, type_q="map", answer="Nice")
        self.db.commit()

        detail = build_intake_deck_detail(self.db, "group:guid-1")

        self.assertEqual(detail["questions"][0]["primary"], "Lyon")
        self.assertEqual(detail["questions"][0]["secondary"], "")

    def test_unknown_deck_detail_is_not_found(self):
        with self.assertRaises(HTTPException) as caught:
            build_intake_deck_detail(self.db, "group:nope")

        self.assertEqual(caught.exception.status_code, 404)


class FeedOrderTests(IntakePlanTestCase):
    def test_an_unarranged_plan_keeps_the_legacy_order(self):
        self.two_decks()

        self.assertEqual(self.deck_keys(), ["group:guid-2", "group:guid-1"])
        # Two decks in parallel by default.
        self.assertEqual(planned_new_question_ids(self.db), [20, 10, 21, 11])

    def test_focus_one_feeds_one_deck_at_a_time(self):
        self.two_decks()
        self.act({"type": "set_focus", "focus": 1})

        self.assertEqual(planned_new_question_ids(self.db), [20, 21, 10, 11])

    def test_sections_follow_the_focus_window(self):
        self.two_decks()
        group_c = self.add_group(3, "C")
        self.add_question(30, group=group_c)
        self.add_question(31, group=group_c)
        self.db.commit()

        sections = [deck["section"] for deck in build_intake_plan_snapshot(self.db)["decks"]]

        self.assertEqual(sections, ["focus", "focus", "next"])

    def test_review_session_and_menu_follow_the_plan(self):
        self.two_decks()
        self.act({"type": "set_paused", "keys": ["group:guid-2"], "paused": True})

        served = set().union(*(
            _item_question_ids(item) for item in get_review(db=self.db)
        ))
        summary = get_review_summary(self.db)

        self.assertTrue(served)
        self.assertTrue(served <= {10, 11})
        self.assertEqual(summary["new_waiting"], 2)
        self.assertEqual(summary["new_paused"], 2)
        self.assertEqual(summary["new_count"], len(served))

    def test_the_days_split_survives_a_mid_day_reopen(self):
        self.two_decks()
        # B already introduced one question today.
        self.start(20, reviewed_on=date.today())
        self.db.commit()

        self.assertEqual(planned_new_question_ids(self.db, limit=2), [10, 21])


class PauseTests(IntakePlanTestCase):
    def test_pausing_holds_back_new_questions_but_not_reviews(self):
        group = self.add_group(1)
        self.add_question(1, group=group)
        self.add_question(2, group=group)
        self.add_question(3, group=group)
        self.start(3, next_review=date.today())
        self.db.commit()

        self.act({"type": "set_paused", "keys": ["group:guid-1"], "paused": True})

        self.assertEqual(planned_new_question_ids(self.db), [])
        self.assertEqual(due_question_count(self.db, date.today()), 1)
        # Pausing is an intake decision; suspension is untouched.
        self.assertFalse(any(
            question.suspended for question in self.db.query(Question)
        ))

    def test_a_question_added_to_a_paused_deck_stays_out(self):
        # The old per-question suspension leaked here: a pack update added
        # new questions unsuspended and they started feeding.
        group = self.add_group(1)
        self.add_question(1, group=group)
        self.add_question(2, group=group)
        self.db.commit()
        self.act({"type": "set_paused", "keys": ["group:guid-1"], "paused": True})

        self.add_question(3, group=group)
        self.db.commit()

        self.assertEqual(planned_new_question_ids(self.db), [])

    def test_a_resumed_deck_takes_back_its_place(self):
        self.two_decks()
        self.act({"type": "set_paused", "keys": ["group:guid-2"], "paused": True})
        self.assertEqual(self.deck_keys(), ["group:guid-1", "group:guid-2"])

        self.act({"type": "set_paused", "keys": ["group:guid-2"], "paused": False})

        self.assertEqual(self.deck_keys(), ["group:guid-2", "group:guid-1"])

    def test_moving_a_paused_deck_is_rejected(self):
        self.two_decks()
        self.act({"type": "set_paused", "keys": ["group:guid-2"], "paused": True})

        with self.assertRaises(HTTPException) as caught:
            self.act({"type": "move", "key": "group:guid-2", "to_index": 0})

        self.assertEqual(caught.exception.status_code, 400)


class NewDeckPolicyTests(IntakePlanTestCase):
    def add_new_deck(self):
        group = self.add_group(9, "New")
        self.add_question(90, group=group)
        self.add_question(91, group=group)
        self.db.commit()

    def test_new_decks_land_at_the_end_by_default(self):
        self.two_decks()
        self.act({"type": "set_focus", "focus": 1})
        self.add_new_deck()

        self.assertEqual(self.deck_keys()[-1], "group:guid-9")

    def test_new_decks_can_land_first(self):
        self.two_decks()
        self.act({"type": "set_new_decks", "policy": "start"})
        self.add_new_deck()

        self.assertEqual(self.deck_keys()[0], "group:guid-9")

    def test_new_decks_can_arrive_paused(self):
        self.two_decks()
        self.act({"type": "set_new_decks", "policy": "paused"})
        self.add_new_deck()

        snapshot = build_intake_plan_snapshot(self.db)
        new_deck = snapshot["decks"][-1]

        self.assertEqual(new_deck["key"], "group:guid-9")
        self.assertTrue(new_deck["paused"])
        self.assertNotIn(90, planned_new_question_ids(self.db))

    def test_entries_for_deleted_decks_are_dropped(self):
        _group_a, group_b = self.two_decks()
        self.act({"type": "set_focus", "focus": 1})

        for question in list(group_b.questions):
            self.db.delete(question)

        self.db.delete(group_b)
        self.db.commit()
        self.act({"type": "set_focus", "focus": 2})

        stored = [entry["key"] for entry in load_intake_plan(self.db)["decks"]]

        self.assertEqual(stored, ["group:guid-1"])


class ActionTests(IntakePlanTestCase):
    def test_move_reorders_active_decks_around_paused_ones(self):
        for group_id in (1, 2, 3, 4):
            group = self.add_group(group_id)
            self.add_question(group_id * 10, group=group, intake_order=group_id)
            self.add_question(group_id * 10 + 1, group=group, intake_order=10 + group_id)

        self.db.commit()
        self.act({"type": "set_paused", "keys": ["group:guid-2"], "paused": True})

        snapshot = self.act({"type": "move", "key": "group:guid-4", "to_index": 0})

        self.assertEqual(
            self.deck_keys(snapshot),
            ["group:guid-4", "group:guid-1", "group:guid-3", "group:guid-2"]
        )
        self.assertEqual(
            [deck["position"] for deck in snapshot["decks"]],
            [1, 2, 3, None]
        )

    def test_study_next_moves_to_the_front_and_resumes(self):
        self.two_decks()
        self.act({"type": "set_paused", "keys": ["group:guid-1"], "paused": True})

        snapshot = self.act({"type": "study_next", "keys": ["group:guid-1"]})

        self.assertEqual(self.deck_keys(snapshot), ["group:guid-1", "group:guid-2"])
        self.assertFalse(snapshot["decks"][0]["paused"])

    def test_invalid_settings_are_rejected(self):
        self.two_decks()

        for action in (
            {"type": "set_focus", "focus": 7},
            {"type": "set_new_decks", "policy": "sideways"},
            {"type": "move", "key": "group:guid-1"},
            {"type": "set_paused", "keys": [], "paused": True}
        ):
            with self.assertRaises(HTTPException) as caught:
                self.act(action)

            self.assertEqual(caught.exception.status_code, 400)

    def test_reordering_a_deck_rewrites_only_that_deck(self):
        self.two_decks()

        self.act({
            "type": "reorder_questions",
            "key": "group:guid-1",
            "question_ids": [11, 10]
        })

        stored = {
            question.id: question.intake_order
            for question in self.db.query(Question)
        }

        self.assertEqual(stored, {10: 2, 11: 1, 20: 1, 21: 4})
        self.assertEqual(planned_new_question_ids(self.db), [20, 11, 21, 10])

    def test_reorder_rejects_partial_stale_and_duplicate_payloads(self):
        self.two_decks()

        with self.assertRaises(IntakePlanConflict):
            self.act({
                "type": "reorder_questions",
                "key": "group:guid-1",
                "question_ids": [11]
            })

        self.db.rollback()

        with self.assertRaises(HTTPException) as duplicate:
            self.act({
                "type": "reorder_questions",
                "key": "group:guid-1",
                "question_ids": [11, 11]
            })

        self.assertEqual(duplicate.exception.status_code, 400)

    def test_shuffle_permutes_the_deck(self):
        group = self.add_group(1)

        for question_id in range(1, 21):
            self.add_question(question_id, group=group)

        self.db.commit()
        self.act({"type": "shuffle", "key": "group:guid-1"}, rng=random.Random(4))

        order = planned_new_question_ids(self.db)

        self.assertEqual(sorted(order), list(range(1, 21)))
        self.assertNotEqual(order, list(range(1, 21)))

    def test_suspension_changes_only_unseen_questions(self):
        question = self.add_question(1, intake_order=5)
        self.add_question(2)
        self.start(2)
        self.add_question(3, suspended=True, intake_order=7)
        self.db.commit()

        with self.assertRaises(HTTPException) as started:
            self.act({"type": "set_suspended", "question_ids": [1, 2], "suspended": True})

        self.assertEqual(started.exception.status_code, 400)
        self.db.rollback()
        self.assertFalse(question.suspended)

        self.act({"type": "set_suspended", "question_ids": [1], "suspended": True})
        detail = build_intake_deck_detail(self.db, LOOSE_DECK_KEY)

        self.assertEqual(detail["questions"], [])
        self.assertEqual([item["id"] for item in detail["suspended"]], [1, 3])
        self.assertTrue(question.suspended)
        self.assertEqual(question.intake_order, 5)

        self.act({"type": "set_suspended", "question_ids": [1], "suspended": False})

        self.assertFalse(question.suspended)
        self.assertEqual(question.intake_order, 5)

    def test_every_write_bumps_the_revision_and_stale_ones_conflict(self):
        self.two_decks()
        self.act({"type": "set_focus", "focus": 1})
        self.act({"type": "set_focus", "focus": 3})

        self.assertEqual(load_intake_plan(self.db)["revision"], 2)

        with self.assertRaises(IntakePlanConflict):
            apply_intake_plan_actions(
                self.db,
                1,
                [{"type": "set_focus", "focus": 0}]
            )

    def test_the_route_answers_a_conflict_with_the_fresh_snapshot(self):
        self.two_decks()
        self.act({"type": "set_focus", "focus": 1})

        with self.assertRaises(HTTPException) as caught:
            update_intake_plan(
                IntakePlanActionsRequest(
                    base_revision=0,
                    actions=[{"type": "set_focus", "focus": 3}]
                ),
                db=self.db
            )

        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail["snapshot"]["revision"], 1)
        self.assertEqual(caught.exception.detail["snapshot"]["settings"]["focus"], 1)

    def test_the_plan_travels_with_sync(self):
        self.two_decks()
        self.act({"type": "set_focus", "focus": 1})

        self.assertIn(INTAKE_PLAN_KEY, SYNC_SETTING_KEYS)
        self.assertEqual(sync_settings_payload(self.db)[INTAKE_PLAN_KEY]["focus"], 1)
        self.assertEqual(
            self.db.query(AppSetting)
            .filter(AppSetting.key == INTAKE_PLAN_KEY)
            .count(),
            1
        )


class SnapshotTests(IntakePlanTestCase):
    def test_today_is_split_by_deck_in_arrival_order(self):
        group_a = self.add_group(1, "A")
        group_b = self.add_group(2, "B")

        for question_id in range(10, 20):
            self.add_question(question_id, group=group_a)

        for question_id in range(20, 30):
            self.add_question(question_id, group=group_b)

        self.db.commit()

        today = build_intake_plan_snapshot(self.db)["today"]
        split = {entry["key"]: entry["count"] for entry in today["by_deck"]}

        self.assertEqual(today["count"], min(today["quota"], 20))
        self.assertEqual(sum(split.values()), today["count"])
        self.assertEqual(today["by_deck"][0]["key"], "group:guid-1")
        self.assertGreaterEqual(split["group:guid-1"], split.get("group:guid-2", 0))

    def test_eta_buckets_are_coarse(self):
        self.assertEqual(_eta_bucket(2, 5, 5.0), "today")
        self.assertEqual(_eta_bucket(10, 5, 5.0), "week")
        self.assertEqual(_eta_bucket(100, 5, 5.0), "month")
        self.assertEqual(_eta_bucket(300, 5, 5.0), "months")
        self.assertEqual(_eta_bucket(1000, 5, 5.0), "later")
        self.assertIsNone(_eta_bucket(10, 0, None))


if __name__ == "__main__":
    unittest.main()
