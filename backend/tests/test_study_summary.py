import unittest
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import (
    Collection,
    PackSubscription,
    Progress,
    Question,
    QuestionGroup
)
from app.services.study_summary import (
    classify_mastery_bucket,
    build_study_scope_summary
)
from app.services.tag_hierarchy import apply_tag_actions, load_tag_hierarchy
from app.services.training import group_training_fingerprint


def history_entry(day, quality):
    return {
        "reviewed_on": day.isoformat(),
        "quality": quality,
        "stability": 1.0,
        "difficulty": 5.0,
        "reps": 1,
        "lapses": 1 if quality == 0 else 0,
        "interval": 1,
        "next_review": (day + timedelta(days=1)).isoformat()
    }


class StudySummaryTests(unittest.TestCase):
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
        *,
        type_q="text",
        question=None,
        answer=None,
        media=None,
        tags=None,
        data=None,
        group=None,
        suspended=False,
        pack_guid=None
    ):
        item = Question(
            id=question_id,
            type_q=type_q,
            question=question or f"Question {question_id}",
            answer=answer if answer is not None else f"Answer {question_id}",
            media=media,
            tags=tags or [],
            data=data or {},
            group=group,
            suspended=suspended,
            pack_guid=pack_guid
        )
        self.db.add(item)
        return item

    def add_progress(
        self,
        question,
        *,
        today,
        reps=1,
        stability=1.0,
        lapses=0,
        next_review=None,
        history=None
    ):
        progress = Progress(
            question=question,
            stability=stability,
            difficulty=5.0,
            reps=reps,
            lapses=lapses,
            interval=1,
            last_review=today - timedelta(days=1),
            next_review=next_review,
            history=history or []
        )
        self.db.add(progress)
        return progress

    def test_bucket_classification_is_pure_and_conservative(self):
        today = date(2026, 8, 14)
        unseen = Question(id=1, type_q="text", question="A", answer="B")
        fragile = Question(id=2, type_q="text", question="A", answer="B")
        fragile.progress = Progress(
            reps=3,
            stability=80,
            history=[history_entry(today - timedelta(days=2), 0)]
        )
        learning = Question(id=3, type_q="text", question="A", answer="B")
        learning.progress = Progress(reps=1, stability=12, history=[])
        stable = Question(id=4, type_q="text", question="A", answer="B")
        stable.progress = Progress(reps=2, stability=30, history=[])
        mastered = Question(id=5, type_q="text", question="A", answer="B")
        mastered.progress = Progress(reps=3, stability=60, history=[])
        suspended = Question(
            id=6,
            type_q="text",
            question="A",
            answer="B",
            suspended=True
        )
        unavailable = Question(id=7, type_q="map", question="A", answer="")

        self.assertEqual(classify_mastery_bucket(unseen, today), "unseen")
        self.assertEqual(classify_mastery_bucket(fragile, today), "fragile")
        self.assertEqual(classify_mastery_bucket(learning, today), "learning")
        self.assertEqual(classify_mastery_bucket(stable, today), "stable")
        self.assertEqual(classify_mastery_bucket(mastered, today), "mastered")
        self.assertEqual(classify_mastery_bucket(suspended, today), "suspended")
        self.assertEqual(
            classify_mastery_bucket(unavailable, today),
            "unavailable"
        )

    def test_group_summary_aggregates_atomic_progress_without_creating_rows(self):
        today = date(2026, 8, 14)
        group = QuestionGroup(
            id=10,
            type_group="map",
            name="Départements français",
            media="france.svg",
            data={}
        )
        self.db.add(group)
        unseen = self.add_question(
            1,
            type_q="map",
            answer="Ain",
            data={"code": "01"},
            group=group
        )
        due_learning = self.add_question(
            2,
            type_q="map",
            answer="Aisne",
            data={"code": "02"},
            group=group
        )
        fragile = self.add_question(
            3,
            type_q="map",
            answer="Allier",
            data={"code": "03"},
            group=group
        )
        stable = self.add_question(
            4,
            type_q="map",
            answer="Alpes",
            data={"code": "04"},
            group=group
        )
        mastered = self.add_question(
            5,
            type_q="map",
            answer="Ardèche",
            data={"code": "07"},
            group=group
        )
        suspended = self.add_question(
            6,
            type_q="map",
            answer="Ariège",
            data={"code": "09"},
            group=group,
            suspended=True
        )
        self.add_question(
            7,
            type_q="map",
            answer="",
            data={"code": "00"},
            group=group
        )
        confused_history = history_entry(today - timedelta(days=1), 0)
        confused_history["answer_event"] = {
            "expected_card_id": fragile.id,
            "resolved_response_id": stable.id,
            "raw_response": "Alpes",
            "expected_value": "Allier",
            "type_q": "map",
            "presentation_kind": "map_group",
            "mode": "multiple_choice",
            "direction": "label_to_zone",
            "candidate_ids": [fragile.id, stable.id],
            "answer_policy": {"preset": "relaxed"}
        }
        self.add_progress(
            due_learning,
            today=today,
            reps=1,
            stability=12,
            next_review=today
        )
        self.add_progress(
            fragile,
            today=today,
            reps=3,
            stability=80,
            lapses=1,
            next_review=today + timedelta(days=3),
            history=[confused_history]
        )
        self.add_progress(
            stable,
            today=today,
            reps=2,
            stability=30,
            next_review=today + timedelta(days=5)
        )
        self.add_progress(
            mastered,
            today=today,
            reps=3,
            stability=90,
            next_review=today + timedelta(days=20)
        )
        self.db.commit()
        progress_count = self.db.query(Progress).count()

        summary = build_study_scope_summary(
            self.db,
            "group",
            group_id=group.id,
            today=today
        )

        self.assertEqual(self.db.query(Progress).count(), progress_count)
        self.assertEqual(summary["scope"]["name"], "Départements français")
        self.assertEqual(summary["scope"]["question_count"], 7)
        self.assertEqual(summary["scope"]["audio_only"], False)
        self.assertEqual(summary["counts"]["total_atomic_questions"], 7)
        self.assertEqual(summary["counts"]["active_questions"], 5)
        self.assertEqual(summary["counts"]["suspended"], 1)
        self.assertEqual(summary["counts"]["unavailable"], 1)
        self.assertEqual(summary["counts"]["due_now"], 1)
        self.assertEqual(summary["counts"]["recent_miss_items"], 1)
        self.assertEqual(summary["counts"]["lapse_total"], 1)
        self.assertEqual(summary["buckets"], {
            "unseen": 1,
            "learning": 1,
            "fragile": 1,
            "stable": 1,
            "mastered": 1
        })
        self.assertEqual(summary["upcoming_load"]["total"], 3)
        self.assertEqual(
            summary["available_modes"][0]["review_modes"],
            ["type_all", "click_prompt", "type_prompt", "multiple_choice"]
        )
        self.assertEqual(
            summary["recent_misses"]["items"][0]["id"],
            fragile.id
        )
        self.assertEqual(summary["confusions"]["event_count"], 1)
        self.assertEqual(
            summary["confusions"]["items"][0]["expected"]["id"],
            fragile.id
        )
        self.assertEqual(
            summary["confusions"]["items"][0]["selected"]["id"],
            stable.id
        )
        self.assertEqual(
            summary["confusions"]["items"][0]["candidate_ids"],
            [fragile.id, stable.id]
        )
        self.assertEqual(
            summary["confusions"]["items"][0]["presentation_kind"],
            "map_group"
        )
        self.assertEqual(
            summary["confusions"]["items"][0]["answer_policy"],
            {"preset": "relaxed"}
        )
        self.assertEqual(summary["weak_items"][0]["id"], fragile.id)
        self.assertEqual(
            summary["practice"]["selectors"]["recent_misses"]["question_ids"],
            [fragile.id]
        )
        self.assertEqual(
            summary["practice"]["selectors"]["commonly_confused_pairs"]["question_ids"],
            [fragile.id, stable.id]
        )
        self.assertEqual(
            summary["practice"]["selectors"]["new_only"]["question_ids"],
            [unseen.id]
        )
        self.assertEqual(
            summary["practice"]["selectors"]["almost_mastered"]["question_ids"],
            [stable.id]
        )
        self.assertEqual(
            summary["practice"]["selectors"]["before_tomorrow"]["question_ids"],
            [due_learning.id]
        )
        self.assertEqual(
            [
                entry["label"]
                for entry in summary["practice"]["entry_points"]
            ],
            [
                "Travailler les erreurs récentes",
                "Travailler les confusions",
                "Nouveaux uniquement",
                "Presque maîtrisés",
                "À revoir avant demain"
            ]
        )
        self.assertEqual(summary["learn"]["supported"], True)
        self.assertEqual(summary["learn"]["family"], "map")
        self.assertEqual(summary["learn"]["group"]["media"], "france.svg")
        self.assertEqual(summary["learn"]["item_count"], 6)
        self.assertIn(
            suspended.id,
            {item["id"] for item in summary["learn"]["items"]}
        )
        self.assertEqual(summary["learn"]["items"][0]["id"], unseen.id)
        self.assertEqual(summary["learn"]["items"][0]["code"], "01")
        self.assertEqual(summary["learn"]["items"][0]["answer"], "Ain")
        self.assertEqual(
            summary["learn"]["items"][0]["signals"]["bucket"],
            "unseen"
        )

    def test_media_group_summary_surfaces_read_only_learn_items(self):
        today = date(2026, 8, 14)
        group = QuestionGroup(
            id=15,
            type_group="media",
            name="Drapeaux",
            media="cover.png",
            data={}
        )
        self.db.add(group)
        item = self.add_question(
            1,
            type_q="media",
            question="Drapeaux - France",
            answer="France",
            media="flag-fr.png",
            data={
                "media_pool": ["flag-fr.png", "flag-fr-alt.png"],
                "aliases": ["République française"]
            },
            group=group
        )
        suspended_item = self.add_question(
            2,
            type_q="media",
            question="Drapeaux - Allemagne",
            answer="Allemagne",
            media="flag-de.png",
            group=group,
            suspended=True
        )
        self.db.commit()
        progress_count = self.db.query(Progress).count()

        summary = build_study_scope_summary(
            self.db,
            "group",
            group_id=group.id,
            today=today
        )

        self.assertEqual(self.db.query(Progress).count(), progress_count)
        self.assertEqual(summary["learn"]["supported"], True)
        self.assertEqual(summary["learn"]["family"], "media")
        self.assertEqual(summary["learn"]["item_count"], 2)
        self.assertEqual(
            {learn_item["id"] for learn_item in summary["learn"]["items"]},
            {item.id, suspended_item.id}
        )
        self.assertEqual(summary["learn"]["items"][0]["id"], item.id)
        self.assertEqual(
            summary["learn"]["items"][0]["media_pool"],
            ["flag-fr.png", "flag-fr-alt.png"]
        )
        self.assertEqual(summary["learn"]["items"][0]["media_kind"], "image")
        self.assertEqual(
            summary["learn"]["items"][0]["aliases"],
            ["République française"]
        )
        suspended_learn_item = next(
            learn_item for learn_item in summary["learn"]["items"]
            if learn_item["id"] == suspended_item.id
        )
        self.assertEqual(suspended_learn_item["signals"]["bucket"], "suspended")
        self.assertEqual(suspended_learn_item["signals"]["due"], False)

    def test_group_summary_surfaces_current_and_stale_training_records(self):
        today = date(2026, 8, 14)
        group = QuestionGroup(
            id=20,
            type_group="sequence",
            name="Rois de France",
            data={}
        )
        self.db.add(group)
        first = self.add_question(1, type_q="sequence", group=group)
        second = self.add_question(2, type_q="sequence", group=group)
        self.db.commit()
        current_fingerprint = group_training_fingerprint(self.db, group)
        record = {
            "best_found_percent": 100,
            "best_found_count": 2,
            "best_found_elapsed_ms": 9000,
            "best_found_at": "2026-08-10T12:00:00+00:00",
            "best_time_ms": 9000,
            "best_time_at": "2026-08-10T12:00:00+00:00",
            "question_count": 2,
            "content_fingerprint": current_fingerprint
        }
        group.data = {
            "training_record": record,
            "training_records": {"type_position": record}
        }
        self.db.commit()

        current = build_study_scope_summary(
            self.db,
            "group",
            group_id=group.id,
            today=today
        )

        self.assertEqual(
            current["training"]["training_record"]["best_time_ms"],
            9000
        )
        self.assertEqual(current["training"]["previous_training_record"], None)

        second.data = {"position": 1}
        first.data = {"position": 2}
        self.db.commit()
        stale = build_study_scope_summary(
            self.db,
            "group",
            group_id=group.id,
            today=today
        )

        self.assertIsNone(stale["training"]["training_record"])
        self.assertEqual(
            stale["training"]["previous_training_record"]["best_time_ms"],
            9000
        )
        self.assertIn(
            "type_position",
            stale["training"]["previous_training_records"]
        )

    def test_tag_collection_and_pack_scopes_aggregate_existing_questions(self):
        today = date(2026, 8, 14)
        parent_id = "11111111-1111-4111-8111-111111111111"
        child_id = "22222222-2222-4222-8222-222222222222"
        hierarchy = load_tag_hierarchy(self.db)
        apply_tag_actions(self.db, hierarchy["revision"], [
            {
                "type": "create",
                "tag_id": parent_id,
                "label": "Géographie locale",
                "parent_ids": ["core:geography"]
            },
            {
                "type": "create",
                "tag_id": child_id,
                "label": "France locale",
                "parent_ids": [parent_id]
            }
        ])
        group = QuestionGroup(id=30, type_group="media", name="Drapeaux")
        self.db.add(group)
        tagged = self.add_question(
            1,
            type_q="media",
            tags=[child_id],
            group=group,
            pack_guid="pack-1"
        )
        direct = self.add_question(
            2,
            type_q="text",
            tags=[parent_id],
            pack_guid="pack-1"
        )
        outside = self.add_question(3, type_q="text", tags=["core:history"])
        collection = Collection(id=40, name="Playlist")
        collection.questions = [tagged, outside]
        self.db.add(collection)
        self.add_progress(
            tagged,
            today=today,
            reps=3,
            stability=90,
            next_review=today + timedelta(days=2)
        )
        self.add_progress(
            direct,
            today=today,
            reps=1,
            stability=5,
            next_review=today
        )
        self.db.add(PackSubscription(
            pack_guid="pack-1",
            installed_version=2,
            name="Pack Géographie",
            source="pack.zip",
            subscribed_at="2026-08-01T00:00:00+00:00"
        ))
        self.db.commit()

        tag_summary = build_study_scope_summary(
            self.db,
            "tag",
            tag=parent_id,
            today=today
        )
        collection_summary = build_study_scope_summary(
            self.db,
            "collection",
            collection_id=collection.id,
            today=today
        )
        pack_summary = build_study_scope_summary(
            self.db,
            "pack",
            pack_guid="pack-1",
            today=today
        )

        self.assertEqual(tag_summary["scope"]["label"], "Géographie locale")
        self.assertEqual(
            tag_summary["counts"]["total_atomic_questions"],
            2
        )
        self.assertEqual(
            collection_summary["counts"]["total_atomic_questions"],
            2
        )
        self.assertEqual(
            pack_summary["scope"]["installed_version"],
            2
        )
        self.assertEqual(pack_summary["counts"]["due_now"], 1)
        self.assertEqual(pack_summary["buckets"]["mastered"], 1)

    def test_missing_scope_returns_http_errors(self):
        with self.assertRaises(HTTPException) as missing_group:
            build_study_scope_summary(self.db, "group", group_id=404)

        with self.assertRaises(HTTPException) as missing_pack:
            build_study_scope_summary(
                self.db,
                "pack",
                pack_guid="missing"
            )

        self.assertEqual(missing_group.exception.status_code, 404)
        self.assertEqual(missing_pack.exception.status_code, 404)
