import { describe, expect, it } from "vitest";
import {
  createDbOnlySyncZip,
  unpackDbOnlySyncZip
} from "./mobileCollectionZip";

describe("mobileCollectionZip", () => {
  it("round-trips backend-compatible DB-only sync archives", async () => {
    const databaseBytes = new Uint8Array([1, 2, 3, 4]);
    const zipBytes = await createDbOnlySyncZip({
      databaseBytes,
      schemaVersion: "0017",
      deviceId: "device-1",
      createdAt: new Date("2026-07-28T12:00:00Z")
    });

    const unpacked = await unpackDbOnlySyncZip(zipBytes);

    expect([...unpacked.databaseBytes]).toEqual([1, 2, 3, 4]);
    expect(unpacked.manifest).toMatchObject({
      format: 1,
      reason: "sync",
      included: ["questions.db"],
      extra: {
        schema_version: "0017",
        device_id: "device-1"
      }
    });
  });
});

