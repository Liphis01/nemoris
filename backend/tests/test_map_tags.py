import unittest
import uuid
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Progress, Question, QuestionGroup
from app.routers.review import get_review
from app.schemas import MapZonesBulkUpdate
from app.services.map_zones import save_map_group_zones
from app.services.tag_hierarchy import apply_tag_actions, load_tag_hierarchy
from app.services.training import (
    group_training_fingerprint,
    serialize_previous_training_record,
    serialize_training_record
)


class MapTagTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def seed_training_record(self, group):
        group.data = {
            **(group.data or {}),
            "training_record": {
                "best_found_percent": 100,
                "best_found_count": 2,
                "best_found_elapsed_ms": 4000,
                "best_found_at": "2026-06-01T10:00:00+00:00",
                "question_count": 2,
                "content_fingerprint": group_training_fingerprint(
                    self.db,
                    group
                )
            }
        }
        self.db.commit()

    def create_tag(self, label, parent_id=None):
        created_id = str(uuid.uuid4())
        hierarchy = load_tag_hierarchy(self.db)
        apply_tag_actions(self.db, hierarchy["revision"], [{
            "type": "create",
            "tag_id": created_id,
            "label": label,
            "parent_ids": [parent_id] if parent_id else []
        }])
        self.db.commit()
        return created_id

    def test_bulk_save_applies_group_tags_to_existing_and_created_zones(self):
        geo_id = self.create_tag("Geo", "core:geography")
        capitals_id = self.create_tag("Capitales", "core:geography")
        group = QuestionGroup(
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={}
        )
        existing = Question(
            type_q="map",
            question="Europe - fr",
            answer="France",
            media="",
            tags=["old"],
            data={"code": "fr", "aliases": []},
            group=group
        )
        untouched = Question(
            type_q="map",
            question="Europe - es",
            answer="Espagne",
            media="",
            tags=["old"],
            data={"code": "es", "aliases": []},
            group=group
        )

        self.db.add_all([group, existing, untouched])
        self.db.commit()

        response = save_map_group_zones(
            self.db,
            group.id,
            MapZonesBulkUpdate(
                group={
                    "name": "Europe",
                    "media": "europe.svg",
                    "tags": [geo_id, capitals_id]
                },
                zones=[
                    {
                        "id": existing.id,
                        "code": "fr",
                        "answer": "France",
                        "aliases": ["FR"]
                    },
                    {
                        "code": "de",
                        "answer": "Allemagne",
                        "aliases": ["Deutschland"]
                    }
                ]
            )
        )

        questions = (
            self.db.query(Question)
            .filter(Question.group_id == group.id)
            .all()
        )

        self.assertEqual(response["group"]["tags"], [geo_id, capitals_id])
        self.assertEqual(response["question_count"], 3)
        self.assertEqual(len(response["zones"]), 3)
        self.assertTrue(all(
            question.tags == [geo_id, capitals_id]
            for question in questions
        ))

    def served_record(self, group):
        return serialize_training_record(
            group.data,
            group_training_fingerprint(self.db, group)
        )

    def test_bulk_save_invalidates_record_only_on_membership_or_map_change(self):
        geo_id = self.create_tag("Geo", "core:geography")
        group = QuestionGroup(
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={"theme": "blue"}
        )
        first = Question(
            type_q="map",
            question="Europe - fr",
            answer="France",
            media="",
            tags=["old"],
            data={"code": "fr", "aliases": ["FR"]},
            group=group
        )
        second = Question(
            type_q="map",
            question="Europe - de",
            answer="Allemagne",
            media="",
            tags=["old"],
            data={"code": "de", "aliases": []},
            group=group
        )

        self.db.add_all([group, first, second])
        self.db.commit()
        self.seed_training_record(group)

        # Editing a zone's answer/aliases is a content fix; membership and the
        # map image are unchanged, so the record survives.
        save_map_group_zones(
            self.db,
            group.id,
            MapZonesBulkUpdate(
                group={
                    "name": "European map",
                    "media": "europe.svg",
                    "tags": [geo_id]
                },
                zones=[
                    {
                        "id": first.id,
                        "code": "fr",
                        "answer": "France",
                        "aliases": ["FR"]
                    },
                    {
                        "id": second.id,
                        "code": "de",
                        "answer": "Germany",
                        "aliases": []
                    }
                ]
            )
        )
        self.assertIsNotNone(self.served_record(group))
        self.assertEqual(group.data["theme"], "blue")

        # Swapping the map's background image is a whole-group change, so the
        # record is retired.
        save_map_group_zones(
            self.db,
            group.id,
            MapZonesBulkUpdate(
                group={
                    "name": "European map",
                    "media": "europe-v2.svg",
                    "tags": [geo_id]
                },
                zones=[
                    {
                        "id": first.id,
                        "code": "fr",
                        "answer": "France",
                        "aliases": ["FR"]
                    },
                    {
                        "id": second.id,
                        "code": "de",
                        "answer": "Germany",
                        "aliases": []
                    }
                ]
            )
        )
        self.assertIsNone(self.served_record(group))
        self.assertIsNotNone(
            serialize_previous_training_record(
                group.data,
                group_training_fingerprint(self.db, group)
            )
        )

        # Re-seed against the current content, then add a zone: membership
        # changes, so the record is retired again.
        self.seed_training_record(group)
        self.assertIsNotNone(self.served_record(group))
        save_map_group_zones(
            self.db,
            group.id,
            MapZonesBulkUpdate(
                group={
                    "name": "European map",
                    "media": "europe-v2.svg",
                    "tags": [geo_id]
                },
                zones=[
                    {
                        "id": first.id,
                        "code": "fr",
                        "answer": "France",
                        "aliases": ["FR"]
                    },
                    {
                        "id": second.id,
                        "code": "de",
                        "answer": "Germany",
                        "aliases": []
                    },
                    {
                        "code": "es",
                        "answer": "Spain",
                        "aliases": []
                    }
                ]
            )
        )
        self.assertIsNone(self.served_record(group))
        self.assertIsNotNone(
            serialize_previous_training_record(
                group.data,
                group_training_fingerprint(self.db, group)
            )
        )

    def test_review_map_group_includes_shared_tags(self):
        group = QuestionGroup(
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={}
        )
        questions = [
            Question(
                type_q="map",
                question="Europe - fr",
                answer="France",
                media="",
                tags=["geo", "capitals"],
                data={"code": "fr", "aliases": []},
                group=group
            ),
            Question(
                type_q="map",
                question="Europe - de",
                answer="Allemagne",
                media="",
                tags=["geo", "capitals"],
                data={"code": "de", "aliases": []},
                group=group
            )
        ]

        self.db.add_all([group, *questions])
        self.db.flush()
        self.db.add_all([
            Progress(
                question_id=question.id,
                next_review=date.today(),
                reps=1
            )
            for question in questions
        ])
        self.db.commit()

        response = get_review(db=self.db)

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["type_q"], "map")
        self.assertEqual(response[0]["tags"], ["geo", "capitals"])
        self.assertEqual(len(response[0]["items"]), 2)


if __name__ == "__main__":
    unittest.main()
