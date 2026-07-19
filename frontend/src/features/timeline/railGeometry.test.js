import { describe, expect, it } from "vitest";
import {
  answerWindowMaxYears,
  answerWindowMinYears,
  buildAnswerSlice,
  buildDisplayRange,
  buildYearTicks,
  clampSlice,
  clampViewport,
  followSlice,
  minFrameContextYears,
  minViewportSpanDays,
  minYearRailSpan,
  panViewport,
  percentForYear,
  sliceToOrdinalRange,
  yearBoundsFromRange,
  yearFromPercent,
  zoomSliceAt,
  zoomViewportAt
} from "./railGeometry";
import { dateToOrdinal, ordinalToDate, yearToTimelineIndex } from "./timelineUtils";

const wideBounds = { start: 1000, end: 2000 };
const trackRange = {
  start_value: dateToOrdinal(1400, 1, 1),
  end_value: dateToOrdinal(2000, 1, 1)
};

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

  describe("buildAnswerSlice", () => {
    const bounds = { start: 500, end: 2027 };
    const target = yearToTimelineIndex(1789);

    // A deterministic stand-in for Math.random, cycling through fixed draws.
    function seeded(values) {
      let index = 0;

      return () => values[index++ % values.length];
    }

    it("opens on a window that contains the answer", () => {
      [0, 0.5, 0.999].forEach(draw => {
        const slice = buildAnswerSlice([target], bounds, seeded([draw]));

        expect(slice.start).toBeLessThanOrEqual(target);
        expect(slice.end).toBeGreaterThan(target);
      });
    });

    it("keeps the window narrow enough that a year is clickable", () => {
      const slice = buildAnswerSlice([target], bounds, seeded([1, 0.5]));

      expect(slice.end - slice.start).toBeLessThanOrEqual(answerWindowMaxYears + 1);
      expect(slice.end - slice.start).toBeGreaterThanOrEqual(answerWindowMinYears);
    });

    it("never parks the answer against the edge of the window", () => {
      // Extreme draws for the offset: the answer must still sit clear of both ends.
      [0, 1].forEach(offsetDraw => {
        const slice = buildAnswerSlice([target], bounds, seeded([0.5, offsetDraw]));
        const position = (target - slice.start) / (slice.end - slice.start);

        expect(position).toBeGreaterThan(0.1);
        expect(position).toBeLessThan(0.9);
      });
    });

    // The point of the randomisation: if the answer always landed in the same
    // spot, "it is on screen" would collapse into "it is right there".
    it("puts the answer in a different place each time it is shown", () => {
      const positions = new Set(
        [0.05, 0.3, 0.55, 0.8, 0.95].map(draw => {
          const slice = buildAnswerSlice([target], bounds, seeded([0.5, draw]));

          return Math.round(((target - slice.start) / (slice.end - slice.start)) * 100);
        })
      );

      expect(positions.size).toBeGreaterThan(3);
    });

    it("spans both endpoints of an interval", () => {
      const start = yearToTimelineIndex(1914);
      const end = yearToTimelineIndex(1918);
      const slice = buildAnswerSlice([start, end], bounds, seeded([0.5]));

      expect(slice.start).toBeLessThanOrEqual(start);
      expect(slice.end).toBeGreaterThan(end);
    });

    it("stays inside the frame for an answer sitting on its edge", () => {
      const edge = bounds.end - 2;
      const slice = buildAnswerSlice([edge], bounds, seeded([0.5]));

      expect(slice.start).toBeGreaterThanOrEqual(bounds.start);
      expect(slice.end).toBeLessThanOrEqual(bounds.end);
      expect(slice.start).toBeLessThanOrEqual(edge);
    });
  });

  it("keeps a floor of historical context however tightly the session clusters", () => {
    // Every card in one decade: the frame must not shrink to that decade.
    const tight = buildDisplayRange({
      start_value: dateToOrdinal(1914, 1, 1),
      end_value: dateToOrdinal(1918, 12, 31)
    });
    const firstYear = ordinalToDate(tight.start_value).year;

    expect(1914 - firstYear).toBeGreaterThanOrEqual(minFrameContextYears);
    // Far enough back that the medieval landmarks are on the map at all.
    expect(firstYear).toBeLessThan(1066);
  });

  it("gives a wide-ranging session a proportional run-up rather than the floor", () => {
    const wide = buildDisplayRange({
      start_value: dateToOrdinal(-500, 1, 1),
      end_value: dateToOrdinal(1500, 12, 31)
    });
    const firstYear = ordinalToDate(wide.start_value).year;

    // 2000-year span → a 1.2x run-up (~2400 years) beats the 1000-year floor.
    expect(-500 - firstYear).toBeGreaterThan(minFrameContextYears);
  });

  it("always carries the frame forward to today", () => {
    const frame = buildDisplayRange({
      start_value: dateToOrdinal(1200, 1, 1),
      end_value: dateToOrdinal(1300, 12, 31)
    });

    expect(ordinalToDate(frame.end_value).year).toBeGreaterThanOrEqual(
      new Date().getFullYear()
    );
  });

  it("never lets the global viewport escape its range", () => {
    expect(clampViewport(
      { start_value: trackRange.start_value - 90000, end_value: trackRange.end_value + 90000 },
      trackRange
    )).toEqual(trackRange);
  });

  it("floors the global viewport at the minimum span so it cannot zoom to nothing", () => {
    const tiny = clampViewport(
      { start_value: dateToOrdinal(1789, 7, 14), end_value: dateToOrdinal(1789, 7, 15) },
      trackRange
    );

    expect(tiny.end_value - tiny.start_value).toBe(minViewportSpanDays);
  });

  it("keeps the date under the pointer pinned while zooming the global track", () => {
    const focusPercent = 30;
    const span = trackRange.end_value - trackRange.start_value;
    const focusValue = trackRange.start_value + (focusPercent / 100) * span;
    const zoomed = zoomViewportAt(trackRange, focusPercent, 0.5, trackRange);
    const zoomedFocus = zoomed.start_value +
      (focusPercent / 100) * (zoomed.end_value - zoomed.start_value);

    // Viewports are whole days, so start and end each round independently and the
    // resulting span can land a day either side of the exact half.
    expect(zoomed.end_value - zoomed.start_value).toBeCloseTo(span * 0.5, -0.5);
    expect(zoomedFocus).toBeCloseTo(focusValue, -0.5);
  });

  it("pans the global viewport without changing its span, and stops at the edge", () => {
    const zoomed = zoomViewportAt(trackRange, 50, 0.5, trackRange);
    const span = zoomed.end_value - zoomed.start_value;
    const panned = panViewport(zoomed, 20, trackRange);

    expect(panned.end_value - panned.start_value).toBe(span);
    expect(panned.start_value).toBeGreaterThan(zoomed.start_value);

    // Pan far past the end: it should clamp flush to the range, not overshoot.
    const pinned = panViewport(zoomed, 100000, trackRange);

    expect(pinned.end_value).toBe(trackRange.end_value);
    expect(pinned.end_value - pinned.start_value).toBe(span);
  });

  it("expresses the slice as the ordinal window the global track brackets", () => {
    const bracket = sliceToOrdinalRange({ start: 1700, end: 1800 });

    expect(bracket.start_value).toBe(dateToOrdinal(1700, 1, 1));
    expect(bracket.end_value).toBe(dateToOrdinal(1799, 12, 31));
  });
});
