import { describe, expect, it } from "vitest";
import {
  formatTimelineAnswer,
  formatTypedDate,
  gradeTimelineGuess,
  parseTimelineInput,
  timelineIndexToYear,
  yearToTimelineIndex
} from "./timelineUtils";

function point(year, precision = "year", month = null, day = null) {
  return { kind: "point", start: { year, month, day, precision } };
}

// These mirror the backend thresholds (year ±1, month ±2, day ±14) — if they
// drift from services/timeline.py, the reveal disagrees with what gets recorded.
describe("gradeTimelineGuess", () => {
  it("grades an exact year as Good", () => {
    expect(gradeTimelineGuess(point(1789), { start: { year: 1789, precision: "year" } }).quality).toBe(2);
  });

  it("grades a one-year miss as Hard and beyond the band as Again", () => {
    expect(gradeTimelineGuess(point(1789), { start: { year: 1790, precision: "year" } }).quality).toBe(1);
    expect(gradeTimelineGuess(point(1789), { start: { year: 1792, precision: "year" } }).quality).toBe(0);
  });

  it("uses a 14-day band at day precision", () => {
    const expected = point(1789, "day", 7, 14);

    expect(gradeTimelineGuess(expected, { start: { year: 1789, month: 7, day: 20, precision: "day" } }).quality).toBe(1);
    expect(gradeTimelineGuess(expected, { start: { year: 1789, month: 8, day: 14, precision: "day" } }).quality).toBe(0);
  });

  it("reports a signed-free distance and unit for the reveal", () => {
    const graded = gradeTimelineGuess(point(1789), { start: { year: 1795, precision: "year" } });

    expect(graded.start.distance).toBe(6);
    expect(graded.start.unit).toBe("years");
  });

  it("grades an interval as its worse endpoint", () => {
    const expected = {
      kind: "interval",
      start: { year: 1914, month: null, day: null, precision: "year" },
      end: { year: 1918, month: null, day: null, precision: "year" }
    };
    const guess = {
      start: { year: 1914, precision: "year" },
      end: { year: 1925, precision: "year" }
    };

    // Start exact (2), end far off (0) -> min is 0.
    expect(gradeTimelineGuess(expected, guess).quality).toBe(0);
  });
});

describe("formatTypedDate", () => {
  it("masks a day-precision entry as the digits arrive", () => {
    const typed = ["2", "20", "200", "2004", "20041", "200419", "2004195", "20041950"];
    const shown = typed.map(value => formatTypedDate(value, "day"));

    expect(shown).toEqual([
      "2", "20", "20/0", "20/04", "20/04/1", "20/04/19", "20/04/195", "20/04/1950"
    ]);
  });

  it("masks month and year precision to their own shapes", () => {
    expect(formatTypedDate("042004", "month")).toBe("04/2004");
    expect(formatTypedDate("1950", "year")).toBe("1950");
  });

  it("stays stable when backspacing a masked day date", () => {
    // Deleting a character re-derives the same mask rather than collapsing it.
    expect(formatTypedDate("20/04/195", "day")).toBe("20/04/195");
    expect(formatTypedDate("20/04/1", "day")).toBe("20/04/1");
  });

  it("without a precision, leaves a year bare and masks anything longer", () => {
    // A year in progress must not become "17/89".
    expect(formatTypedDate("1789")).toBe("1789");
    // Past four digits it cannot be a year: 20 is no month, so it reads as a day.
    expect(formatTypedDate("20041")).toBe("20/04/1");
    expect(formatTypedDate("200419")).toBe("20/04/19");
    expect(formatTypedDate("20041950")).toBe("20/04/1950");
    // A valid leading month with no more than MM/YYYY digits reads as a month.
    expect(formatTypedDate("04200")).toBe("04/200");
    expect(formatTypedDate("042004")).toBe("04/2004");
  });

  it("without a precision, collapses back to a year as digits are deleted", () => {
    expect(formatTypedDate("20/04/195")).toBe("20/04/195");
    expect(formatTypedDate("20/04/1")).toBe("20/04/1");
    expect(formatTypedDate("2004")).toBe("2004");
  });

  it("never rewrites an interval or an era suffix", () => {
    expect(formatTypedDate("1914-1918")).toBe("1914-1918");
    expect(formatTypedDate("44 av. J.-C.")).toBe("44 av. J.-C.");
    expect(formatTypedDate("1914-1918", "day")).toBe("1914-1918");
  });

  it("is idempotent on an already separated entry", () => {
    expect(formatTypedDate("04/2004")).toBe("04/2004");
    expect(formatTypedDate("20/04/1950")).toBe("20/04/1950");
    expect(formatTypedDate("20/04/1950", "day")).toBe("20/04/1950");
  });
});

describe("separator-free date entry", () => {
  it("reads an 8-digit run as a day date", () => {
    expect(parseTimelineInput("14071789").timeline).toMatchObject({
      kind: "point",
      start: { year: 1789, month: 7, day: 14, precision: "day" }
    });
  });

  it("reads a 6-digit run as a month date", () => {
    expect(parseTimelineInput("071789").timeline).toMatchObject({
      kind: "point",
      start: { year: 1789, month: 7, day: null, precision: "month" }
    });
  });

  it("accepts single-digit day and month without leading zeros", () => {
    expect(parseTimelineInput("6061944").timeline).toMatchObject({
      start: { year: 1944, month: 6, day: 6, precision: "day" }
    });
    expect(parseTimelineInput("61944").timeline).toMatchObject({
      start: { year: 1944, month: 6, precision: "month" }
    });
  });

  it("still treats a bare 1-4 digit number as a year", () => {
    expect(parseTimelineInput("1789").timeline).toMatchObject({
      start: { year: 1789, precision: "year" }
    });
  });

  it("honours the era on a separator-free date", () => {
    expect(parseTimelineInput("6061944 av. J.-C.").timeline).toMatchObject({
      start: { year: -1944, month: 6, day: 6, precision: "day" }
    });
  });

  it("rejects a separator-free run with an impossible month", () => {
    // 19 14 1918 -> month 14 is invalid; an interval still needs its dash.
    expect(parseTimelineInput("19141918").timeline).toBeNull();
    expect(parseTimelineInput("1914-1918").timeline).toMatchObject({ kind: "interval" });
  });
});

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
