import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  defaultImageSuccessQuality,
  matchesImageAnswer,
  normalizeImageAnswer,
  useImageReview
} from "./useImageReview";
import { sendImageAnswer } from "../../../api/review";

vi.mock("../../../api/review", () => ({
  sendImageAnswer: vi.fn()
}));

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
    const { result } = renderHook(() => useImageReview(items, vi.fn()));
    const initialOrder = result.current.gridItems.map(row => row.item.question_id);

    act(() => {
      result.current.setInput("wrong");
    });

    expect(result.current.gridItems.map(row => row.item.question_id)).toEqual(
      initialOrder
    );
  });

  it("marks correct answers as quality 2 and advances to another unfinished image", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() => useImageReview(items, vi.fn()));
    const first = result.current.activeItem;

    act(() => {
      result.current.setInput("wrong");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput(first.answer);
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.foundQuestionIds).toContain(first.question_id);
    expect(result.current.qualityByQuestionId[first.question_id]).toBe(2);
    expect(result.current.activeItem.question_id).not.toBe(first.question_id);
    expect(result.current.resultMode).toBe(false);
  });

  it("selects an unfinished image by click and clears the shared input", () => {
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany"),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() => useImageReview(items, vi.fn()));
    const target = result.current.gridItems.find(row =>
      row.item.question_id !== result.current.activeQuestionId
    );

    act(() => {
      result.current.setInput("draft");
    });
    act(() => {
      result.current.selectItem(target.item.question_id);
    });

    expect(result.current.activeQuestionId).toBe(target.item.question_id);
    expect(result.current.input).toBe("");
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

    expect(sendImageAnswer).toHaveBeenCalledWith({
      [found.question_id]: 3,
      [missedIds[0]]: 0,
      [missedIds[1]]: 0
    });
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
});
