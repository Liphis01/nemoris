import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewSession } from "./useReviewSession";
import {
  getReview,
  getReviewSettings,
  rebalanceReviewCalendar,
  reviseAnswer,
  sendAnswer,
  updateReviewSettings
} from "../../../api/review";

vi.mock("../../../api/review", () => ({
  getReview: vi.fn(),
  getReviewSettings: vi.fn(),
  rebalanceReviewCalendar: vi.fn(),
  reviseAnswer: vi.fn(),
  sendAnswer: vi.fn(),
  updateReviewSettings: vi.fn()
}));

describe("useReviewSession", () => {
  beforeEach(() => {
    getReviewSettings.mockResolvedValue({ catchup_daily_target: 35 });
    getReview.mockResolvedValue([
      {
        question_id: 10,
        type_q: "text",
        question: "Question",
        answer: "Answer"
      }
    ]);
    sendAnswer.mockResolvedValue({});
    reviseAnswer.mockResolvedValue({});
    updateReviewSettings.mockResolvedValue({ catchup_daily_target: 40 });
    rebalanceReviewCalendar.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("loads settings before fetching review questions", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    expect(getReviewSettings).toHaveBeenCalledTimes(1);
    expect(getReview).toHaveBeenCalledTimes(1);
    expect(result.current.catchupTargetDraft).toBe("35");
  });

  it("requeues failed text questions and sends one quality per answer", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    vi.useFakeTimers();

    act(() => {
      result.current.handleTextAnswer(0);
    });

    expect(sendAnswer).toHaveBeenCalledWith(10, 0);
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
  });

  it("requeues only failed image group items", async () => {
    getReview.mockResolvedValue([
      {
        group_id: 5,
        type_q: "image",
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
      type_q: "image",
      _reviewRetryOfIndex: 0,
      items: [
        { question_id: 11, answer: "Germany" }
      ]
    });
  });

  it("saves catchup target and refreshes the review queue", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    act(() => {
      result.current.setCatchupTargetDraft("40");
    });

    await act(async () => {
      await result.current.saveCatchupTarget();
    });

    expect(updateReviewSettings).toHaveBeenCalledWith({
      catchup_daily_target: 40
    });
    expect(rebalanceReviewCalendar).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(getReview).toHaveBeenCalledTimes(2);
    });
  });
});
