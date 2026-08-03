import tempfile
import unittest
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Question, QuestionGroup
from app.schemas import MediaGroupItemBulkItem, MediaGroupItemsBulkUpdate
from app.services.media import (
    delete_unreferenced_media_file,
    is_static_media_referenced,
    static_relative_path_from_media,
    store_media_bytes
)
from app.services.media_groups import save_media_group_items
from app.services.media_pool import (
    normalize_media_pool,
    pool_media_and_data,
    question_media_refs,
    read_media_pool
)
from app.services.packs import export_pack, import_pack


PNG_A = b"\x89PNG\r\n\x1a\n" + b"A" * 32
PNG_B = b"\x89PNG\r\n\x1a\n" + b"B" * 32
PNG_C = b"\x89PNG\r\n\x1a\n" + b"C" * 32


class MediaPoolHelperTests(unittest.TestCase):
    def test_normalize_dedupes_and_trims(self):
        self.assertEqual(
            normalize_media_pool(["  a ", "a", "", "b", None]),
            ["a", "b"]
        )

    def test_read_falls_back_to_single_media(self):
        self.assertEqual(read_media_pool("a.png", None), ["a.png"])
        self.assertEqual(read_media_pool("", {}), [])

    def test_read_prefers_pool(self):
        pool = read_media_pool("a.png", {"media_pool": ["a.png", "b.png"]})
        self.assertEqual(pool, ["a.png", "b.png"])

    def test_pool_media_and_data_stores_only_when_multiple(self):
        cover, data = pool_media_and_data({"aliases": ["x"]}, ["a.png"])
        self.assertEqual(cover, "a.png")
        self.assertNotIn("media_pool", data)
        self.assertEqual(data["aliases"], ["x"])

        cover, data = pool_media_and_data({}, ["a.png", "b.png"])
        self.assertEqual(cover, "a.png")
        self.assertEqual(data["media_pool"], ["a.png", "b.png"])

    def test_question_media_refs_includes_pool_and_answer(self):
        refs = question_media_refs(
            "a.png",
            "ans.mp3",
            {"media_pool": ["a.png", "b.png"]}
        )
        self.assertEqual(refs, ["a.png", "b.png", "ans.mp3"])


class MemoryDbTestCase(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine)
        self.db = self.Session()
        self._temp = tempfile.TemporaryDirectory()
        self.static_dir = Path(self._temp.name)

    def tearDown(self):
        self.db.close()
        self._temp.cleanup()

    def store(self, data):
        return store_media_bytes(
            data,
            filename="file.png",
            static_dir=self.static_dir,
            db=self.db
        )["url"]


class ReferencedMediaWithPoolTests(MemoryDbTestCase):
    def test_pool_image_counts_as_referenced(self):
        url_a = self.store(PNG_A)
        url_b = self.store(PNG_B)

        self.db.add(Question(
            guid="q1",
            type_q="media",
            answer="X",
            media=url_a,
            data={"media_pool": [url_a, url_b]}
        ))
        self.db.commit()

        self.assertTrue(is_static_media_referenced(
            self.db, static_relative_path_from_media(url_b)
        ))

    def test_pool_image_kept_while_another_question_uses_it(self):
        url_a = self.store(PNG_A)

        # Two questions both keep image A in their pool.
        self.db.add_all([
            Question(guid="q1", type_q="media", answer="1", media=url_a,
                     data={"media_pool": [url_a, self.store(PNG_B)]}),
            Question(guid="q2", type_q="media", answer="2", media=url_a,
                     data={"media_pool": [url_a, self.store(PNG_C)]})
        ])
        self.db.commit()

        # Removing A from one question must not delete the shared file.
        q1 = self.db.query(Question).filter(Question.guid == "q1").first()
        q1.media = q1.data["media_pool"][1]
        q1.data = {"media_pool": []}
        self.db.commit()

        deleted = delete_unreferenced_media_file(
            self.db, url_a, static_dir=self.static_dir
        )
        self.assertFalse(deleted)
        self.assertTrue((self.static_dir / static_relative_path_from_media(url_a)).exists())


