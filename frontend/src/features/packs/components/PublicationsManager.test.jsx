import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicationsManager from "./PublicationsManager";
import {
  backfillPackInstalls,
  getPackPublishStatus,
  listPackPublications,
  publishPackDraft,
  requestPackPublishCode,
  signOutPackPublisher,
  unpublishPack,
  verifyPackPublishCode
} from "../../../api/packs";

vi.mock("../../../api/packs", () => ({
  backfillPackInstalls: vi.fn(),
  getPackPublishStatus: vi.fn(),
  listPackPublications: vi.fn(),
  publishPackDraft: vi.fn(),
  requestPackPublishCode: vi.fn(),
  signOutPackPublisher: vi.fn(),
  unpublishPack: vi.fn(),
  verifyPackPublishCode: vi.fn()
}));

const draft = {
  pack_guid: "draft-guid",
  name: "Brouillon capitales",
  version: 1,
  question_count: 12,
  is_public: false,
  publication_status: "draft",
  avg_rating: null,
  rating_count: 0,
  comment_count: 0
};

const published = {
  pack_guid: "published-guid",
  name: "Territoires du monde",
  version: 3,
  question_count: 252,
  is_public: true,
  publication_status: "published",
  avg_rating: 4.5,
  rating_count: 8,
  comment_count: 2
};

const unpublished = {
  pack_guid: "unpublished-guid",
  name: "Ancien pack",
  version: 1,
  question_count: 5,
  is_public: false,
  publication_status: "archived",
  avg_rating: 3,
  rating_count: 1,
  comment_count: 0
};

describe("PublicationsManager", () => {
  beforeEach(() => {
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });
    listPackPublications.mockResolvedValue({
      publications: [draft, published, unpublished]
    });
    unpublishPack.mockResolvedValue({
      status: "unpublished",
      publication: { ...published, is_public: false, publication_status: "archived" }
    });
    publishPackDraft.mockResolvedValue({
      status: "published",
      publication: { ...draft, is_public: true, publication_status: "published" }
    });
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

  it("renders all three status pills including Dépublié", async () => {
    render(<PublicationsManager setMode={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Brouillon capitales")).toBeInTheDocument();
    });

    const items = screen.getAllByText(/Brouillon|Publié|Dépublié/);
    expect(items.map((node) => node.textContent)).toEqual(
      expect.arrayContaining(["Brouillon", "Publié", "Dépublié"])
    );
  });

  it("unpublishing is gated by window.confirm and calls unpublishPack when accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PublicationsManager setMode={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Territoires du monde")).toBeInTheDocument();
    });

    const publishedRow = screen.getByText("Territoires du monde").closest(
      ".pack-publication-item"
    );

    await userEvent.click(
      within(publishedRow).getByRole("button", { name: "Dépublier" })
    );

    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(unpublishPack).toHaveBeenCalledWith("published-guid");
    });
  });

  it("declining the confirm dialog does not call unpublishPack", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PublicationsManager setMode={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Territoires du monde")).toBeInTheDocument();
    });

    const publishedRow = screen.getByText("Territoires du monde").closest(
      ".pack-publication-item"
    );

    await userEvent.click(
      within(publishedRow).getByRole("button", { name: "Dépublier" })
    );

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(unpublishPack).not.toHaveBeenCalled();
  });

  it("Publier republishes a draft or unpublished row", async () => {
    render(<PublicationsManager setMode={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Ancien pack")).toBeInTheDocument();
    });

    const unpublishedRow = screen.getByText("Ancien pack").closest(
      ".pack-publication-item"
    );

    await userEvent.click(
      within(unpublishedRow).getByRole("button", { name: "Publier" })
    );

    await waitFor(() => {
      expect(publishPackDraft).toHaveBeenCalledWith("unpublished-guid");
    });
  });
});
