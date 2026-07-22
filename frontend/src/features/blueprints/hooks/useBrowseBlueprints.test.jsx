import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POPULAR_THEME,
  blueprintStatus,
  useBrowseBlueprints
} from "./useBrowseBlueprints";
import {
  getBlueprintCatalogSettings,
  installBlueprintFromCatalog,
  listInstalledBlueprints,
  searchBlueprintCatalog,
  unsubscribeBlueprint,
  updateBlueprintFromCatalog
} from "../../../api/blueprints";

vi.mock("../../../api/blueprints", () => ({
  getBlueprintCatalogSettings: vi.fn(),
  installBlueprintFromCatalog: vi.fn(),
  listInstalledBlueprints: vi.fn(),
  searchBlueprintCatalog: vi.fn(),
  unsubscribeBlueprint: vi.fn(),
  updateBlueprintFromCatalog: vi.fn()
}));

describe("blueprintStatus", () => {
  it("classifies not_installed, up_to_date and update_available", () => {
    const entry = { blueprint_guid: "g1", version: 3 };

    expect(blueprintStatus(entry, null)).toBe("not_installed");
    expect(
      blueprintStatus(entry, { installed_version: 3 })
    ).toBe("up_to_date");
    expect(
      blueprintStatus(entry, { installed_version: 4 })
    ).toBe("up_to_date");
    expect(
      blueprintStatus(entry, { installed_version: 2 })
    ).toBe("update_available");
  });
});

describe("useBrowseBlueprints", () => {
  const entryA = {
    blueprint_guid: "guid-a",
    name: "Pack A",
    version: 2,
    type_group: "map",
    question_count: 10,
    download_url: "https://example.com/a.zip"
  };
  const entryB = {
    blueprint_guid: "guid-b",
    name: "Pack B",
    version: 1,
    type_group: "media",
    question_count: 5,
    download_url: "https://example.com/b.zip"
  };

  beforeEach(() => {
    getBlueprintCatalogSettings.mockResolvedValue({
      url: "https://project.supabase.co",
      key: "sb_publishable_test"
    });
    searchBlueprintCatalog.mockResolvedValue({
      blueprints: [entryA, entryB],
      facets: {
        themes: [
          { value: POPULAR_THEME, label: "Populaires", result_count: 2 },
          { value: "géographie", label: "Géographie", result_count: 1 }
        ]
      },
      total: 2,
      next_cursor: null
    });
    listInstalledBlueprints.mockResolvedValue([
      { blueprint_guid: "guid-a", installed_version: 1 }
    ]);
    installBlueprintFromCatalog.mockResolvedValue({ status: "imported" });
    updateBlueprintFromCatalog.mockResolvedValue({
      status: "updated",
      removed: []
    });
    unsubscribeBlueprint.mockResolvedValue({ status: "kept" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("reports no catalog configured without searching anything else", async () => {
    getBlueprintCatalogSettings.mockResolvedValue({ url: "", key: "" });

    const { result } = renderHook(() => useBrowseBlueprints());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.catalogUrl).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(searchBlueprintCatalog).not.toHaveBeenCalled();
    expect(listInstalledBlueprints).not.toHaveBeenCalled();
  });

  it("searches the catalogue with server-side filters", async () => {
    const { result } = renderHook(() => useBrowseBlueprints({
      search: "monde",
      theme: "géographie",
      type: "map",
      status: "update_available",
      sort: "récents",
      limit: 24
    }));

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    expect(searchBlueprintCatalog).toHaveBeenCalledWith({
      q: "monde",
      theme: "géographie",
      type: "map",
      status: "update_available",
      sort: "récents",
      limit: 24,
      cursor: null
    });
    expect(result.current.facets.themes[1].label).toBe("Géographie");
  });

  it("correlates catalogue entries against installed subscriptions", async () => {
    const { result } = renderHook(() => useBrowseBlueprints());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const byGuid = Object.fromEntries(
      result.current.items.map((item) => [item.entry.blueprint_guid, item])
    );

    expect(byGuid["guid-a"].status).toBe("update_available");
    expect(byGuid["guid-a"].installedVersion).toBe(1);
    expect(byGuid["guid-b"].status).toBe("not_installed");
    expect(byGuid["guid-b"].installedVersion).toBeNull();
  });

  it("loads additional pages with the returned cursor", async () => {
    searchBlueprintCatalog
      .mockResolvedValueOnce({
        blueprints: [entryA],
        facets: { themes: [] },
        total: 2,
        next_cursor: "24"
      })
      .mockResolvedValueOnce({
        blueprints: [entryB],
        facets: { themes: [] },
        total: 2,
        next_cursor: null
      });

    const { result } = renderHook(() => useBrowseBlueprints({ limit: 24 }));

    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(searchBlueprintCatalog).toHaveBeenLastCalledWith({
      q: "",
      theme: "",
      type: "",
      status: "all",
      sort: "pertinence",
      limit: 24,
      cursor: "24"
    });
    expect(result.current.items.map((item) => item.entry.blueprint_guid)).toEqual([
      "guid-a",
      "guid-b"
    ]);
  });

  it("install() downloads from the catalog and refreshes installed state", async () => {
    const { result } = renderHook(() => useBrowseBlueprints());

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    listInstalledBlueprints.mockResolvedValue([
      { blueprint_guid: "guid-a", installed_version: 1 },
      { blueprint_guid: "guid-b", installed_version: 1 }
    ]);

    await act(async () => {
      await result.current.install(entryB);
    });

    expect(installBlueprintFromCatalog).toHaveBeenCalledWith(entryB);

    const byGuid = Object.fromEntries(
      result.current.items.map((item) => [item.entry.blueprint_guid, item])
    );
    expect(byGuid["guid-b"].status).toBe("up_to_date");
  });

  it("update() surfaces pending removals without deleting until confirmed", async () => {
    updateBlueprintFromCatalog.mockResolvedValue({
      status: "updated",
      removed: ["some-question-guid"]
    });

    const { result } = renderHook(() => useBrowseBlueprints());

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      await result.current.update(entryA, { deleteRemoved: false });
    });

    expect(updateBlueprintFromCatalog).toHaveBeenCalledWith(
      entryA,
      { deleteRemoved: false }
    );

    const byGuid = Object.fromEntries(
      result.current.items.map((item) => [item.entry.blueprint_guid, item])
    );
    expect(byGuid["guid-a"].action.pendingRemoval).toEqual([
      "some-question-guid"
    ]);
  });

  it("surfaces an inline error when an action fails, without crashing", async () => {
    installBlueprintFromCatalog.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useBrowseBlueprints());

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      await result.current.install(entryB);
    });

    const byGuid = Object.fromEntries(
      result.current.items.map((item) => [item.entry.blueprint_guid, item])
    );
    expect(byGuid["guid-b"].action.error).toBe("boom");
    expect(byGuid["guid-b"].action.busy).toBe(false);
  });
});
