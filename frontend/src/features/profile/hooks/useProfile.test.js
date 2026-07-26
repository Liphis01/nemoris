import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overallRetention, useProfile } from "./useProfile";
import { getProfile, updateProfile } from "../../../api/profile";
import { getStats } from "../../../api/stats";

vi.mock("../../../api/profile", () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn()
}));

vi.mock("../../../api/stats", () => ({
  getStats: vi.fn()
}));

describe("overallRetention", () => {
  it("returns null when there are no reviews yet", () => {
    expect(overallRetention({ text: { reviews: 0, success: 0 } })).toBeNull();
  });

  it("aggregates reviews/success across types before rounding", () => {
    expect(overallRetention({
      text: { reviews: 3, success: 2 },
      map: { reviews: 1, success: 1 }
    })).toBe(75);
  });
});

describe("useProfile", () => {
  beforeEach(() => {
    getStats.mockResolvedValue({
      counts: { total: 10, due_total: 2, mastered: 4 },
      retention_by_type: { text: { reviews: 4, success: 3 } }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("loads a signed-out profile without pre-filling drafts", async () => {
    getProfile.mockResolvedValue({
      signed_in: false,
      account_email: null,
      profile: null
    });

    const { result } = renderHook(() => useProfile());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signedIn).toBe(false);
    expect(result.current.usernameDraft).toBe("");
  });

  it("pre-fills drafts from an existing signed-in profile", async () => {
    getProfile.mockResolvedValue({
      signed_in: true,
      account_email: "louis@example.com",
      profile: {
        username: "Louis",
        avatar_emoji: "🦉",
        avatar_color: "teal",
        updated_at: "2026-07-26T10:00:00Z"
      }
    });

    const { result } = renderHook(() => useProfile());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signedIn).toBe(true);
    expect(result.current.usernameDraft).toBe("Louis");
    expect(result.current.emojiDraft).toBe("🦉");
    expect(result.current.colorDraft).toBe("teal");
  });

  it("computes the retention tile from the shared /stats fetch", async () => {
    getProfile.mockResolvedValue({
      signed_in: false,
      account_email: null,
      profile: null
    });

    const { result } = renderHook(() => useProfile());

    await waitFor(() => expect(result.current.statsLoading).toBe(false));

    expect(result.current.stats.counts.total).toBe(10);
    expect(overallRetention(result.current.stats.retention_by_type)).toBe(75);
  });

  it("save() trims the username and reports success", async () => {
    getProfile.mockResolvedValue({
      signed_in: true,
      account_email: "louis@example.com",
      profile: { username: "Louis", avatar_emoji: "🦉", avatar_color: "teal" }
    });
    updateProfile.mockResolvedValue({
      signed_in: true,
      account_email: "louis@example.com",
      profile: { username: "Louis", avatar_emoji: "🦊", avatar_color: "amber" }
    });

    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setUsernameDraft("  Louis  ");
      result.current.setEmojiDraft("🦊");
      result.current.setColorDraft("amber");
    });

    await act(async () => {
      await result.current.save();
    });

    expect(updateProfile).toHaveBeenCalledWith({
      username: "Louis",
      avatar_emoji: "🦊",
      avatar_color: "amber"
    });
    expect(result.current.saveStatus).toBe("Profil enregistré.");
  });

  it("save() surfaces a rejection as saveError", async () => {
    getProfile.mockResolvedValue({
      signed_in: true,
      account_email: "louis@example.com",
      profile: { username: "Louis", avatar_emoji: "🦉", avatar_color: "teal" }
    });
    updateProfile.mockRejectedValue(new Error("Ce pseudo est déjà pris."));

    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.saveError).toBe("Ce pseudo est déjà pris.");
    expect(result.current.saveStatus).toBe("");
  });
});
