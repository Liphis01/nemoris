import { describe, expect, it } from "vitest";
import {
  configureMobileSqlWasmLocator,
  exportMobileDatabase,
  insertMobileReviewLog,
  openMobileDatabase,
  readMobileMediaRegistry,
  readMobileReviewRows,
  upsertMobileProgress
} from "./mobileSqlite";

configureMobileSqlWasmLocator(
  () => `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`
);

function createSchema(database: any) {
  database.run(`
    CREATE TABLE questions (
      id INTEGER PRIMARY KEY,
      guid TEXT,
      type_q TEXT,
      question TEXT,
      answer TEXT,
      media TEXT,
      answer_media TEXT,
      tags TEXT,
      data TEXT,
      group_id INTEGER
    );
    CREATE TABLE progress (
      question_id INTEGER PRIMARY KEY,
      stability REAL,
      difficulty REAL,
      reps INTEGER,
      lapses INTEGER,
      interval INTEGER,
      ideal_interval INTEGER,
      last_review TEXT,
      next_review TEXT,
      ideal_next_review TEXT,
      fsrs_card TEXT,
      fsrs_version TEXT,
      history TEXT
    );
    CREATE TABLE review_log (
      id INTEGER PRIMARY KEY,
      question_id INTEGER,
      question_guid TEXT,
      seq INTEGER,
      reviewed_on TEXT,
      reviewed_at TEXT,
      quality INTEGER,
      stability REAL,
      difficulty REAL,
      reps INTEGER,
      lapses INTEGER,
      interval INTEGER,
      next_review TEXT,
      ideal_interval INTEGER,
      ideal_next_review TEXT,
      data TEXT
    );
    CREATE TABLE media_files (
      id INTEGER PRIMARY KEY,
      path TEXT,
      sha256 TEXT,
      byte_size INTEGER
    );
  `);
}

describe("mobileSqlite", () => {
  it("reads review rows and persists progress/review_log mutations", async () => {
    const database = await openMobileDatabase();
    try {
      createSchema(database);
      database.run(
        "INSERT INTO questions (id, guid, type_q, question, answer, media, tags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [7, "q-guid", "text", "Prompt", "Answer", null, JSON.stringify(["tag"]), "{}"]
      );
      database.run(
        "INSERT INTO media_files (path, sha256, byte_size) VALUES (?, ?, ?)",
        ["photo.png", "abc123", 42]
      );

      const progress = {
        question_id: 7,
        stability: 2.3,
        difficulty: 3.4,
        reps: 1,
        lapses: 0,
        interval: 2,
        ideal_interval: 2,
        last_review: "2026-07-28",
        next_review: "2026-07-30",
        ideal_next_review: "2026-07-30",
        fsrs_card: { state: 2 },
        fsrs_version: "6.3.1",
        history: [{ quality: 2 }]
      };
      upsertMobileProgress(database, progress);
      insertMobileReviewLog(database, {
        question_id: 7,
        question_guid: "q-guid",
        reviewed_on: "2026-07-28",
        reviewed_at: "2026-07-28T12:00:00.000Z",
        quality: 2,
        stability: 2.3,
        difficulty: 3.4,
        reps: 1,
        lapses: 0,
        interval: 2,
        next_review: "2026-07-30",
        ideal_interval: 2,
        ideal_next_review: "2026-07-30",
        data: { source: "mobile" }
      });

      const reopened = await openMobileDatabase(exportMobileDatabase(database));
      try {
        const rows = readMobileReviewRows(reopened);
        expect(rows.questions[0].tags).toEqual(["tag"]);
        expect(rows.progresses[0].fsrs_card).toEqual({ state: 2 });
        expect(rows.progresses[0].history).toEqual([{ quality: 2 }]);
        expect(readMobileMediaRegistry(reopened)).toEqual([
          { sha256: "abc123", path: "photo.png", byte_size: 42 }
        ]);
      } finally {
        reopened.close();
      }
    } finally {
      database.close();
    }
  });
});
