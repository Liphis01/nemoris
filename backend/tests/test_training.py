import unittest
from datetime import date, timedelta
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup
from app.routers.training import grade_timeline_training
from app.schemas import (
    QuestionUpdate,
    TimelineAnswerItem,
    TimelineAnswerRequest,
    TimelineDateValue,
    TrainingAttemptRecordRequest
)
from app.services.questions import delete_question, update_question
from app.services.tag_hierarchy import load_tag_hierarchy, resolve_tag_id, save_tag_hierarchy
from app.services.training import (
    get_training_items,
    group_training_fingerprint,
    list_training_scopes,
    record_training_attempt,
    serialize_training_record
)


def point_timeline(year):
    return {
        "timeline": {
            "kind": "point",
            "start": {
                "year": year,
                "precision": "year"
            }
        }
    }


class TrainingTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_question(
        self,
        question_id,
        type_q="text",
        question=None,
        answer=None,
        media=None,
        tags=None,
        data=None,
        group=None,
        next_review=None,
        reps=None,
        history=None
    ):
        item = Question(
            id=question_id,
            type_q=type_q,
            question=question or f"Question {question_id}",
            answer=answer or f"Answer {question_id}",
            media=media,
            tags=tags or [],
            data=data or {},
            group=group
        )
        self.db.add(item)

        if reps is not None or next_review is not None or history is not None:
            item.progress = Progress(
                stability=1.0,
                difficulty=5.0,
                reps=0 if reps is None else reps,
                lapses=0,
                interval=0,
                next_review=next_review,
                history=history or []
            )

        return item

    def record_request(
        self,
        group,
        elapsed_ms,
        question_count,
        found_count,
        mode=None
    ):
        return TrainingAttemptRecordRequest(
            elapsed_ms=elapsed_ms,
            question_count=question_count,
            found_count=found_count,
            content_fingerprint=group_training_fingerprint(self.db, group),
            mode=mode
        )

    def seed_training_record(self, group, record):
        record = {
            **record,
            "content_fingerprint": group_training_fingerprint(self.db, group)
        }
        group.data = {
            **(group.data or {}),
            "training_record": record
        }
        self.db.commit()

    def test_group_training_returns_all_group_items_in_review_shape(self):
        today = date.today()
        group = QuestionGroup(
            id=10,
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={}
        )
        self.db.add(group)
        self.add_question(
            1,
            type_q="map",
            answer="France",
            tags=["Geo"],
            data={"code": "fr", "aliases": ["Republique francaise"]},
            group=group,
            next_review=today + timedelta(days=30),
            reps=2
        )
        self.add_question(
            2,
            type_q="map",
            answer="Germany",
            tags=["Geo"],
            data={"code": "de", "aliases": ["Deutschland"]},
            group=group
        )
        self.add_question(3, tags=["Geo"], reps=1, next_review=today)
        self.db.commit()

        progress_count = self.db.query(Progress).count()
        response = get_training_items(
            self.db,
            scope_type="group",
            group_id=group.id
        )

        self.assertEqual(self.db.query(Progress).count(), progress_count)
        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["type_q"], "map")
        self.assertEqual(response[0]["group_id"], group.id)
        self.assertEqual(response[0]["mode"], "type_all")
        hierarchy = load_tag_hierarchy(self.db)
        self.assertEqual(response[0]["tags"], [resolve_tag_id(hierarchy, "Geo")])
        self.assertEqual(
            {item["question_id"] for item in response[0]["items"]},
            {1, 2}
        )
        self.assertEqual(
            response[0]["training_fingerprint"],
            group_training_fingerprint(self.db, group)
        )

    def test_group_training_randomizes_group_item_order(self):
        group = QuestionGroup(
            id=12,
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={}
        )
        self.db.add(group)

        for question_id in range(1, 4):
            self.add_question(
                question_id,
                type_q="map",
                answer=f"Zone {question_id}",
                data={"code": f"z{question_id}"},
                group=group
            )

        self.db.commit()

        with patch(
            "app.services.review._shuffled",
            side_effect=lambda items: list(reversed(list(items or [])))
        ):
            response = get_training_items(
                self.db,
                scope_type="group",
                group_id=group.id
            )

        self.assertEqual(
            [item["question_id"] for item in response[0]["items"]],
            [3, 2, 1]
        )
        self.assertEqual(
            [item["question_id"] for item in response[0]["context_items"]],
            [3, 2, 1]
        )

    def test_image_group_training_accepts_mode_and_context_items(self):
        group = QuestionGroup(
            id=11,
            type_group="media",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add(group)
        self.add_question(
            1,
            type_q="media",
            answer="France",
            media="/static/france.png",
            tags=["Geo"],
            group=group
        )
        self.add_question(
            2,
            type_q="media",
            answer="Germany",
            media="/static/germany.png",
            tags=["Geo"],
            group=group
        )
        self.db.commit()

        response = get_training_items(
            self.db,
            scope_type="group",
            group_id=group.id,
            image_mode="multiple_choice_image"
        )

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["type_q"], "media")
        self.assertEqual(response[0]["group_id"], group.id)
        self.assertEqual(response[0]["mode"], "multiple_choice_image")
        self.assertEqual(len(response[0]["items"]), 2)
        self.assertEqual(len(response[0]["context_items"]), 2)
        self.assertEqual(
            response[0]["training_fingerprint"],
            group_training_fingerprint(self.db, group)
        )

    def test_tag_training_is_exact_case_insensitive(self):
        today = date.today()
        group = QuestionGroup(
            id=20,
            type_group="media",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add(group)
        self.add_question(1, tags=["Geo"], reps=1, next_review=today)
        self.add_question(2, tags=["geology"], reps=1, next_review=today)
        self.add_question(
            3,
            type_q="media",
            answer="France",
            tags=["geo"],
            group=group
        )
        self.add_question(
            4,
            type_q="timeline",
            question="Moon landing",
            answer="1969",
            tags=["history"],
            data=point_timeline(1969)
        )
        self.db.commit()

        response = get_training_items(self.db, scope_type="tag", tag=" GEO ")

        text_items = [
            item for item in response
            if item["type_q"] == "text"
        ]
        image_groups = [
            item for item in response
            if item["type_q"] == "media"
        ]
        returned_ids = {
            item["question_id"]
            for item in text_items
        }
        image_ids = {
            item["question_id"]
            for group_item in image_groups
            for item in group_item["items"]
        }

        self.assertEqual(returned_ids, {1})
        self.assertEqual(image_ids, {3})
        self.assertNotIn(2, returned_ids | image_ids)

    def test_tag_training_includes_descendant_tags(self):
        today = date.today()
        self.add_question(1, tags=["paris"], reps=1, next_review=today)
        self.add_question(2, tags=["lyon"], reps=1, next_review=today)
        self.add_question(3, tags=["berlin"], reps=1, next_review=today)
        self.db.commit()

        save_tag_hierarchy(self.db, {
            "parents": {
                "paris": ["france", "capitals"],
                "lyon": ["france"],
                "france": ["europe"],
                "berlin": ["germany", "capitals"],
                "germany": ["europe"]
            }
        })
        self.db.commit()

        france = get_training_items(self.db, scope_type="tag", tag="france")
        france_ids = {
            item["question_id"]
            for item in france
            if item["type_q"] == "text"
        }
        self.assertEqual(france_ids, {1, 2})

        europe = get_training_items(self.db, scope_type="tag", tag="europe")
        europe_ids = {
            item["question_id"]
            for item in europe
            if item["type_q"] == "text"
        }
        self.assertEqual(europe_ids, {1, 2, 3})

        # "capitals" is a second parent of both paris and berlin.
        capitals = get_training_items(self.db, scope_type="tag", tag="capitals")
        capital_ids = {
            item["question_id"]
            for item in capitals
            if item["type_q"] == "text"
        }
        self.assertEqual(capital_ids, {1, 3})

    def test_scopes_roll_up_counts_through_hierarchy(self):
        self.add_question(1, tags=["paris"])
        self.add_question(2, tags=["lyon"])
        self.add_question(3, tags=["berlin"])
        self.db.commit()

        save_tag_hierarchy(self.db, {
            "parents": {
                "paris": ["france", "capitals"],
                "lyon": ["france"],
                "france": ["europe"],
                "berlin": ["europe", "capitals"]
            },
            "labels": {"europe": "Europe", "france": "France", "capitals": "Capitals"}
        })
        self.db.commit()

        response = list_training_scopes(self.db)
        counts = {tag["name"]: tag["count"] for tag in response["tags"]}

        self.assertEqual(counts.get("France"), 2)
        self.assertEqual(counts.get("Europe"), 3)
        self.assertEqual(counts.get("Capitals"), 2)
        self.assertEqual(counts.get("paris"), 1)

    def test_tag_training_uses_unicode_casefold_exact_matching(self):
        self.add_question(1, tags=["Straße"])
        self.add_question(2, tags=["strasseland"])
        self.add_question(3, tags=["STRASSE"])
        self.db.commit()

        response = get_training_items(self.db, scope_type="tag", tag=" strasse ")
        returned_ids = {
            item["question_id"]
            for item in response
            if item["type_q"] == "text"
        }

        self.assertEqual(returned_ids, {1, 3})
        self.assertNotIn(2, returned_ids)

    def test_tag_training_keeps_full_visual_context_for_tagged_items(self):
        group = QuestionGroup(
            id=21,
            type_group="media",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add(group)

        for question_id in range(1, 8):
            self.add_question(
                question_id,
                type_q="media",
                answer=f"Flag {question_id}",
                media=f"/static/flag-{question_id}.png",
                tags=["target"] if question_id in {2, 5} else ["other"],
                group=group
            )

        self.db.commit()

        response = get_training_items(self.db, scope_type="tag", tag="target")

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["type_q"], "media")
        self.assertEqual(response[0]["group_id"], group.id)
        self.assertEqual(
            {item["question_id"] for item in response[0]["items"]},
            {2, 5}
        )
        self.assertEqual(
            {item["question_id"] for item in response[0]["context_items"]},
            {1, 2, 3, 4, 5, 6, 7}
        )

    def test_scopes_return_groups_and_deduped_tag_counts(self):
        group = QuestionGroup(
            id=30,
            type_group="map",
            name="World",
            media="world.svg",
            data={}
        )
        self.db.add(group)
        self.add_question(1, type_q="map", tags=["Geo", "geo"], group=group)
        self.add_question(2, tags=["geo", "History"])
        self.add_question(3, tags=["history"])
        self.db.commit()
        self.seed_training_record(group, {
            "best_found_percent": 100,
            "best_found_count": 1,
            "best_found_elapsed_ms": 4000,
            "best_found_at": "2026-06-01T10:00:00+00:00",
            "best_time_ms": 4000,
            "best_time_at": "2026-06-01T10:00:00+00:00",
            "question_count": 1
        })

        response = list_training_scopes(self.db)

        self.assertEqual(response["groups"][0]["id"], group.id)
        self.assertEqual(response["groups"][0]["question_count"], 1)
        geo_scope = next(tag for tag in response["tags"] if tag["label"] == "Geo")
        self.assertEqual(response["groups"][0]["tags"], [geo_scope["id"]])
        self.assertEqual(
            response["groups"][0]["training_record"]["best_found_percent"],
            100
        )
        self.assertEqual(
            response["groups"][0]["training_records"]["type_all"]["best_found_percent"],
            100
        )
        self.assertEqual(
            [(tag["id"], tag["label"], tag["count"]) for tag in response["tags"]],
            [(geo_scope["id"], "Geo", 2), ("core:history", "Histoire", 2)]
        )

    def test_scopes_hide_legacy_records_without_fingerprint(self):
        group = QuestionGroup(
            id=31,
            type_group="map",
            name="World",
            media="world.svg",
            data={
                "training_record": {
                    "best_found_percent": 100,
                    "best_found_count": 1,
                    "best_found_elapsed_ms": 4000,
                    "best_found_at": "2026-06-01T10:00:00+00:00",
                    "question_count": 1
                }
            }
        )
        self.db.add(group)
        self.add_question(1, type_q="map", group=group)
        self.db.commit()

        response = list_training_scopes(self.db)

        self.assertIsNone(response["groups"][0]["training_record"])

    def test_first_clean_attempt_saves_best_percent_and_time(self):
        group = QuestionGroup(
            id=40,
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={"theme": "blue"}
        )
        self.db.add(group)
        self.add_question(1, type_q="map", group=group)
        self.add_question(2, type_q="map", group=group)
        self.db.commit()

        response = record_training_attempt(
            self.db,
            group.id,
            self.record_request(group, 12345, 2, 2)
        )

        record = response["training_record"]
        self.assertTrue(response["is_new_best_percent"])
        self.assertTrue(response["is_new_best_time"])
        self.assertEqual(record["best_found_percent"], 100)
        self.assertEqual(record["best_found_count"], 2)
        self.assertEqual(record["best_found_elapsed_ms"], 12345)
        self.assertEqual(record["best_time_ms"], 12345)
        self.assertEqual(record["question_count"], 2)
        self.assertEqual(
            record["content_fingerprint"],
            group_training_fingerprint(self.db, group)
        )
        self.assertEqual(group.data["theme"], "blue")

    def test_map_training_records_are_saved_per_mode(self):
        group = QuestionGroup(
            id=401,
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={}
        )
        self.db.add(group)
        self.add_question(1, type_q="map", group=group)
        self.add_question(2, type_q="map", group=group)
        self.db.commit()

        click = record_training_attempt(
            self.db,
            group.id,
            self.record_request(
                group,
                9000,
                2,
                2,
                mode="click_prompt"
            )
        )
        type_all = record_training_attempt(
            self.db,
            group.id,
            self.record_request(
                group,
                7000,
                2,
                1,
                mode="type_all"
            )
        )

        self.assertEqual(
            click["training_records"]["click_prompt"]["best_time_ms"],
            9000
        )
        self.assertEqual(
            type_all["training_records"]["type_all"]["best_found_percent"],
            50
        )
        self.assertEqual(
            group.data["training_records"]["click_prompt"]["best_time_ms"],
            9000
        )
        self.assertEqual(
            group.data["training_record"]["best_found_percent"],
            50
        )

    def test_image_training_records_are_saved_per_mode(self):
        group = QuestionGroup(
            id=402,
            type_group="media",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add(group)
        self.add_question(1, type_q="media", group=group)
        self.add_question(2, type_q="media", group=group)
        self.db.commit()

        choices = record_training_attempt(
            self.db,
            group.id,
            self.record_request(
                group,
                9000,
                2,
                2,
                mode="multiple_choice_image"
            )
        )
        type_prompt = record_training_attempt(
            self.db,
            group.id,
            self.record_request(
                group,
                7000,
                2,
                1,
                mode="type_prompt"
            )
        )

        self.assertEqual(
            choices["training_records"]["multiple_choice_image"]["best_time_ms"],
            9000
        )
        self.assertEqual(
            type_prompt["training_records"]["type_prompt"]["best_found_percent"],
            50
        )
        self.assertEqual(
            group.data["training_records"]["multiple_choice_image"]["best_time_ms"],
            9000
        )
        self.assertEqual(
            group.data["training_record"]["best_found_percent"],
            50
        )

    def test_partial_attempt_updates_best_percent_but_not_clean_time(self):
        group = QuestionGroup(
            id=41,
            type_group="media",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add(group)
        self.add_question(1, type_q="media", group=group)
        self.add_question(2, type_q="media", group=group)
        self.db.commit()

        response = record_training_attempt(
            self.db,
            group.id,
            self.record_request(group, 5000, 2, 1)
        )

        record = response["training_record"]
        self.assertTrue(response["is_new_best_percent"])
        self.assertFalse(response["is_new_best_time"])
        self.assertEqual(record["best_found_percent"], 50)
        self.assertEqual(record["best_found_count"], 1)
        self.assertNotIn("best_time_ms", record)
        self.assertEqual(
            response["training_records"]["type_prompt"]["best_found_percent"],
            50
        )

    def test_lower_percent_does_not_overwrite_and_tie_uses_shorter_time(self):
        group = QuestionGroup(
            id=42,
            type_group="map",
            name="World",
            media=None,
            data={}
        )
        self.db.add(group)
        self.add_question(1, type_q="map", group=group)
        self.add_question(2, type_q="map", group=group)
        self.db.commit()
        self.seed_training_record(group, {
            "best_found_percent": 50,
            "best_found_count": 1,
            "best_found_elapsed_ms": 5000,
            "best_found_at": "2026-06-01T10:00:00+00:00",
            "question_count": 2
        })

        lower = record_training_attempt(
            self.db,
            group.id,
            self.record_request(group, 2000, 2, 0)
        )
        slower_tie = record_training_attempt(
            self.db,
            group.id,
            self.record_request(group, 6000, 2, 1)
        )
        faster_tie = record_training_attempt(
            self.db,
            group.id,
            self.record_request(group, 4000, 2, 1)
        )

        self.assertFalse(lower["is_new_best_percent"])
        self.assertFalse(slower_tie["is_new_best_percent"])
        self.assertTrue(faster_tie["is_new_best_percent"])
        self.assertEqual(
            faster_tie["training_record"]["best_found_elapsed_ms"],
            4000
        )

    def test_faster_clean_time_preserves_better_percent_elapsed(self):
        group = QuestionGroup(
            id=43,
            type_group="media",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add(group)
        self.add_question(1, type_q="media", group=group)
        self.add_question(2, type_q="media", group=group)
        self.db.commit()
        self.seed_training_record(group, {
            "best_found_percent": 100,
            "best_found_count": 2,
            "best_found_elapsed_ms": 6000,
            "best_found_at": "2026-06-01T10:00:00+00:00",
            "best_time_ms": 9000,
            "best_time_at": "2026-06-01T10:00:00+00:00",
            "question_count": 2
        })

        response = record_training_attempt(
            self.db,
            group.id,
            self.record_request(group, 7000, 2, 2)
        )

        record = response["training_record"]
        self.assertFalse(response["is_new_best_percent"])
        self.assertTrue(response["is_new_best_time"])
        self.assertEqual(record["best_found_elapsed_ms"], 6000)
        self.assertEqual(record["best_time_ms"], 7000)

    def test_invalid_training_attempt_records_are_rejected(self):
        group = QuestionGroup(
            id=44,
            type_group="map",
            name="World",
            media=None,
            data={}
        )
        self.db.add(group)
        self.add_question(1, type_q="map", group=group)
        self.db.commit()

        with self.assertRaises(HTTPException) as missing_group:
            record_training_attempt(
                self.db,
                999,
                TrainingAttemptRecordRequest(
                    elapsed_ms=1000,
                    question_count=1,
                    found_count=1,
                    content_fingerprint="missing"
                )
            )

        self.assertEqual(missing_group.exception.status_code, 404)

        with self.assertRaises(HTTPException) as mismatched_count:
            record_training_attempt(
                self.db,
                group.id,
                self.record_request(group, 1000, 2, 1)
            )

        self.assertEqual(mismatched_count.exception.status_code, 400)

        with self.assertRaises(HTTPException) as invalid_found:
            record_training_attempt(
                self.db,
                group.id,
                self.record_request(group, 1000, 1, 2)
            )

        self.assertEqual(invalid_found.exception.status_code, 400)

    def test_stale_same_count_training_attempt_is_rejected(self):
        group = QuestionGroup(
            id=45,
            type_group="map",
            name="World",
            media="world.svg",
            data={}
        )
        self.db.add(group)
        first = self.add_question(
            1,
            type_q="map",
            answer="France",
            data={"code": "fr", "aliases": []},
            group=group
        )
        self.add_question(
            2,
            type_q="map",
            answer="Germany",
            data={"code": "de", "aliases": []},
            group=group
        )
        self.db.commit()
        stale_fingerprint = group_training_fingerprint(self.db, group)

        # Swap one item for another: the count stays at 2 but the membership
        # (and therefore the fingerprint) changes, so an attempt captured before
        # the swap is stale and must be rejected.
        delete_question(self.db, first.id)
        self.add_question(
            3,
            type_q="map",
            answer="Spain",
            data={"code": "es", "aliases": []},
            group=group
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as stale_attempt:
            record_training_attempt(
                self.db,
                group.id,
                TrainingAttemptRecordRequest(
                    elapsed_ms=1000,
                    question_count=2,
                    found_count=2,
                    content_fingerprint=stale_fingerprint
                )
            )

        self.assertEqual(stale_attempt.exception.status_code, 409)

    def test_same_count_content_edit_training_attempt_is_accepted(self):
        group = QuestionGroup(
            id=48,
            type_group="map",
            name="World",
            media="world.svg",
            data={}
        )
        self.db.add(group)
        first = self.add_question(
            1,
            type_q="map",
            answer="France",
            data={"code": "fr", "aliases": []},
            group=group
        )
        self.add_question(
            2,
            type_q="map",
            answer="Germany",
            data={"code": "de", "aliases": []},
            group=group
        )
        self.db.commit()
        fingerprint = group_training_fingerprint(self.db, group)

        # Fixing an item's answer is a content edit, not a membership change, so
        # the fingerprint is unchanged and an in-flight attempt still records.
        first.answer = "France changed"
        self.db.commit()

        record_training_attempt(
            self.db,
            group.id,
            TrainingAttemptRecordRequest(
                elapsed_ms=1000,
                question_count=2,
                found_count=2,
                content_fingerprint=fingerprint
            )
        )

        served = serialize_training_record(
            group.data,
            group_training_fingerprint(self.db, group)
        )
        self.assertIsNotNone(served)

    def test_generic_grouped_question_edits_preserve_records(self):
        group = QuestionGroup(
            id=46,
            type_group="media",
            name="Flags",
            media=None,
            data={"theme": "blue"}
        )
        self.db.add(group)
        self.add_question(
            1,
            type_q="media",
            answer="France",
            media="/static/france.png",
            data={"aliases": ["FR"], "favorite": True},
            group=group
        )
        self.add_question(
            2,
            type_q="media",
            answer="Germany",
            media="/static/germany.png",
            data={"aliases": []},
            group=group
        )
        self.db.commit()
        self.seed_training_record(group, {
            "best_found_percent": 100,
            "best_found_count": 2,
            "best_found_elapsed_ms": 5000,
            "best_found_at": "2026-06-01T10:00:00+00:00",
            "question_count": 2
        })
        group.data = {
            **group.data,
            "training_records": {
                "type_prompt": group.data["training_record"]
            }
        }
        self.db.commit()

        # Editing an existing item — tags, aliases, even its answer — is a
        # content fix, not a membership change, so the best-time record survives
        # and is still served by the fingerprint.
        update_question(self.db, 1, QuestionUpdate(tags=["core:geography"]))
        update_question(
            self.db,
            1,
            QuestionUpdate(data={"aliases": ["France flag"], "favorite": True})
        )
        update_question(self.db, 1, QuestionUpdate(answer="France (flag)"))

        fingerprint = group_training_fingerprint(self.db, group)
        self.assertIsNotNone(serialize_training_record(group.data, fingerprint))
        self.assertIn("training_record", group.data)
        self.assertIn("training_records", group.data)
        self.assertEqual(group.data["theme"], "blue")

    def test_generic_grouped_question_delete_invalidates_records(self):
        group = QuestionGroup(
            id=47,
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={}
        )
        self.db.add(group)
        self.add_question(1, type_q="map", group=group)
        self.add_question(2, type_q="map", group=group)
        self.db.commit()
        self.seed_training_record(group, {
            "best_found_percent": 100,
            "best_found_count": 2,
            "best_found_elapsed_ms": 5000,
            "best_found_at": "2026-06-01T10:00:00+00:00",
            "question_count": 2
        })

        delete_question(self.db, 1)

        # The record is no longer served: removing an item changes the group's
        # membership fingerprint, so the stored record no longer matches.
        fingerprint = group_training_fingerprint(self.db, group)
        self.assertIsNone(serialize_training_record(group.data, fingerprint))

    def test_training_timeline_grading_does_not_mutate_progress(self):
        history = [{
            "reviewed_on": "2026-01-01",
            "quality": 2,
            "next_review": "2026-01-04"
        }]
        self.add_question(
            1,
            type_q="timeline",
            question="Moon landing",
            answer="1969",
            tags=["history"],
            data=point_timeline(1969),
            reps=1,
            next_review=date.today() + timedelta(days=10),
            history=history
        )
        self.add_question(
            2,
            type_q="timeline",
            question="Unstarted timeline",
            answer="2000",
            tags=["history"],
            data=point_timeline(2000)
        )
        self.db.commit()

        before_count = self.db.query(Progress).count()
        before_progress = self.db.query(Progress).filter(
            Progress.question_id == 1
        ).first()
        before_next_review = before_progress.next_review
        before_history = list(before_progress.history)

        response = grade_timeline_training(
            TimelineAnswerRequest(items={
                1: TimelineAnswerItem(
                    start=TimelineDateValue(year=1969, precision="year")
                ),
                2: TimelineAnswerItem(
                    start=TimelineDateValue(year=2000, precision="year")
                )
            }),
            db=self.db
        )

        after_progress = self.db.query(Progress).filter(
            Progress.question_id == 1
        ).first()
        self.assertEqual(response["status"], "ok")
        self.assertEqual(
            {item["question_id"] for item in response["results"]},
            {1, 2}
        )
        self.assertEqual(self.db.query(Progress).count(), before_count)
        self.assertEqual(after_progress.next_review, before_next_review)
        self.assertEqual(after_progress.history, before_history)
        self.assertFalse(
            self.db.query(Progress).filter(Progress.question_id == 2).first()
        )

    def test_invalid_training_scopes_are_rejected(self):
        with self.assertRaises(HTTPException) as missing_group:
            get_training_items(self.db, scope_type="group")

        self.assertEqual(missing_group.exception.status_code, 400)

        with self.assertRaises(HTTPException) as not_found:
            get_training_items(self.db, scope_type="group", group_id=999)

        self.assertEqual(not_found.exception.status_code, 404)

        with self.assertRaises(HTTPException) as missing_tag:
            get_training_items(self.db, scope_type="tag", tag=" ")

        self.assertEqual(missing_tag.exception.status_code, 400)
