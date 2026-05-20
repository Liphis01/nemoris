export const timelinePrecisions = ["year", "month", "day"];
export const minTimelineYear = -9999;
export const maxTimelineYear = 9999;

const precisionRank = {
  year: 0,
  month: 1,
  day: 2
};

export function yearToTimelineIndex(year) {
  return year > 0 ? year : year + 1;
}

export function timelineIndexToYear(index) {
  return index > 0 ? index : index - 1;
}

export function formatTimelineYear(year) {
  const normalizedYear = Number(year) < 0 ? Number(year) : Math.max(1, Number(year) || 1);

  if (normalizedYear < 0) {
    return `${Math.abs(normalizedYear)} av. J.-C.`;
  }

  return String(normalizedYear);
}

export function isLeapYear(year) {
  const timelineYear = yearToTimelineIndex(year);

  return timelineYear % 4 === 0 && (timelineYear % 100 !== 0 || timelineYear % 400 === 0);
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

function daysBeforeTimelineIndex(timelineYear) {
  const previousYear = timelineYear - 1;

  return (
    previousYear * 365 +
    Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400)
  );
}

function daysBeforeYear(year) {
  return daysBeforeTimelineIndex(yearToTimelineIndex(year));
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

export const minTimelineValue = dateToOrdinal(minTimelineYear, 1, 1);
export const maxTimelineValue = dateToOrdinal(maxTimelineYear, 12, 31);

export function ordinalToDate(value) {
  const ordinal = Math.round(clampNumber(value, minTimelineValue, maxTimelineValue));
  let low = yearToTimelineIndex(minTimelineYear);
  let high = yearToTimelineIndex(maxTimelineYear);

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);

    if (daysBeforeTimelineIndex(mid) < ordinal) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const year = timelineIndexToYear(low);
  let dayOfYear = ordinal - daysBeforeTimelineIndex(low);
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

function normalizeTimelineYear(value) {
  const rawYear = Number(value);

  if (!Number.isFinite(rawYear)) {
    return new Date().getFullYear();
  }

  const rounded = Math.round(rawYear);
  const nonZeroYear = rounded === 0 ? 1 : rounded;

  return clampNumber(nonZeroYear, minTimelineYear, maxTimelineYear);
}

export function normalizeTimelineDate(value = {}, fallbackPrecision = "year") {
  const precision = timelinePrecisions.includes(value.precision)
    ? value.precision
    : timelinePrecisions.includes(fallbackPrecision)
      ? fallbackPrecision
      : "year";
  const year = normalizeTimelineYear(value.year);
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
  const yearPrefix = date.year < 0 ? "-" : "";
  const year = `${yearPrefix}${String(Math.abs(date.year)).padStart(4, "0")}`;
  const month = String(date.month || 1).padStart(2, "0");
  const day = String(date.day || 1).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function dateFromIsoInput(value, precision) {
  const match = String(value || "").match(/^(-?\d{1,4})-(\d{1,2})-(\d{1,2})$/);
  const [, year, month, day] = match || [];

  return normalizeTimelineDate({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    precision
  }, precision);
}

export function formatTimelineDate(value) {
  if (!value) return "";

  const date = normalizeTimelineDate(value, value.precision);
  const formattedYear = formatTimelineYear(date.year);

  if (date.precision === "year") {
    return formattedYear;
  }

  if (date.precision === "month") {
    return `${String(date.month).padStart(2, "0")}/${formattedYear}`;
  }

  return `${String(date.day).padStart(2, "0")}/${String(date.month).padStart(2, "0")}/${formattedYear}`;
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
  const validYear = (year) =>
    Number.isInteger(year) &&
    year !== 0 &&
    year >= minTimelineYear &&
    year <= maxTimelineYear;
  const validMonth = (month) => Number.isInteger(month) && month >= 1 && month <= 12;
  const validDay = (year, month, day) =>
    Number.isInteger(day) &&
    day >= 1 &&
    day <= daysInMonth(year, month);
  const extracted = extractEraToken(token);

  if (!extracted) return null;

  let match = extracted.token.match(/^(\d{1,4})$/);

  if (match) {
    const year = applyEraToYear(toNumber(match[1]), extracted.era);
    if (!validYear(year)) return null;

    return normalizeTimelineDate({
      year,
      precision: "year"
    });
  }

  match = extracted.token.match(/^(\d{1,2})\/(\d{1,4})$/);

  if (match) {
    const month = toNumber(match[1]);
    const year = applyEraToYear(toNumber(match[2]), extracted.era);
    if (!validYear(year) || !validMonth(month)) return null;

    return normalizeTimelineDate({
      month,
      year,
      precision: "month"
    });
  }

  match = extracted.token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/);

  if (match) {
    const day = toNumber(match[1]);
    const month = toNumber(match[2]);
    const year = applyEraToYear(toNumber(match[3]), extracted.era);
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

  match = extracted.token.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    const year = applyEraToYear(toNumber(match[1]), extracted.era);
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

function extractEraToken(value) {
  const bcPattern = /(^|\s)(?:av\.?\s*(?:j\.?\s*-?\s*c\.?|jc)|bc|bce)\.?(?=$|\s|[.,;])/i;
  const acPattern = /(^|\s)(?:apr\.?\s*(?:j\.?\s*-?\s*c\.?|jc)|ap\.?\s*(?:j\.?\s*-?\s*c\.?|jc)|ac|ad|ce)\.?(?=$|\s|[.,;])/i;
  const bcReplacePattern = /(^|\s)(?:av\.?\s*(?:j\.?\s*-?\s*c\.?|jc)|bc|bce)\.?(?=$|\s|[.,;])/gi;
  const acReplacePattern = /(^|\s)(?:apr\.?\s*(?:j\.?\s*-?\s*c\.?|jc)|ap\.?\s*(?:j\.?\s*-?\s*c\.?|jc)|ac|ad|ce)\.?(?=$|\s|[.,;])/gi;
  let era = null;
  let token = String(value || "").trim();
  const hasBc = bcPattern.test(token);
  const hasAc = acPattern.test(token);

  if (hasBc && hasAc) return null;

  if (hasBc) {
    era = -1;
    token = token.replace(bcReplacePattern, " ");
  }

  if (hasAc) {
    era = 1;
    token = token.replace(acReplacePattern, " ");
  }

  token = token.replace(/\s+/g, " ").trim();

  if (token.startsWith("-")) {
    era = -1;
    token = token.slice(1).trim();
  } else if (token.startsWith("+")) {
    era = era || 1;
    token = token.slice(1).trim();
  }

  return {
    era,
    token
  };
}

function applyEraToYear(year, era) {
  if (!Number.isInteger(year)) return year;
  if (era === -1) return -Math.abs(year);

  return Math.abs(year);
}

function findTimelineInterval(input) {
  const candidates = [];
  const normalizedInput = input.replace(/[–—]/g, "-");

  for (let index = 0; index < normalizedInput.length; index += 1) {
    if (normalizedInput[index] !== "-") continue;

    const start = normalizedInput.slice(0, index).trim();
    const end = normalizedInput.slice(index + 1).trim();

    if (!start || !end) continue;
    candidates.push([start, end]);
  }

  return candidates.find(([start, end]) =>
    Boolean(parseDateToken(start)) && Boolean(parseDateToken(end))
  ) || null;
}

export function parseTimelineInput(value) {
  const input = String(value || "").trim();

  if (!input) {
    return {
      timeline: null,
      error: ""
    };
  }

  const parsedDate = parseDateToken(input);

  if (parsedDate) {
    return {
      timeline: normalizeTimeline({
        kind: "point",
        start: parsedDate
      }),
      error: ""
    };
  }

  const intervalMatch = findTimelineInterval(input);

  if (intervalMatch) {
    const parsedStart = parseDateToken(intervalMatch[0]);
    const parsedEnd = parseDateToken(intervalMatch[1]);

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

  return {
    timeline: null,
    error: "Format de date invalide"
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
    start_value: Math.max(minTimelineValue, start),
    end_value: Math.min(maxTimelineValue, end)
  };
}
