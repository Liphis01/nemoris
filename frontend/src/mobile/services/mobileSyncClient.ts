export class MobileSyncError extends Error {}
export class MobileSyncAuthError extends MobileSyncError {}
export class MobileSyncConflict extends MobileSyncError {
  serverVersion: number;

  constructor(serverVersion: number) {
    super("Sync conflict");
    this.serverVersion = serverVersion;
  }
}

const BUCKET = "sync-collections";
const TABLE = "collections";

function normalizeProjectUrl(url: string) {
  let base = String(url || "").trim().replace(/\/+$/, "");
  for (const suffix of ["/rest/v1", "/auth/v1", "/storage/v1"]) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
    }
  }
  return base.replace(/\/+$/, "");
}

function parseErrorMessage(body: any) {
  if (!body || typeof body !== "object") return null;
  return body.error_description || body.msg || body.message || body.error || null;
}

async function responsePayload(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => "");
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, init);
}

export class MobileSupabaseSyncClient {
  base: string;
  key: string;
  fetchImpl: typeof defaultFetch;
  onTokensUpdated?: (token: any) => Promise<void> | void;

  constructor({
    projectUrl,
    publishableKey,
    fetchImpl,
    onTokensUpdated
  }: {
    projectUrl: string;
    publishableKey: string;
    fetchImpl?: typeof defaultFetch;
    onTokensUpdated?: (token: any) => Promise<void> | void;
  }) {
    this.base = normalizeProjectUrl(projectUrl);
    this.key = String(publishableKey || "").trim();
    this.fetchImpl = fetchImpl || defaultFetch;
    this.onTokensUpdated = onTokensUpdated;

    if (!this.base) throw new MobileSyncError("No sync server configured");
    if (!this.key) throw new MobileSyncError("Supabase publishable key required");
  }

  async request(path: string, options: any = {}) {
    const headers: Record<string, string> = {
      apikey: this.key,
      ...(options.headers || {})
    };

    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    }

