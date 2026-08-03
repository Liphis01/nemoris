import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import (
    Collection,
    Progress,
    Question,
    QuestionGroup,
    question_collection
)
from app.routers.review import answer_question
from app.routers.collections import (
    create_collection,
    delete_collection,
    get_collection_question_candidates,
    get_collection_questions,
    preview_collection,
    update_collection
)
from app.schemas import (
    AnswerRequest,
    CollectionCreate,
    CollectionPreview,
    CollectionUpdate,
    TrainingAttemptRecordRequest
)
from app.services.collections import (
    AUTO_HARD_COLLECTION_FALLBACK_NAME,
    AUTO_HARD_COLLECTION_KEY,
    AUTO_HARD_COLLECTION_NAME,
    AUTO_HARD_COLLECTION_THRESHOLD,
    find_generated_hard_collection,
    sync_collection_membership,
    sync_generated_hard_collection
)
from app.services.training import (
    collection_training_fingerprint,
    get_training_items,
    list_training_scopes,
    record_collection_training_attempt
)
from app.services.tag_hierarchy import (
    TagValidationError,
    apply_tag_actions,
    load_tag_hierarchy
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


class CollectionTests(unittest.TestCase):
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
        group=None
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
        return item

    def add_progress(self, question, difficulty=5.0, reps=1):
        progress = Progress(
            question_id=question.id,
            stability=1.0,
            difficulty=difficulty,
            reps=reps,
            lapses=0,
            interval=1,
            next_review=None,
            history=[]
        )
        self.db.add(progress)
        return progress

    def collection_link_count(self):
        return self.db.execute(
            select(func.count()).select_from(question_collection)
        ).scalar_one()

    def test_collection_crud_validates_and_persists_membership(self):
        self.add_question(1)
        self.add_question(2)
        self.db.commit()

        created = create_collection(
            CollectionCreate(name="  Geo  ", question_ids=[1, 1, 2]),
            db=self.db
        )

        self.assertEqual(created["name"], "Geo")
        self.assertEqual(created["question_ids"], [1, 2])
        self.assertEqual(created["question_count"], 2)

        with self.assertRaises(HTTPException) as duplicate:
            create_collection(
                CollectionCreate(name="geo", question_ids=[]),
                db=self.db
            )

        self.assertEqual(duplicate.exception.status_code, 409)

        with self.assertRaises(HTTPException) as missing:
            update_collection(
                created["id"],
                CollectionUpdate(question_ids=[1, 999]),
                db=self.db
            )

        self.assertEqual(missing.exception.status_code, 404)

        updated = update_collection(
            created["id"],
            CollectionUpdate(name="Europe", question_ids=[2]),
            db=self.db
        )

        self.assertEqual(updated["name"], "Europe")
        self.assertEqual(updated["question_ids"], [2])

        delete_collection(created["id"], db=self.db)

        generated = find_generated_hard_collection(self.db)
        self.assertIsNotNone(generated)
        self.assertEqual(self.db.query(Collection).count(), 1)
        self.assertEqual(self.collection_link_count(), 0)
        self.assertEqual(self.db.query(Question).count(), 2)

    def test_auto_hard_collection_sync_creates_and_updates_membership(self):
        easy = self.add_question(1)
        hard = self.add_question(2)
        unreviewed = self.add_question(3)
        self.db.flush()
        self.add_progress(easy, difficulty=AUTO_HARD_COLLECTION_THRESHOLD - 0.1)
        self.add_progress(hard, difficulty=AUTO_HARD_COLLECTION_THRESHOLD)
        self.db.commit()

        collection = sync_generated_hard_collection(self.db)

        self.assertEqual(collection.name, AUTO_HARD_COLLECTION_NAME)
        self.assertTrue(collection.data["generated"])
        self.assertEqual(collection.data["auto_collection_key"], AUTO_HARD_COLLECTION_KEY)
        self.assertEqual(collection.data["hard_threshold"], AUTO_HARD_COLLECTION_THRESHOLD)
        self.assertEqual([question.id for question in collection.questions], [2])

        easy.progress.difficulty = AUTO_HARD_COLLECTION_THRESHOLD + 0.1
        hard.progress.difficulty = 6.5
        unreviewed.progress = Progress(
            question_id=unreviewed.id,
            stability=1.0,
            difficulty=AUTO_HARD_COLLECTION_THRESHOLD + 0.2,
            reps=1,
            lapses=0,
            interval=1,
            next_review=None,
            history=[]
        )
        self.db.commit()

        collection = sync_generated_hard_collection(self.db)

        self.assertEqual(
            [question.id for question in collection.questions],
            [1, 3]
        )

    def test_auto_hard_collection_uses_fallback_name_for_manual_name_conflict(self):
        self.db.add(Collection(name=AUTO_HARD_COLLECTION_NAME, data={}, questions=[]))
        self.db.commit()

        generated = sync_generated_hard_collection(self.db)

        self.assertEqual(generated.name, AUTO_HARD_COLLECTION_FALLBACK_NAME)

    def test_generated_collection_is_read_only(self):
        generated = sync_generated_hard_collection(self.db)

        with self.assertRaises(HTTPException) as update_error:
            update_collection(
                generated.id,
                CollectionUpdate(name="Manual"),
                db=self.db
            )

        self.assertEqual(update_error.exception.status_code, 400)

        with self.assertRaises(HTTPException) as delete_error:
            delete_collection(generated.id, db=self.db)

        self.assertEqual(delete_error.exception.status_code, 400)
        self.assertIsNotNone(find_generated_hard_collection(self.db))

    def test_training_scopes_include_generated_collection_metadata(self):
        response = list_training_scopes(self.db)
        generated = next(
            collection
            for collection in response["collections"]
            if collection["auto_collection_key"] == AUTO_HARD_COLLECTION_KEY
        )

        self.assertEqual(generated["name"], AUTO_HARD_COLLECTION_NAME)
        self.assertTrue(generated["generated"])
        self.assertEqual(generated["question_count"], 0)

    def test_review_answer_syncs_auto_hard_collection(self):
        self.add_question(1)
        self.db.commit()

        self.assertIsNone(find_generated_hard_collection(self.db))

        answer_question(
            AnswerRequest(question_id=1, quality=2),
            db=self.db
        )

        generated = find_generated_hard_collection(self.db)

        self.assertIsNotNone(generated)
        self.assertTrue(generated.data["generated"])

    def test_question_candidates_paginate_search_and_filter(self):
        europe = QuestionGroup(
            id=10,
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={}
        )
        flags = QuestionGroup(
            id=11,
            type_group="media",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add_all([europe, flags])
        self.add_question(
            1,
            question="Capitale de la France",
            answer="Paris",
            tags=["Geo"],
            data={"aliases": ["Ville lumiere"]},
            group=flags
        )
        self.add_question(
            2,
            type_q="map",
            question="Zone",
            answer="France",
            tags=["Geo"],
            data={"code": "fr", "aliases": ["Hexagone"]},
            group=europe
        )
        self.add_question(
            3,
            question="Fleuve de Paris",
            answer="Seine",
            tags=["Hydro"]
        )
        self.add_question(
            4,
            type_q="media",
            question="Drapeau",
            answer="France",
            media="/static/france.png",
            tags=["Geo"],
            group=flags
        )
        self.db.commit()

        recent = get_collection_question_candidates(
            limit=2,
            offset=0,
            sort="recent",
            db=self.db
        )

        self.assertEqual(recent["total"], 4)
        self.assertEqual([item["id"] for item in recent["items"]], [4, 1])
        self.assertTrue(recent["items"][0]["has_media"])
        self.assertEqual(recent["items"][0]["group"]["name"], "Flags")
        self.assertEqual(recent["items"][1]["group"]["name"], "Flags")
        self.assertEqual(recent["items"][1]["group_id"], flags.id)

        second_page = get_collection_question_candidates(
            limit=2,
            offset=2,
            sort="recent",
            db=self.db
        )

        self.assertEqual([item["id"] for item in second_page["items"]], [3, 2])

        alias_match = get_collection_question_candidates(
            search="lumiere",
            limit=10,
            offset=0,
            sort="recent",
            db=self.db
        )

        self.assertEqual([item["id"] for item in alias_match["items"]], [1])

        group_match = get_collection_question_candidates(
            search="Europe",
            limit=10,
            offset=0,
            sort="recent",
            db=self.db
        )

        self.assertEqual([item["id"] for item in group_match["items"]], [2])

        map_filter = get_collection_question_candidates(
            type_q="map",
            limit=10,
            offset=0,
            sort="recent",
            db=self.db
        )

        self.assertEqual([item["id"] for item in map_filter["items"]], [2])

        group_filter = get_collection_question_candidates(
            group_id=europe.id,
            limit=10,
            offset=0,
            sort="recent",
            db=self.db
        )

        self.assertEqual([item["id"] for item in group_filter["items"]], [2])

        tag_filter = get_collection_question_candidates(
            tag="Hydro",
            limit=10,
            offset=0,
            sort="recent",
            db=self.db
        )

        self.assertEqual([item["id"] for item in tag_filter["items"]], [3])

    def test_collection_questions_returns_selected_picker_details(self):
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
            question="Capitale de la France",
            answer="Paris",
            tags=["Geo"]
        )
        self.add_question(
            2,
            type_q="map",
            question="Zone",
            answer="France",
            tags=["Geo"],
            group=group
        )
        collection = Collection(
            name="Capitales",
            data={},
            questions=[
                self.db.get(Question, 1),
                self.db.get(Question, 2)
            ]
        )
        self.db.add(collection)
        self.db.commit()

        response = get_collection_questions(collection.id, db=self.db)

        self.assertEqual([item["id"] for item in response], [1, 2])
        self.assertEqual(response[0]["title"], "Capitale de la France")
        self.assertEqual(response[0]["answer_preview"], "Paris")
        self.assertIsNone(response[0]["group"])
        self.assertEqual(response[1]["group"]["name"], "Europe")

    def test_collection_training_returns_selected_items_only(self):
        map_group = QuestionGroup(
            id=10,
            type_group="map",
            name="Europe",
            media="europe.svg",
            data={}
        )
        image_group = QuestionGroup(
            id=11,
            type_group="media",
            name="Flags",
            media=None,
            data={}
        )
        self.db.add_all([map_group, image_group])
        self.add_question(
            1,
            type_q="text",
            question="Capital of France",
            answer="Paris",
            data={"aliases": ["Ville lumière"]}
        )
        self.add_question(
            2,
            type_q="map",
            answer="France",
            data={"code": "fr", "aliases": []},
            group=map_group
        )
        self.add_question(
            3,
            type_q="map",
            answer="Germany",
            data={"code": "de", "aliases": []},
            group=map_group
        )
        self.add_question(
            4,
            type_q="media",
            answer="France",
            media="/static/france.png",
            group=image_group
        )
        self.add_question(
            5,
            type_q="media",
            answer="Germany",
            media="/static/germany.png",
            group=image_group
        )
        self.add_question(
            6,
            type_q="timeline",
            question="Moon landing",
            answer="1969",
            data=point_timeline(1969)
        )
        collection = Collection(
            name="Subset",
            data={},
            questions=[
                self.db.get(Question, 1),
                self.db.get(Question, 2),
                self.db.get(Question, 4),
                self.db.get(Question, 6)
            ]
        )
        self.db.add(collection)
        self.db.commit()

        response = get_training_items(
            self.db,
            scope_type="collection",
            collection_id=collection.id
        )
        text_item = next(item for item in response if item["type_q"] == "text")
        map_item = next(item for item in response if item["type_q"] == "map")
        image_item = next(item for item in response if item["type_q"] == "media")
        timeline_item = next(
            item for item in response if item["type_q"] == "timeline"
        )

        self.assertEqual(text_item["aliases"], ["Ville lumière"])
        self.assertEqual(map_item["mode"], "type_all")
        self.assertEqual(
            [item["question_id"] for item in map_item["items"]],
            [2]
        )
        self.assertEqual(
            [item["question_id"] for item in map_item["context_items"]],
            [2]
        )
        self.assertEqual(image_item["mode"], "type_prompt")
        self.assertEqual(
            [item["question_id"] for item in image_item["items"]],
            [4]
        )
        self.assertEqual(
            [item["question_id"] for item in image_item["context_items"]],
            [4]
        )
        self.assertEqual(
            [item["question_id"] for item in timeline_item["items"]],
            [6]
        )
        self.assertEqual(
            text_item["training_fingerprint"],
            collection_training_fingerprint(self.db, collection)
        )

    def test_collection_training_randomizes_top_level_question_order(self):
        self.add_question(1, question="First", answer="One")
        self.add_question(2, question="Second", answer="Two")
        collection = Collection(
            name="Two texts",
            data={},
            questions=[
                self.db.get(Question, 1),
                self.db.get(Question, 2)
            ]
        )
        self.db.add(collection)
        self.db.commit()

        with patch(
            "app.services.training._shuffled_training_items",
            side_effect=lambda items: list(reversed(list(items or [])))
        ):
            response = get_training_items(
                self.db,
                scope_type="collection",
                collection_id=collection.id
            )

        self.assertEqual(
            [item["question_id"] for item in response],
            [2, 1]
        )

    def test_collection_scopes_and_record_save_use_fingerprints(self):
        self.add_question(1, answer="Paris")
        collection = Collection(
            name="Capitals",
            data={},
            questions=[self.db.get(Question, 1)]
        )
        empty_collection = Collection(name="Empty", data={}, questions=[])
        self.db.add_all([collection, empty_collection])
        self.db.commit()
        fingerprint = collection_training_fingerprint(self.db, collection)

        response = record_collection_training_attempt(
            self.db,
            collection.id,
            TrainingAttemptRecordRequest(
                elapsed_ms=5000,
                question_count=1,
                found_count=1,
                content_fingerprint=fingerprint
            )
        )

        self.assertTrue(response["is_new_best_percent"])
        self.assertTrue(response["is_new_best_time"])
        self.assertEqual(response["training_record"]["best_found_percent"], 100)
        self.assertEqual(response["training_record"]["best_time_ms"], 5000)

        scopes = list_training_scopes(self.db)
        saved_scope = next(
            item for item in scopes["collections"]
            if item["id"] == collection.id
        )
        self.assertEqual(saved_scope["training_record"]["best_time_ms"], 5000)

        # Invalidation is driven by membership, not content: swap the member so
        # the count stays at 1 but the fingerprint changes.
        self.add_question(2, answer="Berlin")
        collection.questions = [self.db.get(Question, 2)]
        self.db.commit()

        with self.assertRaises(HTTPException) as stale:
            record_collection_training_attempt(
                self.db,
                collection.id,
                TrainingAttemptRecordRequest(
                    elapsed_ms=4000,
                    question_count=1,
                    found_count=1,
                    content_fingerprint=fingerprint
                )
            )

        self.assertEqual(stale.exception.status_code, 409)
        self.assertIsNone(
            next(
                item for item in list_training_scopes(self.db)["collections"]
                if item["id"] == collection.id
            )["training_record"]
        )

        with self.assertRaises(HTTPException) as empty:
            record_collection_training_attempt(
                self.db,
                empty_collection.id,
                TrainingAttemptRecordRequest(
                    elapsed_ms=1000,
                    question_count=0,
                    found_count=0,
                    content_fingerprint=collection_training_fingerprint(
                        self.db,
                        empty_collection
                    )
                )
            )

        self.assertEqual(empty.exception.status_code, 400)

        fresh_fingerprint = collection_training_fingerprint(self.db, collection)

        with self.assertRaises(HTTPException) as mismatched_count:
            record_collection_training_attempt(
                self.db,
                collection.id,
                TrainingAttemptRecordRequest(
                    elapsed_ms=1000,
                    question_count=2,
                    found_count=1,
                    content_fingerprint=fresh_fingerprint
                )
            )

        self.assertEqual(mismatched_count.exception.status_code, 400)

        with self.assertRaises(HTTPException) as invalid_found:
            record_collection_training_attempt(
                self.db,
                collection.id,
                TrainingAttemptRecordRequest(
                    elapsed_ms=1000,
                    question_count=1,
                    found_count=2,
                    content_fingerprint=fresh_fingerprint
                )
            )

        self.assertEqual(invalid_found.exception.status_code, 400)


class PlaylistRuleTests(unittest.TestCase):
    """A playlist is a rule, not a snapshot."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        self.db = Session()

    def tearDown(self):
        self.db.close()

    def add_question(self, question_id, tags=None, type_q="text", group=None):
        item = Question(
            id=question_id,
            type_q=type_q,
            question=f"Question {question_id}",
            answer=f"Answer {question_id}",
            tags=tags or [],
            data={},
            group=group
        )
        self.db.add(item)
        return item

    def test_parent_scope_resolves_identically_in_preview_saved_playlist_and_training(self):
        parent_id = "11111111-1111-4111-8111-111111111111"
        child_id = "22222222-2222-4222-8222-222222222222"
        hierarchy = load_tag_hierarchy(self.db)
        apply_tag_actions(self.db, hierarchy["revision"], [
            {
                "type": "create",
                "tag_id": parent_id,
                "label": "Europe locale",
                "parent_ids": ["core:geography"]
            },
            {
                "type": "create",
                "tag_id": child_id,
                "label": "France locale",
                "parent_ids": [parent_id]
            }
        ])
        self.add_question(1, tags=[child_id])
        self.add_question(2, tags=["core:history"])
        self.db.commit()

        candidates = get_collection_question_candidates(
            tag=parent_id, limit=10, offset=0, db=self.db
        )
        rules = {
            "match": "any",
            "clauses": [{"kind": "tag", "tag": parent_id}]
        }
        preview = preview_collection(
            CollectionPreview(rules=rules), db=self.db
        )
        saved = create_collection(
            CollectionCreate(name="Europe", rules=rules), db=self.db
        )
        trained = get_training_items(
            self.db, scope_type="tag", tag=parent_id
        )

        self.assertEqual([item["id"] for item in candidates["items"]], [1])
        self.assertEqual([item["id"] for item in preview["items"]], [1])
        self.assertEqual(saved["question_ids"], [1])
        self.assertEqual(
            [item["question_id"] for item in trained if item["type_q"] == "text"],
            [1]
        )
        self.assertEqual(saved["rules"]["clauses"][0]["tag"], parent_id)

    def test_new_playlist_rules_reject_unknown_tag_ids(self):
        with self.assertRaises(TagValidationError):
            create_collection(
                CollectionCreate(
                    name="Invalide",
                    rules={
                        "match": "any",
                        "clauses": [{
                            "kind": "tag",
                            "tag": "99999999-9999-4999-8999-999999999999"
                        }]
                    }
                ),
                db=self.db
            )

    def test_legacy_playlist_without_rules_keeps_its_membership(self):
        # The data-loss guard: playlists saved before rules existed store
        # their membership only in the association table. Resolving one must
        # never read that as "no rules matched, so it is empty".
        first = self.add_question(1)
        second = self.add_question(2)
        self.add_question(3)
        self.db.flush()

        legacy = Collection(name="Ancienne", data={}, questions=[first, second])
        self.db.add(legacy)
        self.db.commit()

        sync_collection_membership(self.db, legacy, commit=True)

        self.assertEqual(
            sorted(question.id for question in legacy.questions), [1, 2]
        )

    def test_tag_rule_picks_up_questions_tagged_later(self):
        self.add_question(1, tags=["drapeaux"])
        self.add_question(2, tags=["autre"])
        self.db.flush()

        playlist = Collection(
            name="Drapeaux",
            data={
                "rules": {
                    "match": "any",
                    "clauses": [{"kind": "tag", "tag": "drapeaux"}]
                }
            },
            questions=[]
        )
        self.db.add(playlist)
        self.db.commit()

        sync_collection_membership(self.db, playlist, commit=True)
        self.assertEqual([q.id for q in playlist.questions], [1])

        # A question tagged after the playlist was built joins on next read,
        # which a snapshot-based collection could never do.
        self.add_question(3, tags=["drapeaux"])
        self.db.commit()

        sync_collection_membership(self.db, playlist, commit=True)
        self.assertEqual([q.id for q in playlist.questions], [1, 3])

    def test_resolution_is_rules_union_pinned_minus_excluded(self):
        self.add_question(1, tags=["drapeaux"])
        self.add_question(2, tags=["drapeaux"])
        self.add_question(3, tags=["autre"])
        self.db.flush()

        playlist = Collection(
            name="Mix",
            data={
                "rules": {
                    "match": "any",
                    "clauses": [{"kind": "tag", "tag": "drapeaux"}]
                },
                # 3 does not match the rule but is pinned in by hand.
                "pinned_question_ids": [3],
                # 2 matches the rule but is explicitly excluded.
                "excluded_question_ids": [2]
            },
            questions=[]
        )
        self.db.add(playlist)
        self.db.commit()

        sync_collection_membership(self.db, playlist, commit=True)

        self.assertEqual([q.id for q in playlist.questions], [1, 3])

    def test_match_all_requires_every_clause(self):
        group = QuestionGroup(type_group="media", name="Drapeaux du monde")
        self.db.add(group)
        self.db.flush()

        self.add_question(1, tags=["drapeaux"], type_q="media", group=group)
        self.add_question(2, tags=["drapeaux"])
        self.add_question(3, type_q="media", group=group)
        self.db.flush()

        rules = {
            "match": "all",
            "clauses": [
                {"kind": "tag", "tag": "drapeaux"},
                {"kind": "group", "group_id": group.id}
            ]
        }
        playlist = Collection(name="Strict", data={"rules": rules}, questions=[])
        self.db.add(playlist)
        self.db.commit()

        sync_collection_membership(self.db, playlist, commit=True)

        # Only question 1 is both tagged and in the group.
        self.assertEqual([q.id for q in playlist.questions], [1])

    def test_blank_clause_selects_nothing_rather_than_everything(self):
        self.add_question(1, tags=["drapeaux"])
        self.add_question(2)
        self.db.flush()

        playlist = Collection(
            name="Vide",
            data={
                "rules": {"match": "any", "clauses": [{"kind": "tag", "tag": ""}]},
                "pinned_question_ids": []
            },
            questions=[]
        )
        self.db.add(playlist)
        self.db.commit()

        sync_collection_membership(self.db, playlist, commit=True)

        self.assertEqual(list(playlist.questions), [])

    def test_create_and_update_round_trip_rules_through_the_api(self):
        self.add_question(1, tags=["drapeaux"])
        self.add_question(2, tags=["drapeaux"])
        self.add_question(3)
        self.db.commit()

        created = create_collection(
            CollectionCreate(
                name="Drapeaux",
                rules={
                    "match": "any",
                    "clauses": [{"kind": "tag", "tag": "drapeaux"}]
                }
            ),
            db=self.db
        )

        self.assertEqual(created["question_ids"], [1, 2])
        stored_tag_id = created["rules"]["clauses"][0]["tag"]
        self.assertNotEqual(stored_tag_id, "drapeaux")

        updated = update_collection(
            created["id"],
            CollectionUpdate(question_ids=[3], excluded_question_ids=[2]),
            db=self.db
        )

        # Rule still applies, plus the pin, minus the exclusion.
        self.assertEqual(updated["question_ids"], [1, 3])
        self.assertEqual(updated["pinned_question_ids"], [3])
        self.assertEqual(updated["excluded_question_ids"], [2])
        self.assertEqual(
            updated["rules"]["clauses"][0]["tag"], stored_tag_id
        )

    def test_preview_resolves_a_rule_without_saving_anything(self):
        group = QuestionGroup(type_group="media", name="Drapeaux du monde")
        self.db.add(group)
        self.db.flush()
        self.add_question(1, tags=["drapeaux"], type_q="media", group=group)
        self.add_question(2, tags=["drapeaux"])
        self.add_question(3)
        self.db.commit()

        result = preview_collection(
            CollectionPreview(
                rules={
                    "match": "any",
                    "clauses": [
                        {"kind": "tag", "tag": "drapeaux"},
                        {"kind": "group", "group_id": group.id}
                    ]
                },
                excluded_question_ids=[2]
            ),
            db=self.db
        )

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["group_count"], 1)
        # Per-rule contribution, before the exclusion is applied.
        self.assertEqual(result["clause_counts"], [2, 1])
        self.assertEqual([item["id"] for item in result["items"]], [1])

        # Nothing was persisted.
        self.assertEqual(self.db.query(Collection).count(), 0)

    def test_generated_hard_collection_uses_the_shared_resolver(self):
        easy = self.add_question(1)
        hard = self.add_question(2)
        self.db.flush()
        self.db.add(Progress(
            question_id=easy.id,
            stability=1.0,
            difficulty=2.0,
            reps=1,
            lapses=0,
            interval=1,
            next_review=None,
            history=[]
        ))
        self.db.add(Progress(
            question_id=hard.id,
            stability=1.0,
            difficulty=AUTO_HARD_COLLECTION_THRESHOLD + 0.5,
            reps=1,
            lapses=0,
            interval=1,
            next_review=None,
            history=[]
        ))
        self.db.commit()

        collection = sync_generated_hard_collection(self.db)

        self.assertEqual([q.id for q in collection.questions], [2])
        # It is now expressed as an ordinary difficulty rule rather than a
        # second hand-rolled query.
        self.assertEqual(
            collection.data["rules"]["clauses"],
            [{"kind": "difficulty", "gte": AUTO_HARD_COLLECTION_THRESHOLD}]
        )


if __name__ == "__main__":
    unittest.main()
