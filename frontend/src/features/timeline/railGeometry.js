import {
  clampNumber,
  dateToOrdinal,
  maxTimelineValue,
  minTimelineValue,
  ordinalToDate,
  timelineIndexToYear,
  yearToTimelineIndex
} from "./timelineUtils";

// How much history the frame keeps on screen to the left of the session's
// answers, no matter how tightly those answers cluster.
//
// This floor is the whole point. Scaling the frame off the answers' own spread —
// which is what it used to do — means a session whose cards all sit in the 20th
// century gets a 20th-century frame: the era bands collapse to one flat colour
// and every landmark that makes a date *mean* something (1492, 1789, …) falls
// off the edge. The frame is the map, and a map has to show more than where you
// already are. 1000 years reliably spans several named eras.
export const minFrameContextYears = 1000;

const daysPerYear = 365.25;

// The window the global track paints: the answers, plus a generous left-hand
// run-up, plus everything forward to today. Answer-independent, so it leaks
// nothing the backend's randomised padding does not already allow.
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
  // A wide-ranging session still gets its proportional run-up; a tight one gets
  // the floor. Whichever is larger wins.
  const leftPadding = Math.max(span * 1.2, minFrameContextYears * daysPerYear);

  return {
    start_value: Math.max(minTimelineValue, Math.round(range.start_value - leftPadding)),
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

// How wide the year rail opens. Wide enough that "the answer is on screen" is
// only a weak hint; narrow enough that a year is a clickable number of pixels
// (a ~130-year window on a ~1200px ruler is ~9px per year).
export const answerWindowMinYears = 90;
export const answerWindowMaxYears = 170;
// The answer is never parked against the very edge of the opening window — you
// should be able to nudge either side of your guess without panning first.
const answerEdgeMargin = 0.15;

// The rail opens on a window that contains the answer, so you can aim without
// hunting across a millennium first.
//
// Both the window's width and the answer's position inside it are re-randomised
// every time the card is shown. That is what keeps the help from becoming the
// answer: "it is somewhere in view" stays true, while "it is in the middle" —
// or any other fixed spot you could learn to read off — never does. Re-drawing
// per showing (rather than seeding off the question id) also stops a card's
// window from becoming a recognisable fingerprint of its own answer.
export function buildAnswerSlice(targetYearIndexes, bounds, random = Math.random) {
  const targets = (targetYearIndexes || []).filter(Number.isFinite);

  if (targets.length === 0) return clampSlice({ ...bounds }, bounds);

  const low = Math.min(...targets);
  const high = Math.max(...targets);
  const spread = high - low + 1;
  const boundsSpan = Math.max(1, bounds.end - bounds.start);
  const padding = answerWindowMinYears +
    random() * (answerWindowMaxYears - answerWindowMinYears);
  const span = clampNumber(
    Math.round(spread + padding),
    Math.min(minYearRailSpan, boundsSpan),
    boundsSpan
  );
  const slack = Math.max(0, span - spread);
  const offset = Math.round(
    slack * (answerEdgeMargin + random() * (1 - 2 * answerEdgeMargin))
  );

  return clampSlice({ start: low - offset, end: low - offset + span }, bounds);
}

// --- Ordinal-space viewport (the global track) --------------------------------
// The rails think in year indices; the global track thinks in day ordinals,
// because it paints era bands and day-precision pins on the same axis.

export const minViewportSpanDays = 30;

export function clampViewport(viewport, range) {
  const rangeSpan = Math.max(1, range.end_value - range.start_value);
  const span = clampNumber(
    viewport.end_value - viewport.start_value,
    Math.min(minViewportSpanDays, rangeSpan),
    rangeSpan
  );
  const start = clampNumber(
    viewport.start_value,
    range.start_value,
    range.end_value - span
  );

  return {
    start_value: Math.round(start),
    end_value: Math.round(start + span)
  };
}

export function zoomViewportAt(viewport, focusPercent, factor, range) {
  const span = Math.max(1, viewport.end_value - viewport.start_value);
  const ratio = clampNumber(focusPercent, 0, 100) / 100;
  const focusValue = viewport.start_value + ratio * span;
  const nextSpan = span * factor;

  return clampViewport({
    start_value: focusValue - ratio * nextSpan,
    end_value: focusValue + (1 - ratio) * nextSpan
  }, range);
}

export function panViewport(viewport, deltaPercent, range) {
  const span = Math.max(1, viewport.end_value - viewport.start_value);
  const delta = (deltaPercent / 100) * span;

  return clampViewport({
    start_value: viewport.start_value + delta,
    end_value: viewport.end_value + delta
  }, range);
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
