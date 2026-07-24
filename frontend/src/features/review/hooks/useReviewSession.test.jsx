import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewSession } from "./useReviewSession";
import {
  getBonusReviewStatus,
  getBonusGroups,
  getBonusGroupItems,
  getReview,
  graduateRelearning,
  sendMediaAnswer,
  sendMapAnswer,
  sendTimelineAnswer,
  reviseAnswer,
  sendAnswer
} from "../../../api/review";

vi.mock("../../../api/review", () => ({
  getBonusReviewStatus: vi.fn(),
  getBonusGroups: vi.fn(),
  getBonusGroupItems: vi.fn(),
  getReview: vi.fn(),
  graduateRelearning: vi.fn(),
  sendMediaAnswer: vi.fn(),
  sendMapAnswer: vi.fn(),
  sendTextAnswer: vi.fn(),
  sendTimelineAnswer: vi.fn(),
  sendSequenceAnswer: vi.fn(),
  reviseAnswer: vi.fn(),
  sendAnswer: vi.fn()
}));

describe("useReviewSession", () => {
  beforeEach(() => {
    getReview.mockResolvedValue([
      {
        question_id: 10,
        type_q: "text",
        question: "Question",
        answer: "Answer"
      }
    ]);
    getBonusReviewStatus.mockResolvedValue({
      allowed: true,
      state: "low",
      message: "Le planning est léger."
    });
    getBonusGroups.mockResolvedValue([]);
    getBonusGroupItems.mockResolvedValue([]);
    sendAnswer.mockResolvedValue({});
    sendMapAnswer.mockResolvedValue({});
    sendMediaAnswer.mockResolvedValue({});
    sendTimelineAnswer.mockResolvedValue({});
    reviseAnswer.mockResolvedValue({});
    graduateRelearning.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("loads review questions when active", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.questions).toHaveLength(1);

    expect(getReview).toHaveBeenCalledTimes(1);
    expect(result.current.reviewLoading).toBe(false);
  });

  it("requeues failed text questions and sends one quality per answer", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.questions).toHaveLength(1);

    vi.useFakeTimers();

    act(() => {
      result.current.handleTextAnswer(0);
    });

    expect(sendAnswer).toHaveBeenCalledWith(
      10,
      0,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    );
    expect(result.current.selectedTextQuality).toBe(0);

    act(() => {
      vi.advanceTimersByTime(240);
    });

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.questions).toHaveLength(2);
    expect(result.current.questions[1]).toMatchObject({
      question_id: 10,
      _reviewRetryOfIndex: 0
    });
    expect(result.current.bonusMenuOpen).toBe(false);
  });

  it("keeps failed text retries on the original session date after midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 55));

    const { result } = renderHook(() => useReviewSession(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.questions).toHaveLength(1);

    act(() => {
      result.current.handleTextAnswer(0);
    });

    expect(sendAnswer).toHaveBeenLastCalledWith(10, 0, "2026-01-01");

    act(() => {
      vi.advanceTimersByTime(240);
    });

    vi.setSystemTime(new Date(2026, 0, 2, 0, 5));

    // The retry is a relearning card, so "Acquis" graduates it (no re-grade) on
    // the pinned session date rather than sending another answer.
    act(() => {
      result.current.handleTextAnswer(1);
    });

    expect(graduateRelearning).toHaveBeenLastCalledWith([10], "2026-01-01");
    expect(sendAnswer).toHaveBeenCalledTimes(1);
  });

  it("keeps text answer revisions on the original session date after midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 55));

    const { result } = renderHook(() => useReviewSession(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.questions).toHaveLength(1);

    act(() => {
      result.current.handleTextAnswer(0);
    });
    act(() => {
      vi.advanceTimersByTime(240);
    });
    act(() => {
      result.current.returnToLastQuestion();
    });

    vi.setSystemTime(new Date(2026, 0, 2, 0, 5));

    act(() => {
      result.current.handleTextAnswer(3);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(reviseAnswer).toHaveBeenCalledWith(10, 3, "2026-01-01");
  });

  it("keeps grouped submissions on the original session date after midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 55));

    const { result } = renderHook(() => useReviewSession(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.questions).toHaveLength(1);

    vi.setSystemTime(new Date(2026, 0, 2, 0, 5));

    await act(async () => {
      await result.current.submitMapAnswer({ 10: 0 }, "type_all");
      await result.current.submitMediaAnswer({ 11: 2 }, "multiple_choice_image");
      await result.current.submitTimelineAnswer({ 12: { start: { year: 2000 } } });
    });

    expect(sendMapAnswer).toHaveBeenCalledWith(
      { 10: 0 },
      "type_all",
      undefined,
      "2026-01-01"
    );
    expect(sendMediaAnswer).toHaveBeenCalledWith(
      { 11: 2 },
      "multiple_choice_image",
      undefined,
      "2026-01-01"
    );
    expect(sendTimelineAnswer).toHaveBeenCalledWith(
      { 12: { start: { year: 2000 } } },
      "2026-01-01"
    );
  });

  it("opens bonus review automatically after scheduled text questions are correct", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    vi.useFakeTimers();

    act(() => {
      result.current.handleTextAnswer(2);
    });

    act(() => {
      vi.advanceTimersByTime(240);
    });
    vi.useRealTimers();

    expect(result.current.currentIndex).toBe(1);
    // No manual step: the bonus menu opens on its own once bonus is allowed.
    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });
  });

  it("lets the user jump to the bonus menu on demand without finishing the queue", async () => {
    getBonusGroups.mockResolvedValue([
      {
        key: "q:11",
        type_q: "text",
        name: "Bonus",
        tags: [],
        item_count: 1,
        is_container: false
      }
    ]);

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    act(() => {
      result.current.skipToBonusMenu();
    });

    expect(result.current.bonusMenuOpen).toBe(true);
    // The still-unfinished queue is left alone, exactly like the natural
    // "queue ended" path, so "modifier la dernière réponse" keeps working.
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.questions).toHaveLength(1);

    await waitFor(() => {
      expect(result.current.bonusStatusLoading).toBe(false);
    });

    expect(getBonusReviewStatus).toHaveBeenCalled();
    expect(getBonusGroups).toHaveBeenCalledWith();
    expect(result.current.bonusMenuEntries.map(entry => entry.label)).toEqual(["Bonus"]);
  });

  it("opens bonus review automatically when scheduled review is empty", async () => {
    getReview.mockResolvedValue([]);
    getBonusGroups.mockResolvedValue([
      {
        key: "q:11",
        type_q: "text",
        name: "Bonus",
        tags: [],
        item_count: 1,
        is_container: false
      }
    ]);

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.reviewLoading).toBe(false);
    });

    expect(result.current.questions).toEqual([]);

    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });

    expect(getBonusReviewStatus).toHaveBeenCalled();
    // Only the lightweight selection list is loaded up front.
    expect(getBonusGroups).toHaveBeenCalledWith();
    expect(result.current.questions).toEqual([]);
    expect(result.current.bonusMenuEntries.map(entry => entry.label)).toEqual(["Bonus"]);
  });

  it("lists every group in the bonus menu and loads a group's items only on pick", async () => {
    const bonusImages = {
      group_id: 7,
      type_q: "media",
      name: "Bonus images",
      items: [{ question_id: 12 }]
    };
    getReview.mockResolvedValue([
      {
        group_id: 7,
        type_q: "map",
        name: "Map",
        media: "map.svg",
        items: [{ question_id: 10 }],
        context_items: [{ question_id: 10 }]
      }
    ]);
    getBonusReviewStatus.mockResolvedValue({
      allowed: true,
      state: "low",
      message: "Le planning est léger."
    });
    getBonusGroups.mockResolvedValue([
      {
        key: "group:7",
        type_q: "media",
        name: "Bonus images",
        tags: [],
        item_count: 1,
        is_container: true
      }
    ]);
    getBonusGroupItems.mockResolvedValue([bonusImages]);

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    act(() => {
      result.current.handleMapComplete([]);
    });

    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });
    // Bonus is scoped to all groups, so the status is fetched without groupIds.
    expect(getBonusReviewStatus).toHaveBeenCalledWith();

    // The menu is populated from the cheap list; no per-item payload yet.
    expect(getBonusGroups).toHaveBeenCalledWith();
    expect(getBonusGroupItems).not.toHaveBeenCalled();
    expect(result.current.bonusMenuEntries.map(entry => entry.key)).toEqual(["group:7"]);

    // Picking a group fetches its full payload lazily.
    await act(async () => {
      await result.current.selectBonusItem(result.current.bonusMenuEntries[0]);
    });

    expect(getBonusGroupItems).toHaveBeenCalledWith("group:7");
    expect(result.current.bonusMenuOpen).toBe(false);
    expect(result.current.questions).toEqual([bonusImages]);
  });

  it("passes the chosen count when picking a bonus group", async () => {
    const bonusImages = {
      group_id: 8,
      type_q: "media",
      name: "Bonus images",
      items: [{ question_id: 21 }]
    };
    getReview.mockResolvedValue([]);
    getBonusReviewStatus.mockResolvedValue({ allowed: true });
    getBonusGroups.mockResolvedValue([
      {
        key: "group:8",
        type_q: "media",
        name: "Bonus images",
        tags: [],
        item_count: 12,
        is_container: true
      }
    ]);
    getBonusGroupItems.mockResolvedValue([bonusImages]);

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });

    await act(async () => {
      await result.current.selectBonusItem(result.current.bonusMenuEntries[0], 5);
    });

    // The chosen count rides along so the backend samples that many at random.
    expect(getBonusGroupItems).toHaveBeenCalledWith("group:8", 5);
    expect(result.current.questions).toEqual([bonusImages]);
  });

  it("requeues only failed image group items", async () => {
    getReview.mockResolvedValue([
      {
        group_id: 5,
        type_q: "media",
        name: "Flags",
        items: [
          { question_id: 10, answer: "France" },
          { question_id: 11, answer: "Germany" }
        ]
      }
    ]);
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    act(() => {
      result.current.handleImageComplete([11]);
    });

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.questions).toHaveLength(2);
    expect(result.current.questions[1]).toMatchObject({
      type_q: "media",
      _reviewRetryOfIndex: 0,
      items: [
        { question_id: 11, answer: "Germany" }
      ]
    });
  });

  it("keeps small image retries in the served mode", async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      question_id: 100 + index,
      answer: `Image ${index}`
    }));
    getReview.mockResolvedValue([
      {
        group_id: 5,
        type_q: "media",
        name: "Flags",
        mode: "multiple_choice_image",
        items
      }
    ]);
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    act(() => {
      result.current.handleImageComplete(
        items.slice(0, 9).map(item => item.question_id)
      );
    });

    expect(result.current.questions[1]).toMatchObject({
      mode: "multiple_choice_image",
      items: items.slice(0, 9)
    });
  });

  it("keeps image retries when enough failed items remain", async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      question_id: 200 + index,
      answer: `Image ${index}`
    }));
    getReview.mockResolvedValue([
      {
        group_id: 5,
        type_q: "media",
        name: "Flags",
        mode: "multiple_choice_image",
        items
      }
    ]);
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    act(() => {
      result.current.handleImageComplete(
        items.map(item => item.question_id)
      );
    });

    expect(result.current.questions[1]).toMatchObject({
      mode: "multiple_choice_image",
      items
    });
  });

  it("waits for pending text answers before loading bonus questions", async () => {
    let resolveAnswer;
    const answerPromise = new Promise(resolve => {
      resolveAnswer = resolve;
    });
    getReview.mockResolvedValue([
      {
        question_id: 10,
        type_q: "text",
        question: "Question",
        answer: "Answer"
      }
    ]);
    getBonusGroups.mockResolvedValue([
      {
        key: "q:11",
        type_q: "text",
        name: "Bonus",
        tags: [],
        item_count: 1,
        is_container: false
      }
    ]);
    sendAnswer.mockReturnValue(answerPromise);

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    vi.useFakeTimers();

    act(() => {
      result.current.handleTextAnswer(2);
    });

    act(() => {
      vi.advanceTimersByTime(240);
    });

    expect(result.current.currentIndex).toBe(1);
    vi.useRealTimers();

    // The bonus screen opens right away (no separate summary screen), but
    // fetching the list is blocked until the pending text answer resolves.
    await act(async () => {
      await Promise.resolve();
    });
    expect(getBonusGroups).not.toHaveBeenCalled();
    expect(result.current.bonusMenuOpen).toBe(true);
    expect(result.current.bonusStatusLoading).toBe(true);

    await act(async () => {
      resolveAnswer({});
      await answerPromise;
    });

    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });

    expect(getBonusGroups).toHaveBeenCalledWith();
    expect(result.current.bonusMenuEntries.map(entry => entry.label)).toEqual(["Bonus"]);
    // `questions`/`currentIndex` from the review that just ended are left
    // alone (not reset to 0) so "modifier la dernière réponse" still works
    // while the bonus menu is showing; picking an entry is what resets them.
    expect(result.current.currentIndex).toBe(1);
  });

  it("opens a bonus menu and runs a picked item, then returns to the menu", async () => {
    const bonusText = {
      question_id: 11,
      type_q: "text",
      question: "Bonus text",
      answer: "Answer"
    };
    const bonusImages = {
      group_id: 5,
      type_q: "media",
      name: "Bonus images",
      items: [{ question_id: 13, answer: "France" }]
    };
    getReview.mockResolvedValue([]);
    getBonusGroups.mockResolvedValue([
      {
        key: "q:11",
        type_q: "text",
        name: "Bonus text",
        tags: [],
        item_count: 1,
        is_container: false
      },
      {
        key: "group:5",
        type_q: "media",
        name: "Bonus images",
        tags: [],
        item_count: 1,
        is_container: true
      }
    ]);
    getBonusGroupItems.mockImplementation(key =>
      Promise.resolve(key === "group:5" ? [bonusImages] : [bonusText])
    );

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });

    expect(getBonusGroups).toHaveBeenCalledWith();
    expect(result.current.questions).toEqual([]);
    expect(result.current.bonusMenuEntries.map(entry => entry.label)).toEqual([
      "Bonus text",
      "Bonus images"
    ]);

    // Pick the image group from the menu; its payload is fetched on demand.
    await act(async () => {
      await result.current.selectBonusItem(
        result.current.bonusMenuEntries.find(entry => entry.key === "group:5")
      );
    });

    expect(getBonusGroupItems).toHaveBeenCalledWith("group:5");
    expect(result.current.bonusMenuOpen).toBe(false);
    expect(result.current.bonusReviewActive).toBe(true);
    expect(result.current.questions).toEqual([bonusImages]);
    expect(result.current.currentIndex).toBe(0);

    // Finishing the item marks it done and returns to the menu.
    act(() => {
      result.current.handleImageComplete([]);
    });

    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });
    expect(result.current.questions).toEqual([]);
    expect(result.current.bonusMenuEntries.map(entry => entry.label)).toEqual([
      "Bonus text"
    ]);
  });

  it("returns to the bonus menu without consuming the current item", async () => {
    const bonusText = {
      question_id: 11,
      type_q: "text",
      question: "Bonus text",
      answer: "Answer"
    };
    const bonusImages = {
      group_id: 5,
      type_q: "media",
      name: "Bonus images",
      items: [{ question_id: 13, answer: "France" }]
    };
    getReview.mockResolvedValue([]);
    getBonusGroups.mockResolvedValue([
      {
        key: "q:11",
        type_q: "text",
        name: "Bonus text",
        tags: [],
        item_count: 1,
        is_container: false
      },
      {
        key: "group:5",
        type_q: "media",
        name: "Bonus images",
        tags: [],
        item_count: 1,
        is_container: true
      }
    ]);
    getBonusGroupItems.mockImplementation(key =>
      Promise.resolve(key === "group:5" ? [bonusImages] : [bonusText])
    );

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });

    await act(async () => {
      await result.current.selectBonusItem(
        result.current.bonusMenuEntries.find(entry => entry.key === "q:11")
      );
    });

    expect(result.current.questions).toEqual([bonusText]);

    act(() => {
      result.current.returnToBonusMenu();
    });

    expect(result.current.bonusMenuOpen).toBe(true);
    expect(result.current.questions).toEqual([]);
    // The item was not answered, so it stays in the menu.
    expect(result.current.bonusMenuEntries.map(entry => entry.label)).toEqual([
      "Bonus text",
      "Bonus images"
    ]);
    expect(sendAnswer).not.toHaveBeenCalled();
  });

  it("runs every chunk of a picked group back-to-back", async () => {
    const chunkA = {
      group_id: 8,
      type_q: "map",
      name: "Grande carte",
      tags: ["geo"],
      items: [{ question_id: 21 }, { question_id: 22 }]
    };
    const chunkB = {
      group_id: 8,
      type_q: "map",
      name: "Grande carte",
      tags: ["geo"],
      items: [{ question_id: 23 }]
    };
    getReview.mockResolvedValue([]);
    getBonusGroups.mockResolvedValue([
      {
        key: "group:8",
        type_q: "map",
        name: "Grande carte",
        tags: ["geo"],
        item_count: 3,
        is_container: true
      }
    ]);
    getBonusGroupItems.mockResolvedValue([chunkA, chunkB]);

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.bonusMenuOpen).toBe(true);
    });

    // The backend collapses the group's chunks into one menu entry.
    expect(result.current.bonusMenuEntries).toHaveLength(1);
    const [entry] = result.current.bonusMenuEntries;
    expect(entry.key).toBe("group:8");
    expect(entry.label).toBe("Grande carte");
    expect(entry.itemCount).toBe(3);

    // Picking it fetches and runs both chunks back-to-back in one mini-session.
    await act(async () => {
      await result.current.selectBonusItem(result.current.bonusMenuEntries[0]);
    });

    expect(getBonusGroupItems).toHaveBeenCalledWith("group:8");
    expect(result.current.questions).toEqual([chunkA, chunkB]);
  });

  it("shows the bonus screen without a list when the status is not allowed", async () => {
    getReview.mockResolvedValue([]);
    getBonusReviewStatus.mockResolvedValue({
      allowed: false
    });

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.bonusStatusLoading).toBe(false);
    });

    // The bonus screen still opens (it's the only post-review destination
    // now), it just never fetches a list to show.
    expect(result.current.bonusMenuOpen).toBe(true);
    expect(result.current.bonusMenuEntries).toEqual([]);
    expect(getBonusGroups).not.toHaveBeenCalled();
  });
});
