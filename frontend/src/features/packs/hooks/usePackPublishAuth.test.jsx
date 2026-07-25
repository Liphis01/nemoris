import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePackPublishAuth } from "./usePackPublishAuth";
import {
  backfillPackInstalls,
  getPackPublishStatus,
  requestPackPublishCode,
  signOutPackPublisher,
  verifyPackPublishCode
} from "../../../api/packs";

vi.mock("../../../api/packs", () => ({
  backfillPackInstalls: vi.fn(),
  getPackPublishStatus: vi.fn(),
  requestPackPublishCode: vi.fn(),
  signOutPackPublisher: vi.fn(),
  verifyPackPublishCode: vi.fn()
}));

describe("usePackPublishAuth", () => {
  beforeEach(() => {
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: false,
      account_email: null,
      project_url: "https://project.supabase.co"
    });
    requestPackPublishCode.mockResolvedValue({});
    verifyPackPublishCode.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });
    signOutPackPublisher.mockResolvedValue({
      configured: true,
      signed_in: false,
      account_email: null,
      project_url: "https://project.supabase.co"
    });
    backfillPackInstalls.mockResolvedValue({ recorded: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("loads publish status on mount", async () => {
    const { result } = renderHook(() => usePackPublishAuth());

    await waitFor(() => {
      expect(result.current.publishStatus).not.toBeNull();
    });

    expect(getPackPublishStatus).toHaveBeenCalledTimes(1);
    expect(result.current.publishStatus.signed_in).toBe(false);
  });

  it("requestCode() sends the trimmed email and advances to the code step", async () => {
    const { result } = renderHook(() => usePackPublishAuth());

    await waitFor(() => expect(result.current.publishStatus).not.toBeNull());

    act(() => {
      result.current.setEmail("  author@example.com  ");
    });

    await act(async () => {
      await result.current.requestCode();
    });

    expect(requestPackPublishCode).toHaveBeenCalledWith("author@example.com");
    expect(result.current.authStep).toBe("code");
  });

  it("verifyCode() signs in, clears the code, and backfills installs exactly once", async () => {
    const { result } = renderHook(() => usePackPublishAuth());

    await waitFor(() => expect(result.current.publishStatus).not.toBeNull());

    // refresh() re-fetches status after verifying -- reflect the
    // now-signed-in server state for that second call.
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });

    act(() => {
      result.current.setEmail("author@example.com");
      result.current.setCode("123456");
    });

    await act(async () => {
      await result.current.verifyCode();
    });

    expect(verifyPackPublishCode).toHaveBeenCalledWith(
      "author@example.com",
      "123456"
    );
    expect(result.current.code).toBe("");
    expect(result.current.publishStatus.signed_in).toBe(true);
    expect(backfillPackInstalls).toHaveBeenCalledTimes(1);
    // Sign-in refreshes status again on top of the initial mount load.
    expect(getPackPublishStatus).toHaveBeenCalledTimes(2);
  });

  it("verifyCode() failure surfaces an error and never backfills", async () => {
    verifyPackPublishCode.mockRejectedValue(new Error("Code invalide."));

    const { result } = renderHook(() => usePackPublishAuth());

    await waitFor(() => expect(result.current.publishStatus).not.toBeNull());

    act(() => {
      result.current.setCode("000000");
    });

    await act(async () => {
      await result.current.verifyCode();
    });

    expect(result.current.error).toBe("Code invalide.");
    expect(backfillPackInstalls).not.toHaveBeenCalled();
  });

  it("signOut() clears the signed-in status", async () => {
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });

    const { result } = renderHook(() => usePackPublishAuth());

    await waitFor(() => expect(result.current.publishStatus?.signed_in).toBe(true));

    await act(async () => {
      await result.current.signOut();
    });

    expect(signOutPackPublisher).toHaveBeenCalledTimes(1);
    expect(result.current.publishStatus.signed_in).toBe(false);
  });
});
