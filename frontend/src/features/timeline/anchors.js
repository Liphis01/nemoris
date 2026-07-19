import {
  centerOrdinal,
  dateToOrdinal,
  lowerOrdinal,
  maxTimelineValue,
  minTimelineValue,
  normalizeTimeline,
  ordinalToDate,
  upperOrdinal
} from "./timelineUtils";

// Days within which an anchor is considered to "sit on" another date. Anchors
// that land on a session answer are dropped, so the reference layer can never
// spell out a date the user is being asked for.
export const anchorLeakToleranceDays = 200;

// Named historical eras (French periodisation). `startYear`/`endYear` are
// inclusive-of-start, exclusive-of-end; `null` means the era is open on that
// side. Tints are low-saturation overlays so the colourful answer chips still
// read on top of them.
export const eras = [
  {
    id: "prehistoire",
    label: "Préhistoire",
    startYear: null,
    endYear: -3000,
    tint: "rgba(122, 122, 134, 0.085)",
    labelColor: "#9a9aa6"
  },
  {
    id: "antiquite",
    label: "Antiquité",
    startYear: -3000,
    endYear: 476,
    tint: "rgba(214, 188, 130, 0.09)",
    labelColor: "#d6bc82"
  },
  {
    id: "moyen-age",
    label: "Moyen Âge",
    startYear: 476,
    endYear: 1492,
    tint: "rgba(160, 138, 206, 0.095)",
    labelColor: "#b9a4e0"
  },
  {
    id: "moderne",
    label: "Époque moderne",
    startYear: 1492,
    endYear: 1789,
    tint: "rgba(128, 196, 170, 0.095)",
    labelColor: "#86e2b6"
  },
  {
    id: "contemporaine",
    label: "Époque contemporaine",
    startYear: 1789,
    endYear: null,
    tint: "rgba(150, 178, 224, 0.095)",
    labelColor: "#9fc2ff"
  }
];

function yearAnchor(year) {
  return {
    year,
    month: null,
    day: null,
    precision: "year"
  };
}

// Curated landmark events. `tier: 0` anchors are always shown; `tier: 1` anchors
// only appear once there is horizontal room for them (see selectVisibleAnchors).
export const curatedAnchors = [
  { id: "chute-rome", label: "Chute de Rome", start: yearAnchor(476), tier: 0, eraId: "antiquite" },
  { id: "amerique", label: "Découverte de l'Amérique", start: yearAnchor(1492), tier: 0, eraId: "moderne" },
  { id: "revolution", label: "Révolution française", start: yearAnchor(1789), tier: 0, eraId: "contemporaine" },
  {
    id: "ww1",
    label: "Première Guerre mondiale",
    start: yearAnchor(1914),
    end: yearAnchor(1918),
    tier: 0,
    eraId: "contemporaine"
  },
  {
    id: "ww2",
    label: "Seconde Guerre mondiale",
    start: yearAnchor(1939),
    end: yearAnchor(1945),
    tier: 0,
    eraId: "contemporaine"
  },
  { id: "alesia", label: "Alésia", start: yearAnchor(-52), tier: 1, eraId: "antiquite" },
  { id: "charlemagne", label: "Couronnement de Charlemagne", start: yearAnchor(800), tier: 1, eraId: "moyen-age" },
  { id: "hastings", label: "Bataille de Hastings", start: yearAnchor(1066), tier: 1, eraId: "moyen-age" },
  { id: "lune", label: "Premiers pas sur la Lune", start: yearAnchor(1969), tier: 1, eraId: "contemporaine" }
];

export function todayAnchor(now = new Date()) {
  return {
    id: "today",
    label: "Aujourd'hui",
    start: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      precision: "day"
    },
    tier: 0,
    eraId: "contemporaine"
  };
}

export function getCuratedAnchors({ includeToday = true, now = new Date() } = {}) {
  return includeToday
    ? [...curatedAnchors, todayAnchor(now)]
    : [...curatedAnchors];
}

// Era lookup is open-ended on both extremes and treats `endYear` as exclusive so
// boundary years (e.g. 476, 1492, 1789) belong to the era that begins on them.
export function eraForYear(year) {
  return (
    eras.find(era =>
      (era.startYear === null || year >= era.startYear) &&
      (era.endYear === null || year < era.endYear)
    ) || null
  );
}

// Era zones in timeline ordinals, clamped to the full timeline range so the
// open-ended first/last eras still produce a finite band to paint. Bands are
// contiguous: each band's endValue equals the next band's startValue.
export function getEraBands() {
  return eras.map(era => ({
    id: era.id,
    label: era.label,
    startValue: era.startYear === null
      ? minTimelineValue
      : dateToOrdinal(era.startYear, 1, 1),
    endValue: era.endYear === null
      ? maxTimelineValue
      : dateToOrdinal(era.endYear, 1, 1),
    tint: era.tint,
    labelColor: era.labelColor
  }));
}

function toRoman(value) {
  const table = [
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];
  let remaining = Math.max(1, Math.round(value));
  let result = "";

  table.forEach(([amount, numeral]) => {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  });

  return result;
}

