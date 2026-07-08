import unittest
from datetime import date, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup
from app.routers.review import answer_media, answer_map, answer_timeline, get_review
from app.schemas import (
    MediaAnswerRequest,
    MapAnswerRequest,
    TimelineAnswerItem,
    TimelineAnswerRequest,
    TimelineDateValue
)
from app.serializers import (
    serialize_media_review_group,
    serialize_media_review_item,
    serialize_map_review_group,
    serialize_map_review_zone,
    serialize_progress,
    serialize_review_question_item
)
from app.services.timeline import (
    serialize_timeline_review_group,
    serialize_timeline_review_item
)
from app.services.map_modes import map_mode_difficulty
from app.services.image_modes import image_mode_difficulty
from app.services.review import get_review_items
from app.scheduler import preview_intervals


PROGRESS_KEYS = {
    "interval",
    "stability",
    "difficulty",
    "reps",
    "lapses",
    "last_review",
    "next_review",
    "ideal_interval",
    "ideal_next_review",
    "fsrs_state",
    "fsrs_version",
    "history"
}
TEXT_REVIEW_KEYS = {
    "type_q",
    "question_id",
    "question",
    "answer",
    "media",
    "answer_media",
    "tags",
    "progress"
}
MAP_GROUP_KEYS = {
    "group_id",
    "type_q",
    "name",
    "media",
    "tags",
    "mode",
    "context_items",
    "items"
}
MAP_ZONE_KEYS = {
    "question_id",
    "code",
    "label",
    "aliases",
    "progress",
    "projected_intervals"
}
IMAGE_GROUP_KEYS = {
    "group_id",
    "type_q",
    "name",
    "media",
    "tags",
    "mode",
    "context_items",
    "items"
}
IMAGE_ITEM_KEYS = {
    "question_id",
    "question",
    "answer",
    "label",
    "media",
    "tags",
    "aliases",
    "progress",
    "projected_intervals"
}
TIMELINE_GROUP_KEYS = {
    "type_q",
    "name",
    "items",
    "range",
    "anchors"
}
TIMELINE_ITEM_KEYS = {
    "question_id",
    "question",
    "answer",
    "media",
    "tags",
    "timeline",
    "progress",
    "projected_intervals",
    "start_value"
}
TIMELINE_RESULT_KEYS = {
    "question_id",
    "quality",
    "expected",
    "guess",
    "start",
    "end",
    "progress"
}
TIMELINE_DATE_KEYS = {
    "year",
    "month",
    "day",
    "precision"
}


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


def interval_timeline(start_year, end_year):
    return {
        "timeline": {
            "kind": "interval",
            "start": {
                "year": start_year,
                "precision": "year"
            },
            "end": {
                "year": end_year,
                "precision": "year"
            }
        }
    }


