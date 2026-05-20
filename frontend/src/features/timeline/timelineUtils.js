export const timelinePrecisions = ["year", "month", "day"];

const precisionRank = {
  year: 0,
  month: 1,
  day: 2
};

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

export function coerceTimelinePrecision(value, precision) {
  return normalizeTimelineDate({
    ...value,
    precision
  }, precision);
}

export function getFinestPrecision(...dates) {
  return dates
    .filter(Boolean)
    .map(date => date.precision)
    .filter(precision => precision in precisionRank)
    .sort((a, b) => precisionRank[b] - precisionRank[a])[0] || "year";
}

function parseDateToken(value) {
  const token = String(value || "").trim();
  const toNumber = (raw) => Number.parseInt(raw, 10);
  const validYear = (year) => Number.isInteger(year) && year >= 1 && year <= 9999;
  const validMonth = (month) => Number.isInteger(month) && month >= 1 && month <= 12;
  const validDay = (year, month, day) =>
    Number.isInteger(day) &&
    day >= 1 &&
    day <= daysInMonth(year, month);
  let match = token.match(/^(\d{1,4})$/);

  if (match) {
    const year = toNumber(match[1]);
    if (!validYear(year)) return null;

    return normalizeTimelineDate({
      year,
      precision: "year"
    });
  }

  match = token.match(/^(\d{1,2})\/(\d{1,4})$/);

  if (match) {
    const month = toNumber(match[1]);
    const year = toNumber(match[2]);
    if (!validYear(year) || !validMonth(month)) return null;

    return normalizeTimelineDate({
      month,
      year,
      precision: "month"
    });
  }

  match = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/);

  if (match) {
    const day = toNumber(match[1]);
    const month = toNumber(match[2]);
    const year = toNumber(match[3]);
    if (!validYear(year) || !validMonth(month) || !validDay(year, month, day)) {
      return null;
    }

    return normalizeTimelineDate({
      day,
      month,
      year,
      precision: "day"
    });
  }

  match = token.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    const year = toNumber(match[1]);
    const month = toNumber(match[2]);
    const day = toNumber(match[3]);
    if (!validYear(year) || !validMonth(month) || !validDay(year, month, day)) {
      return null;
    }

    return normalizeTimelineDate({
      year,
      month,
      day,
      precision: "day"
    });
  }

  return null;
}

export function parseTimelineInput(value) {
  const input = String(value || "").trim();

  if (!input) {
    return {
      timeline: null,
      error: ""
    };
  }

  const intervalMatch = input.match(/^(.+?)\s*[-–]\s*(.+)$/);

  if (intervalMatch && !input.match(/^\d{1,4}-\d{1,2}-\d{1,2}$/)) {
    const parsedStart = parseDateToken(intervalMatch[1]);
    const parsedEnd = parseDateToken(intervalMatch[2]);

    if (!parsedStart || !parsedEnd) {
      return {
        timeline: null,
        error: "Format de date invalide"
      };
    }

    const precision = getFinestPrecision(parsedStart, parsedEnd);
    const start = coerceTimelinePrecision(parsedStart, precision);
    const end = coerceTimelinePrecision(parsedEnd, precision);

    if (lowerOrdinal(end) < lowerOrdinal(start)) {
      return {
        timeline: null,
        error: "La fin doit etre apres le debut"
      };
    }

    return {
      timeline: normalizeTimeline({
        kind: "interval",
        start,
        end
      }),
      error: ""
    };
  }

  const parsedDate = parseDateToken(input);

  if (!parsedDate) {
    return {
      timeline: null,
      error: "Format de date invalide"
    };
  }

  return {
    timeline: normalizeTimeline({
      kind: "point",
      start: parsedDate
    }),
    error: ""
  };
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
