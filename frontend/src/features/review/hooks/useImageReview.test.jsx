import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultImageSuccessQuality,
  matchesImageAnswer,
  normalizeImageAnswer,
  useImageReview
} from "./useImageReview";
import { sendImageAnswer } from "../../../api/review";
import {
  IMAGE_MODE_CLICK_PROMPT,
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT
} from "../imageModes";

vi.mock("../../../api/review", () => ({
  sendImageAnswer: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
});

function imageItem(questionId, answer, aliases = [], difficulty = 5) {
  return {
    question_id: questionId,
    answer,
    label: answer,
    aliases,
    media: `/static/${answer}.png`,
    progress: {
      difficulty
    }
  };
}

function answerActive(result) {
  const active = result.current.activeItem;

  act(() => {
    result.current.setInput(active.answer);
  });
  act(() => {
    result.current.handleSubmit();
  });

  return active;
}

describe("image review helpers", () => {
  it("normalizes case, accents, spaces, and hyphens", () => {
    expect(normalizeImageAnswer(" Côte-d Ivoire ")).toBe("cote d ivoire");
    expect(matchesImageAnswer(
      imageItem(1, "Côte d'Ivoire", ["Ivory-Coast"]),
      "ivory coast"
    )).toBe(true);
  });

  it("always defaults successful answers to quality 2", () => {
    expect(defaultImageSuccessQuality()).toBe(2);
    expect(defaultImageSuccessQuality(99)).toBe(2);
  });
});

describe("useImageReview", () => {
  it("keeps one stable shuffled grid order during the review screen", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );
    const initialOrder = result.current.gridItems.map(row => row.item.question_id);

    act(() => {
      result.current.setInput("wrong");
    });

    expect(result.current.gridItems.map(row => row.item.question_id)).toEqual(
      initialOrder
    );
  });

  it("type_all marks typed answers as quality 2 without selecting an image", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );

    expect(result.current.activeItem).toBeNull();
    expect(result.current.activeQuestionId).toBeNull();
    expect(result.current.gridItems.every(row => !row.isActive)).toBe(true);

    act(() => {
      result.current.setInput("wrong");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("Germany");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.foundQuestionIds).toContain(2);
    expect(result.current.qualityByQuestionId[2]).toBe(2);
    expect(result.current.activeItem).toBeNull();
    expect(result.current.activeQuestionId).toBeNull();
    expect(result.current.gridItems.every(row => !row.isActive)).toBe(true);
    expect(result.current.resultMode).toBe(false);
  });

  it("type_all ignores image selection and keeps the shared input", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );
    const target = result.current.gridItems[0];

    act(() => {
      result.current.setInput("draft");
    });
    act(() => {
      result.current.selectItem(target.item.question_id);
    });

    act(() => {
      result.current.selectNextItem();
    });

    expect(result.current.activeItem).toBeNull();
    expect(result.current.activeQuestionId).toBeNull();
    expect(result.current.input).toBe("draft");
    expect(result.current.gridItems.every(row => !row.isActive)).toBe(true);
  });

  it("finishes on the same grid with recap qualities editable", async () => {
    sendImageAnswer.mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() => useImageReview(items, onComplete));
    const found = answerActive(result);

    act(() => {
      result.current.finishReview();
    });

    const missedIds = items
      .map(item => item.question_id)
      .filter(id => id !== found.question_id);

    expect(result.current.resultMode).toBe(true);
    expect(result.current.lockedMissedQuestionIds.sort()).toEqual(
      [...missedIds].sort()
    );
    expect(result.current.qualityByQuestionId[found.question_id]).toBe(2);
    missedIds.forEach(id => {
      expect(result.current.qualityByQuestionId[id]).toBe(0);
    });

    act(() => {
      result.current.setQuality(found.question_id, 0);
    });
    expect(result.current.qualityByQuestionId[found.question_id]).toBe(0);

    act(() => {
      result.current.setQuality(found.question_id, 3);
    });
    expect(result.current.qualityByQuestionId[found.question_id]).toBe(3);

    act(() => {
      result.current.setQuality(missedIds[0], 2);
    });
    expect(result.current.qualityByQuestionId[missedIds[0]]).toBe(2);

    await act(async () => {
      await result.current.sendResult();
    });

    expect(sendImageAnswer).toHaveBeenCalledWith(
      {
        [found.question_id]: 3,
        [missedIds[0]]: 2,
        [missedIds[1]]: 0
      },
      IMAGE_MODE_TYPE_PROMPT,
      3
    );
    expect(onComplete).toHaveBeenCalledWith([missedIds[1]]);
  });

  it("enters result mode automatically when all images are found", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() => useImageReview(items, vi.fn()));

    answerActive(result);
    answerActive(result);

    expect(result.current.resultMode).toBe(true);
    expect(result.current.lockedMissedQuestionIds).toEqual([]);
    expect(Object.values(result.current.qualityByQuestionId)).toEqual([2, 2]);
  });

  it("uses an injected submit callback instead of the scheduled answer API", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, onComplete, submitAnswer)
    );
    const found = answerActive(result);
    const missed = items.find(item => item.question_id !== found.question_id);

    act(() => {
      result.current.finishReview();
    });

    await act(async () => {
      await result.current.sendResult();
    });

    expect(submitAnswer).toHaveBeenCalledWith(
      {
        [found.question_id]: 2,
        [missed.question_id]: 0
      },
      IMAGE_MODE_TYPE_PROMPT,
      2
    );
    expect(sendImageAnswer).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith([missed.question_id]);
  });

  it("type_all accepts remaining image answers in any order", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );

    act(() => {
      result.current.setInput("Spain");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("France");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.foundQuestionIds).toEqual([3, 1]);
    expect(result.current.activeQuestionId).toBeNull();
  });

  it("type_prompt keeps the review item order for grid and prompts", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const items = [
        imageItem(1, "France"),
        imageItem(2, "Germany"),
        imageItem(3, "Spain"),
        imageItem(4, "Italy")
      ];
      const { result } = renderHook(() =>
        useImageReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_TYPE_PROMPT
        })
      );

      expect(result.current.gridItems.map(row => row.item.question_id)).toEqual([
        1,
        2,
        3,
        4
      ]);
      expect(result.current.currentPromptItem.question_id).toBe(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("type_prompt manual selection changes the active image without grading", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_PROMPT
      })
    );

    act(() => {
      result.current.setInput("draft");
    });
    act(() => {
      result.current.selectItem(3);
    });

    expect(result.current.currentPromptItem.question_id).toBe(3);
    expect(result.current.input).toBe("");
    expect(result.current.foundQuestionIds).toEqual([]);
    expect(result.current.resolvedQuestionIds).toEqual([]);
    expect(result.current.qualityByQuestionId).toEqual({});
  });

  it("type_prompt next selection wraps and skips resolved images", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_PROMPT
      })
    );

    act(() => {
      result.current.selectItem(2);
    });
    act(() => {
      result.current.setInput("Germany");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.resolvedQuestionIds).toEqual([2]);
    expect(result.current.currentPromptItem.question_id).toBe(3);

    act(() => {
      result.current.selectNextItem(-1);
    });

    expect(result.current.currentPromptItem.question_id).toBe(1);

    act(() => {
      result.current.selectNextItem(1);
    });

    expect(result.current.currentPromptItem.question_id).toBe(3);

    act(() => {
      result.current.selectNextItem(1);
    });

    expect(result.current.currentPromptItem.question_id).toBe(1);
  });

  it("type_prompt answers and passes advance from the current image position", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_TYPE_PROMPT
      })
    );

    act(() => {
      result.current.selectItem(3);
    });
    act(() => {
      result.current.setInput("Spain");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.foundQuestionIds).toEqual([3]);
    expect(result.current.resolvedQuestionIds).toEqual([3]);
    expect(result.current.resolvedQuestionIdsRecentFirst).toEqual([3]);
    expect(result.current.currentPromptItem.question_id).toBe(4);

    act(() => {
      result.current.skipCurrentPrompt();
    });

    expect(result.current.foundQuestionIds).toEqual([3]);
    expect(result.current.resolvedQuestionIds).toEqual([3]);
    expect(result.current.resolvedQuestionIdsRecentFirst).toEqual([3]);
    expect(result.current.currentPromptItem.question_id).toBe(1);
  });

  it("type_prompt pass selects the next image without revealing or grading", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_PROMPT })
    );
    const skipped = result.current.currentPromptItem;

    act(() => {
      result.current.skipCurrentPrompt();
    });

    expect(result.current.resolvedQuestionIds).not.toContain(skipped.question_id);
    expect(result.current.foundQuestionIds).not.toContain(skipped.question_id);
    expect(result.current.revealedQuestionIds).not.toContain(skipped.question_id);
    expect(result.current.gridItems.find(row =>
      row.item.question_id === skipped.question_id
    )).toMatchObject({
      isMissed: false,
      isRevealed: false
    });
    expect(result.current.currentPromptItem.question_id).not.toBe(
      skipped.question_id
    );
  });

  it("click_prompt resolves correct and wrong image clicks", () => {
    vi.useFakeTimers();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];

    try {
      const { result } = renderHook(() =>
        useImageReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_CLICK_PROMPT
        })
      );
      const prompt = result.current.currentPromptItem;
      const wrong = items.find(item => item.question_id !== prompt.question_id);

      act(() => {
        result.current.handleImageSelect(wrong.question_id);
      });

      expect(result.current.resolvedQuestionIds).toContain(prompt.question_id);
      expect(result.current.resolvedQuestionIdsRecentFirst).toEqual([
        prompt.question_id
      ]);
      expect(result.current.resolvedQuestionIdsRecentFirst).not.toContain(
        wrong.question_id
      );
      expect(result.current.foundQuestionIds).not.toContain(prompt.question_id);
      expect(result.current.interactionFeedback).toMatchObject({
        correctQuestionId: prompt.question_id,
        isCorrect: false,
        selectedQuestionId: wrong.question_id
      });
      expect(result.current.gridItems.find(row =>
        row.item.question_id === prompt.question_id
      )).toMatchObject({
        feedbackState: "missed",
        isMissed: true,
        isRevealed: true
      });
      expect(result.current.gridItems.find(row =>
        row.item.question_id === wrong.question_id
      )).toMatchObject({
        feedbackState: "wrong",
        isMissed: false,
        isRevealed: false
      });

      const nextPrompt = result.current.currentPromptItem;

      expect(nextPrompt.question_id).not.toBe(prompt.question_id);
      expect(result.current.promptLabel).toBe(nextPrompt.label);

      act(() => {
        result.current.handleImageSelect(nextPrompt.question_id);
      });

      expect(result.current.foundQuestionIds).toContain(nextPrompt.question_id);
      expect(result.current.interactionFeedback).toMatchObject({
        correctQuestionId: nextPrompt.question_id,
        isCorrect: true,
        selectedQuestionId: nextPrompt.question_id
      });

      act(() => {
        vi.advanceTimersByTime(1300);
      });

      expect(result.current.resultMode).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("multiple_choice_label chooses from labels for the target image", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        contextItems: items
      })
    );
    const prompt = result.current.currentPromptItem;

    expect(result.current.choiceOptions).toHaveLength(4);
    expect(result.current.choiceOptions.map(item => item.question_id)).toContain(
      prompt.question_id
    );

    act(() => {
      result.current.handleChoiceSelect(prompt.question_id);
    });

    expect(result.current.foundQuestionIds).toContain(prompt.question_id);
  });

  it("multiple_choice_label uses borrowed context and submits only active items", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const submitAnswer = vi.fn().mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [
      imageItem(1, "France", [], 1)
    ];
    const contextItems = [
      ...items,
      imageItem(2, "Germany", [], 10),
      imageItem(3, "Spain", [], 4),
      imageItem(4, "Italy", [], 8),
      imageItem(5, "Portugal", [], 9)
    ];
    try {
      const { result } = renderHook(() =>
        useImageReview(items, onComplete, submitAnswer, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
          contextItems
        })
      );
      const prompt = result.current.currentPromptItem;

      expect(result.current.choiceOptions).toHaveLength(4);
      expect(
        result.current.choiceOptions
          .map(item => item.question_id)
          .sort((a, b) => a - b)
      ).toEqual([1, 2, 4, 5]);

      act(() => {
        result.current.handleChoiceSelect(prompt.question_id);
      });
      act(() => {
        result.current.finishReview();
      });

      await act(async () => {
        await result.current.sendResult();
      });

      expect(submitAnswer).toHaveBeenCalledWith(
        {
          [prompt.question_id]: 2
        },
        IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        5
      );
      expect(onComplete).toHaveBeenCalledWith([]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("multiple_choice_label can sample easier distractors from a larger pool", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const items = [
      imageItem(1, "France", [], 1)
    ];
    const contextItems = [
      ...items,
      imageItem(2, "Germany", [], 10),
      imageItem(3, "Spain", [], 4),
      imageItem(4, "Italy", [], 8),
      imageItem(5, "Portugal", [], 9)
    ];

    try {
      const { result } = renderHook(() =>
        useImageReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
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

  it("multiple_choice_label wrong answers reveal the target during feedback", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        contextItems: items
      })
    );
    const prompt = result.current.currentPromptItem;
    const wrong = result.current.choiceOptions.find(option =>
      option.question_id !== prompt.question_id
    );

    act(() => {
      result.current.handleChoiceSelect(wrong.question_id);
    });

    expect(result.current.interactionFeedback).toMatchObject({
      correctQuestionId: prompt.question_id,
      isCorrect: false,
      selectedQuestionId: wrong.question_id
    });
    expect(result.current.activeQuestionId).toBe(prompt.question_id);
    expect(result.current.gridItems.find(row =>
      row.item.question_id === prompt.question_id
    )).toMatchObject({
      feedbackState: "missed",
      isMissed: true,
      isRevealed: true
    });
  });

  it("multiple_choice_label follows the visible image grid order", () => {
    const randomSpy = vi.spyOn(Math, "random");

    randomSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(0.99);

    try {
      const items = [
        imageItem(1, "France"),
        imageItem(2, "Germany"),
        imageItem(3, "Spain"),
        imageItem(4, "Italy")
      ];
      const { result } = renderHook(() =>
        useImageReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
          contextItems: items
        })
      );
      const gridOrder = result.current.gridItems.map(row => row.item.question_id);

      expect(result.current.currentPromptItem.question_id).toBe(gridOrder[0]);

      act(() => {
        result.current.handleChoiceSelect(gridOrder[0]);
      });

      expect(result.current.currentPromptItem.question_id).toBe(gridOrder[1]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("multiple_choice_image shows image choices and resolves by clicked image", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
        contextItems: items
      })
    );
    const prompt = result.current.currentPromptItem;

    expect(result.current.gridItems).toHaveLength(4);
    expect(result.current.gridItems.map(row => row.item.question_id)).toContain(
      prompt.question_id
    );

    act(() => {
      result.current.handleImageSelect(prompt.question_id);
    });

    expect(result.current.foundQuestionIds).toContain(prompt.question_id);
  });

  it("multiple_choice_image wrong answers reveal the target and clicked image during feedback", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain"),
      imageItem(4, "Italy")
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, {
        mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
        contextItems: items
      })
    );
    const prompt = result.current.currentPromptItem;
    const wrong = result.current.gridItems.find(row =>
      row.item.question_id !== prompt.question_id
    ).item;

    act(() => {
      result.current.handleImageSelect(wrong.question_id);
    });

    expect(result.current.interactionFeedback).toMatchObject({
      correctQuestionId: prompt.question_id,
      isCorrect: false,
      selectedQuestionId: wrong.question_id
    });
    expect(result.current.gridItems.find(row =>
      row.item.question_id === prompt.question_id
    )).toMatchObject({
      feedbackState: "missed",
      isMissed: true,
      isRevealed: true
    });
    expect(result.current.gridItems.find(row =>
      row.item.question_id === wrong.question_id
    )).toMatchObject({
      feedbackState: "wrong",
      isMissed: false,
      isRevealed: true
    });
  });

  it("multiple_choice_image keeps previously answered distractors visually neutral", () => {
    vi.useFakeTimers();

    try {
      const items = [
        imageItem(1, "France"),
        imageItem(2, "Germany"),
        imageItem(3, "Spain"),
        imageItem(4, "Italy")
      ];
      const { result } = renderHook(() =>
        useImageReview(items, vi.fn(), undefined, {
          mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
          contextItems: items
        })
      );
      const firstPrompt = result.current.currentPromptItem;

      act(() => {
        result.current.handleImageSelect(firstPrompt.question_id);
      });
      act(() => {
        vi.advanceTimersByTime(1300);
      });

      const previousAnswerAsDistractor = result.current.gridItems.find(row =>
        row.item.question_id === firstPrompt.question_id
      );

      expect(previousAnswerAsDistractor).toMatchObject({
        feedbackState: "",
        isFound: false,
        isMissed: false,
        isRevealed: false
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bulk-updates found image qualities while missed images stay locked at zero", () => {
    const items = [
      {
        ...imageItem(1, "France"),
        projected_intervals: { 1: 4, 2: 12, 3: 30 }
      },
      {
        ...imageItem(2, "Germany"),
        projected_intervals: { 1: 6, 2: 18, 3: 45 }
      },
      {
        ...imageItem(3, "Spain"),
        projected_intervals: { 0: 0, 1: 3, 2: 9, 3: 24 }
      }
    ];
    const { result } = renderHook(() => useImageReview(items, vi.fn()));
    const found = answerActive(result);

    act(() => {
      result.current.finishReview();
    });
    act(() => {
      result.current.setFoundImageQualities(3);
    });

    expect(result.current.qualityByQuestionId[found.question_id]).toBe(3);
    items
      .filter(item => item.question_id !== found.question_id)
      .forEach(item => {
        expect(result.current.qualityByQuestionId[item.question_id]).toBe(0);
      });
    expect(result.current.foundBulkQuality).toBe(3);
    expect(result.current.recapRows.find(row =>
      row.item.question_id === found.question_id
    ).projectedInterval).toBe(found.projected_intervals[3]);
  });

  it("sorts image recap rows by the interval for the currently selected quality", () => {
    const items = [
      {
        ...imageItem(1, "Alpha"),
        progress: { difficulty: 8, interval: 20 },
        projected_intervals: { 1: 5, 2: 20, 3: 80 }
      },
      {
        ...imageItem(2, "Beta"),
        progress: { difficulty: 6, interval: 40 },
        projected_intervals: { 1: 10, 2: 40, 3: 60 }
      },
      {
        ...imageItem(3, "Gamma"),
        progress: { difficulty: 4, interval: 0 },
        projected_intervals: { 0: 0, 1: 2, 2: 8, 3: 16 }
      }
    ];
    const { result } = renderHook(() =>
      useImageReview(items, vi.fn(), undefined, { mode: IMAGE_MODE_TYPE_ALL })
    );

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
      result.current.finishReview();
    });
    act(() => {
      result.current.toggleRecapSort("interval");
    });

    expect(result.current.recapRows.map(row => row.item.answer)).toEqual([
      "Alpha",
      "Beta",
      "Gamma"
    ]);

    act(() => {
      result.current.setQuality(1, 3);
    });

    expect(result.current.recapRows.map(row => row.item.answer)).toEqual([
      "Beta",
      "Alpha",
      "Gamma"
    ]);
  });
});
