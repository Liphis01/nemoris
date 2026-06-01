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

describe("image review helpers", () => {
  it("normalizes case, accents, spaces, and hyphens", () => {
    expect(normalizeImageAnswer(" Côte-d Ivoire ")).toBe("cote d ivoire");
    expect(matchesImageAnswer(
      imageItem(1, "Côte d'Ivoire", ["Ivory-Coast"]),
      "ivory coast"
    )).toBe(true);
  });

  it("defaults successful qualities based on wrong attempts", () => {
    expect(defaultImageSuccessQuality(0)).toBe(2);
    expect(defaultImageSuccessQuality(1)).toBe(1);
  });
});

describe("useImageReview", () => {
  it("grades first-try, corrected, and skipped images before submit", async () => {
    sendImageAnswer.mockResolvedValue({});
    const onComplete = vi.fn();
    const items = [
      imageItem(1, "France"),
      imageItem(2, "Germany", ["Deutschland"]),
      imageItem(3, "Spain")
    ];
    const { result } = renderHook(() => useImageReview(items, onComplete));

    act(() => {
      result.current.setInput("France");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.qualityByQuestionId[1]).toBe(2);

    act(() => {
      result.current.setInput("wrong");
    });
    act(() => {
      result.current.handleSubmit();
    });
    act(() => {
      result.current.setInput("deutschland");
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.qualityByQuestionId[2]).toBe(1);

    act(() => {
      result.current.skipItem();
    });

    expect(result.current.showRecap).toBe(true);
    expect(result.current.recapRows.map(row => row.quality)).toEqual([2, 1, 0]);

    await act(async () => {
      await result.current.sendResult();
    });

    expect(sendImageAnswer).toHaveBeenCalledWith({
      1: 2,
      2: 1,
      3: 0
    });
    expect(onComplete).toHaveBeenCalledWith([3]);
  });
});
