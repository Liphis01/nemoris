import { applyMobileAnswer, selectDueMobileReviewItems } from "./mobileReviewEngine";
import {
  exportMobileDatabase,
  insertMobileReviewLog,
  openMobileDatabase,
  readMobileReviewRows,
  upsertMobileProgress
} from "./mobileSqlite";
import {
  readMobileDatabaseFile,
  writeMobileDatabaseFile
} from "./mobileFileStore";
import {
  loadMobileState,
  markMobileCollectionChanged,
  saveMobileState,
  saveSyncToken
} from "./mobileStorage";
import { mobileSyncStatus } from "./mobileSyncEngine";

let inMemoryCollection: any = {
  questions: [],
  progresses: []
};

async function loadReviewCollection() {
  const databaseBytes = await readMobileDatabaseFile();
  if (!databaseBytes) return inMemoryCollection;

  const database = await openMobileDatabase(databaseBytes);
  try {
    inMemoryCollection = readMobileReviewRows(database);
    return inMemoryCollection;
  } finally {
    database.close();
  }
}

export function installMobileCollectionForTests(collection: any) {
  inMemoryCollection = collection;
}

export async function getMobileStatus() {
  const syncStatus = await mobileSyncStatus();
  const collection = await loadReviewCollection();
  return {
    signed_in: syncStatus.signed_in,
    account_email: syncStatus.account_email,
    last_server_version: syncStatus.last_server_version,
    collection_dirty: syncStatus.collection_dirty,
    question_count: collection.questions.length,
    due_count: selectDueMobileReviewItems(collection).length,
    last_sync_status: syncStatus.last_sync_status,
    last_sync_error: syncStatus.last_sync_error
  };
}

export async function getMobileReview(today?: string) {
  const collection = await loadReviewCollection();
  return selectDueMobileReviewItems({
    questions: collection.questions,
    progresses: collection.progresses,
    today
  });
}

export async function sendMobileAnswer(questionId: number, quality: number, today?: string) {
  const databaseBytes = await readMobileDatabaseFile();
  const collection = await loadReviewCollection();
  const question = collection.questions.find((item: any) => Number(item.id) === Number(questionId));
  if (!question) throw new Error("Question not found");
  const index = collection.progresses.findIndex(
    (progress: any) => Number(progress.question_id) === Number(questionId)
  );
  const existing = index >= 0 ? collection.progresses[index] : null;
  const result = applyMobileAnswer({ question, progress: existing, quality, today });

  if (index >= 0) {
    collection.progresses[index] = result.progress;
  } else {
    collection.progresses.push(result.progress);
  }

  if (databaseBytes) {
    const database = await openMobileDatabase(databaseBytes);
    try {
      upsertMobileProgress(database, result.progress);
      insertMobileReviewLog(database, result.reviewLog);
      await writeMobileDatabaseFile(exportMobileDatabase(database));
    } finally {
      database.close();
    }
  }

  await markMobileCollectionChanged("review");
  return result.progress;
}

export async function saveMobileSyncSession({
  email,
  token,
  serverUrl,
  serverKey
}: {
  email: string;
  token: any;
  serverUrl: string;
  serverKey: string;
}) {
  const state = await loadMobileState();
  await saveSyncToken(token);
  return saveMobileState({
    ...state,
    accountEmail: email,
    serverUrl,
    serverKey
  });
}
