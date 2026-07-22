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
  exportPackGroup,
  getPackPublishStatus,
  listPackPublications,
  publishPackDraft,
  requestPackPublishCode,
  savePackDraft,
  signOutPackPublisher,
  verifyPackPublishCode
} from "../../../api/packs";
import { listGroups } from "../../../api/groups";
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

vi.mock("../../../api/packs", () => ({
  exportPackGroup: vi.fn(),
  getPackPublishStatus: vi.fn(),
  listPackPublications: vi.fn(),
  publishPackDraft: vi.fn(),
  requestPackPublishCode: vi.fn(),
  savePackDraft: vi.fn(),
  signOutPackPublisher: vi.fn(),
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
    catalogUrl: "https://project.supabase.co",
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
    exportPackGroup.mockResolvedValue("capitales-du-monde-v1.zip");
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });
    listPackPublications.mockResolvedValue({ publications: [] });
    savePackDraft.mockResolvedValue({
      status: "draft",
      publication: {
        pack_guid: "group-guid",
        name: "Atlas des capitales",
        version: 1,
        question_count: 42,
        size_bytes: 2048,
        is_public: false
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders the dense importer with database themes", () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Importer" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
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

  it("shows the no-catalogue state and routes to settings", async () => {
    const setMode = vi.fn();
    defaultHook({
      catalogUrl: null,
      items: [],
      total: 0,
      hasMore: false
    });

    render(<BrowsePacks setMode={setMode} />);

    expect(screen.getByText("Catalogue Supabase non configuré")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Configurer le catalogue" }));

    expect(setMode).toHaveBeenCalledWith("settings");
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

  it("downloads a selected group zip from the separate exporter tab", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Exporter" }));

    const exportButton = await screen.findByRole("button", {
      name: "Télécharger ZIP"
    });

    await waitFor(() => expect(exportButton).toBeEnabled());
    await userEvent.clear(screen.getByRole("textbox", { name: "Titre du pack" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Titre du pack" }),
      "Atlas des capitales"
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Licence du pack" }),
      "CC0"
    );
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(exportPackGroup).toHaveBeenCalledWith(10, {
        version: 1,
        name: "Atlas des capitales",
        description: "",
        license: "CC0"
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "capitales-du-monde-v1.zip"
    );
  });

  it("saves a private Supabase draft before publishing it", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Exporter" }));

    const draftButton = await screen.findByRole("button", {
      name: "Enregistrer brouillon"
    });

    await waitFor(() => expect(draftButton).toBeEnabled());
    await userEvent.clear(screen.getByRole("textbox", { name: "Titre du pack" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Titre du pack" }),
      "Atlas des capitales"
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Thèmes du pack" }),
      "géographie, cartes"
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Tags du pack" }),
      "capitales, quiz"
    );
    await userEvent.click(draftButton);

    await waitFor(() => {
      expect(savePackDraft).toHaveBeenCalledWith(10, {
        version: 1,
        name: "Atlas des capitales",
        description: "",
        license: "",
        themes: ["géographie", "cartes"],
        tags: ["capitales", "quiz"]
      });
    });

    const publishButton = await screen.findByRole("button", { name: "Publier" });
    await waitFor(() => expect(publishButton).toBeEnabled());
    await userEvent.click(publishButton);

    await waitFor(() => {
      expect(publishPackDraft).toHaveBeenCalledWith("group-guid");
    });
  });

  it("reuses the Settings sync account for publishing", async () => {
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

    await userEvent.click(screen.getByRole("tab", { name: "Exporter" }));

    expect(
      await screen.findByText("Connecté via Synchronisation")
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Réglages" }));

    expect(setMode).toHaveBeenCalledWith("settings");
    expect(signOutPackPublisher).not.toHaveBeenCalled();
  });
});
