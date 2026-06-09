import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMapReview } from "./useMapReview";
import { sendMapAnswer } from "../../../api/review";

vi.mock("../../../api/review", () => ({
  sendMapAnswer: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
});

function labels(rows) {
  return rows.map(row => row.item.label);
}

function zone({
  questionId,
  code,
  label,
  difficulty = 5,
  interval = 0,
  projectedIntervals = {}
}) {
  return {
    question_id: questionId,
    code,
    label,
    progress: {
      difficulty,
      interval
    },
    projected_intervals: projectedIntervals
  };
}

describe("useMapReview recap sorting", () => {
  it("toggles answer sorting inside found and missed sections", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "b", label: "Beta", difficulty: 9 }),
      zone({ questionId: 2, code: "a", label: "Alpha", difficulty: 3 }),
      zone({ questionId: 3, code: "g", label: "Gamma", difficulty: 8 }),
      zone({ questionId: 4, code: "d", label: "Delta", difficulty: 2 })
    ];
    const { result } = renderHook(() => useMapReview(reviewZones, vi.fn()));

    act(() => {
      result.current.handleZoneSelect("b");
    });
    act(() => {
      result.current.handleZoneSelect("a");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
      "Delta"
    ]);

    act(() => {
      result.current.toggleRecapSort("answer");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma"
    ]);
    expect(result.current.recapRows.map(row => row.isFound)).toEqual([
      true,
      true,
      false,
      false
    ]);

    act(() => {
      result.current.toggleRecapSort("answer");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
      "Delta"
    ]);
  });

  it("uses current row quality for quality and interval sorting", () => {
    const reviewZones = [
      zone({
        questionId: 1,
        code: "a",
        label: "Alpha",
        difficulty: 8,
        projectedIntervals: { 1: 5, 2: 20, 3: 80 }
      }),
      zone({
        questionId: 2,
        code: "b",
        label: "Beta",
        difficulty: 6,
        projectedIntervals: { 1: 10, 2: 40, 3: 60 }
      }),
      zone({ questionId: 3, code: "g", label: "Gamma", difficulty: 4 })
    ];
    const { result } = renderHook(() => useMapReview(reviewZones, vi.fn()));

    act(() => {
      result.current.handleZoneSelect("a");
    });
    act(() => {
      result.current.handleZoneSelect("b");
    });
    act(() => {
      result.current.finishMap();
    });
    act(() => {
      result.current.toggleRecapSort("interval");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Alpha",
      "Beta",
      "Gamma"
    ]);

    act(() => {
      result.current.setQuality(1, 3);
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Beta",
      "Alpha",
      "Gamma"
    ]);

    act(() => {
      result.current.toggleRecapSort("quality");
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Beta",
      "Alpha",
      "Gamma"
    ]);

    act(() => {
      result.current.setQuality(1, 1);
    });

    expect(labels(result.current.recapRows)).toEqual([
      "Alpha",
      "Beta",
      "Gamma"
    ]);
  });

  it("uses an injected submit callback instead of the scheduled answer API", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, onComplete, submitAnswer)
    );

    act(() => {
      result.current.handleZoneSelect("a");
    });
    act(() => {
      result.current.finishMap();
    });

    await act(async () => {
      await result.current.sendResult();
    });

    expect(submitAnswer).toHaveBeenCalledWith({
      1: 2,
      2: 0
    });
    expect(sendMapAnswer).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith([2]);
  });

  it("continues tab focus after a correctly answered focused zone", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" }),
      zone({ questionId: 3, code: "c", label: "Gamma" }),
      zone({ questionId: 4, code: "d", label: "Delta" })
    ];
    const { result } = renderHook(() => useMapReview(reviewZones, vi.fn()));

    act(() => {
      result.current.focusNextRemainingZone();
    });
    act(() => {
      result.current.focusNextRemainingZone();
    });

    expect(result.current.remainingFocusCode).toBe("b");

    act(() => {
      result.current.setInput("Beta");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.focusNextRemainingZone();
    });

    expect(result.current.foundQuestionIds).toEqual([2]);
    expect(result.current.remainingFocusCode).toBe("c");
  });
});
