import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useManageLibrary } from "./useManageLibrary";
import {
  createQuestion,
  deleteQuestion,
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

vi.mock("../../../api/questions", () => ({
  createQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
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
    removeQuestionMedia.mockResolvedValue({});
    uploadMedia.mockResolvedValue({});
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("loads questions and groups in manage mode", async () => {
    const { result } = renderHook(() => useManageLibrary("manage"));

    await waitFor(() => {
      expect(result.current.allQuestions).toHaveLength(3);
      expect(result.current.allGroups).toHaveLength(2);
    });

    expect(listQuestions).toHaveBeenCalledTimes(1);
    expect(listGroups).toHaveBeenCalledTimes(1);
  });

  it("removes a deleted group, its questions, and the selected grouped item from cache", async () => {
    const { result } = renderHook(() => useManageLibrary("manage"));

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
});
