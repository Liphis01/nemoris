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
      result.current.setInput("Beta");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("Alpha");
    });
    act(() => {
      result.current.handleSubmit();
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
      result.current.setInput("Alpha");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("Beta");
    });
    act(() => {
      result.current.handleSubmit();
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
      result.current.setInput("Alpha");
    });
    act(() => {
      result.current.handleSubmit();
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
    }, "type_all", 2);
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
    expect(result.current.manualFocusCode).toBe("b");

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
    expect(result.current.manualFocusCode).toBe("c");
  });

  it("keeps clicks from answering type_all mode", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" })
    ];
    const { result } = renderHook(() => useMapReview(reviewZones, vi.fn()));

    act(() => {
      result.current.handleZoneSelect("a");
    });

    expect(result.current.foundQuestionIds).toEqual([]);
  });

  it("click_prompt resolves the asked zone by clicking the map", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt"
      })
    );
    const targetCode = result.current.promptCode;

    act(() => {
      result.current.handleZoneSelect(targetCode);
    });

    expect(result.current.foundQuestionIds).toHaveLength(1);
  });

  it("click_prompt wrong clicks flash the clicked zone and miss the target", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

    try {
      const reviewZones = [
        zone({ questionId: 1, code: "a", label: "Alpha" }),
        zone({ questionId: 2, code: "b", label: "Beta" })
      ];
      const { result } = renderHook(() =>
        useMapReview(reviewZones, vi.fn(), vi.fn(), {
          mode: "click_prompt"
        })
      );

      expect(result.current.promptCode).toBe("a");

      act(() => {
        result.current.handleZoneSelect("b");
      });

      expect(result.current.flashCodes).toEqual(["b"]);
      expect(result.current.activeMissedCodes).toEqual(["a"]);
      expect(result.current.foundQuestionIds).toEqual([]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("click_prompt ignores clicks on already found zones", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt"
      })
    );
    const foundTarget = result.current.currentPromptItem;

    act(() => {
      result.current.handleZoneSelect(foundTarget.code);
    });

    const nextTarget = result.current.currentPromptItem;

    act(() => {
      result.current.handleZoneSelect(foundTarget.code);
    });

    expect(result.current.foundQuestionIds).toEqual([foundTarget.question_id]);
    expect(result.current.currentPromptItem.question_id).toBe(nextTarget.question_id);
    expect(result.current.showRecap).toBe(false);
  });

  it("click_prompt ignores clicks on already missed zones", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt"
      })
    );
    const missedTarget = result.current.currentPromptItem;

    act(() => {
      result.current.skipCurrentPrompt();
    });

    const nextTarget = result.current.currentPromptItem;

    act(() => {
      result.current.handleZoneSelect(missedTarget.code);
    });

    expect(result.current.activeMissedCodes).toEqual([missedTarget.code]);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.currentPromptItem.question_id).toBe(nextTarget.question_id);
    expect(result.current.showRecap).toBe(false);
  });

  it("click_prompt ignores clicks outside active review zones", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "click_prompt"
      })
    );
    const initialPrompt = result.current.currentPromptItem;

    act(() => {
      result.current.handleZoneSelect("grey");
    });

    expect(result.current.activeMissedCodes).toEqual([]);
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.currentPromptItem.question_id).toBe(
      initialPrompt.question_id
    );
    expect(result.current.showRecap).toBe(false);
  });

  it("type_prompt accepts the highlighted zone name and supports skip", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "type_prompt"
      })
    );
    const firstLabel = result.current.promptLabel;

    act(() => {
      result.current.setInput(firstLabel);
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.skipCurrentPrompt();
    });

    expect(result.current.showRecap).toBe(true);
    expect(Object.values(result.current.qualityByQuestionId).sort()).toEqual([0, 2]);
  });

  it("type_prompt skip makes the skipped zone active missed", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "type_prompt"
      })
    );
    const skippedCode = result.current.promptCode;

    act(() => {
      result.current.skipCurrentPrompt();
    });

    expect(result.current.activeMissedCodes).toEqual([skippedCode]);
    expect(result.current.foundQuestionIds).toEqual([]);
  });

  it("multiple_choice resolves a target from answer buttons", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "multiple_choice",
        contextItems: reviewZones
      })
    );
    const target = result.current.currentPromptItem;

    act(() => {
      result.current.handleChoiceSelect(target.question_id);
    });

    expect(result.current.foundQuestionIds).toEqual([target.question_id]);
  });

  it("multiple_choice uses borrowed context and submits only active zones", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha", difficulty: 1 })
    ];
    const contextItems = [
      ...reviewZones,
      zone({ questionId: 2, code: "b", label: "Beta", difficulty: 10 }),
      zone({ questionId: 3, code: "c", label: "Gamma", difficulty: 4 }),
      zone({ questionId: 4, code: "d", label: "Delta", difficulty: 8 }),
      zone({ questionId: 5, code: "e", label: "Epsilon", difficulty: 9 })
    ];
    try {
      const { result } = renderHook(() =>
        useMapReview(reviewZones, onComplete, submitAnswer, {
          mode: "multiple_choice",
          contextItems
        })
      );
      const target = result.current.currentPromptItem;

      expect(result.current.choiceOptions).toHaveLength(4);
      expect(
        result.current.choiceOptions
          .map(item => item.question_id)
          .sort((a, b) => a - b)
      ).toEqual([1, 2, 4, 5]);

      act(() => {
        result.current.handleChoiceSelect(target.question_id);
      });
      act(() => {
        result.current.finishMap();
      });

      await act(async () => {
        await result.current.sendResult();
      });

      expect(submitAnswer).toHaveBeenCalledWith({
        [target.question_id]: 2
      }, "multiple_choice", 5);
      expect(onComplete).toHaveBeenCalledWith([]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("multiple_choice can sample easier distractors from a larger pool", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha", difficulty: 1 })
    ];
    const contextItems = [
      ...reviewZones,
      zone({ questionId: 2, code: "b", label: "Beta", difficulty: 10 }),
      zone({ questionId: 3, code: "c", label: "Gamma", difficulty: 4 }),
      zone({ questionId: 4, code: "d", label: "Delta", difficulty: 8 }),
      zone({ questionId: 5, code: "e", label: "Epsilon", difficulty: 9 })
    ];

    try {
      const { result } = renderHook(() =>
        useMapReview(reviewZones, vi.fn(), vi.fn(), {
          mode: "multiple_choice",
          contextItems
        })
      );

      expect(
        result.current.choiceOptions
          .map(item => item.question_id)
          .sort((a, b) => a - b)
      ).toEqual([1, 3, 4, 5]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("multiple_choice wrong answers keep target visible as missed feedback", () => {
    const reviewZones = [
      zone({ questionId: 1, code: "a", label: "Alpha" }),
      zone({ questionId: 2, code: "b", label: "Beta" })
    ];
    const { result } = renderHook(() =>
      useMapReview(reviewZones, vi.fn(), vi.fn(), {
        mode: "multiple_choice",
        contextItems: reviewZones
      })
    );
    const target = result.current.currentPromptItem;
    const wrong = reviewZones.find(item => item.question_id !== target.question_id);

    act(() => {
      result.current.handleChoiceSelect(wrong.question_id);
    });

    expect(result.current.choiceFeedback).toMatchObject({
      correctCode: target.code,
      correctQuestionId: target.question_id,
      isCorrect: false,
      selectedQuestionId: wrong.question_id
    });
    expect(result.current.activeMissedCodes).toEqual([target.code]);
    expect(result.current.dueCodes).toEqual([target.code]);
  });
});
