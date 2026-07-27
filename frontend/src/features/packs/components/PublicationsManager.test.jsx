import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicationsManager from "./PublicationsManager";
import { listCollections } from "../../../api/collections";
import { listGroups } from "../../../api/groups";
import {
  deletePackPublication,
  getMyPackStatus,
  listPackComments,
  backfillPackInstalls,
  getPackPublishStatus,
  listPackPublications,
  previewPackRelease,
  publishPack,
  publishPackDraft,
  requestPackPublishCode,
  signOutPackPublisher,
  unpublishPack,
  verifyPackPublishCode
} from "../../../api/packs";

vi.mock("../../../api/collections", () => ({
  listCollections: vi.fn()
}));

vi.mock("../../../api/groups", () => ({
  listGroups: vi.fn()
}));

vi.mock("../../../api/packs", () => ({
  addPackComment: vi.fn(),
  deletePackPublication: vi.fn(),
  getMyPackStatus: vi.fn(),
  listPackComments: vi.fn(),
  ratePack: vi.fn(),
  backfillPackInstalls: vi.fn(),
  getPackPublishStatus: vi.fn(),
  listPackPublications: vi.fn(),
  previewPackRelease: vi.fn(),
  publishPack: vi.fn(),
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
    listGroups.mockResolvedValue([]);
    listCollections.mockResolvedValue([]);
    previewPackRelease.mockResolvedValue({
      status: "preview",
      published_version: 3,
      next_version: 4,
      question_count: { published: 252, next: 253 },
      groups: { added: [], edited: [], removed: [], unchanged: 1 },
      questions: {
        added: ["new-question-guid"],
        edited: ["edited-question-guid"],
        removed: [],
        unchanged: 251
      },
      metadata_changed: ["description"],
      unchanged: false
    });
    publishPack.mockResolvedValue({
      status: "published",
      publication: { ...published, version: 4, question_count: 253 }
    });
    unpublishPack.mockResolvedValue({
      status: "unpublished",
      publication: { ...published, is_public: false, publication_status: "archived" }
    });
    publishPackDraft.mockResolvedValue({
      status: "published",
      publication: { ...draft, is_public: true, publication_status: "published" }
    });
    deletePackPublication.mockResolvedValue({
      status: "deleted",
      pack_guid: "unpublished-guid",
      zip_deleted: true
    });
    requestPackPublishCode.mockResolvedValue({});
    verifyPackPublishCode.mockResolvedValue({ signed_in: true });
    signOutPackPublisher.mockResolvedValue({ signed_in: false });
    backfillPackInstalls.mockResolvedValue({ recorded: 0 });
    // The selected pack's reviews now render immediately (no more "Voir les
    // retours" gate), so every test mounts PackReviewsSection and needs
    // these to resolve, not just the tests that assert on review content.
    getMyPackStatus.mockResolvedValue({ is_installed: false, my_rating: null });
    listPackComments.mockResolvedValue({ comments: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("keeps depublished packs out of the default rail but available in archives", async () => {
    render(<PublicationsManager setMode={vi.fn()} />);

    // The default-selected pack's name renders both in its rail row and in
    // the detail header, so there are two matches once loaded.
    await waitFor(() => {
      expect(screen.getAllByText("Brouillon capitales").length).toBeGreaterThan(0);
    });

    expect(
      screen.getByRole("button", { name: /Territoires du monde/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Ancien pack/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Dépublié")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("tab", { name: /Dépubliés 1/ })
    );

    expect(
      await screen.findByRole("button", { name: /Ancien pack/ })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Dépublié").length).toBeGreaterThan(0);
  });

  it("unpublishing is gated by window.confirm and calls unpublishPack when accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PublicationsManager setMode={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Territoires du monde/ })
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Dépublier" })
    );

    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(unpublishPack).toHaveBeenCalledWith("published-guid");
    });
  });

  it("declining the confirm dialog does not call unpublishPack", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PublicationsManager setMode={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Territoires du monde/ })
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Dépublier" })
    );

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(unpublishPack).not.toHaveBeenCalled();
  });

  it("permanently deletes an archived pack after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    listPackPublications
      .mockResolvedValueOnce({ publications: [draft, published, unpublished] })
      .mockResolvedValueOnce({ publications: [draft, published] });

    render(<PublicationsManager setMode={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("tab", { name: /Dépubliés 1/ })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Ancien pack/ })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Supprimer définitivement" })
    );

    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(deletePackPublication).toHaveBeenCalledWith("unpublished-guid");
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Ancien pack/ })
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /Actifs 2/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("does not permanently delete when confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PublicationsManager setMode={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("tab", { name: /Dépubliés 1/ })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Ancien pack/ })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Supprimer définitivement" })
    );

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(deletePackPublication).not.toHaveBeenCalled();
  });

  it("Publier republishes a draft or unpublished row", async () => {
    render(<PublicationsManager setMode={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("tab", { name: /Dépubliés 1/ })
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /Ancien pack/ })
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Publier" })
    );

    await waitFor(() => {
      expect(publishPackDraft).toHaveBeenCalledWith("unpublished-guid");
    });
  });

  it("links a pack back to the local content it was published from", async () => {
    listPackPublications.mockResolvedValue({
      publications: [
        {
          ...published,
          source: { kind: "group", id: 42, name: "Drapeaux du monde" },
          orphaned: false
        }
      ]
    });
    const onOpenGroup = vi.fn();

    render(<PublicationsManager setMode={vi.fn()} onOpenGroup={onOpenGroup} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Drapeaux du monde/ })
    );

    expect(onOpenGroup).toHaveBeenCalledWith(42);
  });

  it("publishes a new version from a prefilled release preview", async () => {
    listPackPublications.mockResolvedValue({
      publications: [
        {
          ...published,
          pack_guid: "published-guid",
          description: "Ancienne description.",
          license: "CC0",
          tags: ["géographie"],
          themes: ["cartes"],
          source: { kind: "group", id: 42, name: "Territoires du monde" },
          orphaned: false
        }
      ]
    });
    listGroups.mockResolvedValue([
      {
        id: 42,
        name: "Territoires du monde",
        type_group: "map",
        question_count: 253
      }
    ]);

    render(<PublicationsManager setMode={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Publier une nouvelle version" })
    );

    expect(
      await screen.findByRole("heading", { name: "Nouvelle version" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Titre du pack")).toHaveValue("Territoires du monde");
    expect(screen.getByLabelText("Version du pack")).toHaveValue(4);
    expect(screen.getByLabelText("Licence du pack")).toHaveValue("CC0");
    expect(screen.getByLabelText("Thèmes du pack")).toHaveValue("cartes");
    expect(screen.getByLabelText("Tags du pack")).toHaveValue("géographie");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Prévisualiser la version" })
      ).toBeEnabled();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Prévisualiser la version" })
    );

    await waitFor(() => {
      expect(previewPackRelease).toHaveBeenCalledWith(
        "published-guid",
        expect.objectContaining({
          version: 4,
          name: "Territoires du monde",
          description: "Ancienne description.",
          license: "CC0",
          tags: ["géographie"],
          themes: ["cartes"]
        })
      );
    });
    expect(await screen.findByText("Métadonnées : description")).toBeInTheDocument();
    expect(screen.getByText("Questions ajoutées")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Publier la version v4" })
    );

    await waitFor(() => {
      expect(publishPack).toHaveBeenCalledWith(
        { groupId: 42 },
        expect.objectContaining({
          version: 4,
          name: "Territoires du monde"
        })
      );
    });
  });

  it("warns when the pack outlived its local source", async () => {
    listPackPublications.mockResolvedValue({
      publications: [
        {
          ...published,
          source: { kind: null, id: null, name: null },
          orphaned: true
        }
      ]
    });

    render(<PublicationsManager setMode={vi.fn()} />);

    // The catalog row survives a local delete, so the pack stays public with
    // no way to publish a new version of it.
    expect(await screen.findByRole("note")).toHaveTextContent(
      /Source supprimée localement/
    );
  });

  it("lets the creator read feedback on their own pack", async () => {
    listPackPublications.mockResolvedValue({ publications: [published] });
    listPackComments.mockResolvedValue({
      comments: [
        { id: 1, author_label: "lecteur@example.com", body: "Très utile !" }
      ]
    });
    getMyPackStatus.mockResolvedValue({ is_installed: false, my_rating: null });

    render(<PublicationsManager setMode={vi.fn()} />);

    // A single publication is selected by default, so its reviews are
    // already visible -- no extra click to reveal them.
    expect(await screen.findByText("Très utile !")).toBeInTheDocument();
  });
});
