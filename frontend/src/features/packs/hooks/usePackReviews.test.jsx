import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePackReviews } from "./usePackReviews";
import {
  addPackComment,
  getMyPackStatus,
  listPackComments,
  ratePack
} from "../../../api/packs";

vi.mock("../../../api/packs", () => ({
  addPackComment: vi.fn(),
  getMyPackStatus: vi.fn(),
  listPackComments: vi.fn(),
  ratePack: vi.fn()
}));

describe("usePackReviews", () => {
  beforeEach(() => {
    listPackComments.mockResolvedValue({
      comments: [
        { id: 1, author_label: "fan@example.com", body: "Super pack !" }
      ]
    });
    getMyPackStatus.mockResolvedValue({ is_installed: true, my_rating: null });
    ratePack.mockResolvedValue({ my_rating: 4, avg_rating: 4.5, rating_count: 2 });
    addPackComment.mockResolvedValue({
      comment: { id: 2, author_label: "me@example.com", body: "Merci !" }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("loads comments without requiring sign-in", async () => {
    const { result } = renderHook(() =>
      usePackReviews("pack-1", { signedIn: false })
    );

    await waitFor(() => expect(result.current.loadingComments).toBe(false));

    expect(listPackComments).toHaveBeenCalledWith("pack-1");
    expect(result.current.comments).toHaveLength(1);
    expect(getMyPackStatus).not.toHaveBeenCalled();
    expect(result.current.myStatus).toBeNull();
  });

  it("only fetches my-status when signed in", async () => {
    const { result } = renderHook(() =>
      usePackReviews("pack-1", { signedIn: true })
    );

    await waitFor(() => expect(result.current.myStatus).not.toBeNull());

    expect(getMyPackStatus).toHaveBeenCalledWith("pack-1");
    expect(result.current.myStatus.is_installed).toBe(true);
  });

  it("submitComment() prepends the new comment on success and clears on caller side", async () => {
    const { result } = renderHook(() =>
      usePackReviews("pack-1", { signedIn: true })
    );

    await waitFor(() => expect(result.current.loadingComments).toBe(false));

    let success;
    await act(async () => {
      success = await result.current.submitComment("Merci !");
    });

    expect(success).toBe(true);
    expect(addPackComment).toHaveBeenCalledWith("pack-1", "Merci !");
    expect(result.current.comments[0].body).toBe("Merci !");
    expect(result.current.comments).toHaveLength(2);
  });

  it("submitComment() surfaces an error and returns false on failure", async () => {
    addPackComment.mockRejectedValue(new Error("not installed"));

    const { result } = renderHook(() =>
      usePackReviews("pack-1", { signedIn: true })
    );

    await waitFor(() => expect(result.current.loadingComments).toBe(false));

    let success;
    await act(async () => {
      success = await result.current.submitComment("Merci !");
    });

    expect(success).toBe(false);
    expect(result.current.commentSubmitError).toBe("not installed");
    expect(result.current.comments).toHaveLength(1);
  });

  it("submitRating() updates my_rating and the aggregate from the RPC response", async () => {
    const { result } = renderHook(() =>
      usePackReviews("pack-1", {
        signedIn: true,
        initialAggregate: { avg_rating: 3, rating_count: 1 }
      })
    );

    await waitFor(() => expect(result.current.myStatus).not.toBeNull());

    await act(async () => {
      await result.current.submitRating(4);
    });

    expect(ratePack).toHaveBeenCalledWith("pack-1", 4);
    expect(result.current.myStatus.my_rating).toBe(4);
    expect(result.current.aggregate).toEqual({
      avg_rating: 4.5,
      rating_count: 2
    });
  });
});
