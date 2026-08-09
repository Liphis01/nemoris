import { describe, expect, it } from "vitest";
import {
  ANSWER_POLICY_EXACT,
  ANSWER_POLICY_GOLDEN_VECTORS,
  ANSWER_POLICY_RELAXED,
  matchesAnswerValue,
  normalizeAnswerText
} from "./answerPolicy";

describe("answerPolicy", () => {
  it("matches the shared golden vectors", () => {
    ANSWER_POLICY_GOLDEN_VECTORS.forEach(vector => {
      expect(
        normalizeAnswerText(vector.left, vector.policy) ===
        normalizeAnswerText(vector.right, vector.policy)
      ).toBe(vector.matches);
    });
  });

  it("uses relaxed matching by default", () => {
    expect(
      matchesAnswerValue(
        { answer: "Paris", aliases: ["Ville-Lumière"] },
        "ville-lumiere"
      )
    ).toBe(true);
  });

  it("keeps exact spelling strict", () => {
    expect(
      matchesAnswerValue(
        { answer: "État", answer_policy: ANSWER_POLICY_EXACT },
        "etat"
      )
    ).toBe(false);
  });

  it("keeps current relaxed punctuation behavior conservative", () => {
    expect(normalizeAnswerText(" Côte-d Ivoire ", ANSWER_POLICY_RELAXED))
      .toBe("cote d ivoire");
    expect(normalizeAnswerText("Côte d'Ivoire", ANSWER_POLICY_RELAXED))
      .toBe("cote d'ivoire");
  });
});
