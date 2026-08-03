import JSZip from "jszip";

const DATABASE_MEMBER = "questions.db";
const MANIFEST_MEMBER = "backup-manifest.json";

export async function unpackDbOnlySyncZip(zipBytes: Uint8Array | ArrayBuffer) {
  const zip = await JSZip.loadAsync(zipBytes);
  const manifestFile = zip.file(MANIFEST_MEMBER);
  const databaseFile = zip.file(DATABASE_MEMBER);

  if (!manifestFile) {
    throw new Error("Invalid sync archive: backup manifest is missing.");
  }

  if (!databaseFile) {
    throw new Error("Invalid sync archive: questions.db is missing.");
  }

  const manifest = JSON.parse(await manifestFile.async("string"));

  if (manifest.format !== 1) {
    throw new Error("Unsupported sync archive format.");
  }

  return {
    manifest,
    databaseBytes: await databaseFile.async("uint8array")
  };
}

export async function createDbOnlySyncZip({
  databaseBytes,
  schemaVersion,
  deviceId,
  createdAt = new Date()
}: {
  databaseBytes: Uint8Array | ArrayBuffer;
  schemaVersion: string;
  deviceId: string;
  createdAt?: Date;
}) {
  const zip = new JSZip();
  const manifest = {
    format: 1,
    created_at: createdAt.toISOString(),
    reason: "sync",
    database_file: "mobile://questions.db",
    static_dir: "mobile://static",
    extra: {
      schema_version: schemaVersion,
      device_id: deviceId
    },
    included: [DATABASE_MEMBER]
  };

  zip.file(DATABASE_MEMBER, databaseBytes);
  zip.file(MANIFEST_MEMBER, JSON.stringify(manifest, null, 2));

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE"
  });
}