class ReviewResponseShapeTests(unittest.TestCase):
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
        next_review=None
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
        progress = Progress(
            stability=1.0,
            difficulty=5.0,
            reps=1,
            lapses=0,
            interval=0,
            next_review=next_review if next_review else date.today(),
            history=[]
        )
        item.progress = progress
        self.db.add(item)
        return item

    def seed_review_contract_fixture(self):
        today = date.today()
        text = self.add_question(
            1,
            type_q="text",
            question="Capital of France?",
            answer="Paris",
            media="/static/paris.png",
            tags=["geo"],
            next_review=today
        )
        map_group = QuestionGroup(
            id=10,
            type_group="map",
            name="Europe",
            media="/static/europe.svg",
            data={}
        )
        self.db.add(map_group)
        map_zone_a = self.add_question(
            2,
            type_q="map",
            question="Europe - fr",
            answer="France",
            tags=["geo", "map"],
            data={
                "code": "fr",
                "aliases": ["Republique francaise"]
            },
            group=map_group,
            next_review=today
        )
        map_zone_b = self.add_question(
            3,
            type_q="map",
            question="Europe - de",
            answer="Germany",
            tags=["geo", "map"],
            data={
                "code": "de",
                "aliases": ["Deutschland"]
            },
            group=map_group,
            next_review=today
        )
        timeline_point = self.add_question(
            4,
            type_q="timeline",
            question="Moon landing",
            answer="1969",
            media="/static/moon.png",
            tags=["history"],
            data=point_timeline(1969),
            next_review=today
        )
        timeline_interval = self.add_question(
            5,
            type_q="timeline",
            question="World War I",
            answer="1914-1918",
            tags=["history"],
            data=interval_timeline(1914, 1918),
            next_review=today
        )
        image_group = QuestionGroup(
            id=20,
            type_group="media",
            name="Flags",
            media="/static/flags.png",
            data={}
        )
        self.db.add(image_group)
        image_item_a = self.add_question(
            7,
            type_q="media",
            question="Flags - France",
            answer="France",
            media="/static/france.png",
            tags=["flags"],
            data={"aliases": ["French flag"]},
            group=image_group,
            next_review=today
        )
        image_item_b = self.add_question(
            8,
            type_q="media",
            question="Flags - Germany",
            answer="Germany",
            media="/static/germany.png",
            tags=["flags"],
            data={"aliases": ["Deutschland"]},
            group=image_group,
            next_review=today
        )
        future = self.add_question(
            6,
            type_q="text",
            question="Future question",
            answer="Not due",
            next_review=today + timedelta(days=1)
        )
        self.db.commit()

        return {
            "text": text,
            "map_group": map_group,
            "map_zones": [map_zone_a, map_zone_b],
            "image_group": image_group,
            "image_items": [image_item_a, image_item_b],
            "timeline_items": [timeline_point, timeline_interval],
            "future": future
        }

    def assert_progress_shape(self, progress):
        self.assertEqual(set(progress), PROGRESS_KEYS)
        self.assertIsInstance(progress["history"], list)

    def assert_projected_intervals_shape(self, projected_intervals):
        self.assertEqual(
            {int(key) for key in projected_intervals},
            {0, 1, 2, 3}
        )
        self.assertTrue(all(
            isinstance(value, int)
            for value in projected_intervals.values()
        ))

    def assert_timeline_date_shape(self, value):
        self.assertEqual(set(value), TIMELINE_DATE_KEYS)
        self.assertIn(value["precision"], {"year", "month", "day"})

    def assert_timeline_payload_shape(self, timeline):
        expected_keys = {"kind", "start"}

        if timeline["kind"] == "interval":
            expected_keys.add("end")

        self.assertEqual(set(timeline), expected_keys)
        self.assert_timeline_date_shape(timeline["start"])

        if timeline["kind"] == "interval":
            self.assert_timeline_date_shape(timeline["end"])

    def assert_timeline_review_item_shape(self, item):
        expected_keys = set(TIMELINE_ITEM_KEYS)

        if item["timeline"]["kind"] == "interval":
            expected_keys.add("end_value")

        self.assertEqual(set(item), expected_keys)
        self.assert_timeline_payload_shape(item["timeline"])
        self.assert_progress_shape(item["progress"])
        self.assert_projected_intervals_shape(item["projected_intervals"])
        self.assertIsInstance(item["start_value"], int)

        if item["timeline"]["kind"] == "interval":
            self.assertIsInstance(item["end_value"], int)

    def assert_timeline_grading_shape(self, result):
        self.assertEqual(
            set(result),
            {"quality", "distance", "unit", "guess"}
        )
        self.assertIn(result["quality"], {0, 1, 2})
        self.assertIsInstance(result["distance"], int)
        self.assertIsInstance(result["unit"], str)
        self.assert_timeline_date_shape(result["guess"])

    def test_review_endpoint_returns_backend_grouped_runtime_shapes(self):
        fixture = self.seed_review_contract_fixture()

        response = get_review(db=self.db)
        returned_question_ids = {
            item["question_id"]
            for item in response
            if "question_id" in item
        }

        self.assertEqual(len(response), 4)
        text_items = [
            item
            for item in response
            if item["type_q"] == "text"
        ]
        map_groups = [
            item
            for item in response
            if item["type_q"] == "map"
        ]
        timeline_groups = [
            item
            for item in response
            if item["type_q"] == "timeline"
        ]
        image_groups = [
            item
            for item in response
            if item["type_q"] == "media"
        ]

        self.assertEqual(len(text_items), 1)
        self.assertEqual(len(map_groups), 1)
        self.assertEqual(len(timeline_groups), 1)
        self.assertEqual(len(image_groups), 1)

        text_item = text_items[0]
        self.assertEqual(set(text_item), TEXT_REVIEW_KEYS)
        self.assertEqual(text_item["question_id"], fixture["text"].id)
        self.assertNotIn("items", text_item)
        self.assert_progress_shape(text_item["progress"])
        self.assertNotIn(fixture["future"].id, returned_question_ids)

        map_group = map_groups[0]
        self.assertEqual(set(map_group), MAP_GROUP_KEYS)
        self.assertEqual(map_group["group_id"], fixture["map_group"].id)
        self.assertEqual(map_group["name"], "Europe")
        self.assertEqual(map_group["tags"], ["geo", "map"])
        self.assertNotIn("question_id", map_group)
        self.assertEqual(len(map_group["items"]), 2)
        self.assertIn(
            map_group["mode"],
            {"type_all", "click_prompt", "type_prompt", "multiple_choice"}
        )
        self.assertEqual(len(map_group["context_items"]), 2)

        for zone in map_group["items"]:
            self.assertEqual(set(zone), MAP_ZONE_KEYS)
            self.assert_progress_shape(zone["progress"])
            self.assert_projected_intervals_shape(zone["projected_intervals"])

        for zone in map_group["context_items"]:
            self.assertEqual(set(zone), MAP_ZONE_KEYS)
            self.assert_progress_shape(zone["progress"])
            self.assert_projected_intervals_shape(zone["projected_intervals"])

        mode_difficulty = map_mode_difficulty(
            map_group["mode"],
            len(map_group["context_items"])
        )
        first_map_zone = fixture["map_zones"][0]
        returned_first_map_zone = next(
            zone
            for zone in map_group["items"]
            if zone["question_id"] == first_map_zone.id
        )
        self.assertEqual(
            returned_first_map_zone["projected_intervals"],
            preview_intervals(
                first_map_zone.progress,
                mode_difficulty=mode_difficulty
            )
        )

        self.assertEqual(
            {zone["question_id"] for zone in map_group["items"]},
            {zone.id for zone in fixture["map_zones"]}
        )
        self.assertEqual(
            {zone["code"] for zone in map_group["items"]},
            {"fr", "de"}
        )

        timeline_group = timeline_groups[0]
        self.assertEqual(set(timeline_group), TIMELINE_GROUP_KEYS)
        self.assertEqual(timeline_group["name"], "Timeline")
        self.assertNotIn("question_id", timeline_group)
        self.assertEqual(
            set(timeline_group["range"]),
            {"start_value", "end_value"}
        )
        self.assertEqual(len(timeline_group["items"]), 2)

        for item in timeline_group["items"]:
            self.assert_timeline_review_item_shape(item)

        self.assertEqual(
            {item["question_id"] for item in timeline_group["items"]},
            {item.id for item in fixture["timeline_items"]}
        )

        image_group = image_groups[0]
        self.assertEqual(set(image_group), IMAGE_GROUP_KEYS)
        self.assertEqual(image_group["group_id"], fixture["image_group"].id)
        self.assertEqual(image_group["name"], "Flags")
        self.assertEqual(image_group["tags"], ["flags"])
        self.assertEqual(len(image_group["items"]), 2)
        self.assertIn(
            image_group["mode"],
            {
                "type_all",
                "click_prompt",
                "type_prompt",
                "multiple_choice_label",
                "multiple_choice_image"
            }
        )
        self.assertEqual(len(image_group["context_items"]), 2)

        for item in image_group["items"]:
            self.assertEqual(set(item), IMAGE_ITEM_KEYS)
            self.assert_progress_shape(item["progress"])
            self.assert_projected_intervals_shape(item["projected_intervals"])

        for item in image_group["context_items"]:
            self.assertEqual(set(item), IMAGE_ITEM_KEYS)
            self.assert_progress_shape(item["progress"])
            self.assert_projected_intervals_shape(item["projected_intervals"])

        mode_difficulty = image_mode_difficulty(
            image_group["mode"],
            len(image_group["context_items"])
        )
        first_image_item = fixture["image_items"][0]
        returned_first_image_item = next(
            item
            for item in image_group["items"]
            if item["question_id"] == first_image_item.id
        )
        self.assertEqual(
            returned_first_image_item["projected_intervals"],
            preview_intervals(
                first_image_item.progress,
                mode_difficulty=mode_difficulty
            )
        )

        self.assertEqual(
            {item["question_id"] for item in image_group["items"]},
            {item.id for item in fixture["image_items"]}
        )

    def test_review_randomizes_question_order_inside_runtime_groups(self):
        today = date.today()
        map_group = QuestionGroup(
            id=25,
            type_group="map",
            name="Random map",
            media="/static/random.svg",
            data={}
        )
        self.db.add(map_group)

        for index in range(3):
            self.add_question(
                20 + index,
                type_q="map",
                answer=f"Zone {index}",
                data={"code": f"z{index}"},
                group=map_group,
                next_review=today
            )

        self.db.commit()

        with patch(
            "app.services.review._shuffled",
            side_effect=lambda items: list(reversed(list(items or [])))
        ):
            response = get_review(db=self.db)

        map_payload = next(item for item in response if item["type_q"] == "map")
        item_ids = [
            item["question_id"]
            for item in map_payload["items"]
        ]

        self.assertEqual(item_ids, [22, 21, 20])
        self.assertEqual(
            [item["question_id"] for item in map_payload["context_items"]],
            item_ids
        )

    def test_small_scheduled_map_multiple_choice_borrows_started_context(self):
        today = date.today()
        map_group = QuestionGroup(
            id=30,
            type_group="map",
            name="Small map",
            media="/static/small.svg",
            data={}
        )
        self.db.add(map_group)
        due_zone = self.add_question(
            100,
            type_q="map",
            answer="Due",
            data={"code": "due"},
            group=map_group,
            next_review=today
        )
        future_zones = [
            self.add_question(
                101 + index,
                type_q="map",
                answer=f"Future {index}",
                data={"code": f"f{index}"},
                group=map_group,
                next_review=today + timedelta(days=1)
            )
            for index in range(4)
        ]
        self.db.commit()

        with patch("app.services.mode_selection.random.random", return_value=0):
            response = get_review(db=self.db)

        map_payload = next(item for item in response if item["type_q"] == "map")

        self.assertEqual(map_payload["mode"], "multiple_choice")
        self.assertEqual(
            [item["question_id"] for item in map_payload["items"]],
            [due_zone.id]
        )
        self.assertEqual(
            {item["question_id"] for item in map_payload["context_items"]},
            {due_zone.id, *[zone.id for zone in future_zones]}
        )

    def test_large_scheduled_map_multiple_choice_uses_whole_group_context(self):
        today = date.today()
        map_group = QuestionGroup(
            id=32,
            type_group="map",
            name="Whole group map",
            media="/static/whole.svg",
            data={}
        )
        self.db.add(map_group)
        due_zones = [
            self.add_question(
                120 + index,
                type_q="map",
                answer=f"Due {index}",
                data={"code": f"d{index}"},
                group=map_group,
                next_review=today
            )
            for index in range(5)
        ]
        # Started (reps=1 via add_question) but not due today.
        future_zones = [
            self.add_question(
                130 + index,
                type_q="map",
                answer=f"Future {index}",
                data={"code": f"f{index}"},
                group=map_group,
                next_review=today + timedelta(days=1)
            )
            for index in range(3)
        ]
        self.db.commit()

        with patch("app.services.mode_selection.random.random", return_value=0):
            response = get_review(db=self.db)

        map_payload = next(item for item in response if item["type_q"] == "map")

        self.assertEqual(map_payload["mode"], "multiple_choice")
        self.assertEqual(
            {item["question_id"] for item in map_payload["items"]},
            {zone.id for zone in due_zones}
        )
        # Even though the chunk already has >= 5 due questions, the distractor
        # pool spans the whole group's started questions, not just the session.
        self.assertEqual(
            {item["question_id"] for item in map_payload["context_items"]},
            {zone.id for zone in (*due_zones, *future_zones)}
        )

    def test_small_scheduled_map_falls_back_below_choice_context_minimum(self):
        today = date.today()
        map_group = QuestionGroup(
            id=31,
            type_group="map",
            name="Tiny map",
            media="/static/tiny.svg",
            data={}
        )
        self.db.add(map_group)
        due_zone = self.add_question(
            110,
            type_q="map",
            answer="Due",
            data={"code": "due"},
            group=map_group,
            next_review=today
        )

        for index in range(3):
            self.add_question(
                111 + index,
                type_q="map",
                answer=f"Future {index}",
                data={"code": f"f{index}"},
                group=map_group,
                next_review=today + timedelta(days=1)
            )

        self.db.commit()

        with patch("app.services.mode_selection.random.random", return_value=0):
            response = get_review(db=self.db)

        map_payload = next(item for item in response if item["type_q"] == "map")

        self.assertNotEqual(map_payload["mode"], "multiple_choice")
        self.assertEqual(
            [item["question_id"] for item in map_payload["items"]],
            [due_zone.id]
        )
        self.assertEqual(
            [item["question_id"] for item in map_payload["context_items"]],
            [due_zone.id]
        )

    def test_bonus_image_context_uses_selected_items_and_started_distractors(self):
        today = date.today()
        image_group = QuestionGroup(
            id=32,
            type_group="media",
            name="Bonus flags",
            media=None,
            data={}
        )
        self.db.add(image_group)
        selected_bonus = Question(
            id=120,
            type_q="media",
            question="Flag due",
            answer="Selected bonus",
            media="/static/selected.png",
            tags=[],
            data={},
            group=image_group
        )
        self.db.add(selected_bonus)

        for index in range(3):
            self.db.add(Question(
                id=121 + index,
                type_q="media",
                question=f"Unselected {index}",
                answer=f"Unselected {index}",
                media=f"/static/unselected-{index}.png",
                tags=[],
                data={},
                group=image_group
            ))

        started_distractors = [
            self.add_question(
                124 + index,
                type_q="media",
                question=f"Started {index}",
                answer=f"Started {index}",
                media=f"/static/started-{index}.png",
                group=image_group,
                next_review=today + timedelta(days=1)
            )
            for index in range(4)
        ]
        self.db.commit()

        with patch("app.services.mode_selection.random.random", return_value=0):
            response = get_review_items(
                self.db,
                include_new=True,
                bonus_status={"bonus_question_capacity": 1}
            )

        image_payload = next(item for item in response if item["type_q"] == "media")

        self.assertEqual(image_payload["mode"], "multiple_choice_label")
        self.assertEqual(
            [item["question_id"] for item in image_payload["items"]],
            [selected_bonus.id]
        )
        self.assertEqual(
            {item["question_id"] for item in image_payload["context_items"]},
            {selected_bonus.id, *[item.id for item in started_distractors]}
        )
        self.assertNotIn(
            121,
            [item["question_id"] for item in image_payload["context_items"]]
        )

        answer_media(
            MediaAnswerRequest(
                items={selected_bonus.id: 2},
                mode="multiple_choice_label",
                context_count=len(image_payload["context_items"])
            ),
            db=self.db
        )
        progress_ids = {
            progress.question_id
            for progress in self.db.query(Progress).all()
        }

        self.assertIn(selected_bonus.id, progress_ids)
        self.assertFalse({121, 122, 123} & progress_ids)

    def test_audio_only_media_group_uses_serial_review_modes(self):
        # Audio can't be scanned in a grid, so an audio-only media group must
        # only ever use the prompt->name modes, never the spatial/QCM-media ones.
        today = date.today()
        audio_group = QuestionGroup(
            id=60,
            type_group="media",
            name="Sons de l'alphabet",
            media=None,
            data={}
        )
        self.db.add(audio_group)
        for index in range(8):
            self.add_question(
                200 + index,
                type_q="media",
                answer=f"Lettre {index}",
                media=f"/static/media-groups/60/letter{index}.mp3",
                group=audio_group,
                next_review=today
            )
        self.db.commit()

        serial_modes = {"type_prompt", "multiple_choice_label"}

        # Mode selection is randomised, so sample repeatedly.
        for _ in range(40):
            response = get_review(db=self.db)
            media_groups = [
                item for item in response if item["type_q"] == "media"
            ]

            self.assertTrue(media_groups)

            for group in media_groups:
                self.assertIn(group["mode"], serial_modes)

    def test_review_endpoint_splits_large_image_groups_into_balanced_chunks(self):
        today = date.today()
        image_group = QuestionGroup(
            id=50,
            type_group="media",
            name="Large flags",
            media=None,
            data={}
        )
        self.db.add(image_group)
        image_items = [
            self.add_question(
                100 + index,
                type_q="media",
                answer=f"Flag {index}",
                group=image_group,
                next_review=today
            )
            for index in range(31)
        ]
        self.db.commit()

        response = get_review(db=self.db)
        image_groups = [
            item
            for item in response
            if item["type_q"] == "media"
        ]
        chunk_sizes = [len(group["items"]) for group in image_groups]
        returned_ids = {
            item["question_id"]
            for group in image_groups
            for item in group["items"]
        }

        self.assertEqual(chunk_sizes, [16, 15])
        self.assertTrue(all(size <= 30 for size in chunk_sizes))
        self.assertEqual(
            returned_ids,
            {item.id for item in image_items}
        )

        image_mc_modes = {"multiple_choice_label", "multiple_choice_image"}
        all_started_ids = {item.id for item in image_items}

        for group in image_groups:
            if group["mode"] in image_mc_modes:
                # Multiple choice draws distractors from the whole group's
                # started questions, not just the current chunk.
                self.assertEqual(
                    {item["question_id"] for item in group["context_items"]},
                    all_started_ids
                )
            else:
                self.assertEqual(
                    [item["question_id"] for item in group["context_items"]],
                    [item["question_id"] for item in group["items"]]
                )

        self.assertTrue(all(
            group["mode"] in {
                "type_all",
                "click_prompt",
                "type_prompt",
                "multiple_choice_label",
                "multiple_choice_image"
            }
            for group in image_groups
        ))

    def test_review_endpoint_splits_large_map_groups_into_balanced_chunks(self):
        today = date.today()
        map_group = QuestionGroup(
            id=52,
            type_group="map",
            name="Large map",
            media="/static/large-map.svg",
            data={}
        )
        self.db.add(map_group)
        map_items = [
            self.add_question(
                250 + index,
                type_q="map",
                answer=f"Zone {index}",
                data={"code": f"z{index}"},
                group=map_group,
                next_review=today
            )
            for index in range(31)
        ]
        self.db.commit()

        response = get_review(db=self.db)
        map_groups = [
            item
            for item in response
            if item["type_q"] == "map"
        ]
        chunk_sizes = [len(group["items"]) for group in map_groups]
        returned_ids = [
            item["question_id"]
            for group in map_groups
            for item in group["items"]
        ]

        self.assertEqual(chunk_sizes, [16, 15])
        self.assertTrue(all(size <= 30 for size in chunk_sizes))
        self.assertEqual(set(returned_ids), {item.id for item in map_items})
        self.assertEqual(len(returned_ids), len(set(returned_ids)))

        all_started_ids = {item.id for item in map_items}

        for group in map_groups:
            if group["mode"] == "multiple_choice":
                # Multiple choice draws distractors from the whole group's
                # started questions, not just the current chunk.
                self.assertEqual(
                    {item["question_id"] for item in group["context_items"]},
                    all_started_ids
                )
            else:
                self.assertEqual(
                    [item["question_id"] for item in group["context_items"]],
                    [item["question_id"] for item in group["items"]]
                )

    def test_review_endpoint_splits_large_mixed_groups_by_affinity(self):
        today = date.today()
        image_group = QuestionGroup(
            id=53,
            type_group="media",
            name="Mixed flags",
            media=None,
            data={}
        )
        self.db.add(image_group)
        image_items = []

        for index in range(36):
            item = self.add_question(
                400 + index,
                type_q="media",
                answer=f"Flag {index}",
                group=image_group,
                next_review=today
            )

            if index < 12:
                item.progress.reps = 1
                item.progress.difficulty = 3.0
            elif index < 24:
                item.progress.reps = 3
                item.progress.difficulty = 5.0
            else:
                item.progress.reps = 4
                item.progress.difficulty = 3.0

            image_items.append(item)

        self.db.commit()

        response = get_review(db=self.db)
        image_groups = [
            item
            for item in response
            if item["type_q"] == "media"
        ]
        chunks = [
            [item["question_id"] for item in group["items"]]
            for group in image_groups
        ]
        returned_ids = [
            question_id
            for chunk in chunks
            for question_id in chunk
        ]

        self.assertEqual(len(image_groups), 3)
        self.assertEqual([len(chunk) for chunk in chunks], [12, 12, 12])
        self.assertEqual(
            set(chunks[0]),
            {item.id for item in image_items[:12]}
        )
        self.assertEqual(
            set(chunks[1]),
            {item.id for item in image_items[12:24]}
        )
        self.assertEqual(
            set(chunks[2]),
            {item.id for item in image_items[24:]}
        )
        self.assertEqual(set(returned_ids), {item.id for item in image_items})
        self.assertEqual(len(returned_ids), len(set(returned_ids)))

        image_mc_modes = {"multiple_choice_label", "multiple_choice_image"}
        all_started_ids = {item.id for item in image_items}

        for group in image_groups:
            if group["mode"] in image_mc_modes:
                # Multiple choice draws distractors from the whole group's
                # started questions, not just the current chunk.
                self.assertEqual(
                    {item["question_id"] for item in group["context_items"]},
                    all_started_ids
                )
            else:
                self.assertEqual(
                    [item["question_id"] for item in group["context_items"]],
                    [item["question_id"] for item in group["items"]]
                )

    def test_review_endpoint_does_not_split_thirty_image_items(self):
        today = date.today()
        image_group = QuestionGroup(
            id=51,
            type_group="media",
            name="Compact flags",
            media=None,
            data={}
        )
        self.db.add(image_group)
        image_items = [
            self.add_question(
                200 + index,
                type_q="media",
                answer=f"Flag {index}",
                group=image_group,
                next_review=today
            )
            for index in range(30)
        ]
        self.db.commit()

        response = get_review(db=self.db)
        image_groups = [
            item
            for item in response
            if item["type_q"] == "media"
        ]

        self.assertEqual(len(image_groups), 1)
        self.assertEqual(len(image_groups[0]["items"]), 30)
        self.assertEqual(
            {item["question_id"] for item in image_groups[0]["items"]},
            {item.id for item in image_items}
        )

    def test_answer_map_endpoint_returns_ack_shape_for_zone_grades(self):
        fixture = self.seed_review_contract_fixture()
        zone_a, zone_b = fixture["map_zones"]

        response = answer_map(
            MapAnswerRequest(items={
                zone_a.id: 2,
                zone_b.id: 0
            }, mode="click_prompt"),
            db=self.db
        )

        self.assertEqual(response, {"status": "ok"})

        qualities_by_question_id = {
            progress.question_id: progress.history[-1]["quality"]
            for progress in (
                self.db.query(Progress)
                .filter(Progress.question_id.in_([zone_a.id, zone_b.id]))
                .all()
            )
        }
        self.assertEqual(qualities_by_question_id, {
            zone_a.id: 2,
            zone_b.id: 0
        })
        zone_a_history = zone_a.progress.history[-1]
        self.assertEqual(zone_a_history["map_mode"], "click_prompt")
        self.assertEqual(zone_a_history["raw_quality"], 2)
        self.assertEqual(zone_a_history["effective_quality"], 2)
        self.assertEqual(zone_a_history["map_context_count"], 2)
        self.assertTrue(zone_a_history["mode_adjusted"])
        self.assertAlmostEqual(
            zone_a_history["mode_difficulty"],
            map_mode_difficulty("click_prompt", 2)
        )
        self.assertIn("mode_reward_factor", zone_a_history)

    def test_review_endpoint_returns_missed_map_items_after_group_submit(self):
        fixture = self.seed_review_contract_fixture()
        zone_a, zone_b = fixture["map_zones"]

        answer_map(
            MapAnswerRequest(items={
                zone_a.id: 2,
                zone_b.id: 0
            }),
            db=self.db
        )

        response = get_review(db=self.db)
        map_groups = [
            item
            for item in response
            if item["type_q"] == "map"
        ]

        self.assertEqual(len(map_groups), 1)
        self.assertEqual(
            [item["question_id"] for item in map_groups[0]["items"]],
            [zone_b.id]
        )
        self.assertEqual(zone_b.progress.next_review, date.today())

    def test_answer_media_endpoint_returns_ack_shape_for_item_grades(self):
        fixture = self.seed_review_contract_fixture()
        item_a, item_b = fixture["image_items"]

        response = answer_media(
            MediaAnswerRequest(items={
                item_a.id: 3,
                item_b.id: 0
            }, mode="multiple_choice_image", context_count=5),
            db=self.db
        )

        self.assertEqual(response, {"status": "ok"})

        qualities_by_question_id = {
            progress.question_id: progress.history[-1]["quality"]
            for progress in (
                self.db.query(Progress)
                .filter(Progress.question_id.in_([item_a.id, item_b.id]))
                .all()
            )
        }
        self.assertEqual(qualities_by_question_id, {
            item_a.id: 3,
            item_b.id: 0
        })
        item_a_history = item_a.progress.history[-1]
        self.assertEqual(item_a_history["image_mode"], "multiple_choice_image")
        self.assertEqual(item_a_history["raw_quality"], 3)
        self.assertEqual(item_a_history["effective_quality"], 3)
        self.assertEqual(item_a_history["image_context_count"], 5)
        self.assertEqual(item_a_history["image_choice_count"], 4)
        self.assertTrue(item_a_history["mode_adjusted"])
        self.assertEqual(
            item_a_history["mode_difficulty"],
            image_mode_difficulty("multiple_choice_image", 5)
        )
        self.assertIn("mode_reward_factor", item_a_history)

    def test_review_endpoint_returns_missed_image_items_below_click_minimum(self):
        fixture = self.seed_review_contract_fixture()
        item_a, item_b = fixture["image_items"]

        answer_media(
            MediaAnswerRequest(items={
                item_a.id: 2,
                item_b.id: 0
            }, mode="click_prompt"),
            db=self.db
        )

        response = get_review(db=self.db)
        image_groups = [
            item
            for item in response
            if item["type_q"] == "media"
        ]

        self.assertEqual(len(image_groups), 1)
        self.assertEqual(
            [item["question_id"] for item in image_groups[0]["items"]],
            [item_b.id]
        )
        self.assertEqual(
            [item["question_id"] for item in image_groups[0]["context_items"]],
            [item_b.id]
        )
        self.assertNotEqual(image_groups[0]["mode"], "click_prompt")
        self.assertEqual(item_b.progress.next_review, date.today())

    def test_answer_media_uses_submitted_chunk_size_for_mode_metadata(self):
        today = date.today()
        image_group = QuestionGroup(
            id=60,
            type_group="media",
            name="Many flags",
            media=None,
            data={}
        )
        self.db.add(image_group)
        image_items = [
            self.add_question(
                300 + index,
                type_q="media",
                answer=f"Flag {index}",
                group=image_group,
                next_review=today
            )
            for index in range(12)
        ]
        self.db.commit()
        submitted_items = image_items[:5]

        response = answer_media(
            MediaAnswerRequest(
                items={
                    item.id: 2
                    for item in submitted_items
                },
                mode="click_prompt"
            ),
            db=self.db
        )

        self.assertEqual(response, {"status": "ok"})

        history = submitted_items[0].progress.history[-1]
        self.assertEqual(history["image_mode"], "click_prompt")
        self.assertEqual(history["image_context_count"], 5)
        self.assertAlmostEqual(
            history["mode_difficulty"],
            image_mode_difficulty("click_prompt", 5)
        )

    def test_answer_timeline_endpoint_returns_per_item_result_shapes(self):
        fixture = self.seed_review_contract_fixture()
        point, interval = fixture["timeline_items"]

        response = answer_timeline(
            TimelineAnswerRequest(items={
                point.id: TimelineAnswerItem(
                    start=TimelineDateValue(
                        year=1969,
                        precision="year"
                    )
                ),
                interval.id: TimelineAnswerItem(
                    start=TimelineDateValue(
                        year=1914,
                        precision="year"
                    ),
                    end=TimelineDateValue(
                        year=1918,
                        precision="year"
                    )
                )
            }),
            db=self.db
        )

        self.assertEqual(set(response), {"status", "results"})
        self.assertEqual(response["status"], "ok")
        self.assertEqual(len(response["results"]), 2)

        results = sorted(
            response["results"],
            key=lambda item: item["question_id"]
        )
        point_result, interval_result = results

        for result in results:
            self.assertEqual(set(result), TIMELINE_RESULT_KEYS)
            self.assertEqual(result["quality"], 2)
            self.assert_timeline_payload_shape(result["expected"])
            self.assertEqual(set(result["guess"]), {"start", "end"})
            self.assert_timeline_date_shape(result["guess"]["start"])
            self.assert_timeline_grading_shape(result["start"])
            self.assert_progress_shape(result["progress"])

        self.assertIsNone(point_result["guess"]["end"])
        self.assertIsNone(point_result["end"])

        self.assert_timeline_date_shape(interval_result["guess"]["end"])
        self.assert_timeline_grading_shape(interval_result["end"])

    def test_review_serializers_expose_frontend_contract_shapes(self):
        fixture = self.seed_review_contract_fixture()
        text = fixture["text"]
        map_group = fixture["map_group"]
        map_zone = fixture["map_zones"][0]
        image_group = fixture["image_group"]
        image_item = fixture["image_items"][0]
        timeline_point, timeline_interval = fixture["timeline_items"]

        self.assertEqual(set(serialize_progress(text.progress)), PROGRESS_KEYS)
        self.assertEqual(set(serialize_progress(None)), PROGRESS_KEYS)

        text_payload = serialize_review_question_item(text)
        self.assertEqual(set(text_payload), TEXT_REVIEW_KEYS)
        self.assertEqual(text_payload["question_id"], text.id)
        self.assert_progress_shape(text_payload["progress"])

        map_group_payload = serialize_map_review_group(map_group, tags=["geo"])
        self.assertEqual(set(map_group_payload), MAP_GROUP_KEYS)
        self.assertEqual(map_group_payload["type_q"], "map")
        self.assertEqual(map_group_payload["mode"], "type_all")
        self.assertEqual(map_group_payload["context_items"], [])
        self.assertEqual(map_group_payload["items"], [])
        self.assertNotIn("progress", map_group_payload)

        map_zone_payload = serialize_map_review_zone(map_zone)
        self.assertEqual(set(map_zone_payload), MAP_ZONE_KEYS)
        self.assertEqual(map_zone_payload["question_id"], map_zone.id)
        self.assertEqual(map_zone_payload["code"], "fr")
        self.assertEqual(map_zone_payload["label"], "France")
        self.assert_progress_shape(map_zone_payload["progress"])
        self.assert_projected_intervals_shape(
            map_zone_payload["projected_intervals"]
        )

        image_group_payload = serialize_media_review_group(
            image_group,
            tags=["flags"]
        )
        self.assertEqual(set(image_group_payload), IMAGE_GROUP_KEYS)
        self.assertEqual(image_group_payload["type_q"], "media")
        self.assertEqual(image_group_payload["mode"], "type_prompt")
        self.assertEqual(image_group_payload["context_items"], [])
        self.assertEqual(image_group_payload["items"], [])
        self.assertNotIn("progress", image_group_payload)

        image_item_payload = serialize_media_review_item(image_item)
        self.assertEqual(set(image_item_payload), IMAGE_ITEM_KEYS)
        self.assertEqual(image_item_payload["question_id"], image_item.id)
        self.assertEqual(image_item_payload["label"], "France")
        self.assertEqual(image_item_payload["media"], "/static/france.png")
        self.assert_progress_shape(image_item_payload["progress"])
        self.assert_projected_intervals_shape(
            image_item_payload["projected_intervals"]
        )

        timeline_point_payload = serialize_timeline_review_item(timeline_point)
        timeline_interval_payload = serialize_timeline_review_item(
            timeline_interval
        )
        self.assert_timeline_review_item_shape(timeline_point_payload)
        self.assertNotIn("end_value", timeline_point_payload)
        self.assert_timeline_review_item_shape(timeline_interval_payload)
        self.assertIn("end_value", timeline_interval_payload)

        timeline_group_payload = serialize_timeline_review_group([
            timeline_point_payload,
            timeline_interval_payload
        ])
        self.assertEqual(set(timeline_group_payload), TIMELINE_GROUP_KEYS)
        self.assertEqual(timeline_group_payload["type_q"], "timeline")
        self.assertEqual(
            timeline_group_payload["items"],
            [timeline_point_payload, timeline_interval_payload]
        )
        self.assertEqual(
            set(timeline_group_payload["range"]),
            {"start_value", "end_value"}
        )


if __name__ == "__main__":
    unittest.main()
