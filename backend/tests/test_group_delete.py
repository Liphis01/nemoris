import unittest
from datetime import date

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base,
    Collection,
    Progress,
    Question,
    QuestionGroup,
    question_collection
)
from app.routers.groups import delete_group
from app.services.questions import delete_question


class GroupDeleteTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def association_count(self):
        return self.db.execute(
            select(func.count()).select_from(question_collection)
        ).scalar_one()

    def test_delete_group_deletes_questions_progress_and_collection_links(self):
        group = QuestionGroup(
            type_group="map",
            name="France",
            media="france.svg",
            data={}
        )
        collection = Collection(name="Geography")
        questions = [
            Question(
                type_q="map",
                question="France - dep_75",
                answer="Paris",
                media="",
                tags=[],
                data={"code": "dep_75"},
                group=group,
                collections=[collection]
            ),
            Question(
                type_q="map",
                question="France - dep_69",
                answer="Rhone",
                media="",
                tags=[],
                data={"code": "dep_69"},
                group=group
            )
        ]

        self.db.add_all([group, collection, *questions])
        self.db.flush()
        self.db.add_all([
            Progress(question_id=questions[0].id, next_review=date.today()),
            Progress(question_id=questions[1].id, next_review=date.today())
        ])
        self.db.commit()

        self.assertEqual(self.db.query(Question).count(), 2)
        self.assertEqual(self.db.query(Progress).count(), 2)
        self.assertEqual(self.association_count(), 1)

        response = delete_group(group.id, db=self.db)

        self.assertEqual(response, {"status": "deleted"})
        self.assertEqual(self.db.query(QuestionGroup).count(), 0)
        self.assertEqual(self.db.query(Question).count(), 0)
        self.assertEqual(self.db.query(Progress).count(), 0)
        self.assertEqual(self.association_count(), 0)
        self.assertEqual(self.db.query(Collection).count(), 1)

    def test_delete_question_still_deletes_progress_and_collection_links(self):
        group = QuestionGroup(
            type_group="map",
            name="France",
            media="france.svg",
            data={}
        )
        collection = Collection(name="Geography")
        question = Question(
            type_q="map",
            question="France - dep_75",
            answer="Paris",
            media="",
            tags=[],
            data={"code": "dep_75"},
            group=group,
            collections=[collection]
        )

        self.db.add_all([group, collection, question])
        self.db.flush()
        self.db.add(
            Progress(question_id=question.id, next_review=date.today())
        )
        self.db.commit()

        delete_question(self.db, question.id)

        self.assertEqual(self.db.query(QuestionGroup).count(), 0)
        self.assertEqual(self.db.query(Question).count(), 0)
        self.assertEqual(self.db.query(Progress).count(), 0)
        self.assertEqual(self.association_count(), 0)
        self.assertEqual(self.db.query(Collection).count(), 1)


if __name__ == "__main__":
    unittest.main()
