import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Collection, Question, QuestionGroup, Tombstone
from app.routers.collections import delete_collection
from app.routers.groups import delete_group
from app.services.questions import delete_question


class TombstoneTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def tombstones(self):
        return [
            (row.entity_type, row.guid)
            for row in self.db.query(Tombstone).all()
        ]

    def test_delete_question_records_tombstone(self):
        question = Question(id=1, type_q="text", question="Q1", tags=[])
        self.db.add(question)
        self.db.commit()
        guid = question.guid

        delete_question(self.db, 1)

        self.assertEqual(self.tombstones(), [("question", guid)])

    def test_delete_last_question_tombstones_empty_group(self):
        group = QuestionGroup(id=1, type_group="media", name="G1")
        question = Question(
            id=1,
            type_q="media",
            question="Q1",
            tags=[],
            group_id=1
        )
        self.db.add_all([group, question])
        self.db.commit()

        delete_question(self.db, 1)

        self.assertEqual(
            sorted(self.tombstones()),
            sorted([
                ("question", question.guid),
                ("question_group", group.guid)
            ])
        )

    def test_delete_group_tombstones_group_and_questions(self):
        group = QuestionGroup(id=1, type_group="map", name="G1")
        first = Question(
            id=1, type_q="map", question="Q1", tags=[], group_id=1
        )
        second = Question(
            id=2, type_q="map", question="Q2", tags=[], group_id=1
        )
        self.db.add_all([group, first, second])
        self.db.commit()

        # Capture guids before deletion detaches the rows.
        group_guid = group.guid
        question_guids = {first.guid, second.guid}

        delete_group(1, self.db)

        recorded = self.tombstones()

        self.assertIn(("question_group", group_guid), recorded)

        for guid in question_guids:
            self.assertIn(("question", guid), recorded)

        self.assertEqual(len(recorded), 3)

    def test_delete_collection_records_tombstone(self):
        collection = Collection(id=1, name="C1")
        self.db.add(collection)
        self.db.commit()
        guid = collection.guid

        delete_collection(1, self.db)

        self.assertIn(("collection", guid), self.tombstones())


if __name__ == "__main__":
    unittest.main()
