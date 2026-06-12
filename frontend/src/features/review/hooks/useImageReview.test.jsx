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

function imageItem(questionId, answer, aliases = []) {
  return {
    question_id: questionId,
    answer,
    label: answer,
    aliases,
    media: `/static/${answer}.png`
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

  it("finishes on the same grid with found qualities editable and misses locked", async () => {
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
    expect(result.current.qualityByQuestionId[found.question_id]).toBe(2);

    act(() => {
      result.current.setQuality(found.question_id, 3);
    });
    expect(result.current.qualityByQuestionId[found.question_id]).toBe(3);

    act(() => {
      result.current.setQuality(missedIds[0], 2);
    });
    expect(result.current.qualityByQuestionId[missedIds[0]]).toBe(0);

    await act(async () => {
      await result.current.sendResult();
    });

    expect(sendImageAnswer).toHaveBeenCalledWith(
      {
        [found.question_id]: 3,
        [missedIds[0]]: 0,
        [missedIds[1]]: 0
      },
      IMAGE_MODE_TYPE_PROMPT
    );
    expect(onComplete).toHaveBeenCalledWith(expect.arrayContaining(missedIds));
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
      IMAGE_MODE_TYPE_PROMPT
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

  it("type_prompt skip marks the current image missed and advances", () => {
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

    expect(result.current.resolvedQuestionIds).toContain(skipped.question_id);
    expect(result.current.foundQuestionIds).not.toContain(skipped.question_id);
    expect(result.current.currentPromptItem.question_id).not.toBe(
      skipped.question_id
    );
  });

  it("click_prompt resolves correct and wrong image clicks", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany")
    ];
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
    expect(result.current.foundQuestionIds).not.toContain(prompt.question_id);

    const nextPrompt = result.current.currentPromptItem;

    act(() => {
      result.current.handleImageSelect(nextPrompt.question_id);
    });

    expect(result.current.foundQuestionIds).toContain(nextPrompt.question_id);
    expect(result.current.resultMode).toBe(true);
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
});
