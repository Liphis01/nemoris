import { describe, expect, it } from "vitest";
import {
  buildSessionDebrief,
  createReviewResultRecords,
  formatIntervalChange,
  formatQualityLabel
} from "./sessionDebrief";

describe("sessionDebrief", () => {
  it("builds a traceable summary from grouped atomic answer rows", () => {
    const presentation = {
      group_id: 10,
      name: "Europe",
      presentation_kind: "map_group",
      type_q: "map",
      context_items: [
        { question_id: 1, label: "France" },
        { question_id: 2, label: "Germany" },
        { question_id: 3, label: "Spain" }
      ],
      items: [
        {
          question_id: 1,
          label: "France",
          progress: { interval: 3, history: [] }
        },
        {
          question_id: 2,
          label: "Germany",
          progress: {
            interval: 5,
            history: [{ quality: 0, reviewed_on: "2026-08-01" }]
          }
        }
      ]
    };
    const response = {
      status: "ok",
      items: [
        {
          question_id: 1,
          quality: 2,
          effective_quality: 2,
          progress: {
            interval: 8,
            next_review: "2026-08-22",
            history: [{ quality: 2, interval: 8, next_review: "2026-08-22" }]
          }
        },
        {
          question_id: 2,
          quality: 0,
          effective_quality: 0,
          backend_matched: false,
          progress: {
            interval: 0,
            next_review: "2026-08-15",
            history: [
              {
                quality: 0,
                interval: 0,
                next_review: "2026-08-15",
                answer_event: {
                  expected_card_id: 2,
                  resolved_response_id: 3,
                  context: { backend_matched: false }
                }
              }
            ]
          }
        }
      ]
    };

    const records = createReviewResultRecords({
      attemptKey: "group:0",
      presentation,
      response,
      submittedQualities: { 1: 2, 2: 0 },
      reviewDate: "2026-08-14"
    });
    const summary = buildSessionDebrief({
      records,
      reviewDate: "2026-08-14"
    });

    expect(summary.completedCount).toBe(2);
    expect(summary.successCount).toBe(1);
    expect(summary.missCount).toBe(1);
    expect(summary.recurringMisses).toHaveLength(1);
    expect(summary.newMisses).toHaveLength(0);
    expect(summary.tomorrowCount).toBe(1);
    expect(summary.confusions).toEqual([
      expect.objectContaining({
        expected: "Germany",
        selected: "Spain"
      })
    ]);
    expect(summary.typeStats[0]).toMatchObject({
      label: "Carte",
      success: 1,
      miss: 1
    });
    expect(summary.groupStats[0]).toMatchObject({
      label: "Europe",
      total: 2
    });
    expect(formatQualityLabel(records[1])).toBe("Faux");
    expect(formatIntervalChange(records[0])).toBe("3 j -> 8 j");
  });

  it("recommends a calm exit when nothing was due", () => {
    const summary = buildSessionDebrief({
      records: [],
      reviewDate: "2026-08-14"
    });

    expect(summary.completedCount).toBe(0);
    expect(summary.recommendation).toMatchObject({
      label: "Retour au menu",
      mode: "menu"
    });
  });
});