export function centuryLabel(year) {
  const century = Math.ceil(Math.abs(year) / 100);
  const roman = toRoman(century);
  const ordinal = century === 1 ? `${roman}er` : `${roman}e`;
  const suffix = year < 0 ? " av. J.-C." : "";

  return `${ordinal} siècle${suffix}`;
}

export function decadeLabel(year) {
  const decadeStart = Math.floor(year / 10) * 10;

  if (year < 0) {
    return `années ${Math.abs(decadeStart)} av. J.-C.`;
  }

  return `années ${decadeStart}`;
}

function timelineCenterValue(timeline) {
  const normalized = normalizeTimeline(timeline);

  if (normalized.kind === "interval" && normalized.end) {
    return Math.round(
      (centerOrdinal(normalized.start) + centerOrdinal(normalized.end)) / 2
    );
  }

  return centerOrdinal(normalized.start);
}

// The reference layer for a review session: curated landmarks plus the user's
// own mastered cards, minus anything that would give the session away.
//
// Two filters, in order:
//  - a mastered card that duplicates a curated landmark is dropped (curated
//    wins, so one date never carries two flags);
//  - any anchor sitting on one of the session's expected dates is dropped,
//    because a labelled landmark on the answer is a free answer.
export function buildSessionAnchors(items, masteredAnchors = [], options = {}) {
  const toleranceDays = options.toleranceDays ?? anchorLeakToleranceDays;
  const curated = options.curated ?? getCuratedAnchors();
  const sessionCenters = (items || [])
    .map(item => item.timeline)
    .filter(Boolean)
    .map(timelineCenterValue);
  const curatedCenters = curated.map(anchorCenterValue);
  const dedupedMastered = (masteredAnchors || []).filter(anchor =>
    !curatedCenters.some(value =>
      Math.abs(value - anchorCenterValue(anchor)) < toleranceDays
    )
  );

  return [...curated, ...dedupedMastered].filter(anchor =>
    !sessionCenters.some(value =>
      Math.abs(value - anchorCenterValue(anchor)) < toleranceDays
    )
  );
}

// Center/bounds of an anchor in timeline ordinals (works for both point anchors
// and span anchors such as a war that runs across several years).
export function anchorCenterValue(anchor) {
  const low = lowerOrdinal(anchor.start);
  const high = upperOrdinal(anchor.end || anchor.start);

  return Math.round((low + high) / 2);
}

export function anchorBounds(anchor) {
  return {
    startValue: lowerOrdinal(anchor.start),
    endValue: upperOrdinal(anchor.end || anchor.start)
  };
}

function percentInViewport(value, viewport) {
  const span = Math.max(1, viewport.end_value - viewport.start_value);

  return ((value - viewport.start_value) / span) * 100;
}

// Human-readable "where am I" parts for the breadcrumb, derived from the center
// of the current view.
export function describeValue(value) {
  const { year } = ordinalToDate(value);
  const era = eraForYear(year);

  return {
    year,
    eraId: era ? era.id : null,
    eraLabel: era ? era.label : "",
    eraColor: era ? era.labelColor : "#9a9aa6",
    centuryLabel: centuryLabel(year),
    decadeLabel: decadeLabel(year)
  };
}

// Level-of-detail + collision resolution for the anchor layer.
// - tier 0 anchors inside the view are always kept.
// - tier 1 / mastered anchors are kept only when they do not crowd an
//   already-kept anchor (minGapPx apart).
// - anchors outside the view are returned as nearest off-screen neighbours so
//   the canvas can render edge arrows toward them.
export function selectVisibleAnchors(anchors, viewport, widthPx, options = {}) {
  const minGapPx = options.minGapPx ?? 64;
  const edgeLimit = options.edgeLimit ?? 3;
  const safeWidth = Math.max(1, widthPx || 1);

  const positioned = (anchors || []).map(anchor => {
    const value = anchorCenterValue(anchor);

    return {
      anchor,
      value,
      percent: percentInViewport(value, viewport)
    };
  });

  const inView = [];
  const offLeft = [];
  const offRight = [];

  positioned.forEach(entry => {
    if (entry.value < viewport.start_value) {
      offLeft.push(entry);
    } else if (entry.value > viewport.end_value) {
      offRight.push(entry);
    } else {
      inView.push(entry);
    }
  });

  const kept = [];
  const hidden = [];
  const fitsAlongside = (entry) => {
    const px = (entry.percent / 100) * safeWidth;

    return kept.every(other =>
      Math.abs((other.percent / 100) * safeWidth - px) >= minGapPx
    );
  };

  // Tier 0 first so curated landmarks always win the available space.
  inView
    .filter(entry => (entry.anchor.tier ?? 1) === 0)
    .forEach(entry => kept.push(entry));

  inView
    .filter(entry => (entry.anchor.tier ?? 1) !== 0)
    .sort((a, b) => a.percent - b.percent)
    .forEach(entry => {
      if (fitsAlongside(entry)) {
        kept.push(entry);
      } else {
        hidden.push(entry);
      }
    });

  return {
    visible: kept.sort((a, b) => a.percent - b.percent),
    hidden,
    offLeft: offLeft
      .sort((a, b) => b.value - a.value)
      .slice(0, edgeLimit),
    offRight: offRight
      .sort((a, b) => a.value - b.value)
      .slice(0, edgeLimit)
  };
}
