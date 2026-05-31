import { describe, expect, it } from "vitest";
import {
  formatTimelineAnswer,
  parseTimelineInput,
  timelineIndexToYear,
  yearToTimelineIndex
} from "./timelineUtils";

describe("timelineUtils", () => {
  it("parses BC year input without creating year zero", () => {
    const result = parseTimelineInput("44 av. J.-C.");

    expect(result.error).toBe("");
    expect(result.timeline).toMatchObject({
      kind: "point",
      start: {
        year: -44,
        month: null,
        day: null,
        precision: "year"
      }
    });
    expect(formatTimelineAnswer(result.timeline)).toBe("44 av. J.-C.");
  });

  it("rejects year zero", () => {
    const result = parseTimelineInput("0");

    expect(result.timeline).toBeNull();
    expect(result.error).toBe("Format de date invalide");
  });

  it("keeps timeline year indexes reversible across the BC/AD boundary", () => {
    expect(yearToTimelineIndex(-1)).toBe(0);
    expect(timelineIndexToYear(0)).toBe(-1);
    expect(yearToTimelineIndex(1)).toBe(1);
    expect(timelineIndexToYear(1)).toBe(1);
  });

  it("parses intervals and coerces both ends to the finest precision", () => {
    const result = parseTimelineInput("06/1944 - 25/08/1944");

    expect(result.error).toBe("");
    expect(result.timeline).toMatchObject({
      kind: "interval",
      start: {
        year: 1944,
        month: 6,
        day: 1,
        precision: "day"
      },
      end: {
        year: 1944,
        month: 8,
        day: 25,
        precision: "day"
      }
    });
  });
});
