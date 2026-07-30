import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPackComment,
  backfillPackInstalls,
  getMyPackStatus,
  getPackPublishStatus,
  listPackComments,
  listPackPublications,
  publishPack,
  publishPackDraft,
  ratePack,
  recordPackInstall,
  requestPackPublishCode,
  signOutPackPublisher,
  unpublishPack,
  verifyPackPublishCode
} from "../../../api/packs";
import { listGroups } from "../../../api/groups";
import { listCollections } from "../../../api/collections";
import {
  POPULAR_THEME,
  useBrowsePacks
} from "../hooks/useBrowsePacks";
import BrowsePacks from "./BrowsePacks";

vi.mock("../hooks/useBrowsePacks", () => ({
  POPULAR_THEME: "__popular__",
  useBrowsePacks: vi.fn()
}));

vi.mock("../../../api/groups", () => ({
  listGroups: vi.fn()
}));

vi.mock("../../../api/collections", () => ({
  listCollections: vi.fn()
}));

vi.mock("../../../api/packs", () => ({
  addPackComment: vi.fn(),
  backfillPackInstalls: vi.fn(),
  getMyPackStatus: vi.fn(),
  getPackPublishStatus: vi.fn(),
  listPackComments: vi.fn(),
  listPackPublications: vi.fn(),
  publishPack: vi.fn(),
  publishPackDraft: vi.fn(),
  ratePack: vi.fn(),
  recordPackInstall: vi.fn(),
  requestPackPublishCode: vi.fn(),
  savePlaylistDraft: vi.fn(),
  signOutPackPublisher: vi.fn(),
  unpublishPack: vi.fn(),
  verifyPackPublishCode: vi.fn()
}));

const mapEntry = {
  pack_guid: "world-map",
  name: "Territoires du monde",
  description: "Tous les pays du monde sur une carte interactive.",
  license: "CC0",
  version: 2,
  type_group: "map",
  question_count: 252,
  size_bytes: 72420,
  download_url: "https://example.com/world.zip"
};

const textEntry = {
  pack_guid: "biology-text",
  name: "Biologie cellulaire",
  description: "Questions isolées sur les organites et la mitose.",
  license: "CC-BY",
  version: 1,
  type_group: "text",
  question_count: 48,
  size_bytes: 18800,
  download_url: "https://example.com/bio.zip"
};

function item(
  entry,
  status = "not_installed",
  installedVersion = null,
  action = {},
  extra = {}
) {
  return { entry, status, installedVersion, action, ...extra };
}

function defaultHook(overrides = {}) {
  const value = {
    facets: {
      themes: [
        { value: POPULAR_THEME, label: "Populaires", result_count: 12 },
        { value: "géographie", label: "Géographie", result_count: 5 },
        { value: "biologie", label: "Biologie", result_count: 3 }
      ]
    },
    items: [
      item(mapEntry, "not_installed"),
      item(textEntry, "up_to_date", 1)
    ],
    loading: false,
    loadingMore: false,
    error: "",
    total: 12,
    hasMore: true,
    reload: vi.fn(),
    loadMore: vi.fn(),
    install: vi.fn(),
    update: vi.fn(),
    unsubscribe: vi.fn(),
    ...overrides
  };

  useBrowsePacks.mockReturnValue(value);
  return value;
}

