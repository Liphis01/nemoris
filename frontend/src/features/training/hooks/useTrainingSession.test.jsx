import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrainingSession } from "./useTrainingSession";
import {
  getTrainingItems,
  gradeTrainingTimeline,
  listTrainingScopes
} from "../../../api/training";

vi.mock("../../../api/training", () => ({
  getTrainingItems: vi.fn(),
  gradeTrainingTimeline: vi.fn(),
  listTrainingScopes: vi.fn()
}));


describe("useTrainingSession", () => {
  beforeEach(() => {
    listTrainingScopes.mockResolvedValue({
      groups: [{ id: 5, name: "Europe", type_group: "map", question_count: 2 }],
      tags: [{ name: "geo", count: 3 }]
    });
    getTrainingItems.mockResolvedValue([
      {
        question_id: 1,
        type_q: "text",
        question: "Question",
        answer: "Answer"
      }
    ]);
    gradeTrainingTimeline.mockResolvedValue({ status: "ok", results: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("loads scopes and starts a group training session", async () => {
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe"
      });
    });

    expect(getTrainingItems).toHaveBeenCalledWith({
      scopeType: "group",
      groupId: 5
    });
    expect(result.current.questions).toHaveLength(1);
    expect(result.current.labelForActiveScope).toBe("Europe");
  });

  it("tracks objective failed ids locally and retries only failed items", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        question_id: 1,
        type_q: "text",
        question: "Question",
        answer: "Answer"
      },
      {
        group_id: 2,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        items: [
          { question_id: 2, code: "fr", label: "France" },
          { question_id: 3, code: "de", label: "Germany" }
        ]
      }
    ]);
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.tags).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "tag",
        name: "geo"
      });
    });

    act(() => {
      result.current.handleTextAnswer();
    });
    act(() => {
      result.current.handleMapComplete([3]);
    });

    expect(result.current.isComplete).toBe(true);
    expect(result.current.failedCount).toBe(1);

    act(() => {
      result.current.retryFailedItems();
    });

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.failedCount).toBe(0);
    expect(result.current.questions).toMatchObject([
      {
        type_q: "map",
        items: [
          { question_id: 3 }
        ]
      }
    ]);
  });

  it("restarts the full original scope and returns to the selector", async () => {
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "tag",
        name: "geo"
      });
    });

    act(() => {
      result.current.handleTextAnswer();
    });

    expect(result.current.isComplete).toBe(true);
    expect(result.current.failedCount).toBe(0);

    act(() => {
      result.current.restartFullScope();
    });

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.questions).toHaveLength(1);
    expect(result.current.failedCount).toBe(0);

    act(() => {
      result.current.returnToScopeSelector();
    });

    expect(result.current.activeScope).toBe(null);
    expect(result.current.questions).toEqual([]);
  });

  it("uses the training timeline grader callback", async () => {
    const { result } = renderHook(() => useTrainingSession(false));
    const payload = {
      4: {
        start: {
          year: 1969,
          precision: "year"
        }
      }
    };

    await act(async () => {
      await result.current.submitTimelineTrainingAnswer(payload);
    });

    expect(gradeTrainingTimeline).toHaveBeenCalledWith(payload);
  });
});
