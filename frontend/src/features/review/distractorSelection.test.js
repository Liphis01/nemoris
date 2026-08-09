import { describe, expect, it } from "vitest";
import {
  buildChoiceOptions,
  confusabilityScore,
  feedbackConfusability,
  isEligibleDistractor,
  mapProximityConfusability,
  stringConfusability
} from "./distractorSelection";

function item(id, answer, extra = {}) {
  return {
    question_id: id,
    answer,
    label: answer,
    progress: { difficulty: 5, history: [] },
    ...extra
  };
}

describe("distractor selection", () => {
  it("filters normalization-equivalent answers with the target policy", () => {
    const target = item(1, "État");
    const equivalent = item(2, "etat");

    expect(isEligibleDistractor(target, equivalent)).toBe(false);
    expect(isEligibleDistractor(
      { ...target, answer_policy: { preset: "exact" } },
      equivalent
    )).toBe(true);
  });

  it("ranks close French strings above unrelated labels", () => {
    const target = item(1, "Slovénie");

    expect(stringConfusability(target, item(2, "Slovaquie"))).toBeGreaterThan(
      stringConfusability(target, item(3, "Argentine"))
    );
  });

  it("uses unioned map geometry only when it is usable", () => {
    const target = item(1, "Nord", { code: "north" });
    const close = item(2, "Sud", { code: "south" });
    const far = item(3, "Est", { code: "east" });
    const geometry = {
      diagonal: 100,
      zones: {
        north: { centroid: { x: 0, y: 0 } },
        south: { centroid: { x: 10, y: 0 } },
        east: { centroid: { x: 90, y: 0 } }
      }
    };

    expect(mapProximityConfusability(target, close, geometry)).toBeGreaterThan(
      mapProximityConfusability(target, far, geometry)
    );
    expect(mapProximityConfusability(target, close, { zones: {} })).toBe(0);
  });

  it("uses only complete closed-choice events as exposure evidence", () => {
    const candidate = item(2, "B");
    const target = item(1, "A", {
      progress: {
        difficulty: 5,
        history: [
          {
            answer_event: {
              expected_card_id: 1,
              candidate_ids: [1, 2, 3],
              raw_response: 2
            }
          },
          {
            answer_event: {
              expected_card_id: 1,
              candidate_ids: [1, 3],
              raw_response: 3
            }
          },
          { answer_event: { expected_card_id: 1, raw_response: 2 } }
        ]
      }
    });

    expect(feedbackConfusability(target, candidate)).toMatchObject({
      exposures: 1,
      mispicks: 1
    });
    expect(confusabilityScore(target, candidate)).toBeGreaterThan(0);
  });

  it("keeps sampled options bounded and excludes invalid distractors", () => {
    const target = item(1, "France");
    const options = buildChoiceOptions(target, [
      target,
      item(2, "France"),
      item(3, "Italie"),
      item(4, "Espagne"),
      item(5, "Portugal"),
      item(6, "Belgique")
    ], new Map(), null, { random: () => 0 });

    expect(options).toHaveLength(4);
    expect(options.map(option => option.question_id)).not.toContain(2);
    expect(new Set(options.map(option => option.question_id)).size).toBe(4);
  });
});