    let body = options.body;
    if (options.payload !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.payload);
    }

    const response = await this.fetchImpl(`${this.base}${path}`, {
      method: options.method || "GET",
      headers,
      body
    });
    const payload = await responsePayload(response);

    if (response.status === 401) {
      throw new MobileSyncAuthError(parseErrorMessage(payload) || "Not signed in");
    }

    if (!response.ok) {
      throw new MobileSyncError(parseErrorMessage(payload) || `Sync failed (${response.status})`);
    }

    return payload;
  }

  async requestCode(email: string) {
    await this.request("/auth/v1/otp", {
      method: "POST",
      payload: { email, create_user: true }
    });
    return {};
  }

  verifyPayloads(email: string, value: string) {
    const code = String(value || "").trim();
    if (code.includes("://") || code.includes("verify?")) {
      const parsed = new URL(code);
      const tokenHash = parsed.searchParams.get("token");
      const linkType = parsed.searchParams.get("type") || "magiclink";
      if (!tokenHash) throw new MobileSyncAuthError("Invalid email link");
      return [
        { type: linkType, token_hash: tokenHash },
        { type: "email", token_hash: tokenHash }
      ];
    }
    return [{ type: "email", email, token: code }];
  }

  async verify(email: string, codeOrLink: string) {
    let lastError = "Invalid code";
    for (const payload of this.verifyPayloads(email, codeOrLink)) {
      try {
        const data: any = await this.request("/auth/v1/verify", {
          method: "POST",
          payload
        });
        const userId = data?.user?.id;
        if (!data?.access_token || !userId) {
          throw new MobileSyncAuthError("Invalid verification response");
        }
        return {
          token: {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user_id: userId
          }
        };
      } catch (error: any) {
        lastError = error?.message || lastError;
      }
    }
    throw new MobileSyncAuthError(lastError);
  }

  async refresh(token: any) {
    if (!token?.refresh_token) throw new MobileSyncAuthError("Not signed in");
    const data: any = await this.request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      payload: { refresh_token: token.refresh_token }
    });
    if (!data?.access_token) {
      throw new MobileSyncAuthError("Session expired");
    }
    const nextToken = {
      ...token,
      access_token: data.access_token,
      refresh_token: data.refresh_token || token.refresh_token
    };
    await this.onTokensUpdated?.(nextToken);
    return nextToken;
  }

  async authed<T>(token: any, operation: (token: any) => Promise<T>): Promise<T> {
    if (!token?.access_token) throw new MobileSyncAuthError("Not signed in");
    try {
      return await operation(token);
    } catch (error) {
      if (error instanceof MobileSyncAuthError) {
        return operation(await this.refresh(token));
      }
      throw error;
    }
  }

  async getMeta(token: any) {
    return this.authed(token, async (activeToken) => {
      const rows: any = await this.request(
        `/rest/v1/${TABLE}?select=version,schema_version,updated_at,last_device_id,media_hashes`,
        { accessToken: activeToken.access_token }
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        return { version: 0, schema_version: null, updated_at: null, media_hashes: [] };
      }
      return { media_hashes: [], ...rows[0] };
    });
  }

  objectPath(token: any, version: number) {
    return `/storage/v1/object/${BUCKET}/${token.user_id}/v${version}.zip`;
  }

  mediaObjectPath(token: any, sha256: string) {
    return `/storage/v1/object/${BUCKET}/${token.user_id}/media/${sha256}`;
  }

  async uploadZip(token: any, version: number, zipBytes: Blob | Uint8Array | ArrayBuffer) {
    await this.request(this.objectPath(token, version), {
      method: "POST",
      accessToken: token.access_token,
      body: zipBytes,
      headers: {
        "Content-Type": "application/zip",
        "x-upsert": "true"
      }
    });
  }

  async downloadZip(token: any, version: number) {
    const response = await this.fetchImpl(`${this.base}${this.objectPath(token, version)}`, {
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${token.access_token}`
      }
    });
    if (!response.ok) {
      if (response.status === 401) throw new MobileSyncAuthError("Not signed in");
      throw new MobileSyncError("Cloud collection not found");
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async deleteZip(token: any, version: number) {
    try {
      await this.request(this.objectPath(token, version), {
        method: "DELETE",
        accessToken: token.access_token
      });
    } catch {
      // Cleanup is best-effort; a stale object must not fail an otherwise
      // valid sync decision.
    }
  }

  async claimVersion(token: any, fields: any) {
    if (fields.current === 0) {
      try {
        await this.request(`/rest/v1/${TABLE}`, {
          method: "POST",
          accessToken: token.access_token,
          payload: {
            user_id: token.user_id,
            version: fields.newVersion,
            schema_version: fields.schemaVersion,
            updated_at: new Date().toISOString(),
            last_device_id: fields.deviceId,
            media_hashes: fields.mediaHashes
          },
          headers: { Prefer: "return=representation" }
        });
        return true;
      } catch (error: any) {
        if (/409/.test(error?.message || "")) return false;
        throw error;
      }
    }

    const rows: any = await this.request(
      `/rest/v1/${TABLE}?user_id=eq.${token.user_id}&version=eq.${fields.current}`,
      {
        method: "PATCH",
        accessToken: token.access_token,
        payload: {
          version: fields.newVersion,
          schema_version: fields.schemaVersion,
          updated_at: new Date().toISOString(),
          last_device_id: fields.deviceId,
          media_hashes: fields.mediaHashes
        },
        headers: { Prefer: "return=representation" }
      }
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  async push(token: any, options: any) {
    return this.authed(token, async (activeToken) => {
      const meta = await this.getMeta(activeToken);
      if (!options.force && Number(options.baseVersion) !== Number(meta.version)) {
        throw new MobileSyncConflict(Number(meta.version));
      }
      const newVersion = Number(meta.version) + 1;
      await this.uploadZip(activeToken, newVersion, options.zipBytes);
      const claimed = await this.claimVersion(activeToken, {
        current: Number(meta.version),
        newVersion,
        schemaVersion: options.schemaVersion,
        deviceId: options.deviceId,
        mediaHashes: options.mediaHashes || []
      });
      if (!claimed) {
        await this.deleteZip(activeToken, newVersion);
        const latest = await this.getMeta(activeToken);
        throw new MobileSyncConflict(Number(latest.version));
      }
      if (newVersion >= 3) {
        await this.deleteZip(activeToken, newVersion - 2);
      }
      return { version: newVersion };
    });
  }

  async pull(token: any) {
    return this.authed(token, async (activeToken) => {
      const meta = await this.getMeta(activeToken);
      if (!meta.version) return null;
      return {
        version: meta.version,
        schema_version: meta.schema_version,
        zip_bytes: await this.downloadZip(activeToken, Number(meta.version))
      };
    });
  }

  async uploadMediaBlob(token: any, sha256: string, data: Blob | Uint8Array | ArrayBuffer) {
    return this.authed(token, async (activeToken) => this.request(
      this.mediaObjectPath(activeToken, sha256),
      {
        method: "POST",
        accessToken: activeToken.access_token,
        body: data,
        headers: {
          "Content-Type": "application/octet-stream",
          "x-upsert": "true"
        }
      }
    ));
  }

  async downloadMediaBlob(token: any, sha256: string) {
    return this.authed(token, async (activeToken) => {
      const response = await this.fetchImpl(`${this.base}${this.mediaObjectPath(activeToken, sha256)}`, {
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${activeToken.access_token}`
        }
      });
      if (!response.ok) throw new MobileSyncError("Media not found");
      return new Uint8Array(await response.arrayBuffer());
    });
  }
}
