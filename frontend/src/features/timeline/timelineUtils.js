export const timelinePrecisions = ["year", "month", "day"];

export function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year, month) {
  return [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ][Math.min(12, Math.max(1, month)) - 1];
}

function daysBeforeYear(year) {
  const previousYear = year - 1;

  return (
    previousYear * 365 +
    Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400)
  );
}

function daysBeforeMonth(year, month) {
  const monthLengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  return monthLengths
    .slice(0, Math.max(0, month - 1))
    .reduce((total, days) => total + days, 0);
}

export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function dateToOrdinal(year, month, day) {
  return daysBeforeYear(year) + daysBeforeMonth(year, month) + day;
}

export function ordinalToDate(value) {
  const ordinal = Math.round(clampNumber(value, 1, dateToOrdinal(9999, 12, 31)));
  let low = 1;
  let high = 9999;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);

    if (daysBeforeYear(mid) < ordinal) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const year = low;
  let dayOfYear = ordinal - daysBeforeYear(year);
  let month = 1;

  while (dayOfYear > daysInMonth(year, month)) {
    dayOfYear -= daysInMonth(year, month);
    month += 1;
  }

  return {
    year,
    month,
    day: dayOfYear
  };
}

export function normalizeTimelineDate(value = {}, fallbackPrecision = "year") {
  const precision = timelinePrecisions.includes(value.precision)
    ? value.precision
    : fallbackPrecision;
  const rawYear = Number(value.year);
  const year = Number.isFinite(rawYear)
    ? clampNumber(Math.round(rawYear), 1, 9999)
    : new Date().getFullYear();
  const rawMonth = Number(value.month);
  const month = precision === "year"
    ? null
    : clampNumber(Number.isFinite(rawMonth) ? Math.round(rawMonth) : 1, 1, 12);
  const rawDay = Number(value.day);
  const day = precision === "day"
    ? clampNumber(
      Number.isFinite(rawDay) ? Math.round(rawDay) : 1,
      1,
      daysInMonth(year, month || 1)
    )
    : null;

  return {
    year,
    month,
    day,
    precision
  };
}

export function lowerOrdinal(value) {
  const date = normalizeTimelineDate(value, value?.precision);

  if (date.precision === "year") {
    return dateToOrdinal(date.year, 1, 1);
  }

  if (date.precision === "month") {
    return dateToOrdinal(date.year, date.month, 1);
  }

  return dateToOrdinal(date.year, date.month, date.day);
}

export function upperOrdinal(value) {
  const date = normalizeTimelineDate(value, value?.precision);

  if (date.precision === "year") {
    return dateToOrdinal(date.year, 12, 31);
  }

  if (date.precision === "month") {
    return dateToOrdinal(date.year, date.month, daysInMonth(date.year, date.month));
  }

  return dateToOrdinal(date.year, date.month, date.day);
}

export function centerOrdinal(value) {
  return Math.round((lowerOrdinal(value) + upperOrdinal(value)) / 2);
}

export function ordinalToTimelineDate(value, precision) {
  const date = ordinalToDate(value);

  if (precision === "year") {
    return {
      year: date.year,
      month: null,
      day: null,
      precision
    };
  }

  if (precision === "month") {
    return {
      year: date.year,
      month: date.month,
      day: null,
      precision
    };
  }

  return {
    ...date,
    precision: "day"
  };
}

export function dateToIsoInput(value) {
  const date = normalizeTimelineDate(value, value?.precision);
  const month = String(date.month || 1).padStart(2, "0");
  const day = String(date.day || 1).padStart(2, "0");

  return `${String(date.year).padStart(4, "0")}-${month}-${day}`;
}

export function dateFromIsoInput(value, precision) {
  const [year, month, day] = String(value || "").split("-").map(Number);

  return normalizeTimelineDate({
    year,
    month,
    day,
    precision
  }, precision);
}

export function formatTimelineDate(value) {
  if (!value) return "";

  const date = normalizeTimelineDate(value, value.precision);

  if (date.precision === "year") {
    return String(date.year);
  }

  if (date.precision === "month") {
    return `${String(date.month).padStart(2, "0")}/${date.year}`;
  }

  return `${String(date.day).padStart(2, "0")}/${String(date.month).padStart(2, "0")}/${date.year}`;
}

export function formatTimelineAnswer(timeline) {
  if (!timeline?.start) return "";

  if (timeline.kind === "interval" && timeline.end) {
    return `${formatTimelineDate(timeline.start)} - ${formatTimelineDate(timeline.end)}`;
  }

  return formatTimelineDate(timeline.start);
}

export function createDefaultTimeline(year = new Date().getFullYear()) {
  return {
    kind: "point",
    start: {
      year,
      month: null,
      day: null,
      precision: "year"
    }
  };
}

export function normalizeTimeline(timeline) {
  if (!timeline) return createDefaultTimeline();

  const kind = timeline.kind === "interval" ? "interval" : "point";
  const start = normalizeTimelineDate(timeline.start, "year");
  const result = {
    kind,
    start
  };

  if (kind === "interval") {
    const end = normalizeTimelineDate(timeline.end, start.precision);
    result.end = lowerOrdinal(end) < lowerOrdinal(start)
      ? start
      : end;
  }

  return result;
}

export function buildRangeFromItems(items) {
  const values = [];

  (items || []).forEach(item => {
    const timeline = normalizeTimeline(item.timeline);
    values.push(lowerOrdinal(timeline.start), upperOrdinal(timeline.start));

    if (timeline.kind === "interval" && timeline.end) {
      values.push(lowerOrdinal(timeline.end), upperOrdinal(timeline.end));
    }
  });

  if (values.length === 0) {
    const today = new Date();
    const center = dateToOrdinal(today.getFullYear(), today.getMonth() + 1, today.getDate());

    return {
      start_value: center - 3650,
      end_value: center + 3650
    };
  }

  let start = Math.min(...values);
  let end = Math.max(...values);
  const span = Math.max(1, end - start);

  start -= Math.round(span * 0.25);
  end += Math.round(span * 0.25);

  return {
    start_value: Math.max(1, start),
    end_value: Math.min(dateToOrdinal(9999, 12, 31), end)
  };
}