describe("BrowsePacks", () => {
  beforeEach(() => {
    listGroups.mockResolvedValue([
      { id: 10, name: "Capitales du monde", type_group: "map", question_count: 42 },
      { id: 11, name: "Groupe vide", type_group: "text", question_count: 0 }
    ]);
    listCollections.mockResolvedValue([
      { id: 4, name: "Drapeaux mix", question_count: 12, generated: false },
      {
        id: 5,
        name: "Questions difficiles",
        question_count: 3,
        generated: true
      }
    ]);
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });
    listPackPublications.mockResolvedValue({ publications: [] });
    publishPack.mockResolvedValue({
      status: "published",
      publication: {
        pack_guid: "group-guid",
        name: "Atlas des capitales",
        version: 1,
        question_count: 42,
        size_bytes: 2048,
        is_public: true
      }
    });
    publishPackDraft.mockResolvedValue({
      status: "published",
      publication: {
        pack_guid: "group-guid",
        name: "Atlas des capitales",
        version: 1,
        question_count: 42,
        size_bytes: 2048,
        is_public: true
      }
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
    recordPackInstall.mockResolvedValue({ recorded: true });
    listPackComments.mockResolvedValue({ comments: [] });
    getMyPackStatus.mockResolvedValue({ is_installed: false, my_rating: null });
    ratePack.mockResolvedValue({ my_rating: 5, avg_rating: 5, rating_count: 1 });
    addPackComment.mockResolvedValue({
      comment: { id: 1, author_label: "me@example.com", body: "Top !" }
    });
    unpublishPack.mockResolvedValue({
      status: "unpublished",
      publication: { pack_guid: "group-guid", publication_status: "archived" }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders the dense importer with database themes", () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Découvrir" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const themeButtons = within(
      screen.getByRole("complementary", { name: "Thèmes" })
    ).getAllByRole("button");
    expect(themeButtons[0]).toHaveTextContent("Populaires");
    expect(themeButtons[1]).toHaveTextContent("Géographie");
    expect(screen.getByRole("button", { name: /Géographie/ })).toBeInTheDocument();
    expect(screen.getByTestId("pack-card-row-world-map")).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });

  it("switches themes and sends the theme to the search hook", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: POPULAR_THEME })
    );

    await userEvent.click(
      within(screen.getByRole("complementary", { name: "Thèmes" }))
        .getByRole("button", { name: /Biologie/ })
    );

    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "biologie" })
    );
  });

  it("debounces search and moves filters to the toolbar", async () => {
    vi.useFakeTimers();
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Rechercher un pack" }),
      { target: { value: "atlas" } }
    );
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "map" }
    });
    fireEvent.change(screen.getByLabelText("Statut"), {
      target: { value: "not_installed" }
    });
    fireEvent.change(screen.getByLabelText("Tri"), {
      target: { value: "questions" }
    });

    await act(async () => {
      vi.advanceTimersByTime(320);
    });

    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "atlas",
        type: "map",
        status: "not_installed",
        sort: "questions"
      })
    );
  });

  it("loads the next catalogue page", async () => {
    const hook = defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Charger plus" }));

    expect(hook.loadMore).toHaveBeenCalledTimes(1);
  });

  it("surfaces catalogue errors and retries loading", async () => {
    const hook = defaultHook({
      error: "Catalogue impossible à charger.",
      items: [],
      total: 0,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Catalogue impossible à charger.");

    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(hook.reload).toHaveBeenCalled();
  });

  it("calls install from a pack row action", async () => {
    const hook = defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(
      screen.getAllByLabelText("Installer Territoires du monde")[0]
    );

    expect(hook.install).toHaveBeenCalledWith(mapEntry);
  });

  it("shows mine and local-copy checks without install actions", () => {
    const onOpenGroup = vi.fn();
    const localEntry = {
      ...mapEntry,
      pack_guid: "my-pack",
      name: "Mon atlas publié"
    };
    defaultHook({
      items: [
        item(localEntry, "local_copy", null, {}, {
          hasLocalContent: true,
          isMine: true,
          localGroupId: 10
        })
      ],
      total: 1,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} onOpenGroup={onOpenGroup} />);

    expect(screen.getAllByText("Mon pack").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Déjà présent").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Ce pack existe déjà dans tes groupes locaux.")
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Installer Mon atlas publié")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Se désabonner" })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ouvrir Mon atlas publié dans le gestionnaire"
      })
    );

    expect(onOpenGroup).toHaveBeenCalledWith(10);
  });

  it("publishes a group in a single click, with no draft step", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));

    // Step 1: pick a source. Step 2 (the form) only appears after that.
    await userEvent.click(
      await screen.findByRole("button", { name: /Capitales du monde/ })
    );

    const publishButton = await screen.findByRole("button", {
      name: "Publier"
    });

    await waitFor(() => expect(publishButton).toBeEnabled());
    await userEvent.clear(screen.getByRole("textbox", { name: "Titre du pack" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Titre du pack" }),
      "États et géographie"
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Thèmes du pack" }),
      "géographie, cartes"
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Tags du pack" }),
      "capitales, quiz"
    );
    await userEvent.click(publishButton);

    await waitFor(() => {
      expect(publishPack).toHaveBeenCalledWith(
        { groupId: 10 },
        {
          version: 1,
          name: "États et géographie",
          description: "",
          license: "",
          themes: ["géographie", "cartes"],
          tags: ["capitales", "quiz"]
        }
      );
    });

    // The pack goes straight to public: no "Brouillon" state is ever shown.
    // Confirmation is landing on the fresh pack's own dashboard, not a banner.
    expect(screen.queryByText("Brouillon privé")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Atlas des capitales" })
    ).toBeInTheDocument();
    expect(screen.getByText("Publié")).toBeInTheDocument();
  });

  it("publishes a playlist as a multi-group pack", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Playlist" }));

    await userEvent.click(
      await screen.findByRole("button", { name: /Drapeaux mix/ })
    );
    await userEvent.click(screen.getByRole("button", { name: "Publier" }));

    await waitFor(() => {
      expect(publishPack).toHaveBeenCalledWith(
        { collectionId: 4 },
        expect.objectContaining({ name: "Drapeaux mix" })
      );
    });
  });

  it("refuses to publish a generated playlist", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Playlist" }));

    // "Questions difficiles" is derived from the user's own review history,
    // so it is not theirs to hand to someone else.
    expect(
      await screen.findByRole("button", { name: /Questions difficiles/ })
    ).toBeDisabled();
  });

  it("does not offer a local ZIP download", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Capitales du monde/ })
    );
    await screen.findByRole("button", { name: "Publier" });

    // The zip had no way back in -- nothing in the app could import a
    // manually obtained file -- so the button is gone.
    expect(
      screen.queryByRole("button", { name: "Télécharger ZIP" })
    ).not.toBeInTheDocument();
  });

  it("reuses the Settings sync account for publishing without showing an auth panel", async () => {
    const setMode = vi.fn();
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "sync@example.com",
      auth_source: "sync",
      project_url: "https://project.supabase.co"
    });
    defaultHook();

    render(<BrowsePacks setMode={setMode} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));

    // Already signed in via the Settings sync account -- there is nothing to
    // do here, so no "Connecté via Synchronisation" status panel is shown.
    await userEvent.click(
      await screen.findByRole("button", { name: /Capitales du monde/ })
    );
    await screen.findByRole("button", { name: "Publier" });

    expect(screen.queryByText("Connecté via Synchronisation")).not.toBeInTheDocument();
    expect(screen.queryByText("Connexion Supabase")).not.toBeInTheDocument();
  });

  it("switches to the Gérer tab and renders the publications manager", async () => {
    defaultHook();
    listPackPublications.mockResolvedValue({
      publications: [
        {
          pack_guid: "group-guid",
          name: "Atlas des capitales",
          version: 1,
          question_count: 42,
          is_public: true,
          publication_status: "published"
        }
      ]
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));

    expect(screen.getByRole("tab", { name: "Publier" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // The single publication is auto-selected, so its detail heading shows
    // alongside its rail row -- assert on the heading specifically.
    expect(
      await screen.findByRole("heading", { name: "Atlas des capitales" })
    ).toBeInTheDocument();
  });

  it("forwards the top-rated sort option to the search hook", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Tri"), {
      target: { value: "note" }
    });

    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "note" })
    );
    expect(
      within(screen.getByLabelText("Tri")).getByRole("option", {
        name: "Mieux notés"
      })
    ).toBeInTheDocument();
  });
});
