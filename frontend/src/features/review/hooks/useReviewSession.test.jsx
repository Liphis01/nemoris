import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewSession } from "./useReviewSession";
import {
  getReview,
  graduateRelearning,
  sendMediaAnswer,
  sendMapAnswer,
  sendTimelineAnswer,
  reviseAnswer,
  sendAnswer
} from "../../../api/review";

vi.mock("../../../api/review", () => ({
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
    expect(result.current.sessionComplete).toBe(false);
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

  it("ends the session when nothing is scheduled", async () => {
    getReview.mockResolvedValue([]);
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.sessionComplete).toBe(true);
    });

    expect(result.current.questions).toEqual([]);
    expect(result.current.reviewLoading).toBe(false);
  });

  it("ends the session once the last question is answered", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    expect(result.current.sessionComplete).toBe(false);

    vi.useFakeTimers();

    act(() => {
      result.current.handleTextAnswer(3);
    });

    act(() => {
      vi.advanceTimersByTime(240);
    });

    vi.useRealTimers();

    await waitFor(() => {
      expect(result.current.sessionComplete).toBe(true);
    });
  });

  it("lets the user end the session early while retries remain", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    act(() => {
      result.current.skipToSessionEnd();
    });

    await waitFor(() => {
      expect(result.current.sessionComplete).toBe(true);
    });
  });
});
