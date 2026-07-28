import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

let sqlPromise: Promise<any> | null = null;
let sqlWasmLocator: (() => string) | null = null;

export function configureMobileSqlWasmLocator(locator: (() => string) | null) {
  sqlWasmLocator = locator;
  sqlPromise = null;
}

export async function loadSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: () => sqlWasmLocator?.() || sqlWasmUrl
    });
  }
  return sqlPromise;
}

export async function openMobileDatabase(bytes?: Uint8Array) {
  const SQL = await loadSql();
  return bytes ? new SQL.Database(bytes) : new SQL.Database();
}

export function exportMobileDatabase(database: any): Uint8Array {
  return database.export();
}

export function queryAll(database: any, sql: string, params: any[] = []) {
  const statement = database.prepare(sql, params);
  const rows = [];
  try {
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return rows;
}

export function readMobileReviewRows(database: any) {
  const questions = queryAll(
    database,
    "SELECT id, guid, type_q, question, answer, media, answer_media, tags, data, group_id FROM questions ORDER BY id"
  ).map(deserializeJsonColumns);
  const progresses = queryAll(
    database,
    "SELECT question_id, stability, difficulty, reps, lapses, interval, ideal_interval, last_review, next_review, ideal_next_review, fsrs_card, fsrs_version, history FROM progress"
  ).map(deserializeJsonColumns);
  return { questions, progresses };
}

export function readMobileMediaRegistry(database: any) {
  try {
    return queryAll(
      database,
      "SELECT sha256, path, byte_size FROM media_files ORDER BY id"
    ).filter((row: any) => row.sha256 && row.path);
  } catch {
    return [];
  }
}

export function upsertMobileProgress(database: any, progress: any) {
  database.run(
    `
    INSERT INTO progress (
      question_id, stability, difficulty, reps, lapses, interval,
      ideal_interval, last_review, next_review, ideal_next_review,
      fsrs_card, fsrs_version, history
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(question_id) DO UPDATE SET
      stability = excluded.stability,
      difficulty = excluded.difficulty,
      reps = excluded.reps,
      lapses = excluded.lapses,
      interval = excluded.interval,
      ideal_interval = excluded.ideal_interval,
      last_review = excluded.last_review,
      next_review = excluded.next_review,
      ideal_next_review = excluded.ideal_next_review,
      fsrs_card = excluded.fsrs_card,
      fsrs_version = excluded.fsrs_version,
      history = excluded.history
    `,
    [
      progress.question_id,
      progress.stability,
      progress.difficulty,
      progress.reps,
      progress.lapses,
      progress.interval,
      progress.ideal_interval,
      progress.last_review,
      progress.next_review,
      progress.ideal_next_review,
      JSON.stringify(progress.fsrs_card ?? null),
      progress.fsrs_version,
      JSON.stringify(progress.history || [])
    ]
  );
}

export function insertMobileReviewLog(database: any, reviewLog: any) {
  if (!reviewLog) return;
  const seqRows = queryAll(
    database,
    "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM review_log WHERE question_id = ?",
    [reviewLog.question_id]
  );
  const seq = seqRows[0]?.seq || 1;

  database.run(
    `
    INSERT INTO review_log (
      question_id, question_guid, seq, reviewed_on, reviewed_at, quality,
      stability, difficulty, reps, lapses, interval, next_review,
      ideal_interval, ideal_next_review, data
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      reviewLog.question_id,
      reviewLog.question_guid,
      seq,
      reviewLog.reviewed_on,
      reviewLog.reviewed_at,
      reviewLog.quality,
      reviewLog.stability,
      reviewLog.difficulty,
      reviewLog.reps,
      reviewLog.lapses,
      reviewLog.interval,
      reviewLog.next_review,
      reviewLog.ideal_interval,
      reviewLog.ideal_next_review,
      JSON.stringify(reviewLog.data || {})
    ]
  );
}

function deserializeJsonColumns(row: any) {
  const next = { ...row };
  for (const key of ["tags", "data", "fsrs_card", "history"]) {
    if (typeof next[key] === "string" && next[key]) {
      try {
        next[key] = JSON.parse(next[key]);
      } catch {
        // Leave legacy malformed JSON as-is so callers can decide how to handle it.
      }
    }
  }
  return next;
}
