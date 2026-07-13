import { describe, expect, it } from "vitest";
import {
  buildYearTicks,
  clampSlice,
  followSlice,
  minYearRailSpan,
  percentForYear,
  sliceToOrdinalRange,
  yearBoundsFromRange,
  yearFromPercent,
  zoomSliceAt
} from "./railGeometry";
import { dateToOrdinal, yearToTimelineIndex } from "./timelineUtils";

const wideBounds = { start: 1000, end: 2000 };

describe("railGeometry", () => {
  it("derives year bounds that give the last year of the range a full cell", () => {
    const bounds = yearBoundsFromRange({
      start_value: dateToOrdinal(1700, 1, 1),
      end_value: dateToOrdinal(1800, 12, 31)
    });

    expect(bounds.start).toBe(yearToTimelineIndex(1700));
    expect(bounds.end).toBe(yearToTimelineIndex(1800) + 1);
  });

  it("maps a year to the centre of its own cell", () => {
    // Year 1500 owns [1500, 1501); its centre sits halfway across a 1000-year slice.
    expect(percentForYear(1500, wideBounds)).toBeCloseTo(50.05, 2);
  });

  it("round-trips a percent back to the year it points at", () => {
    const slice = { start: 1780, end: 1800 };

    expect(yearFromPercent(percentForYear(1789, slice), slice)).toBe(1789);
  });

  it("clamps a slice inside its bounds and never below the minimum span", () => {
    expect(clampSlice({ start: 900, end: 2200 }, wideBounds)).toEqual(wideBounds);

    const tiny = clampSlice({ start: 1500, end: 1501 }, wideBounds);

    expect(tiny.end - tiny.start).toBe(minYearRailSpan);
  });

  it("keeps the year under the pointer pinned while zooming", () => {
    const slice = { start: 1000, end: 2000 };
    const focusPercent = 25;
    const focusYear = slice.start + (focusPercent / 100) * (slice.end - slice.start);
    const zoomed = zoomSliceAt(slice, focusPercent, 0.5, wideBounds);
    const zoomedFocus = zoomed.start + (focusPercent / 100) * (zoomed.end - zoomed.start);

    expect(zoomed.end - zoomed.start).toBe(500);
    expect(zoomedFocus).toBeCloseTo(focusYear, 6);
  });

  it("leaves the slice alone while the selection stays in the middle band", () => {
    const slice = { start: 1700, end: 1800 };

    expect(followSlice(slice, 1750, wideBounds)).toEqual(slice);
  });

  it("recentres the slice once the selection leaves the middle band", () => {
    const slice = { start: 1700, end: 1800 };
    const followed = followSlice(slice, 1795, wideBounds);

    expect(followed.end - followed.start).toBe(100);
    expect(followed.start).toBeLessThan(1795.5);
    expect(followed.end).toBeGreaterThan(1795.5);
  });

  it("thins tick labels out as the slice widens", () => {
    const zoomedIn = buildYearTicks({ start: 1780, end: 1800 }, 900);
    const zoomedOut = buildYearTicks({ start: 1000, end: 2000 }, 900);

    expect(zoomedIn.labelStep).toBeLessThan(zoomedOut.labelStep);
    expect(zoomedIn.ticks.every(tick => tick.percent >= 0 && tick.percent <= 100)).toBe(true);
    expect(zoomedOut.ticks.filter(tick => tick.isLabel).length).toBeGreaterThan(0);
  });

  it("labels ticks with display years, so the BC side skips the missing year zero", () => {
    const { ticks } = buildYearTicks({ start: -5, end: 5 }, 900);
    const years = ticks.map(tick => tick.year);

    expect(years).not.toContain(0);
    // Index 0 is 1 BC, index 1 is 1 AD: the boundary is one cell wide, not two.
    expect(years).toContain(-1);
    expect(years).toContain(1);
  });

  it("expresses the slice as the ordinal window the global track brackets", () => {
    const bracket = sliceToOrdinalRange({ start: 1700, end: 1800 });

    expect(bracket.start_value).toBe(dateToOrdinal(1700, 1, 1));
    expect(bracket.end_value).toBe(dateToOrdinal(1799, 12, 31));
  });
});
