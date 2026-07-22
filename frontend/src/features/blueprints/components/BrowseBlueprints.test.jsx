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
import { exportBlueprintGroup } from "../../../api/blueprints";
import { listGroups } from "../../../api/groups";
import {
  POPULAR_THEME,
  useBrowseBlueprints
} from "../hooks/useBrowseBlueprints";
import BrowseBlueprints from "./BrowseBlueprints";

vi.mock("../hooks/useBrowseBlueprints", () => ({
  POPULAR_THEME: "__popular__",
  useBrowseBlueprints: vi.fn()
}));

vi.mock("../../../api/groups", () => ({
  listGroups: vi.fn()
}));

vi.mock("../../../api/blueprints", () => ({
  exportBlueprintGroup: vi.fn()
}));

const mapEntry = {
  blueprint_guid: "world-map",
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
  blueprint_guid: "biology-text",
  name: "Biologie cellulaire",
  description: "Questions isolées sur les organites et la mitose.",
  license: "CC-BY",
  version: 1,
  type_group: "text",
  question_count: 48,
  size_bytes: 18800,
  download_url: "https://example.com/bio.zip"
};

function item(entry, status = "not_installed", installedVersion = null, action = {}) {
  return { entry, status, installedVersion, action };
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

  useBrowseBlueprints.mockReturnValue(value);
  return value;
}

describe("BrowseBlueprints", () => {
  beforeEach(() => {
    listGroups.mockResolvedValue([
      { id: 10, name: "Capitales du monde", type_group: "map", question_count: 42 },
      { id: 11, name: "Groupe vide", type_group: "text", question_count: 0 }
    ]);
    exportBlueprintGroup.mockResolvedValue("capitales-du-monde-v1.zip");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders the dense importer with database themes", () => {
    defaultHook();
    render(<BrowseBlueprints setMode={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Importer" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("button", { name: /Géographie/ })).toBeInTheDocument();
    expect(screen.getByTestId("blueprint-card-row-world-map")).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });

  it("switches themes and sends the theme to the search hook", async () => {
    defaultHook();
    render(<BrowseBlueprints setMode={vi.fn()} />);

    expect(useBrowseBlueprints).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: POPULAR_THEME })
    );

    await userEvent.click(
      within(screen.getByRole("complementary", { name: "Thèmes" }))
        .getByRole("button", { name: /Biologie/ })
    );

    expect(useBrowseBlueprints).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "biologie" })
    );
  });

  it("debounces search and moves filters to the toolbar", async () => {
    vi.useFakeTimers();
    defaultHook();
    render(<BrowseBlueprints setMode={vi.fn()} />);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Rechercher un blueprint" }),
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

    expect(useBrowseBlueprints).toHaveBeenLastCalledWith(
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
    render(<BrowseBlueprints setMode={vi.fn()} />);

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

    render(<BrowseBlueprints setMode={setMode} />);

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

    render(<BrowseBlueprints setMode={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Catalogue impossible à charger.");

    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(hook.reload).toHaveBeenCalled();
  });

  it("calls install from a blueprint row action", async () => {
    const hook = defaultHook();
    render(<BrowseBlueprints setMode={vi.fn()} />);

    await userEvent.click(
      screen.getAllByLabelText("Installer Territoires du monde")[0]
    );

    expect(hook.install).toHaveBeenCalledWith(mapEntry);
  });

  it("exports a selected group from the separate exporter tab", async () => {
    defaultHook();
    render(<BrowseBlueprints setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Exporter" }));

    const exportButton = await screen.findByRole("button", {
      name: "Exporter le blueprint"
    });

    await waitFor(() => expect(exportButton).toBeEnabled());
    await userEvent.clear(screen.getByRole("textbox", { name: "Titre du blueprint" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Titre du blueprint" }),
      "Atlas des capitales"
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Licence du blueprint" }),
      "CC0"
    );
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(exportBlueprintGroup).toHaveBeenCalledWith(10, {
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
});
