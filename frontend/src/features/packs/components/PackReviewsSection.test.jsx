import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PackReviewsSection from "./PackReviewsSection";
import {
  addPackComment,
  backfillPackInstalls,
  getMyPackStatus,
  getPackPublishStatus,
  listPackComments,
  ratePack,
  requestPackPublishCode,
  signOutPackPublisher,
  verifyPackPublishCode
} from "../../../api/packs";

vi.mock("../../../api/packs", () => ({
  addPackComment: vi.fn(),
  backfillPackInstalls: vi.fn(),
  getMyPackStatus: vi.fn(),
  getPackPublishStatus: vi.fn(),
  listPackComments: vi.fn(),
  ratePack: vi.fn(),
  requestPackPublishCode: vi.fn(),
  signOutPackPublisher: vi.fn(),
  verifyPackPublishCode: vi.fn()
}));

const entry = {
  pack_guid: "world-map",
  name: "Territoires du monde",
  avg_rating: 4.5,
  rating_count: 8
};

describe("PackReviewsSection", () => {
  beforeEach(() => {
    listPackComments.mockResolvedValue({ comments: [] });
    requestPackPublishCode.mockResolvedValue({});
    verifyPackPublishCode.mockResolvedValue({ signed_in: true });
    signOutPackPublisher.mockResolvedValue({ signed_in: false });
    backfillPackInstalls.mockResolvedValue({ recorded: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("shows a sign-in prompt when signed out", async () => {
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: false,
      account_email: null,
      project_url: "https://project.supabase.co"
    });

    render(<PackReviewsSection entry={entry} setMode={vi.fn()} />);

    expect(
      await screen.findByText("Connexion Supabase")
    ).toBeInTheDocument();
    expect(getMyPackStatus).not.toHaveBeenCalled();
  });

  it("shows an install prompt when signed in but not installed", async () => {
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });
    getMyPackStatus.mockResolvedValue({ is_installed: false, my_rating: null });

    render(<PackReviewsSection entry={entry} setMode={vi.fn()} />);

    expect(
      await screen.findByText(
        "Installe ce pack pour le noter et laisser un commentaire."
      )
    ).toBeInTheDocument();
  });

  it("renders the star input and comment form when eligible, and submits both", async () => {
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });
    getMyPackStatus.mockResolvedValue({ is_installed: true, my_rating: null });
    ratePack.mockResolvedValue({ my_rating: 5, avg_rating: 4.7, rating_count: 9 });
    addPackComment.mockResolvedValue({
      comment: { id: 1, author_label: "me@example.com", body: "Top pack !" }
    });

    render(<PackReviewsSection entry={entry} setMode={vi.fn()} />);

    // The five star buttons share the same accessible name ("★"); wait for
    // them to appear once eligibility resolves, then click the 5th.
    const starButtons = await screen.findAllByRole("button", { name: "★" });
    expect(starButtons).toHaveLength(5);
    await userEvent.click(starButtons[4]);

    await waitFor(() => {
      expect(ratePack).toHaveBeenCalledWith("world-map", 5);
    });

    const textarea = screen.getByLabelText("Ton commentaire");
    await userEvent.type(textarea, "Top pack !");
    await userEvent.click(screen.getByRole("button", { name: "Commenter" }));

    await waitFor(() => {
      expect(addPackComment).toHaveBeenCalledWith("world-map", "Top pack !");
    });
    expect(textarea).toHaveValue("");
  });
});
