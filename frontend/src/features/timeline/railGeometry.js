import {
  clampNumber,
  dateToOrdinal,
  maxTimelineValue,
  minTimelineValue,
  ordinalToDate,
  timelineIndexToYear,
  yearToTimelineIndex
} from "./timelineUtils";

// The window the global track paints. It is deliberately wider than the answers
// themselves: a range hugging the answers would be a picture of nothing (and, on
// a single-card session, would frame the answer dead centre). Reaching forward
// to today and back by a multiple of the span gives the landmarks room to appear
// and keeps "where does this sit" answerable. It is answer-independent, so it
// leaks nothing the backend's randomised padding does not already allow.
export function buildDisplayRange(range) {
  const today = new Date();
  const todayValue = dateToOrdinal(
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate()
  );
  const rightLimit = Math.max(todayValue, range.end_value);
  const span = Math.max(365, range.end_value - range.start_value);
  const rightPadding = Math.min(120, Math.max(14, Math.round(span * 0.015)));

  return {
    start_value: Math.max(minTimelineValue, Math.round(range.start_value - span * 1.2)),
    end_value: Math.min(maxTimelineValue, rightLimit + rightPadding)
  };
}

// The year rail works in *year index* space (see yearToTimelineIndex), where
// 1 BC is 0 and 1 AD is 1. History has no year zero, so indices are what make a
// year exactly one unit wide on both sides of the BC/AD boundary — the rail
// stays linear and a tick step of 50 means 50 years everywhere.
//
// A slice is a half-open window [start, end) of year indices, held as floats so
// zooming can land between years. Year Y owns the cell [Y, Y + 1), so its
// visual centre — where its tick and label go — is Y + 0.5.

export const minYearRailSpan = 6;

const tickSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

export function yearBoundsFromRange(range) {
  const start = yearToTimelineIndex(ordinalToDate(range.start_value).year);
  const end = yearToTimelineIndex(ordinalToDate(range.end_value).year);

  return {
    start,
    // Exclusive: the final year needs a full cell of its own.
    end: Math.max(start + minYearRailSpan, end + 1)
  };
}

export function clampSlice(slice, bounds) {
  const boundsSpan = Math.max(1, bounds.end - bounds.start);
  const span = clampNumber(
    slice.end - slice.start,
    Math.min(minYearRailSpan, boundsSpan),
    boundsSpan
  );
  const start = clampNumber(slice.start, bounds.start, bounds.end - span);

  return {
    start,
    end: start + span
  };
}

export function sliceSpan(slice) {
  return Math.max(1, slice.end - slice.start);
}

export function percentForYear(yearIndex, slice) {
  return ((yearIndex + 0.5 - slice.start) / sliceSpan(slice)) * 100;
}

export function yearFromPercent(percent, slice) {
  return Math.floor(slice.start + (percent / 100) * sliceSpan(slice));
}

// Zoom keeps the year under the pointer pinned in place, so the rail magnifies
// around what you are looking at rather than around its centre.
export function zoomSliceAt(slice, focusPercent, factor, bounds) {
  const span = sliceSpan(slice);
  const ratio = clampNumber(focusPercent, 0, 100) / 100;
  const focusYear = slice.start + ratio * span;
  const nextSpan = span * factor;

  return clampSlice({
    start: focusYear - ratio * nextSpan,
    end: focusYear + (1 - ratio) * nextSpan
  }, bounds);
}

// Keep the selection on screen without re-centring on every step: the window
// only moves once the selection leaves the comfortable middle band. A slice that
// slid on every tick would scroll out from under a drag and fight the pointer.
export function followSlice(slice, yearIndex, bounds, deadzone = 0.18) {
  const span = sliceSpan(slice);
  const center = yearIndex + 0.5;

  if (center >= slice.start + span * deadzone && center <= slice.end - span * deadzone) {
    return clampSlice(slice, bounds);
  }

  return clampSlice({
    start: center - span / 2,
    end: center + span / 2
  }, bounds);
}

// Two interleaved densities: minor ticks as dense as legibility allows, labels
// only on the round steps that can be written without colliding.
export function buildYearTicks(slice, widthPx, options = {}) {
  const minLabelGapPx = options.minLabelGapPx ?? 58;
  const minTickGapPx = options.minTickGapPx ?? 9;
  const span = sliceSpan(slice);
  const pxPerYear = Math.max(0.0001, Math.max(1, widthPx) / span);
  const fallback = tickSteps[tickSteps.length - 1];
  const labelStep = tickSteps.find(step => step * pxPerYear >= minLabelGapPx) ?? fallback;
  const tickStep = tickSteps.find(step => step * pxPerYear >= minTickGapPx) ?? labelStep;
  const ticks = [];
  const first = Math.ceil(slice.start / tickStep) * tickStep;

  for (let index = first; index < slice.end; index += tickStep) {
    ticks.push({
      yearIndex: index,
      year: timelineIndexToYear(index),
      percent: percentForYear(index, slice),
      isLabel: index % labelStep === 0
    });
  }

  return {
    labelStep,
    pxPerYear,
    tickStep,
    ticks
  };
}

// The slice, expressed as the ordinal window the global track brackets.
export function sliceToOrdinalRange(slice) {
  const startYear = timelineIndexToYear(Math.floor(slice.start));
  const endYear = timelineIndexToYear(Math.ceil(slice.end) - 1);

  return {
    start_value: dateToOrdinal(startYear, 1, 1),
    end_value: dateToOrdinal(endYear, 12, 31)
  };
}
