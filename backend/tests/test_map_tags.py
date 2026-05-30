import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Progress, Question, QuestionGroup
from app.routers.review import get_review
from app.schemas import MapZonesBulkUpdate
from app.services.map_zones import save_map_group_zones


class MapTagTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def test_bulk_save_applies_group_tags_to_existing_and_created_zones(self):
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
                    "tags": ["geo", "capitales"]
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

        self.assertEqual(response["group"]["tags"], ["geo", "capitales"])
        self.assertEqual(response["question_count"], 3)
        self.assertEqual(len(response["zones"]), 3)
        self.assertTrue(all(
            question.tags == ["geo", "capitales"]
            for question in questions
        ))

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
                tags=["geo", "capitales"],
                data={"code": "fr", "aliases": []},
                group=group
            ),
            Question(
                type_q="map",
                question="Europe - de",
                answer="Allemagne",
                media="",
                tags=["geo", "capitales"],
                data={"code": "de", "aliases": []},
                group=group
            )
        ]

        self.db.add_all([group, *questions])
        self.db.flush()
        self.db.add_all([
            Progress(question_id=question.id, next_review=date.today())
            for question in questions
        ])
        self.db.commit()

        response = get_review(db=self.db)

        self.assertEqual(len(response), 1)
        self.assertEqual(response[0]["type_q"], "map")
        self.assertEqual(response[0]["tags"], ["geo", "capitales"])
        self.assertEqual(len(response[0]["items"]), 2)


if __name__ == "__main__":
    unittest.main()
