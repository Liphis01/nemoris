import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POPULAR_THEME,
  packStatus,
  useBrowsePacks
} from "./useBrowsePacks";
import {
  getPackCatalogSettings,
  installPackFromCatalog,
  listInstalledPacks,
  searchPackCatalog,
  unsubscribePack,
  updatePackFromCatalog
} from "../../../api/packs";

vi.mock("../../../api/packs", () => ({
  getPackCatalogSettings: vi.fn(),
  installPackFromCatalog: vi.fn(),
  listInstalledPacks: vi.fn(),
  searchPackCatalog: vi.fn(),
  unsubscribePack: vi.fn(),
  updatePackFromCatalog: vi.fn()
}));

describe("packStatus", () => {
  it("classifies not_installed, up_to_date and update_available", () => {
    const entry = { pack_guid: "g1", version: 3 };

    expect(packStatus(entry, null)).toBe("not_installed");
    expect(
      packStatus(entry, { installed_version: 3 })
    ).toBe("up_to_date");
    expect(
      packStatus(entry, { installed_version: 4 })
    ).toBe("up_to_date");
    expect(
      packStatus(entry, { installed_version: 2 })
    ).toBe("update_available");
    expect(
      packStatus(entry, null, { has_local_content: true })
    ).toBe("local_copy");
  });
});

describe("useBrowsePacks", () => {
  const entryA = {
    pack_guid: "guid-a",
    name: "Pack A",
    version: 2,
    type_group: "map",
    question_count: 10,
    download_url: "https://example.com/a.zip"
  };
  const entryB = {
    pack_guid: "guid-b",
    name: "Pack B",
    version: 1,
    type_group: "media",
    question_count: 5,
    download_url: "https://example.com/b.zip"
  };

  beforeEach(() => {
    getPackCatalogSettings.mockResolvedValue({
      url: "https://project.supabase.co",
      key: "sb_publishable_test"
    });
    searchPackCatalog.mockResolvedValue({
      packs: [entryA, entryB],
      facets: {
        themes: [
          { value: POPULAR_THEME, label: "Populaires", result_count: 2 },
          { value: "géographie", label: "Géographie", result_count: 1 }
        ]
      },
      total: 2,
      next_cursor: null
    });
    listInstalledPacks.mockResolvedValue([
      { pack_guid: "guid-a", installed_version: 1 }
    ]);
    installPackFromCatalog.mockResolvedValue({ status: "imported" });
    updatePackFromCatalog.mockResolvedValue({
      status: "updated",
      removed: []
    });
    unsubscribePack.mockResolvedValue({ status: "kept" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("reports no catalog configured without searching anything else", async () => {
    getPackCatalogSettings.mockResolvedValue({ url: "", key: "" });

    const { result } = renderHook(() => useBrowsePacks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.catalogUrl).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(searchPackCatalog).not.toHaveBeenCalled();
    expect(listInstalledPacks).not.toHaveBeenCalled();
  });

  it("searches the catalogue with server-side filters", async () => {
    const { result } = renderHook(() => useBrowsePacks({
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

    expect(searchPackCatalog).toHaveBeenCalledWith({
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
    const { result } = renderHook(() => useBrowsePacks());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const byGuid = Object.fromEntries(
      result.current.items.map((item) => [item.entry.pack_guid, item])
    );

    expect(byGuid["guid-a"].status).toBe("update_available");
    expect(byGuid["guid-a"].installedVersion).toBe(1);
    expect(byGuid["guid-b"].status).toBe("not_installed");
    expect(byGuid["guid-b"].installedVersion).toBeNull();
  });

  it("keeps local authored packs out of the installable state", async () => {
    searchPackCatalog.mockResolvedValue({
      packs: [
        {
          pack_guid: "guid-local",
          name: "Pack local",
          version: 4,
          type_group: "text",
          question_count: 7,
          download_url: "https://example.com/local.zip",
          is_mine: true,
          local_status: {
            status: "local_copy",
            is_mine: true,
            has_local_content: true,
            installed_version: null,
            local_pack_version: null,
            local_group_id: 10,
            local_group_name: "Pack local"
          }
        }
      ],
      facets: { themes: [] },
      total: 1,
      next_cursor: null
    });
    listInstalledPacks.mockResolvedValue([]);

    const { result } = renderHook(() => useBrowsePacks());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });

    expect(result.current.items[0]).toMatchObject({
      status: "local_copy",
      installedVersion: null,
      localGroupId: 10,
      hasLocalContent: true,
      isMine: true
    });
  });

  it("loads additional pages with the returned cursor", async () => {
    searchPackCatalog
      .mockResolvedValueOnce({
        packs: [entryA],
        facets: {
          global_total: 8,
          themes: [
            { value: POPULAR_THEME, label: "Populaires", result_count: 8 },
            { value: "géographie", label: "Géographie", result_count: 5 }
          ]
        },
        total: 2,
        next_cursor: "24"
      })
      .mockResolvedValueOnce({
        packs: [entryB],
        facets: {
          themes: [
            { value: "page-locale", label: "Page locale", result_count: 1 }
          ]
        },
        total: 2,
        next_cursor: null
      });

    const { result } = renderHook(() => useBrowsePacks({ limit: 24 }));

    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(searchPackCatalog).toHaveBeenLastCalledWith({
      q: "",
      theme: "",
      type: "",
      status: "all",
      sort: "pertinence",
      limit: 24,
      cursor: "24"
    });
    expect(result.current.items.map((item) => item.entry.pack_guid)).toEqual([
      "guid-a",
      "guid-b"
    ]);
    expect(result.current.facets.themes.map((theme) => theme.value)).toEqual([
      POPULAR_THEME,
      "géographie"
    ]);
  });

  it("install() downloads from the catalog and refreshes installed state", async () => {
    const { result } = renderHook(() => useBrowsePacks());

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    listInstalledPacks.mockResolvedValue([
      { pack_guid: "guid-a", installed_version: 1 },
      { pack_guid: "guid-b", installed_version: 1 }
    ]);

    await act(async () => {
      await result.current.install(entryB);
    });

    expect(installPackFromCatalog).toHaveBeenCalledWith(entryB);

    const byGuid = Object.fromEntries(
      result.current.items.map((item) => [item.entry.pack_guid, item])
    );
    expect(byGuid["guid-b"].status).toBe("up_to_date");
  });

  it("update() surfaces pending removals without deleting until confirmed", async () => {
    updatePackFromCatalog.mockResolvedValue({
      status: "updated",
      removed: ["some-question-guid"]
    });

    const { result } = renderHook(() => useBrowsePacks());

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      await result.current.update(entryA, { deleteRemoved: false });
    });

    expect(updatePackFromCatalog).toHaveBeenCalledWith(
      entryA,
      { deleteRemoved: false }
    );

    const byGuid = Object.fromEntries(
      result.current.items.map((item) => [item.entry.pack_guid, item])
    );
    expect(byGuid["guid-a"].action.pendingRemoval).toEqual([
      "some-question-guid"
    ]);
  });

  it("surfaces an inline error when an action fails, without crashing", async () => {
    installPackFromCatalog.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useBrowsePacks());

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      await result.current.install(entryB);
    });

    const byGuid = Object.fromEntries(
      result.current.items.map((item) => [item.entry.pack_guid, item])
    );
    expect(byGuid["guid-b"].action.error).toBe("boom");
    expect(byGuid["guid-b"].action.busy).toBe(false);
  });
});
