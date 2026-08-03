import {
  createDbOnlySyncZip,
  unpackDbOnlySyncZip
} from "./mobileCollectionZip";
import {
  mobileMediaPathExists,
  readMobileDatabaseFile,
  readMobileMediaPath,
  writeMobileMediaPath,
  writeMobileDatabaseFile
} from "./mobileFileStore";
import {
  openMobileDatabase,
  readMobileMediaRegistry
} from "./mobileSqlite";
import {
  collectionIsDirty,
  ensureDeviceId,
  loadMobileState,
  loadSyncToken,
  markMobileCollectionClean,
  saveMobileState,
  saveSyncToken
} from "./mobileStorage";
import {
  MobileSupabaseSyncClient,
  MobileSyncConflict
} from "./mobileSyncClient";

function buildClient(state: any) {
  return new MobileSupabaseSyncClient({
    projectUrl: state.serverUrl,
    publishableKey: state.serverKey,
    onTokensUpdated: saveSyncToken
  });
}

async function readMediaRegistry(databaseBytes: Uint8Array) {
  const database = await openMobileDatabase(databaseBytes);
  try {
    return readMobileMediaRegistry(database);
  } finally {
    database.close();
  }
}

async function reconcilePulledMedia(
  client: MobileSupabaseSyncClient,
  token: any,
  databaseBytes: Uint8Array
) {
  const registry = await readMediaRegistry(databaseBytes);
  let downloaded = 0;
  let missing = 0;

  for (const item of registry) {
    if (await mobileMediaPathExists(item.path)) continue;

    try {
      const bytes = await client.downloadMediaBlob(token, item.sha256);
      await writeMobileMediaPath(item.path, bytes);
      downloaded += 1;
    } catch {
      missing += 1;
    }
  }

  return { total: registry.length, downloaded, missing };
}

async function uploadMissingLocalMedia(
  client: MobileSupabaseSyncClient,
  token: any,
  databaseBytes: Uint8Array,
  serverHashes: Set<string>
) {
  const registry = await readMediaRegistry(databaseBytes);
  const localHashes = new Set<string>();
  let uploaded = 0;
  let skipped = 0;

  for (const item of registry) {
    localHashes.add(item.sha256);
    if (serverHashes.has(item.sha256)) continue;

    const bytes = await readMobileMediaPath(item.path);
    if (!bytes) {
      skipped += 1;
      continue;
    }

    await client.uploadMediaBlob(token, item.sha256, bytes);
    uploaded += 1;
  }

  return {
    mediaHashes: Array.from(localHashes).sort(),
    total: registry.length,
    uploaded,
    skipped
  };
}

export async function mobileSyncStatus() {
  const state = await loadMobileState();
  const token = await loadSyncToken();
  return {
    signed_in: Boolean(state.accountEmail && token),
    account_email: state.accountEmail,
    last_server_version: state.lastServerVersion,
    collection_dirty: collectionIsDirty(state),
    last_sync_status: state.lastSyncStatus,
    last_sync_error: state.lastSyncError,
    last_media_status: state.lastMediaStatus,
    conflict_server_version: state.conflictServerVersion
  };
}

export async function requestMobileSyncCode(email: string) {
  const state = await loadMobileState();
  return buildClient(state).requestCode(email);
}

export async function verifyMobileSyncCode(email: string, codeOrLink: string) {
  const state = await loadMobileState();
  const client = buildClient(state);
  const result = await client.verify(email, codeOrLink);
  await saveSyncToken(result.token);
  return saveMobileState({
    ...state,
    accountEmail: String(email || "").trim().toLowerCase()
  });
}

export async function pullMobileCollection() {
  const state = ensureDeviceId(await loadMobileState());
  await saveMobileState(state);
  const token = await loadSyncToken();
  const client = buildClient(state);
  const pulled = await client.pull(token);
  const activeToken = (await loadSyncToken()) || token;

  if (!pulled) {
    await saveMobileState({
      ...state,
      lastSyncStatus: "empty",
      lastSyncError: null
    });
    return { status: "empty" };
  }

  const incomingSchema = pulled.schema_version;
  const localSchema = state.codeSchemaVersion;
  if (incomingSchema && localSchema && incomingSchema > localSchema) {
    throw new Error("This collection was synced from a newer app version.");
  }

  const { databaseBytes } = await unpackDbOnlySyncZip(pulled.zip_bytes);
  await writeMobileDatabaseFile(databaseBytes);
  const mediaStatus = await reconcilePulledMedia(client, activeToken, databaseBytes);
  await markMobileCollectionClean(pulled.version);
  await saveMobileState({
    ...(await loadMobileState()),
    lastSyncStatus: "pulled",
    lastSyncError: mediaStatus.missing
      ? `${mediaStatus.missing} uploaded media file(s) were not available in cloud storage.`
      : null,
    lastMediaStatus: mediaStatus,
    conflictServerVersion: null
  });
  return { status: "pulled", version: pulled.version, media: mediaStatus };
}

export async function pushMobileCollection({ force = false } = {}) {
  const state = ensureDeviceId(await loadMobileState());
  await saveMobileState(state);
  const token = await loadSyncToken();
  const databaseBytes = await readMobileDatabaseFile();

  if (!databaseBytes) {
    throw new Error("No local mobile collection to push.");
  }

  const zipBytes = await createDbOnlySyncZip({
    databaseBytes,
    schemaVersion: state.codeSchemaVersion || "mobile-v1",
    deviceId: state.deviceId
  });
  const client = buildClient(state);

  try {
    const meta = await client.getMeta(token);
    const activeToken = (await loadSyncToken()) || token;
    if (!force && Number(state.lastServerVersion) !== Number(meta.version)) {
      throw new MobileSyncConflict(Number(meta.version));
    }

    const mediaStatus = await uploadMissingLocalMedia(
      client,
      activeToken,
      databaseBytes,
      new Set(meta.media_hashes || [])
    );
    const latestToken = (await loadSyncToken()) || activeToken;
    const result = await client.push(latestToken, {
      baseVersion: state.lastServerVersion,
      schemaVersion: state.codeSchemaVersion || "mobile-v1",
      deviceId: state.deviceId,
      zipBytes,
      mediaHashes: mediaStatus.mediaHashes,
      force
    });
    await markMobileCollectionClean(result.version);
    await saveMobileState({
      ...(await loadMobileState()),
      lastSyncStatus: "pushed",
      lastSyncError: null,
      lastMediaStatus: mediaStatus,
      conflictServerVersion: null
    });
    return { status: "pushed", version: result.version, media: mediaStatus };
  } catch (error) {
    if (error instanceof MobileSyncConflict) {
      await saveMobileState({
        ...(await loadMobileState()),
        lastSyncStatus: "conflict",
        lastSyncError: null,
        conflictServerVersion: error.serverVersion
      });
      return { status: "conflict", server_version: error.serverVersion };
    }
    throw error;
  }
}
