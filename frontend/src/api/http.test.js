import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLECTION_MUTATION_EVENT, requestJson } from "./http";

vi.mock("./config", () => ({
  apiUrl: (path) => path
}));

describe("requestJson collection mutation events", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits after successful collection mutations", async () => {
    const listener = vi.fn();
    window.addEventListener(COLLECTION_MUTATION_EVENT, listener);

    await requestJson("/questions", { method: "POST" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({
      path: "/questions",
      method: "POST"
    });

    window.removeEventListener(COLLECTION_MUTATION_EVENT, listener);
  });

  it("does not emit for sync endpoints", async () => {
    const listener = vi.fn();
    window.addEventListener(COLLECTION_MUTATION_EVENT, listener);

    await requestJson("/sync/push?force=false", { method: "POST" });

    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(COLLECTION_MUTATION_EVENT, listener);
  });

  it("emits for transactional tag actions", async () => {
    const listener = vi.fn();
    window.addEventListener(COLLECTION_MUTATION_EVENT, listener);

    await requestJson("/tags/actions", { method: "POST" });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(COLLECTION_MUTATION_EVENT, listener);
  });

  it("preserves an HTTP conflict status and fresh tag snapshot", async () => {
    const snapshot = { revision: 12, nodes: [] };
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      detail: { message: "stale", snapshot }
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" }
    }));

    await expect(requestJson("/tags/actions", { method: "POST" }))
      .rejects.toMatchObject({ status: 409, message: "stale", snapshot });
  });
});