class MediaGroupSavePoolTests(MemoryDbTestCase):
    def _media_group(self):
        group = QuestionGroup(guid="g1", type_group="media", name="Flags")
        self.db.add(group)
        self.db.commit()
        return group

    def test_save_stores_pool_and_mirrors_cover(self):
        group = self._media_group()
        url_a = self.store(PNG_A)
        url_b = self.store(PNG_B)

        payload = MediaGroupItemsBulkUpdate(
            items=[MediaGroupItemBulkItem(
                answer="France",
                media=url_a,
                media_pool=[url_a, url_b],
                aliases=["tricolore"]
            )]
        )
        result = save_media_group_items(self.db, group.id, payload)

        item = result["items"][0]
        self.assertEqual(item["media"], url_a)
        self.assertEqual(item["media_pool"], [url_a, url_b])

        row = self.db.query(Question).filter(Question.group_id == group.id).first()
        self.assertEqual(row.media, url_a)
        self.assertEqual(row.data["media_pool"], [url_a, url_b])

    def test_single_image_leaves_no_pool_key(self):
        group = self._media_group()
        url_a = self.store(PNG_A)

        payload = MediaGroupItemsBulkUpdate(
            items=[MediaGroupItemBulkItem(answer="Italy", media_pool=[url_a])]
        )
        result = save_media_group_items(self.db, group.id, payload)

        self.assertEqual(result["items"][0]["media_pool"], [url_a])
        row = self.db.query(Question).filter(Question.group_id == group.id).first()
        self.assertEqual(row.media, url_a)
        self.assertNotIn("media_pool", row.data or {})

    def test_removing_pool_image_garbage_collects_it(self):
        group = self._media_group()
        url_a = self.store(PNG_A)
        url_b = self.store(PNG_B)

        created = save_media_group_items(self.db, group.id, MediaGroupItemsBulkUpdate(
            items=[MediaGroupItemBulkItem(answer="Spain", media_pool=[url_a, url_b])]
        ))
        item_id = created["items"][0]["id"]

        # Drop image B from the pool; its file is referenced nowhere else.
        save_media_group_items(self.db, group.id, MediaGroupItemsBulkUpdate(
            items=[MediaGroupItemBulkItem(id=item_id, media_pool=[url_a])]
        ), )

        self.assertTrue((self.static_dir / static_relative_path_from_media(url_a)).exists())
        # B was pruned because save runs delete on the removed ref set.
        self.assertFalse(is_static_media_referenced(
            self.db, static_relative_path_from_media(url_b)
        ))


class PackPoolRoundTripTests(unittest.TestCase):
    def setUp(self):
        self._temps = [tempfile.TemporaryDirectory() for _ in range(3)]
        self.static_src, self.static_dst, self.pack_dir = (
            Path(t.name) for t in self._temps
        )

    def tearDown(self):
        for temp in self._temps:
            temp.cleanup()

    def _fresh_db(self):
        # A distinct database so import lands in a different collection than the
        # one the pack was exported from (the real cross-device scenario).
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        return sessionmaker(bind=engine)()

    def test_pool_images_round_trip_by_hash(self):
        db_src = self._fresh_db()
        url_a = store_media_bytes(PNG_A, filename="a.png", static_dir=self.static_src, db=db_src)["url"]
        url_b = store_media_bytes(PNG_B, filename="b.png", static_dir=self.static_src, db=db_src)["url"]

        group = QuestionGroup(guid="g1", type_group="media", name="Flags")
        db_src.add(group)
        db_src.flush()
        db_src.add(Question(
            guid="q1",
            type_q="media",
            answer="France",
            media=url_a,
            data={"media_pool": [url_a, url_b], "aliases": []},
            group_id=group.id
        ))
        db_src.commit()

        zip_path = export_pack(
            db_src, group.id, version=1, name="Flags",
            static_dir=self.static_src, pack_dir=self.pack_dir
        )
        db_src.close()

        db_dst = self._fresh_db()
        import_pack(db_dst, zip_path, static_dir=self.static_dst)

        imported = db_dst.query(Question).filter(Question.guid == "q1").first()
        pool = read_media_pool(imported.media, imported.data)

        self.assertEqual(len(pool), 2)
        self.assertEqual(imported.media, pool[0])
        for ref in pool:
            self.assertTrue(
                (self.static_dst / static_relative_path_from_media(ref)).exists()
            )
        db_dst.close()


if __name__ == "__main__":
    unittest.main()
