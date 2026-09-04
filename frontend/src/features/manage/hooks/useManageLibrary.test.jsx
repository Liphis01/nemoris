import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useManageLibrary } from "./useManageLibrary";
import {
  createQuestion,
  deleteQuestion,
  importMediaUrl,
  listQuestions,
  removeQuestionMedia,
  updateQuestion,
  uploadMedia
} from "../../../api/questions";
import {
  createGroup,
  deleteGroup,
  listGroups
} from "../../../api/groups";
import {
  importMediaGroupMediaUrl,
  uploadMediaGroupMedia
} from "../../../api/mediaGroups";
import {
  deleteCollection,
  listCollections
} from "../../../api/collections";

vi.mock("../../../api/questions", () => ({
  createQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  importMediaUrl: vi.fn(),
  listQuestions: vi.fn(),
  removeQuestionMedia: vi.fn(),
  updateQuestion: vi.fn(),
  uploadMedia: vi.fn()
}));

vi.mock("../../../api/groups", () => ({
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  listGroups: vi.fn()
}));

vi.mock("../../../api/mediaGroups", () => ({
  importMediaGroupMediaUrl: vi.fn(),
  uploadMediaGroupMedia: vi.fn()
}));

vi.mock("../../../api/collections", () => ({
  deleteCollection: vi.fn(),
  listCollections: vi.fn()
}));

describe("useManageLibrary", () => {
  const group = {
    id: 7,
    name: "Carte Europe",
    type_group: "map",
    question_count: 2
  };
  const groupedQuestion = {
    id: 20,
    type_q: "map",
    question: "France",
    answer: "France",
    group
  };
  const directGroupedQuestion = {
    id: 21,
    type_q: "text",
    question: "Capital",
    answer: "Paris",
    group_id: 7
  };
  const ungroupedQuestion = {
    id: 22,
    type_q: "text",
    question: "Loose",
    answer: "Item"
  };
  const playlist = {
    id: 4,
    name: "Révisions rapides",
    isPlaylist: true,
    question_count: 3
  };
  const smallPlaylist = {
    id: 5,
    name: "À cibler",
    isPlaylist: true,
    question_count: 1
  };

  beforeEach(() => {
    listQuestions.mockResolvedValue([
      groupedQuestion,
      directGroupedQuestion,
      ungroupedQuestion
    ]);
    listGroups.mockResolvedValue([
      group,
      {
        id: 8,
        name: "Other",
        type_group: "map",
        question_count: 1
      }
    ]);
    deleteGroup.mockResolvedValue({});
    deleteQuestion.mockResolvedValue({});
    updateQuestion.mockResolvedValue({});
    createQuestion.mockResolvedValue({});
    createGroup.mockResolvedValue({});
    deleteCollection.mockResolvedValue({});
    listCollections.mockResolvedValue([playlist, smallPlaylist]);
    importMediaUrl.mockResolvedValue({});
    importMediaGroupMediaUrl.mockResolvedValue({});
    removeQuestionMedia.mockResolvedValue({});
    uploadMedia.mockResolvedValue({});
    uploadMediaGroupMedia.mockResolvedValue({});
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function renderManageLibrary() {
    const hook = renderHook(() => useManageLibrary("manage"));

    await waitFor(() => {
      expect(hook.result.current.allQuestions).toHaveLength(3);
      expect(hook.result.current.allGroups).toHaveLength(2);
      expect(hook.result.current.allPlaylists).toHaveLength(2);
    });

    return hook;
  }

  it("loads questions and groups in manage mode", async () => {
    const { result } = await renderManageLibrary();

    await waitFor(() => {
      expect(result.current.allQuestions).toHaveLength(3);
      expect(result.current.allGroups).toHaveLength(2);
    });

    expect(listQuestions).toHaveBeenCalledTimes(1);
    expect(listGroups).toHaveBeenCalledTimes(1);
  });

  it("sorts playlists with their own sort state", async () => {
    const { result } = await renderManageLibrary();

    expect(result.current.filteredPlaylists.map(item => item.id)).toEqual([4, 5]);

    act(() => {
      result.current.selectPlaylistSortField("question_count");
    });

    expect(result.current.filteredPlaylists.map(item => item.id)).toEqual([5, 4]);

    act(() => {
      result.current.togglePlaylistSortOrder();
    });

    expect(result.current.filteredPlaylists.map(item => item.id)).toEqual([4, 5]);
  });

  it("removes a deleted group, its questions, and the selected grouped item from cache", async () => {
    const { result } = await renderManageLibrary();

    await waitFor(() => {
      expect(result.current.allQuestions).toHaveLength(3);
    });

    act(() => {
      result.current.setSelectedItem(groupedQuestion);
    });

    await act(async () => {
      await result.current.deleteGroup(7);
    });

    expect(deleteGroup).toHaveBeenCalledWith(7);
    expect(result.current.allGroups.map(item => item.id)).toEqual([8]);
    expect(result.current.allQuestions.map(item => item.id)).toEqual([22]);
    expect(result.current.selectedItem).toBeNull();
  });

  it("opens group creation without preselecting a type", async () => {
    const { result } = await renderManageLibrary();

    act(() => {
      result.current.startCreateGroup();
    });

    expect(result.current.isCreatingGroup).toBe(true);
    expect(result.current.groupDraft.type_group).toBe("");
  });

  it("requires a svg media before creating a map group", async () => {
    const { result } = await renderManageLibrary();

    act(() => {
      result.current.startCreateGroup("map");
      result.current.setGroupDraft({
        name: "Europe",
        type_group: "map",
        media: "",
        data: {}
      });
    });

    await act(async () => {
      await result.current.createGroup();
    });

    expect(createGroup).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith("Le fichier SVG de la carte est requis.");
  });

  it("creates image groups without cover media", async () => {
    const createdGroup = {
      id: 9,
      name: "Drapeaux",
      type_group: "media",
      media: null
    };
    createGroup.mockResolvedValue(createdGroup);
    const { result } = await renderManageLibrary();

    act(() => {
      result.current.startCreateGroup("media");
      result.current.setGroupDraft({
        name: "Drapeaux",
        type_group: "media",
        media: "",
        data: {}
      });
    });

    await act(async () => {
      await result.current.createGroup();
    });

    expect(createGroup).toHaveBeenCalledWith({
      type_group: "media",
      name: "Drapeaux",
      media: null,
      data: {}
    });
    expect(result.current.allGroups).toContain(createdGroup);
  });

  it("imports remote question media into the new question draft", async () => {
    importMediaUrl.mockResolvedValue({ url: "/static/imported.png" });
    const { result } = await renderManageLibrary();

    await act(async () => {
      await result.current.importQuestionMediaUrl(
        "https://example.com/photo.png",
        { id: "new" }
      );
    });

    expect(importMediaUrl).toHaveBeenCalledWith("https://example.com/photo.png");
    expect(result.current.questionDraft.media).toBe("/static/imported.png");
  });

  it("imports remote image group media through the group upload endpoint", async () => {
    importMediaGroupMediaUrl.mockResolvedValue({ url: "/static/media-groups/7/france.png" });
    const { result } = await renderManageLibrary();

    await act(async () => {
      await result.current.importMediaGroupMediaUrl(
        7,
        "https://example.com/france.png"
      );
    });

    expect(importMediaGroupMediaUrl).toHaveBeenCalledWith(
      7,
      "https://example.com/france.png"
    );
  });
});
