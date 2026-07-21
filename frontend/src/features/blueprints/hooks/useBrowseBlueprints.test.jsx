import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blueprintStatus, useBrowseBlueprints } from "./useBrowseBlueprints";
import {
  fetchCatalog,
  getBlueprintCatalogSettings,
  installBlueprintFromCatalog,
  listInstalledBlueprints,
  unsubscribeBlueprint,
  updateBlueprintFromCatalog
} from "../../../api/blueprints";

vi.mock("../../../api/blueprints", () => ({
  fetchCatalog: vi.fn(),
  getBlueprintCatalogSettings: vi.fn(),
  installBlueprintFromCatalog: vi.fn(),
  listInstalledBlueprints: vi.fn(),
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
      url: "https://example.com/catalog.json"
    });
    fetchCatalog.mockResolvedValue({ blueprints: [entryA, entryB] });
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

  it("reports no catalog configured without fetching anything else", async () => {
    getBlueprintCatalogSettings.mockResolvedValue({ url: "" });

    const { result } = renderHook(() => useBrowseBlueprints());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.catalogUrl).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(fetchCatalog).not.toHaveBeenCalled();
  });

  it("correlates catalog entries against installed subscriptions", async () => {
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
