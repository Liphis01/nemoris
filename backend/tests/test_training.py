import unittest
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Progress, Question, QuestionGroup
from app.routers.training import grade_timeline_training
from app.schemas import (
    TimelineAnswerItem,
    TimelineAnswerRequest,
    TimelineDateValue
)
from app.services.training import get_training_items, list_training_scopes


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
            media=None,
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
        self.assertEqual(response[0]["tags"], ["Geo"])
        self.assertEqual(
            {item["question_id"] for item in response[0]["items"]},
            {1, 2}
        )

    def test_tag_training_is_exact_case_insensitive(self):
        today = date.today()
        group = QuestionGroup(
            id=20,
            type_group="image",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add(group)
        self.add_question(1, tags=["Geo"], reps=1, next_review=today)
        self.add_question(2, tags=["geology"], reps=1, next_review=today)
        self.add_question(
            3,
            type_q="image",
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
            if item["type_q"] == "image"
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

        response = list_training_scopes(self.db)

        self.assertEqual(response["groups"][0]["id"], group.id)
        self.assertEqual(response["groups"][0]["question_count"], 1)
        self.assertEqual(response["groups"][0]["tags"], ["Geo"])
        self.assertEqual(response["tags"], [
            {"name": "Geo", "count": 2},
            {"name": "History", "count": 2}
        ])

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
