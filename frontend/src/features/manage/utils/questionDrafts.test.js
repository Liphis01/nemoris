import { describe, expect, it } from "vitest";
import { buildQuestionSavePayload } from "./questionDrafts";

describe("questionDrafts", () => {
  it("preserves text question data such as favorites", () => {
    expect(buildQuestionSavePayload({
      question: "Prompt",
      answer: "Answer",
      media: null,
      type_q: "text",
      tags: [],
      data: { favorite: true }
    })).toMatchObject({
      type_q: "text",
      data: { favorite: true }
    });
  });

  it("preserves timeline metadata alongside favorites", () => {
    expect(buildQuestionSavePayload({
      question: "Event",
      answer: "1969",
      media: null,
      type_q: "timeline",
      tags: [],
      data: {
        favorite: true,
        timeline: {
          kind: "point",
          start: {
            year: 1969,
            precision: "year"
          }
        }
      }
    })).toMatchObject({
      type_q: "timeline",
      data: {
        favorite: true,
        timeline: {
          kind: "point",
          start: {
            year: 1969,
            precision: "year"
          }
        }
      }
    });
  });
});
