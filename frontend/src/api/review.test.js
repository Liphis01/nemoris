import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./http";
import { getReview } from "./review";

vi.mock("./http", () => ({
  requestJson: vi.fn(() => Promise.resolve([])),
  requestOk: vi.fn(() => Promise.resolve({}))
}));

describe("getReview", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps global review unscoped by default", () => {
    getReview();

    expect(requestJson).toHaveBeenCalledWith("/review");
  });

  it("serializes scoped review params", () => {
    getReview({ type: "group", id: 10 });
    getReview({ type: "collection", collectionId: 20 });
    getReview({ type: "tag", key: "core:geography" });
    getReview({ type: "pack", packGuid: "pack-guid" });

    expect(requestJson).toHaveBeenNthCalledWith(
      1,
      "/review?scope_type=group&group_id=10"
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/review?scope_type=collection&collection_id=20"
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      "/review?scope_type=tag&tag=core%3Ageography"
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      4,
      "/review?scope_type=pack&pack_guid=pack-guid"
    );
  });
});
