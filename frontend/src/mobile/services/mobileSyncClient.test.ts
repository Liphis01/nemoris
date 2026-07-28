import { describe, expect, it, vi } from "vitest";
import {
  MobileSupabaseSyncClient,
  MobileSyncConflict
} from "./mobileSyncClient";

function jsonResponse(payload: any, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

describe("MobileSupabaseSyncClient", () => {
  it("keeps browser fetch bound to globalThis by default", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(function (this: any) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(jsonResponse({}));
    });
    globalThis.fetch = fetchMock as any;

    try {
      const client = new MobileSupabaseSyncClient({
        projectUrl: "https://project.supabase.co",
        publishableKey: "public"
      });

      await client.requestCode("a@example.com");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://project.supabase.co/auth/v1/otp",
        expect.objectContaining({ method: "POST" })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts Supabase magic links as verification input", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      access_token: "access",
      refresh_token: "refresh",
      user: { id: "user-1" }
    }));
    const client = new MobileSupabaseSyncClient({
      projectUrl: "https://project.supabase.co/auth/v1",
      publishableKey: "public",
      fetchImpl: fetchImpl as any
    });

    const result = await client.verify(
      "a@example.com",
      "https://project.supabase.co/auth/v1/verify?token=hash&type=magiclink"
    );

    expect(result.token).toEqual({
      access_token: "access",
      refresh_token: "refresh",
      user_id: "user-1"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "magiclink", token_hash: "hash" })
      })
    );
  });

  it("reads sync metadata with the published Supabase table shape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([
      {
        version: 7,
        schema_version: "0017",
        media_hashes: ["abc"]
      }
    ]));
    const client = new MobileSupabaseSyncClient({
      projectUrl: "https://project.supabase.co",
      publishableKey: "public",
      fetchImpl: fetchImpl as any
    });

    const meta = await client.getMeta({
      access_token: "access",
      refresh_token: "refresh",
      user_id: "user-1"
    });

    expect(meta.version).toBe(7);
    expect(meta.media_hashes).toEqual(["abc"]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://project.supabase.co/rest/v1/collections?select=version,schema_version,updated_at,last_device_id,media_hashes"
    );
  });

  it("raises conflicts when the cloud version moved", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ version: 3, media_hashes: [] }]));
    const client = new MobileSupabaseSyncClient({
      projectUrl: "https://project.supabase.co",
      publishableKey: "public",
      fetchImpl: fetchImpl as any
    });

    await expect(client.push({
      access_token: "access",
      refresh_token: "refresh",
      user_id: "user-1"
    }, {
      baseVersion: 2,
      schemaVersion: "0017",
      deviceId: "device",
      zipBytes: new Uint8Array([1, 2, 3]),
      mediaHashes: []
    })).rejects.toBeInstanceOf(MobileSyncConflict);
  });
});
