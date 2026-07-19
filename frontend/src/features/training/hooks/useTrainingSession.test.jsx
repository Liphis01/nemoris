import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  shuffleTrainingItems,
  useTrainingSession
} from "./useTrainingSession";
import {
  getTrainingItems,
  gradeTrainingTimeline,
  listTrainingScopes,
  recordCollectionTrainingAttempt,
  recordGroupTrainingAttempt
} from "../../../api/training";

vi.mock("../../../api/training", () => ({
  getTrainingItems: vi.fn(),
  gradeTrainingTimeline: vi.fn(),
  listTrainingScopes: vi.fn(),
  recordCollectionTrainingAttempt: vi.fn(),
  recordGroupTrainingAttempt: vi.fn()
}));


const TRAINING_FINGERPRINT = "training-fingerprint";


describe("useTrainingSession", () => {
  let performanceNowSpy;
  let randomSpy;

  beforeEach(() => {
    listTrainingScopes.mockResolvedValue({
      groups: [{
        id: 5,
        name: "Europe",
        type_group: "map",
        question_count: 2,
        training_record: null
      }],
      collections: [{
        id: 7,
        name: "Custom",
        question_count: 2,
        training_record: null
      }],
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
    recordGroupTrainingAttempt.mockResolvedValue({
      training_record: {
        best_found_percent: 100,
        best_found_count: 2,
        best_found_elapsed_ms: 5500,
        best_found_at: "2026-06-02T10:00:00+00:00",
        best_time_ms: 5500,
        best_time_at: "2026-06-02T10:00:00+00:00",
        question_count: 2
      },
      is_new_best_percent: true,
      is_new_best_time: true
    });
    recordCollectionTrainingAttempt.mockResolvedValue({
      training_record: {
        best_found_percent: 100,
        best_found_count: 2,
        best_found_elapsed_ms: 5500,
        best_found_at: "2026-06-02T10:00:00+00:00",
        best_time_ms: 5500,
        best_time_at: "2026-06-02T10:00:00+00:00",
        question_count: 2
      },
      training_records: {},
      is_new_best_percent: true,
      is_new_best_time: true
    });
    performanceNowSpy = vi
      .spyOn(performance, "now")
      .mockReturnValue(1000);
    randomSpy = vi
      .spyOn(Math, "random")
      .mockReturnValue(0.999);
  });

  afterEach(() => {
    vi.clearAllMocks();
    performanceNowSpy?.mockRestore();
    randomSpy?.mockRestore();
    vi.useRealTimers();
  });

  it("shuffles training queues and grouped child items without mutating input", () => {
    const items = [
      { question_id: 1, type_q: "text" },
      {
        group_id: 2,
        type_q: "map",
        items: [
          { question_id: 2 },
          { question_id: 3 },
          { question_id: 4 }
        ],
        context_items: [
          { question_id: 6 },
          { question_id: 7 },
          { question_id: 8 }
        ]
      },
      { question_id: 5, type_q: "text" }
    ];
    const random = vi.fn().mockReturnValue(0);

    const shuffled = shuffleTrainingItems(items, random);

    expect(shuffled.map(item => item.question_id ?? item.group_id)).toEqual([
      2,
      5,
      1
    ]);
    expect(shuffled[0].items.map(item => item.question_id)).toEqual([
      3,
      4,
      2
    ]);
    expect(shuffled[0].context_items.map(item => item.question_id)).toEqual([
      7,
      8,
      6
    ]);
    expect(items.map(item => item.question_id ?? item.group_id)).toEqual([
      1,
      2,
      5
    ]);
    expect(items[1].items.map(item => item.question_id)).toEqual([2, 3, 4]);
    expect(items[1].context_items.map(item => item.question_id)).toEqual([
      6,
      7,
      8
    ]);
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

  it("starts a collection training session", async () => {
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.collections).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "collection",
        id: 7,
        name: "Custom"
      });
    });

    expect(getTrainingItems).toHaveBeenCalledWith({
      scopeType: "collection",
      collectionId: 7
    });
    expect(result.current.questions).toHaveLength(1);
    expect(result.current.labelForActiveScope).toBe("Custom");
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

  it("saves a clean full group attempt record once", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 5,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [
          { question_id: 10, code: "fr", label: "France" },
          { question_id: 11, code: "de", label: "Germany" }
        ]
      }
    ]);
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe",
        question_count: 2
      });
    });

    performanceNowSpy.mockReturnValue(6500);

    act(() => {
      result.current.handleMapComplete([]);
    });

    await waitFor(() => {
      expect(recordGroupTrainingAttempt).toHaveBeenCalledWith(5, {
        elapsed_ms: 5500,
        question_count: 2,
        found_count: 2,
        content_fingerprint: TRAINING_FINGERPRINT
      });
    });

    await waitFor(() => {
      expect(result.current.recordSaveStatus).toBe("saved");
    });
    expect(result.current.recordResult.is_new_best_time).toBe(true);
    expect(result.current.activeScope.training_record.best_found_percent).toBe(100);
  });

  it("stops the clock when the last question is answered, not when its recap is dismissed", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 5,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [
          { question_id: 10, code: "fr", label: "France" },
          { question_id: 11, code: "de", label: "Germany" }
        ]
      }
    ]);
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe",
        question_count: 2
      });
    });

    // Last zone answered: the recap opens here.
    performanceNowSpy.mockReturnValue(4000);

    act(() => {
      result.current.markAnsweringComplete([]);
    });

    expect(result.current.completedElapsedMs).toBe(3000);

    // The attempt is saved immediately, without waiting for the recap dismissal.
    await waitFor(() => {
      expect(recordGroupTrainingAttempt).toHaveBeenCalledWith(5, {
        elapsed_ms: 3000,
        question_count: 2,
        found_count: 2,
        content_fingerprint: TRAINING_FINGERPRINT
      });
    });

    // The user reads the recap for another five seconds before dismissing it.
    performanceNowSpy.mockReturnValue(9000);

    act(() => {
      result.current.handleMapComplete([]);
    });

    expect(result.current.completedRunElapsedMs).toBe(3000);
    expect(recordGroupTrainingAttempt).toHaveBeenCalledTimes(1);
  });

  it("saves the attempt with the score known when answering ended", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 5,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [
          { question_id: 10, code: "fr", label: "France" },
          { question_id: 11, code: "de", label: "Germany" }
        ]
      }
    ]);
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe",
        question_count: 2
      });
    });

    performanceNowSpy.mockReturnValue(4000);

    // "Terminer" pressed with one zone still missing.
    act(() => {
      result.current.markAnsweringComplete([11]);
    });

    await waitFor(() => {
      expect(recordGroupTrainingAttempt).toHaveBeenCalledWith(5, {
        elapsed_ms: 3000,
        question_count: 2,
        found_count: 1,
        content_fingerprint: TRAINING_FINGERPRINT
      });
    });
    expect(result.current.failedCount).toBe(1);
  });

  it("keeps the clock running when a question other than the last is answered", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 5,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [{ question_id: 10, code: "fr", label: "France" }]
      },
      {
        group_id: 5,
        type_q: "map",
        name: "Asia",
        media: "asia.svg",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [{ question_id: 11, code: "jp", label: "Japan" }]
      }
    ]);
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe",
        question_count: 2
      });
    });

    performanceNowSpy.mockReturnValue(4000);

    act(() => {
      result.current.markAnsweringComplete([]);
    });

    expect(result.current.completedElapsedMs).toBeNull();
    expect(recordGroupTrainingAttempt).not.toHaveBeenCalled();

    act(() => {
      result.current.handleMapComplete([]);
    });

    // Now on the last question: its recap is what freezes the clock.
    performanceNowSpy.mockReturnValue(9000);

    act(() => {
      result.current.markAnsweringComplete([]);
    });

    expect(result.current.completedElapsedMs).toBe(8000);
  });

  it("saves a clean full collection attempt as one record", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        question_id: 10,
        type_q: "text",
        question: "Capital",
        answer: "Paris",
        training_fingerprint: TRAINING_FINGERPRINT
      },
      {
        question_id: 11,
        type_q: "text",
        question: "Capital",
        answer: "Berlin",
        training_fingerprint: TRAINING_FINGERPRINT
      }
    ]);
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.collections).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "collection",
        id: 7,
        name: "Custom",
        question_count: 2
      });
    });

    performanceNowSpy.mockReturnValue(6500);

    act(() => {
      result.current.handleTextAnswer();
    });
    act(() => {
      result.current.handleTextAnswer();
    });

    await waitFor(() => {
      expect(recordCollectionTrainingAttempt).toHaveBeenCalledWith(7, {
        elapsed_ms: 5500,
        question_count: 2,
        found_count: 2,
        content_fingerprint: TRAINING_FINGERPRINT
      });
    });
    expect(recordGroupTrainingAttempt).not.toHaveBeenCalled();

    // The record lands in state only when the save resolves; asserting right
    // after the API-call waitFor races the state commit on slow runners.
    await waitFor(() => {
      expect(result.current.recordSaveStatus).toBe("saved");
    });
    expect(result.current.activeScope.training_record.best_found_percent).toBe(100);
    expect(result.current.scopes.collections[0].training_record.best_time_ms).toBe(5500);
  });

  it("passes selected map mode through training fetch and record save", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 5,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        mode: "multiple_choice",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [
          { question_id: 10, code: "fr", label: "France" },
          { question_id: 11, code: "de", label: "Germany" }
        ]
      }
    ]);
    recordGroupTrainingAttempt.mockResolvedValueOnce({
      training_record: {
        best_found_percent: 100,
        best_found_count: 2,
        best_found_elapsed_ms: 5500,
        best_found_at: "2026-06-02T10:00:00+00:00",
        best_time_ms: 5500,
        best_time_at: "2026-06-02T10:00:00+00:00",
        question_count: 2
      },
      training_records: {
        multiple_choice: {
          best_found_percent: 100,
          best_found_count: 2,
          best_found_elapsed_ms: 5500,
          best_found_at: "2026-06-02T10:00:00+00:00",
          best_time_ms: 5500,
          best_time_at: "2026-06-02T10:00:00+00:00",
          question_count: 2
        }
      },
      is_new_best_percent: true,
      is_new_best_time: true
    });
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe",
        question_count: 2
      }, "multiple_choice");
    });

    expect(getTrainingItems).toHaveBeenCalledWith({
      scopeType: "group",
      groupId: 5,
      mapMode: "multiple_choice"
    });

    performanceNowSpy.mockReturnValue(6500);

    act(() => {
      result.current.handleMapComplete([]);
    });

    await waitFor(() => {
      expect(recordGroupTrainingAttempt).toHaveBeenCalledWith(5, {
        elapsed_ms: 5500,
        question_count: 2,
        found_count: 2,
        content_fingerprint: TRAINING_FINGERPRINT,
        mode: "multiple_choice"
      });
    });
    expect(result.current.activeScope.training_records.multiple_choice.best_time_ms).toBe(5500);
  });

  it("passes selected image mode through training fetch and record save", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 6,
        type_q: "media",
        name: "Flags",
        mode: "multiple_choice_image",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [
          { question_id: 20, label: "France", media: "/static/france.png" },
          { question_id: 21, label: "Germany", media: "/static/germany.png" }
        ],
        context_items: [
          { question_id: 20, label: "France", media: "/static/france.png" },
          { question_id: 21, label: "Germany", media: "/static/germany.png" }
        ]
      }
    ]);
    recordGroupTrainingAttempt.mockResolvedValueOnce({
      training_record: {
        best_found_percent: 100,
        best_found_count: 2,
        best_found_elapsed_ms: 5500,
        best_found_at: "2026-06-02T10:00:00+00:00",
        best_time_ms: 5500,
        best_time_at: "2026-06-02T10:00:00+00:00",
        question_count: 2
      },
      training_records: {
        multiple_choice_image: {
          best_found_percent: 100,
          best_found_count: 2,
          best_found_elapsed_ms: 5500,
          best_found_at: "2026-06-02T10:00:00+00:00",
          best_time_ms: 5500,
          best_time_at: "2026-06-02T10:00:00+00:00",
          question_count: 2
        }
      },
      is_new_best_percent: true,
      is_new_best_time: true
    });
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        type_group: "media",
        id: 6,
        name: "Flags",
        question_count: 2
      }, "multiple_choice_image");
    });

    expect(getTrainingItems).toHaveBeenCalledWith({
      scopeType: "group",
      groupId: 6,
      imageMode: "multiple_choice_image"
    });

    performanceNowSpy.mockReturnValue(6500);

    act(() => {
      result.current.handleImageComplete([]);
    });

    await waitFor(() => {
      expect(recordGroupTrainingAttempt).toHaveBeenCalledWith(6, {
        elapsed_ms: 5500,
        question_count: 2,
        found_count: 2,
        content_fingerprint: TRAINING_FINGERPRINT,
        mode: "multiple_choice_image"
      });
    });
    await waitFor(() => {
      expect(
        result.current.activeScope.training_records
          ?.multiple_choice_image
          ?.best_time_ms
      ).toBe(5500);
    });
  });

  it("surfaces stale record save errors", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 5,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [
          { question_id: 10, code: "fr", label: "France" },
          { question_id: 11, code: "de", label: "Germany" }
        ]
      }
    ]);
    recordGroupTrainingAttempt.mockRejectedValueOnce(
      new Error("Training content changed; restart the session")
    );
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe",
        question_count: 2
      });
    });

    performanceNowSpy.mockReturnValue(6500);

    act(() => {
      result.current.handleMapComplete([]);
    });

    await waitFor(() => {
      expect(result.current.recordSaveStatus).toBe("error");
    });
    expect(result.current.recordSaveError).toBe(
      "Training content changed; restart the session"
    );
  });

  it("saves partial full group score but skips retry attempts", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 5,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [
          { question_id: 10, code: "fr", label: "France" },
          { question_id: 11, code: "de", label: "Germany" }
        ]
      }
    ]);
    recordGroupTrainingAttempt.mockResolvedValueOnce({
      training_record: {
        best_found_percent: 50,
        best_found_count: 1,
        best_found_elapsed_ms: 4000,
        best_found_at: "2026-06-02T10:00:00+00:00",
        question_count: 2
      },
      is_new_best_percent: true,
      is_new_best_time: false
    });
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe",
        question_count: 2
      });
    });

    performanceNowSpy.mockReturnValue(5000);

    act(() => {
      result.current.handleMapComplete([11]);
    });

    await waitFor(() => {
      expect(recordGroupTrainingAttempt).toHaveBeenCalledWith(5, {
        elapsed_ms: 4000,
        question_count: 2,
        found_count: 1,
        content_fingerprint: TRAINING_FINGERPRINT
      });
    });

    act(() => {
      result.current.retryFailedItems();
    });

    performanceNowSpy.mockReturnValue(7000);

    act(() => {
      result.current.handleMapComplete([]);
    });

    expect(recordGroupTrainingAttempt).toHaveBeenCalledTimes(1);
  });

  it("restarts full group attempts as record-eligible runs", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        group_id: 5,
        type_q: "map",
        name: "Europe",
        media: "europe.svg",
        training_fingerprint: TRAINING_FINGERPRINT,
        items: [
          { question_id: 10, code: "fr", label: "France" },
          { question_id: 11, code: "de", label: "Germany" }
        ]
      }
    ]);
    const { result } = renderHook(() => useTrainingSession(true));

    await waitFor(() => {
      expect(result.current.scopes.groups).toHaveLength(1);
    });

    await act(async () => {
      await result.current.startScope({
        type: "group",
        id: 5,
        name: "Europe",
        question_count: 2
      });
    });

    performanceNowSpy.mockReturnValue(5000);

    act(() => {
      result.current.handleMapComplete([]);
    });

    await waitFor(() => {
      expect(recordGroupTrainingAttempt).toHaveBeenCalledTimes(1);
    });

    performanceNowSpy.mockReturnValue(10000);

    act(() => {
      result.current.restartFullScope();
    });

    performanceNowSpy.mockReturnValue(13000);

    act(() => {
      result.current.handleMapComplete([]);
    });

    await waitFor(() => {
      expect(recordGroupTrainingAttempt).toHaveBeenCalledTimes(2);
    });
  });
});
