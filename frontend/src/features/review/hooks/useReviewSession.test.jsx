import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeDailyGrove } from "../../../api/dailyGrove";
import { useReviewSession } from "./useReviewSession";
import {
  getReview,
  reviseAnswer,
  sendAnswer
} from "../../../api/review";

vi.mock("../../../api/review", () => ({
  getReview: vi.fn(),
  reviseAnswer: vi.fn(),
  sendAnswer: vi.fn()
}));

vi.mock("../../../api/dailyGrove", () => ({
  completeDailyGrove: vi.fn()
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
    reviseAnswer.mockResolvedValue({});
    completeDailyGrove.mockResolvedValue({
      current_streak: 1,
      due_count: 0,
      today_complete: true,
      completed: true
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("loads review questions when active", async () => {
    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.questions).toHaveLength(1);
    });

    expect(getReview).toHaveBeenCalledTimes(1);
    expect(result.current.reviewLoading).toBe(false);
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
    expect(result.current.canStartBonusReview).toBe(false);
  });

  it("offers bonus review after scheduled text questions are correct", async () => {
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
    expect(result.current.canStartBonusReview).toBe(true);
  });

  it("completes the daily grove after scheduled answers settle", async () => {
    let resolveAnswer;
    const answerPromise = new Promise(resolve => {
      resolveAnswer = resolve;
    });
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

    expect(result.current.canStartBonusReview).toBe(true);
    expect(completeDailyGrove).not.toHaveBeenCalled();

    vi.useRealTimers();

    await act(async () => {
      resolveAnswer({});
      await answerPromise;
    });

    await waitFor(() => {
      expect(completeDailyGrove).toHaveBeenCalledTimes(1);
    });

    expect(result.current.dailyGroveCompletion).toMatchObject({
      current_streak: 1,
      today_complete: true
    });
  });

  it("offers bonus review when scheduled review is empty", async () => {
    getReview
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          question_id: 11,
          type_q: "text",
          question: "Bonus",
          answer: "Answer"
        }
      ]);

    const { result } = renderHook(() => useReviewSession(true));

    await waitFor(() => {
      expect(result.current.reviewLoading).toBe(false);
    });

    expect(result.current.questions).toEqual([]);
    expect(result.current.canStartBonusReview).toBe(true);

    await act(async () => {
      await result.current.startBonusReview();
    });

    expect(getReview).toHaveBeenCalledWith({ includeNew: true });
    expect(result.current.questions).toEqual([
      {
        question_id: 11,
        type_q: "text",
        question: "Bonus",
        answer: "Answer"
      }
    ]);
    expect(result.current.canStartBonusReview).toBe(false);
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

  it("waits for pending text answers before loading bonus questions", async () => {
    let resolveAnswer;
    const answerPromise = new Promise(resolve => {
      resolveAnswer = resolve;
    });
    getReview
      .mockResolvedValueOnce([
        {
          question_id: 10,
          type_q: "text",
          question: "Question",
          answer: "Answer"
        }
      ])
      .mockResolvedValueOnce([
        {
          question_id: 11,
          type_q: "text",
          question: "Bonus",
          answer: "Answer"
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

    expect(result.current.canStartBonusReview).toBe(true);

    let bonusPromise;

    act(() => {
      bonusPromise = result.current.startBonusReview();
    });

    expect(getReview).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAnswer({});
      await bonusPromise;
    });

    expect(getReview).toHaveBeenCalledWith({ includeNew: true });
    expect(result.current.questions).toEqual([
      {
        question_id: 11,
        type_q: "text",
        question: "Bonus",
        answer: "Answer"
      }
    ]);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.canStartBonusReview).toBe(false);
  });
});
