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

  it("asks for the whole review session, with no scope", () => {
    getReview();

    // Scoped review is gone: the Learn screen replaced the per-scope Study
    // dashboard that was its only entry point.
    expect(requestJson).toHaveBeenCalledWith("/review");
  });

});
