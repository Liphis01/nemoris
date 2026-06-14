import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendTimelineAnswer } from "../../../api/review";
import { fadeInStyle } from "../../../shared/styles";
import {
  buildRangeFromItems,
  centerOrdinal,
  clampNumber,
  dateToOrdinal,
  formatTimelineYear,
  formatTimelineAnswer,
  formatTimelineDate,
  getFinestPrecision,
  lowerOrdinal,
  maxTimelineValue,
  minTimelineValue,
  normalizeTimeline,
  ordinalToDate,
  ordinalToTimelineDate,
  timelineIndexToYear,
  yearToTimelineIndex
} from "../../timeline/timelineUtils";

const markerColors = [
  "#7dd3fc",
  "#c4b5fd",
  "#f9a8d4",
  "#fcd34d",
  "#86efac",
  "#fca5a5",
  "#93c5fd",
  "#d8b4fe"
];

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

const answerAnchorTop = 64;
const activeChipTop = 43;
const rulerRowHeight = 24;
const precisionRank = {
  year: 0,
  month: 1,
  day: 2
};
const minViewportSpanByPrecision = {
  year: 365,
  month: 30,
  day: 1
};

const typeBadgeStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  width: "fit-content",
  padding: "5px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "700",
  background: "rgba(196, 181, 253, 0.15)",
  color: "#c4b5fd",
  border: "1px solid rgba(196, 181, 253, 0.3)"
};

const buttonStyle = {
  border: "1px solid #333",
  borderRadius: "10px",
  background: "#232323",
  color: "#eee",
  cursor: "pointer",
  fontWeight: "700",
  padding: "12px 16px"
};

const successButtonStyle = {
  ...buttonStyle,
  background: "#1d3a29",
  border: "1px solid #2c5c3e",
  color: "#7ee2a8"
};

function qualityLabel(quality) {
  if (quality === 3) return "Facile";
  if (quality === 2) return "Bon";
  if (quality === 1) return "Dur";
  return "Faux";
}

function qualityColor(quality) {
  if (quality === 3) return "#7ee2a8";
  if (quality === 2) return "#8fc7ff";
  if (quality === 1) return "#ffd36b";
  return "#ff9aa5";
}

function sortReviewItems(items) {
  return [...items].sort((a, b) => {
    const difficultyA = Number(a.progress?.difficulty ?? 5);
    const difficultyB = Number(b.progress?.difficulty ?? 5);

    if (difficultyA !== difficultyB) return difficultyA - difficultyB;

    const repsA = Number(a.progress?.reps ?? 0);
    const repsB = Number(b.progress?.reps ?? 0);

    if (repsA !== repsB) return repsA - repsB;

    return Number(a.question_id) - Number(b.question_id);
  });
}

function formatAnswer(answer, timeline) {
  if (!answer) return "";

  if (timeline.kind === "interval") {
    return `${formatTimelineDate(answer.start)} - ${formatTimelineDate(answer.end)}`;
  }

  return formatTimelineDate(answer.start);
}

function getAnswerCenterValue(answer, timeline) {
  if (timeline.kind === "interval") {
    return Math.round((centerOrdinal(answer.start) + centerOrdinal(answer.end)) / 2);
  }

  return centerOrdinal(answer.start);
}

function percentFromValue(value, viewport) {
  const span = Math.max(1, viewport.end_value - viewport.start_value);

  return ((value - viewport.start_value) / span) * 100;
}

function buildTimelineBounds(range) {
  const today = new Date();
  const todayValue = dateToOrdinal(
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate()
  );
  const rightLimit = Math.max(todayValue, range.end_value);
  const reviewSpan = Math.max(365, range.end_value - range.start_value);
  const rightPadding = Math.min(120, Math.max(14, Math.round(reviewSpan * 0.015)));

  return {
    start_value: Math.max(minTimelineValue, Math.round(range.start_value - reviewSpan * 1.2)),
    end_value: Math.min(maxTimelineValue, rightLimit + rightPadding)
  };
}

function minViewportSpanForPrecision(precision) {
  return minViewportSpanByPrecision[precision] || minViewportSpanByPrecision.day;
}

function getTimelinePrecision(timeline) {
  if (timeline.kind === "interval") {
    return getFinestPrecision(timeline.start, timeline.end);
  }

  return timeline.start.precision;
}

function precisionAllows(activePrecision, precision) {
  return precisionRank[activePrecision] >= precisionRank[precision];
}

function clampViewport(viewport, bounds, activePrecision = "day") {
  const boundsSpan = Math.max(1, bounds.end_value - bounds.start_value);
  const span = Math.min(
    Math.max(
      minViewportSpanForPrecision(activePrecision),
      viewport.end_value - viewport.start_value
    ),
    boundsSpan
  );
  let start = viewport.start_value;
  let end = start + span;

  if (start < bounds.start_value) {
    start = bounds.start_value;
    end = start + span;
  }

  if (end > bounds.end_value) {
    end = bounds.end_value;
    start = end - span;
  }

  return {
    start_value: start,
    end_value: end
  };
}

function zoomViewport(viewport, bounds, centerValue, zoomFactor, activePrecision = "day") {
  const center = clampNumber(centerValue, viewport.start_value, viewport.end_value);

  return clampViewport({
    start_value: center - (center - viewport.start_value) * zoomFactor,
    end_value: center + (viewport.end_value - center) * zoomFactor
  }, bounds, activePrecision);
}

function panViewport(viewport, bounds, deltaValue, activePrecision = "day") {
  return clampViewport({
    start_value: viewport.start_value + deltaValue,
    end_value: viewport.end_value + deltaValue
  }, bounds, activePrecision);
}

function niceStep(rawStep) {
  const target = Math.max(1, rawStep);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const multiplier = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 5
        ? 5
        : 10;

  return multiplier * magnitude;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function monthIndexFromDate(date) {
  return yearToTimelineIndex(date.year) * 12 + date.month - 1;
}

function dateFromMonthIndex(monthIndex) {
  const yearIndex = Math.floor(monthIndex / 12);

  return {
    year: timelineIndexToYear(yearIndex),
    month: positiveModulo(monthIndex, 12) + 1
  };
}

function niceMonthStep(rawStep) {
  const steps = [1, 2, 3, 4, 6, 12, 24, 36, 60, 120];

  return steps.find(step => step >= rawStep) || niceStep(rawStep / 12) * 12;
}

function buildGridTicks(rulers) {
  const unitWeight = {
    millennium: 4,
    year: 3,
    month: 2,
    day: 1
  };
  const ticksByValue = new Map();

  rulers.forEach(ruler => {
    ruler.ticks.forEach(tick => {
      const current = ticksByValue.get(tick.value);

      if (!current || unitWeight[tick.unit] > unitWeight[current.unit]) {
        ticksByValue.set(tick.value, tick);
      }
    });
  });

  return [...ticksByValue.values()].sort((a, b) => a.value - b.value);
}

function buildTimelineScale(viewport, width = 900, activePrecision = "day") {
  const span = Math.max(1, viewport.end_value - viewport.start_value);
  const safeWidth = Math.max(320, width || 900);
  const yearLabelTarget = clampNumber(Math.floor(safeWidth / 52), 10, 32);
  const monthLabelTarget = clampNumber(Math.floor(safeWidth / 42), 12, 34);
  const dayLabelTarget = clampNumber(Math.floor(safeWidth / 30), 14, 42);
  const allowMonths = precisionAllows(activePrecision, "month");
  const allowDays = precisionAllows(activePrecision, "day");
  const startDate = ordinalToDate(viewport.start_value);
  const endDate = ordinalToDate(viewport.end_value);
  const yearTicks = [];
  const monthTicks = [];
  const dayTicks = [];
  const bands = [];
  const startYearIndex = yearToTimelineIndex(startDate.year);
  const endYearIndex = yearToTimelineIndex(endDate.year);
  const yearCount = Math.max(1, endYearIndex - startYearIndex + 1);
  const yearStep = yearCount <= yearLabelTarget
    ? 1
    : niceStep(yearCount / yearLabelTarget);

  for (
    let yearIndex = Math.ceil(startYearIndex / yearStep) * yearStep;
    yearIndex <= endYearIndex;
    yearIndex += yearStep
  ) {
    const year = timelineIndexToYear(yearIndex);

    yearTicks.push({
      value: dateToOrdinal(year, 1, 1),
      label: formatTimelineYear(year),
      level: "major",
      unit: "year"
    });
  }

  const firstMillennium = Math.ceil(startDate.year / 1000) * 1000;

  for (let year = firstMillennium; year <= endDate.year; year += 1000) {
    if (year === 0) continue;

    const value = dateToOrdinal(year, 1, 1);
    const existingTick = yearTicks.find(tick => tick.value === value);

    if (existingTick) {
      existingTick.level = "millennium";
      existingTick.unit = "millennium";
      existingTick.label = formatTimelineYear(year);
    } else {
      yearTicks.push({
        value,
        label: formatTimelineYear(year),
        level: "millennium",
        unit: "millennium"
      });
    }
  }

  yearTicks.sort((a, b) => a.value - b.value);

  if (!yearTicks.some(tick =>
    tick.value >= viewport.start_value && tick.value <= viewport.end_value
  )) {
    yearTicks.push({
      value: viewport.start_value,
      label: formatTimelineYear(startDate.year),
      level: "major",
      unit: "year"
    });
  }

  const bandStep = Math.max(yearStep, niceStep(yearCount / 5));
  let bandIndex = 0;

  for (
    let yearIndex = Math.floor(startYearIndex / bandStep) * bandStep;
    yearIndex <= endYearIndex + bandStep;
    yearIndex += bandStep
  ) {
    const year = timelineIndexToYear(yearIndex);
    const nextYearIndex = yearIndex + bandStep;
    const nextYear = timelineIndexToYear(nextYearIndex);

    bands.push({
      start: clampNumber(dateToOrdinal(year, 1, 1), minTimelineValue, maxTimelineValue),
      end: clampNumber(dateToOrdinal(nextYear, 1, 1), minTimelineValue, maxTimelineValue),
      muted: bandIndex % 2 === 1
    });
    bandIndex += 1;
  }

  const startMonthIndex = monthIndexFromDate(startDate);
  const endMonthIndex = monthIndexFromDate(endDate);
  const monthCount = Math.max(1, endMonthIndex - startMonthIndex + 1);
  const monthPixelWidth = safeWidth / monthCount;
  const showMonths = allowMonths && (monthPixelWidth >= 2.5 || span <= 365 * 30);
  const monthGridStep = monthPixelWidth >= 4
    ? 1
    : monthPixelWidth >= 2.5
      ? 2
      : 3;
  const monthLabelStep = niceMonthStep(Math.max(1, Math.ceil(monthCount / monthLabelTarget)));

  if (showMonths) {
    for (
      let monthIndex = Math.ceil(startMonthIndex / monthGridStep) * monthGridStep;
      monthIndex <= endMonthIndex;
      monthIndex += monthGridStep
    ) {
      const { year, month } = dateFromMonthIndex(monthIndex);
      const labeled = positiveModulo(monthIndex, monthLabelStep) === 0;

      monthTicks.push({
        value: dateToOrdinal(year, month, 1),
        label: labeled ? monthNames[month - 1] : "",
        level: month === 1 ? "major" : "minor",
        unit: "month"
      });
    }
  }

  if (showMonths && !monthTicks.some(tick =>
    tick.value >= viewport.start_value && tick.value <= viewport.end_value
  )) {
    monthTicks.push({
      value: viewport.start_value,
      label: monthNames[startDate.month - 1],
      level: "major",
      unit: "month"
    });
  }

  const dayPixelWidth = safeWidth / span;
  const showDays = allowDays && (dayPixelWidth >= 1.8 || span <= 370);
  const showAllDayLabels = dayPixelWidth >= 12;
  const dayLabelStep = niceStep(Math.max(1, Math.ceil(span / dayLabelTarget)));

  if (showDays) {
    for (
      let value = Math.ceil(viewport.start_value);
      value <= viewport.end_value;
      value += 1
    ) {
      const date = ordinalToDate(value);

      dayTicks.push({
        value,
        label: showAllDayLabels || positiveModulo(Math.round(value), dayLabelStep) === 0
          ? String(date.day)
          : "",
        level: date.day === 1 ? "major" : "minor",
        unit: "day"
      });
    }
  }

  const rulers = [
    { ticks: yearTicks },
    ...(showMonths ? [{ ticks: monthTicks }] : []),
    ...(showDays ? [{ ticks: dayTicks }] : [])
  ];

  return {
    bands,
    gridTicks: buildGridTicks(rulers),
    rulers,
    unit: showDays ? "day" : showMonths ? "month" : "year"
  };
}

function percentWithinRange(value, range) {
  const span = Math.max(1, range.end_value - range.start_value);

  return ((value - range.start_value) / span) * 100;
}

function centerViewportOn(value, viewport, bounds, activePrecision = "day") {
  const span = viewport.end_value - viewport.start_value;

  return clampViewport({
    start_value: value - span / 2,
    end_value: value + span / 2
  }, bounds, activePrecision);
}

function formatValueLabel(value, precision) {
  return formatTimelineDate(snapValueToDate(value, precision));
}

function snapValueToDate(value, precision) {
  return ordinalToTimelineDate(
    clampNumber(Math.round(value), minTimelineValue, maxTimelineValue),
    precision
  );
}

function normalizeIntervalAnswer(startValue, endValue, timeline, bounds) {
  const boundedStart = clampNumber(startValue, bounds.start_value, bounds.end_value);
  const boundedEnd = clampNumber(endValue, bounds.start_value, bounds.end_value);
  const start = snapValueToDate(Math.min(boundedStart, boundedEnd), timeline.start.precision);
  const end = snapValueToDate(Math.max(boundedStart, boundedEnd), timeline.end.precision);

  return lowerOrdinal(end) < lowerOrdinal(start)
    ? { start: end, end }
    : { start, end };
}

function answerFromClick(value, timeline) {
  return {
    start: snapValueToDate(value, timeline.start.precision)
  };
}

function answerToPayload(answer, timeline) {
  const payload = {
    start: answer.start
  };

  if (timeline.kind === "interval") {
    payload.end = answer.end;
  }

  return payload;
}

function buildMarkers(items, answersByQuestionId, activeId, viewport, orderById) {
  const rawMarkers = items
    .map(item => {
      if (item.question_id === activeId) return null;

      const answer = answersByQuestionId[item.question_id];
      if (!answer) return null;

      const timeline = normalizeTimeline(item.timeline);
      const centerValue = getAnswerCenterValue(answer, timeline);
      const centerPercent = percentFromValue(centerValue, viewport);

      if (centerPercent < -20 || centerPercent > 120) return null;

      return {
        answer,
        centerPercent,
        color: markerColors[(orderById.get(item.question_id) || 0) % markerColors.length],
        item,
        order: orderById.get(item.question_id) || 0,
        stack: 0,
        timeline
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.centerPercent - b.centerPercent);

  const stackEndByLevel = [];

  rawMarkers.forEach(marker => {
    const level = stackEndByLevel.findIndex(lastPercent =>
      marker.centerPercent - lastPercent > 13
    );
    const nextLevel = level === -1 ? stackEndByLevel.length : level;

    marker.stack = nextLevel;
    stackEndByLevel[nextLevel] = marker.centerPercent;
  });

  return rawMarkers;
}

function markerTop(stack) {
  const lanes = [78, 88, 54, 44, 96, 34, 70, 60];

  return lanes[stack % lanes.length];
}

function TimelineQueue({
  activeId,
  committedAnswers,
  draftAnswers,
  items,
  onSelect,
  skippedIds
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        overflowX: "auto",
        padding: "2px 0 8px"
      }}
    >
      {items.map((item, index) => {
        const active = activeId === item.question_id;
        const answered = Boolean(committedAnswers[item.question_id]);
        const draft = Boolean(draftAnswers[item.question_id]) && !answered;
        const skipped = skippedIds.has(item.question_id) && !answered;
        const color = markerColors[index % markerColors.length];

        return (
          <button
            key={item.question_id}
            type="button"
            onClick={() => onSelect(item.question_id)}
            title={item.question}
            style={{
              minWidth: "42px",
              height: "36px",
              borderRadius: "999px",
              border: active
                ? "2px solid #fff"
                : answered
                  ? `1px solid ${color}`
                  : skipped
                    ? "1px solid #6f6434"
                    : draft
                      ? "1px solid #3c5f7a"
                      : "1px solid #333",
              background: active
                ? `${color}30`
                : answered
                  ? `${color}18`
                  : skipped
                    ? "#2d2917"
                    : draft
                      ? "#17242d"
                      : "#171717",
              color: answered ? color : skipped ? "#f3d36a" : draft ? "#7dd3fc" : "#777",
              cursor: "pointer",
              fontWeight: "900",
              flexShrink: 0
            }}
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
}

function TimelineTooltip({ tooltip }) {
  if (!tooltip) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: `${tooltip.x}%`,
        top: `${tooltip.y}%`,
        transform: "translate(-50%, -110%)",
        maxWidth: "320px",
        border: "1px solid #3a3a3a",
        borderRadius: "10px",
        background: "rgba(18,18,18,0.96)",
        color: "#f4f4f4",
        fontSize: "12px",
        fontWeight: "750",
        lineHeight: 1.35,
        padding: "8px 10px",
        pointerEvents: "none",
        boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
        zIndex: 30
      }}
    >
      {tooltip.text}
    </div>
  );
}

function TimelineCanvas({
  activeAnswer,
  activeId,
  activeItem,
  activeNumber,
  bounds,
  compactLayout = false,
  committedAnswers,
  items,
  onDraftChange,
  onSelect,
  orderById,
  range,
  resetSignal
}) {
  const activeTimeline = normalizeTimeline(activeItem.timeline);
  const activePrecision = getTimelinePrecision(activeTimeline);
  const minimapRef = useRef(null);
  const minimapDragRef = useRef(null);
  const surfaceRef = useRef(null);
  const dragRef = useRef(null);
  const [viewport, setViewport] = useState(() =>
    clampViewport(range, bounds, activePrecision)
  );
  const viewportRef = useRef(viewport);
  const [dragMode, setDragMode] = useState("");
  const [hoveredValue, setHoveredValue] = useState(null);
  const [markerDateLabel, setMarkerDateLabel] = useState("");
  const [pendingInterval, setPendingInterval] = useState(null);
  const [surfaceWidth, setSurfaceWidth] = useState(900);
  const [tooltip, setTooltip] = useState(null);
  const activeColor = markerColors[(orderById.get(activeId) || 0) % markerColors.length];
  const scale = buildTimelineScale(viewport, surfaceWidth, activePrecision);
  const markers = useMemo(
    () => buildMarkers(items, committedAnswers, activeId, viewport, orderById),
    [activeId, committedAnswers, items, orderById, viewport]
  );
  const placedAnswers = useMemo(
    () => items
      .map(item => {
        const answer = item.question_id === activeId
          ? activeAnswer
          : committedAnswers[item.question_id];

        if (!answer) return null;

        return {
          answer,
          color: markerColors[(orderById.get(item.question_id) || 0) % markerColors.length],
          item,
          timeline: normalizeTimeline(item.timeline)
        };
      })
      .filter(Boolean),
    [activeAnswer, activeId, committedAnswers, items, orderById]
  );
  const pendingIntervalAnswer =
    pendingInterval && activeTimeline.kind === "interval" && !activeAnswer
      ? normalizeIntervalAnswer(
        pendingInterval.anchorValue,
        pendingInterval.floatingValue,
        activeTimeline,
        bounds
      )
      : null;
  const canvasDateLabel = markerDateLabel || (pendingIntervalAnswer
    ? formatAnswer(pendingIntervalAnswer, activeTimeline)
    : hoveredValue === null
    ? activeAnswer
      ? formatAnswer(activeAnswer, activeTimeline)
      : "Hover timeline to preview date"
    : formatValueLabel(hoveredValue, activePrecision));
  const canvasDateContext = markerDateLabel
    ? "Marker date"
    : pendingIntervalAnswer
    ? "Click again to place the other border"
    : hoveredValue === null
    ? activeAnswer
      ? "Placed answer"
      : "Move pointer over the timeline"
    : "Hovered date";
  const viewportStartPercent = percentWithinRange(viewport.start_value, bounds);
  const viewportEndPercent = percentWithinRange(viewport.end_value, bounds);
  const viewportWidthPercent = Math.max(2, viewportEndPercent - viewportStartPercent);

  const updateViewport = useCallback((nextViewport) => {
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
  }, []);

  useEffect(() => {
    updateViewport(clampViewport(range, bounds, activePrecision));
    setHoveredValue(null);
    setMarkerDateLabel("");
    setPendingInterval(null);
  }, [activePrecision, bounds, range, updateViewport]);

  useEffect(() => {
    setHoveredValue(null);
    setMarkerDateLabel("");
    setPendingInterval(null);
  }, [activeId, resetSignal]);

  useEffect(() => {
    if (activeAnswer) {
      setPendingInterval(null);
    }
  }, [activeAnswer]);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return undefined;

    const updateWidth = () => {
      setSurfaceWidth(node.getBoundingClientRect().width || 900);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const nodes = [
      surfaceRef.current,
      minimapRef.current
    ].filter(Boolean);

    if (nodes.length === 0) return undefined;

    function handleWheel(event) {
      event.preventDefault();
      event.stopPropagation();

      const rect = event.currentTarget.getBoundingClientRect();
      const zoomFactor = event.deltaY < 0 ? 0.78 : 1.28;
      const current = viewportRef.current;
      const ratio = clampNumber((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const centerValue = current.start_value +
        ratio * (current.end_value - current.start_value);

      setHoveredValue(centerValue);
      setPendingInterval(prev => (
        prev && activeTimeline.kind === "interval" && !activeAnswer
          ? { ...prev, floatingValue: centerValue }
          : prev
      ));
      updateViewport(zoomViewport(current, bounds, centerValue, zoomFactor, activePrecision));
    }

    nodes.forEach(node => node.addEventListener("wheel", handleWheel, { passive: false }));

    return () => {
      nodes.forEach(node => node.removeEventListener("wheel", handleWheel));
    };
  }, [activeAnswer, activePrecision, activeTimeline.kind, bounds, updateViewport]);

  function valueFromClientX(clientX, targetViewport = viewport) {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return targetViewport.start_value;

    const ratio = clampNumber((clientX - rect.left) / Math.max(1, rect.width), 0, 1);

    return targetViewport.start_value +
      ratio * (targetViewport.end_value - targetViewport.start_value);
  }

  function valueFromMinimapClientX(clientX) {
    const rect = minimapRef.current?.getBoundingClientRect();
    if (!rect) return viewport.start_value;

    const ratio = clampNumber((clientX - rect.left) / Math.max(1, rect.width), 0, 1);

    return bounds.start_value + ratio * (bounds.end_value - bounds.start_value);
  }

  function placeDraft(value) {
    if (activeTimeline.kind !== "interval") {
      onDraftChange(answerFromClick(value, activeTimeline));
      return;
    }

    if (activeAnswer) {
      return;
    }

    if (!pendingInterval) {
      setPendingInterval({
        anchorValue: value,
        floatingValue: value
      });
      return;
    }

    onDraftChange(normalizeIntervalAnswer(
      pendingInterval.anchorValue,
      value,
      activeTimeline,
      bounds
    ));
    setPendingInterval(null);
  }

  function updateDraggedAnswer(mode, value, dragState) {
    const initialAnswer = dragState.initialAnswer;
    let nextAnswer;

    if (activeTimeline.kind !== "interval" || mode === "point") {
      nextAnswer = {
        start: snapValueToDate(value, activeTimeline.start.precision)
      };
    } else if (mode === "start") {
      const endValue = centerOrdinal(initialAnswer.end);
      nextAnswer = normalizeIntervalAnswer(
        Math.min(value, endValue),
        endValue,
        activeTimeline,
        bounds
      );
    } else if (mode === "end") {
      const startValue = centerOrdinal(initialAnswer.start);
      nextAnswer = normalizeIntervalAnswer(
        startValue,
        Math.max(value, startValue),
        activeTimeline,
        bounds
      );
    } else {
      const delta = value - dragState.startValue;
      nextAnswer = normalizeIntervalAnswer(
        centerOrdinal(initialAnswer.start) + delta,
        centerOrdinal(initialAnswer.end) + delta,
        activeTimeline,
        bounds
      );
    }

    onDraftChange(nextAnswer);
  }

  function capturePointer(event) {
    try {
      surfaceRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may fail in some browser edge cases; dragging still works over the surface.
    }
  }

  function releasePointer(event) {
    try {
      surfaceRef.current?.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore release failures for pointers that were not captured.
    }
  }

  function beginSurfaceDrag(event) {
    if (event.button !== 0) return;

    event.preventDefault();
    setTooltip(null);
    capturePointer(event);
    const startValue = valueFromClientX(event.clientX);
    setHoveredValue(startValue);

    dragRef.current = {
      initialViewport: viewport,
      mode: "surface",
      moved: false,
      pointerId: event.pointerId,
      startValue,
      startX: event.clientX,
      startY: event.clientY
    };
    setDragMode("surface");
  }

  function beginAnswerDrag(event, mode) {
    if (event.button !== 0 || !activeAnswer) return;

    event.preventDefault();
    event.stopPropagation();
    setTooltip(null);
    capturePointer(event);
    setHoveredValue(valueFromClientX(event.clientX));

    dragRef.current = {
      initialAnswer: activeAnswer,
      mode,
      moved: false,
      pointerId: event.pointerId,
      startValue: valueFromClientX(event.clientX),
      startX: event.clientX,
      startY: event.clientY
    };
    setDragMode(mode);
  }

  function handlePointerMove(event) {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const distance = Math.max(
      Math.abs(event.clientX - dragState.startX),
      Math.abs(event.clientY - dragState.startY)
    );

    if (distance > 3) {
      dragState.moved = true;
    }

    if (dragState.mode === "surface") {
      if (!dragState.moved) return;

      const rect = surfaceRef.current?.getBoundingClientRect();
      const span = dragState.initialViewport.end_value - dragState.initialViewport.start_value;
      const deltaValue = -((event.clientX - dragState.startX) / Math.max(1, rect?.width || 1)) * span;
      const nextViewport = panViewport(
        dragState.initialViewport,
        bounds,
        deltaValue,
        activePrecision
      );
      const nextValue = valueFromClientX(event.clientX, nextViewport);

      setHoveredValue(nextValue);
      setPendingInterval(prev => (
        prev && activeTimeline.kind === "interval" && !activeAnswer
          ? { ...prev, floatingValue: nextValue }
          : prev
      ));
      updateViewport(nextViewport);
      return;
    }

    updateDraggedAnswer(dragState.mode, valueFromClientX(event.clientX), dragState);
  }

  function handleSurfacePointerMove(event) {
    const dragState = dragRef.current;
    if (dragState?.mode === "surface" && dragState.pointerId === event.pointerId) {
      handlePointerMove(event);
      return;
    }

    const value = valueFromClientX(event.clientX);

    setHoveredValue(value);
    setPendingInterval(prev => (
      prev && activeTimeline.kind === "interval" && !activeAnswer
        ? { ...prev, floatingValue: value }
        : prev
    ));
    handlePointerMove(event);
  }

  function handleSurfacePointerLeave() {
    if (!dragRef.current && !pendingInterval) {
      setHoveredValue(null);
    }
  }

  function handlePointerUp(event) {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (dragState.mode === "surface" && !dragState.moved) {
      placeDraft(valueFromClientX(event.clientX));
    } else if (dragState.mode !== "surface" && !dragState.moved) {
      updateDraggedAnswer(dragState.mode, valueFromClientX(event.clientX), dragState);
    }

    releasePointer(event);
    dragRef.current = null;
    setHoveredValue(valueFromClientX(event.clientX));
    setDragMode("");
  }

  function zoomFromButton(zoomFactor) {
    const centerValue = activeAnswer
      ? getAnswerCenterValue(activeAnswer, activeTimeline)
      : (viewport.start_value + viewport.end_value) / 2;

    updateViewport(zoomViewport(
      viewportRef.current,
      bounds,
      centerValue,
      zoomFactor,
      activePrecision
    ));
  }

  function resetViewport() {
    updateViewport(clampViewport(range, bounds, activePrecision));
  }

  function beginMinimapDrag(event) {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    setTooltip(null);

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may fail if the pointer was already released.
    }

    minimapDragRef.current = {
      pointerId: event.pointerId
    };
    setDragMode("minimap");
    updateViewport(centerViewportOn(
      valueFromMinimapClientX(event.clientX),
      viewportRef.current,
      bounds,
      activePrecision
    ));
  }

  function handleMinimapPointerMove(event) {
    const dragState = minimapDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    updateViewport(centerViewportOn(
      valueFromMinimapClientX(event.clientX),
      viewportRef.current,
      bounds,
      activePrecision
    ));
  }

  function handleMinimapPointerUp(event) {
    const dragState = minimapDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore release failures for uncaptured pointers.
    }

    minimapDragRef.current = null;
    setDragMode("");
  }

  function showTooltip(text, x, y) {
    setTooltip({
      text,
      x: clampNumber(x, 8, 92),
      y: clampNumber(y, 14, 88)
    });
  }

  function showMarkerDate(answer, timeline) {
    setMarkerDateLabel(formatAnswer(answer, timeline));
  }

  function hideMarkerDate() {
    setMarkerDateLabel("");
  }

  function renderRulers() {
    const rulerHeight = Math.max(rulerRowHeight, scale.rulers.length * rulerRowHeight);

    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "12px",
          height: `${rulerHeight}px`,
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: 2
        }}
      >
        {scale.rulers.map((ruler, rowIndex) => (
          <div
            key={`ruler-${rowIndex}`}
            style={{
              position: "relative",
              height: `${rulerRowHeight}px`
            }}
          >
            {ruler.ticks.map((tick, index) => {
              const left = percentFromValue(tick.value, viewport);
              const millennium = tick.level === "millennium";
              const major = millennium || tick.level === "major";

              if (left < -4 || left > 104) return null;

              return (
                <div
                  key={`ruler-${rowIndex}-${tick.value}-${index}`}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    top: 0,
                    bottom: 0,
                    borderLeft: millennium
                      ? "2px solid rgba(244,212,140,0.72)"
                      : major
                        ? "1px solid rgba(244,240,223,0.38)"
                        : "1px solid rgba(244,240,223,0.16)",
                    color: millennium ? "#f4d48c" : major ? "#f1e8d4" : "#a99c88",
                    fontSize: millennium ? "12px" : major ? "11px" : "10px",
                    fontWeight: millennium ? "950" : major ? "900" : "750",
                    pointerEvents: "none"
                  }}
                >
                  {tick.label && (
                    <div
                      style={{
                        position: "absolute",
                        left: "6px",
                        top: "7px",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {tick.label}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  function renderHoverGuide() {
    if (hoveredValue === null) return null;

    const left = percentFromValue(hoveredValue, viewport);
    if (left < -2 || left > 102) return null;

    const labelLeft = clampNumber(left, 9, 91);
    const rulerHeight = Math.max(rulerRowHeight, scale.rulers.length * rulerRowHeight);

    return (
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 3
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            top: 0,
            bottom: 0,
            width: "46px",
            transform: "translateX(-50%)",
            background: "linear-gradient(90deg, rgba(244,212,140,0), rgba(244,212,140,0.1), rgba(244,212,140,0))"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            top: 0,
            bottom: 0,
            width: "2px",
            transform: "translateX(-50%)",
            borderRadius: "999px",
            background: "linear-gradient(180deg, rgba(244,212,140,0.1), rgba(244,212,140,0.95) 18%, rgba(244,212,140,0.68) 72%, rgba(244,212,140,0.08))",
            boxShadow: "0 0 18px rgba(244,212,140,0.34)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            top: `${answerAnchorTop}%`,
            width: "9px",
            height: "9px",
            transform: "translate(-50%, -50%)",
            border: "2px solid rgba(255,255,255,0.78)",
            borderRadius: "999px",
            background: "#f4d48c",
            boxShadow: "0 0 0 7px rgba(244,212,140,0.15), 0 8px 20px rgba(0,0,0,0.35)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${labelLeft}%`,
            top: `${rulerHeight + 22}px`,
            transform: "translateX(-50%)",
            border: "1px solid rgba(244,212,140,0.52)",
            borderRadius: "999px",
            background: "rgba(19, 18, 15, 0.92)",
            color: "#f4f0df",
            fontSize: "11px",
            fontWeight: "900",
            letterSpacing: 0,
            lineHeight: 1,
            padding: "7px 10px",
            boxShadow: "0 10px 28px rgba(0,0,0,0.38), 0 0 0 1px rgba(0,0,0,0.32)",
            whiteSpace: "nowrap"
          }}
        >
          {formatValueLabel(hoveredValue, activePrecision)}
        </div>
      </div>
    );
  }

  function renderPassiveMarker(marker) {
    const color = marker.color;
    const top = markerTop(marker.stack);
    const text = marker.item.question;
    const answerText = formatAnswer(marker.answer, marker.timeline);
    const stemTop = Math.min(top, answerAnchorTop);
    const stemHeight = Math.abs(answerAnchorTop - top);

    if (marker.timeline.kind === "interval") {
      const start = percentFromValue(centerOrdinal(marker.answer.start), viewport);
      const end = percentFromValue(centerOrdinal(marker.answer.end), viewport);
      const center = (start + end) / 2;
      const width = Math.max(8, Math.abs(end - start));
      const left = center - width / 2;

      return (
        <div
          key={marker.item.question_id}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 5
          }}
        >
          <div
            style={{
              position: "absolute",
              left: `${left}%`,
              top: `${answerAnchorTop}%`,
              width: `${width}%`,
              height: "4px",
              transform: "translateY(-50%)",
              borderRadius: "999px",
              background: `${color}55`,
              boxShadow: `0 0 0 1px ${color}44`,
              pointerEvents: "none"
            }}
          />
          {[start, end].map((point, index) => (
            <div
              key={`${marker.item.question_id}-endpoint-${index}`}
              style={{
                position: "absolute",
                left: `${point}%`,
                top: `${answerAnchorTop}%`,
                width: "9px",
                height: "9px",
                transform: "translate(-50%, -50%)",
                borderRadius: "999px",
                border: `1px solid ${color}`,
                background: "#121212",
                boxShadow: `0 0 0 3px ${color}18`,
                pointerEvents: "none"
              }}
            />
          ))}
          <div
            style={{
              position: "absolute",
              left: `${center}%`,
              top: `${stemTop}%`,
              height: `${stemHeight}%`,
              borderLeft: `1px solid ${color}88`,
              pointerEvents: "none"
            }}
          />
            <button
              type="button"
              onClick={() => onSelect(marker.item.question_id)}
              onBlur={hideMarkerDate}
              onFocus={() => {
                showTooltip(`${text}: ${answerText}`, center, top);
                showMarkerDate(marker.answer, marker.timeline);
              }}
              onMouseEnter={() => {
                showTooltip(`${text}: ${answerText}`, center, top);
                showMarkerDate(marker.answer, marker.timeline);
              }}
              onMouseLeave={() => {
                setTooltip(null);
                hideMarkerDate();
              }}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              position: "absolute",
              left: `${center}%`,
              top: `${top}%`,
              display: "flex",
              alignItems: "center",
              gap: "7px",
              maxWidth: "230px",
              height: "30px",
              transform: "translate(-50%, -50%)",
              borderRadius: "999px",
              border: `1px solid ${color}`,
              background: "#151515",
              color,
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: "900",
              overflow: "hidden",
              padding: "0 10px",
              pointerEvents: "auto",
              zIndex: 2
            }}
          >
            <span>{marker.order + 1}</span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {text}
            </span>
          </button>
        </div>
      );
    }

    const left = percentFromValue(centerOrdinal(marker.answer.start), viewport);

    return (
      <div
        key={marker.item.question_id}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 5
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            top: `${stemTop}%`,
            height: `${stemHeight}%`,
            borderLeft: `1px solid ${color}88`,
            pointerEvents: "none"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            top: `${answerAnchorTop}%`,
            width: "11px",
            height: "11px",
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            border: `2px solid ${color}`,
            background: "#121212",
            boxShadow: `0 0 0 4px ${color}18`,
            pointerEvents: "none"
          }}
        />
          <button
            type="button"
            onClick={() => onSelect(marker.item.question_id)}
            onBlur={hideMarkerDate}
            onFocus={() => {
              showTooltip(`${text}: ${answerText}`, left, top);
              showMarkerDate(marker.answer, marker.timeline);
            }}
            onMouseEnter={() => {
              showTooltip(`${text}: ${answerText}`, left, top);
              showMarkerDate(marker.answer, marker.timeline);
            }}
            onMouseLeave={() => {
              setTooltip(null);
              hideMarkerDate();
            }}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            left: `${left}%`,
            top: `${top}%`,
            display: "flex",
            alignItems: "center",
            gap: "7px",
            maxWidth: "230px",
            height: "30px",
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            border: `1px solid ${color}`,
            background: "#151515",
            color,
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "900",
            overflow: "hidden",
            padding: "0 10px 0 5px",
            pointerEvents: "auto",
            zIndex: 2
          }}
        >
          <span
            style={{
              alignItems: "center",
              background: `${color}22`,
              borderRadius: "999px",
              display: "inline-flex",
              flexShrink: 0,
              height: "22px",
              justifyContent: "center",
              width: "22px"
            }}
          >
            {marker.order + 1}
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {text}
          </span>
        </button>
      </div>
    );
  }

  function renderPendingInterval() {
    if (!pendingIntervalAnswer || !pendingInterval) return null;

    const text = activeItem.question;
    const stemTop = Math.min(activeChipTop, answerAnchorTop);
    const stemHeight = Math.abs(answerAnchorTop - activeChipTop);
    const anchor = percentFromValue(
      clampNumber(pendingInterval.anchorValue, bounds.start_value, bounds.end_value),
      viewport
    );
    const floating = percentFromValue(
      clampNumber(pendingInterval.floatingValue, bounds.start_value, bounds.end_value),
      viewport
    );
    const center = (anchor + floating) / 2;
    const width = Math.max(1, Math.abs(floating - anchor));
    const left = center - width / 2;

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 11
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            top: `${answerAnchorTop}%`,
            width: `${width}%`,
            height: "5px",
            transform: "translateY(-50%)",
            borderRadius: "999px",
            background: activeColor,
            boxShadow: `0 0 0 5px ${activeColor}18, 0 8px 22px rgba(0,0,0,0.34)`,
            opacity: 0.88
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${center}%`,
            top: `${stemTop}%`,
            height: `${stemHeight}%`,
            borderLeft: `2px solid ${activeColor}`,
            boxShadow: `0 0 16px ${activeColor}55`,
            opacity: 0.88
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${center}%`,
            top: `${activeChipTop}%`,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            maxWidth: "280px",
            height: "38px",
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            border: `2px solid ${activeColor}`,
            background: "#151515",
            color: "#f7f7f7",
            fontSize: "12px",
            fontWeight: "950",
            overflow: "hidden",
            padding: "0 14px 0 10px",
            boxShadow: `0 0 0 8px ${activeColor}16, 0 14px 30px rgba(0,0,0,0.32)`,
            opacity: 0.9
          }}
          title={formatAnswer(pendingIntervalAnswer, activeTimeline)}
        >
          <span
            style={{
              alignItems: "center",
              background: activeColor,
              borderRadius: "999px",
              color: "#101010",
              display: "inline-flex",
              flexShrink: 0,
              height: "24px",
              justifyContent: "center",
              width: "24px"
            }}
          >
            {activeNumber}
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {text}
          </span>
        </div>

        {[
          ["anchor", anchor],
          ["floating", floating]
        ].map(([handle, point]) => (
          <div
            key={handle}
            style={{
              position: "absolute",
              left: `${point}%`,
              top: `${answerAnchorTop}%`,
              width: "20px",
              height: "20px",
              transform: "translate(-50%, -50%)",
              borderRadius: "999px",
              border: "2px solid #fff",
              background: activeColor,
              boxShadow: handle === "anchor"
                ? `0 0 0 6px ${activeColor}22, 0 8px 20px rgba(0,0,0,0.42)`
                : "0 8px 20px rgba(0,0,0,0.42)",
              zIndex: 2
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: `${center}%`,
            top: `${answerAnchorTop}%`,
            width: "13px",
            height: "13px",
            transform: "translate(-50%, -50%) rotate(45deg)",
            border: "2px solid #fff",
            borderRadius: "2px 50% 50% 50%",
            background: activeColor,
            boxShadow: `0 0 0 7px ${activeColor}18`,
            padding: 0,
            zIndex: 3
          }}
        />
      </div>
    );
  }

  function renderActiveAnswer() {
    if (!activeAnswer) return null;

    const text = activeItem.question;
    const stemTop = Math.min(activeChipTop, answerAnchorTop);
    const stemHeight = Math.abs(answerAnchorTop - activeChipTop);

    if (activeTimeline.kind === "interval") {
      const start = percentFromValue(centerOrdinal(activeAnswer.start), viewport);
      const end = percentFromValue(centerOrdinal(activeAnswer.end), viewport);
      const center = (start + end) / 2;
      const width = Math.max(1, Math.abs(end - start));
      const left = center - width / 2;

      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 12
          }}
        >
          <div
            style={{
              position: "absolute",
              left: `${left}%`,
              top: `${answerAnchorTop}%`,
              width: `${width}%`,
              height: "5px",
              transform: "translateY(-50%)",
              borderRadius: "999px",
              background: activeColor,
              boxShadow: `0 0 0 5px ${activeColor}18, 0 8px 22px rgba(0,0,0,0.34)`,
              pointerEvents: "none"
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${center}%`,
              top: `${stemTop}%`,
              height: `${stemHeight}%`,
              borderLeft: `2px solid ${activeColor}`,
              boxShadow: `0 0 16px ${activeColor}55`,
              pointerEvents: "none"
            }}
          />
          <button
            type="button"
            onBlur={hideMarkerDate}
            onFocus={() => {
              showTooltip(`${text}: ${formatAnswer(activeAnswer, activeTimeline)}`, center, 50);
              showMarkerDate(activeAnswer, activeTimeline);
            }}
            onMouseEnter={() => {
              showTooltip(`${text}: ${formatAnswer(activeAnswer, activeTimeline)}`, center, 50);
              showMarkerDate(activeAnswer, activeTimeline);
            }}
            onMouseLeave={() => {
              setTooltip(null);
              hideMarkerDate();
            }}
            onPointerDown={(event) => beginAnswerDrag(event, "bar")}
            style={{
              position: "absolute",
              left: `${center}%`,
              top: `${activeChipTop}%`,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              maxWidth: "280px",
              height: "38px",
              transform: "translate(-50%, -50%)",
              borderRadius: "999px",
              border: `2px solid ${activeColor}`,
              background: "#151515",
              color: "#f7f7f7",
              cursor: dragMode === "bar" ? "grabbing" : "grab",
              fontSize: "12px",
              fontWeight: "950",
              overflow: "hidden",
              padding: "0 14px 0 10px",
              pointerEvents: "auto",
              boxShadow: `0 0 0 8px ${activeColor}16, 0 14px 30px rgba(0,0,0,0.32)`
            }}
          >
            <span
              style={{
                alignItems: "center",
                background: activeColor,
                borderRadius: "999px",
                color: "#101010",
                display: "inline-flex",
                flexShrink: 0,
                height: "24px",
                justifyContent: "center",
                width: "24px"
              }}
            >
              {activeNumber}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {text}
            </span>
          </button>

          {[
            ["start", start],
            ["end", end]
          ].map(([handle, point]) => (
            <button
              key={handle}
              type="button"
              aria-label={handle === "start" ? "Move period start" : "Move period end"}
              onBlur={hideMarkerDate}
              onFocus={() => showMarkerDate(activeAnswer, activeTimeline)}
              onMouseEnter={() => showMarkerDate(activeAnswer, activeTimeline)}
              onMouseLeave={hideMarkerDate}
              onPointerDown={(event) => beginAnswerDrag(event, handle)}
              style={{
                position: "absolute",
                left: `${point}%`,
                top: `${answerAnchorTop}%`,
                width: "20px",
                height: "20px",
                transform: "translate(-50%, -50%)",
                borderRadius: "999px",
                border: "2px solid #fff",
                background: activeColor,
                cursor: "ew-resize",
                pointerEvents: "auto",
                boxShadow: "0 8px 20px rgba(0,0,0,0.42)",
                zIndex: 2
              }}
            />
          ))}
          <button
            type="button"
            aria-label="Move period"
            onBlur={hideMarkerDate}
            onFocus={() => showMarkerDate(activeAnswer, activeTimeline)}
            onMouseEnter={() => showMarkerDate(activeAnswer, activeTimeline)}
            onMouseLeave={hideMarkerDate}
            onPointerDown={(event) => beginAnswerDrag(event, "bar")}
            style={{
              position: "absolute",
              left: `${center}%`,
              top: `${answerAnchorTop}%`,
              width: "13px",
              height: "13px",
              transform: "translate(-50%, -50%) rotate(45deg)",
              border: "2px solid #fff",
              borderRadius: "2px 50% 50% 50%",
              background: activeColor,
              boxShadow: `0 0 0 7px ${activeColor}18`,
              cursor: dragMode === "bar" ? "grabbing" : "grab",
              padding: 0,
              pointerEvents: "auto",
              zIndex: 3
            }}
          />
        </div>
      );
    }

    const left = percentFromValue(centerOrdinal(activeAnswer.start), viewport);

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 12
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            top: `${stemTop}%`,
            height: `${stemHeight}%`,
            borderLeft: `2px solid ${activeColor}`,
            boxShadow: `0 0 16px ${activeColor}55`,
            pointerEvents: "none"
          }}
        />
        <button
          type="button"
          aria-label="Move date"
          onBlur={hideMarkerDate}
          onFocus={() => showMarkerDate(activeAnswer, activeTimeline)}
          onMouseEnter={() => showMarkerDate(activeAnswer, activeTimeline)}
          onMouseLeave={hideMarkerDate}
          onPointerDown={(event) => beginAnswerDrag(event, "point")}
          style={{
            position: "absolute",
            left: `${left}%`,
            top: `${answerAnchorTop}%`,
            width: "16px",
            height: "16px",
            transform: "translate(-50%, -50%) rotate(45deg)",
            border: "2px solid #fff",
            borderRadius: "2px 50% 50% 50%",
            background: activeColor,
            boxShadow: `0 0 0 8px ${activeColor}22, 0 10px 24px rgba(0,0,0,0.38)`,
            cursor: dragMode === "point" ? "grabbing" : "grab",
            padding: 0,
            pointerEvents: "auto"
          }}
        />
        <button
          type="button"
          onBlur={hideMarkerDate}
          onFocus={() => {
            showTooltip(`${text}: ${formatAnswer(activeAnswer, activeTimeline)}`, left, 50);
            showMarkerDate(activeAnswer, activeTimeline);
          }}
          onMouseEnter={() => {
            showTooltip(`${text}: ${formatAnswer(activeAnswer, activeTimeline)}`, left, 50);
            showMarkerDate(activeAnswer, activeTimeline);
          }}
          onMouseLeave={() => {
            setTooltip(null);
            hideMarkerDate();
          }}
          onPointerDown={(event) => beginAnswerDrag(event, "point")}
          style={{
            position: "absolute",
            left: `${left}%`,
            top: `${activeChipTop}%`,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            maxWidth: "280px",
            height: "38px",
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            border: `2px solid ${activeColor}`,
            background: "#151515",
            color: "#f7f7f7",
            cursor: dragMode === "point" ? "grabbing" : "grab",
            fontSize: "12px",
            fontWeight: "950",
            overflow: "hidden",
            padding: "0 14px 0 10px",
            pointerEvents: "auto",
            boxShadow: `0 0 0 8px ${activeColor}16, 0 14px 30px rgba(0,0,0,0.32)`
          }}
        >
          <span
            style={{
              alignItems: "center",
              background: activeColor,
              borderRadius: "999px",
              color: "#101010",
              display: "inline-flex",
              flexShrink: 0,
              height: "24px",
              justifyContent: "center",
              width: "24px"
            }}
          >
            {activeNumber}
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {text}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #282828",
        borderRadius: "18px",
        background: "#121212",
        display: "flex",
        flex: compactLayout ? "1 1 auto" : undefined,
        flexDirection: "column",
        height: compactLayout ? "100%" : undefined,
        minHeight: compactLayout ? 0 : "650px",
        overflow: "hidden",
        padding: "18px",
        position: "relative"
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: "14px",
          justifyContent: "space-between",
          marginBottom: "14px",
          position: "relative",
          zIndex: 10
        }}
      >
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div
            style={{
              color: "#f4f0df",
              fontSize: "23px",
              fontWeight: "900",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {canvasDateLabel}
          </div>
          <div style={{ color: "#777", fontSize: "11px", marginTop: "3px" }}>
            {canvasDateContext}
            {!compactLayout && " · Wheel zooms, drag canvas or minimap to move"}
          </div>
        </div>

        <div style={{ display: "flex", flexShrink: 0, gap: "8px" }}>
          <button
            type="button"
            onClick={() => zoomFromButton(0.72)}
            style={{ ...buttonStyle, height: "36px", padding: 0, width: "40px" }}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomFromButton(1.32)}
            style={{ ...buttonStyle, height: "36px", padding: 0, width: "40px" }}
            title="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={resetViewport}
            style={{ ...buttonStyle, height: "36px", padding: "0 12px" }}
            title="Reset view"
          >
            Reset
          </button>
        </div>
      </div>

      <div
        ref={minimapRef}
        onPointerDown={beginMinimapDrag}
        onPointerMove={handleMinimapPointerMove}
        onPointerUp={handleMinimapPointerUp}
        onPointerCancel={handleMinimapPointerUp}
        style={{
          position: "relative",
          height: "76px",
          border: "1px solid #2a2a2a",
          borderRadius: "13px",
          background: "linear-gradient(180deg, #161616, #101010)",
          cursor: dragMode === "minimap" ? "grabbing" : "pointer",
          marginBottom: "14px",
          overflow: "hidden",
          overscrollBehavior: "contain",
          touchAction: "none"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "14px",
            top: "10px",
            color: "#777",
            fontSize: "11px",
            fontWeight: "800",
            zIndex: 2
          }}
        >
          {formatTimelineYear(ordinalToDate(bounds.start_value).year)}
        </div>
        <div
          style={{
            position: "absolute",
            right: "14px",
            top: "10px",
            color: "#777",
            fontSize: "11px",
            fontWeight: "800",
            zIndex: 2
          }}
        >
          {formatTimelineYear(ordinalToDate(bounds.end_value).year)}
        </div>

        <div
          style={{
            position: "absolute",
            left: "14px",
            right: "14px",
            top: "40px",
            height: "4px",
            borderRadius: "999px",
            background: "#3c3326"
          }}
        />

        {placedAnswers.map(entry => {
          const isActive = entry.item.question_id === activeId;

          if (entry.timeline.kind === "interval") {
            const start = percentWithinRange(centerOrdinal(entry.answer.start), bounds);
            const end = percentWithinRange(centerOrdinal(entry.answer.end), bounds);
            const left = clampNumber(Math.min(start, end), 0, 100);
            const width = Math.max(1, Math.abs(end - start));

            return (
              <div
                key={`mini-${entry.item.question_id}`}
                title={`${entry.item.question}: ${formatAnswer(entry.answer, entry.timeline)}`}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  top: isActive ? "34px" : "36px",
                  width: `${width}%`,
                  minWidth: isActive ? "12px" : "8px",
                  height: isActive ? "12px" : "8px",
                  borderRadius: "999px",
                  background: entry.color,
                  boxShadow: isActive ? `0 0 0 5px ${entry.color}22` : "none",
                  transform: "translateY(-50%)",
                  zIndex: isActive ? 5 : 3
                }}
              />
            );
          }

          const left = percentWithinRange(centerOrdinal(entry.answer.start), bounds);

          return (
            <div
              key={`mini-${entry.item.question_id}`}
              title={`${entry.item.question}: ${formatAnswer(entry.answer, entry.timeline)}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: isActive ? "40px" : "42px",
                width: isActive ? "12px" : "8px",
                height: isActive ? "12px" : "8px",
                borderRadius: "999px",
                background: entry.color,
                border: isActive ? "2px solid #fff" : "none",
                boxShadow: isActive ? `0 0 0 5px ${entry.color}22` : "none",
                transform: "translate(-50%, -50%)",
                zIndex: isActive ? 5 : 3
              }}
            />
          );
        })}

        <div
          style={{
            position: "absolute",
            left: `${viewportStartPercent}%`,
            top: "8px",
            width: `${viewportWidthPercent}%`,
            minWidth: "28px",
            bottom: "8px",
            border: "2px solid #f4d48c",
            borderRadius: "10px",
            background: "rgba(244, 212, 140, 0.08)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.35), 0 10px 22px rgba(0,0,0,0.25)",
            pointerEvents: "none",
            zIndex: 4
          }}
        />
      </div>

      <div
        ref={surfaceRef}
        onPointerDown={beginSurfaceDrag}
        onPointerMove={handleSurfacePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handleSurfacePointerLeave}
        style={{
          position: "relative",
          flex: compactLayout ? "1 1 auto" : undefined,
          height: compactLayout ? "auto" : "470px",
          minHeight: compactLayout ? "260px" : undefined,
          background: "linear-gradient(180deg, #181818 0%, #101010 100%)",
          border: "1px solid #292929",
          borderRadius: "14px",
          cursor: dragMode === "surface"
            ? "grabbing"
            : activeTimeline.kind === "interval" && activeAnswer
              ? "grab"
              : "crosshair",
          overflow: "hidden",
          overscrollBehavior: "contain",
          touchAction: "none"
        }}
      >
        {scale.bands.map((band, index) => {
          const left = clampNumber(percentFromValue(band.start, viewport), -20, 120);
          const right = clampNumber(percentFromValue(band.end, viewport), -20, 120);
          const width = Math.max(0, right - left);

          return (
            <div
              key={`${band.start}-${index}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                top: 0,
                bottom: 0,
                background: band.muted
                  ? "rgba(255, 255, 255, 0.032)"
                  : "rgba(255, 255, 255, 0.018)",
                pointerEvents: "none"
              }}
            />
          );
        })}

        {scale.gridTicks.map((tick, index) => {
          const left = percentFromValue(tick.value, viewport);
          const opacity = tick.unit === "millennium"
            ? 0.5
            : tick.unit === "year"
            ? 0.28
            : tick.unit === "month"
              ? 0.14
              : tick.level === "major"
                ? 0.12
                : 0.055;

          if (left < -5 || left > 105) return null;

          return (
            <div
              key={`grid-${tick.value}-${index}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: 0,
                bottom: 0,
                borderLeft: tick.unit === "millennium"
                  ? `2px solid rgba(244,212,140,${opacity})`
                  : `1px solid rgba(244,240,223,${opacity})`,
                pointerEvents: "none",
                zIndex: 1
              }}
            />
          );
        })}

        {renderRulers()}
        {renderHoverGuide()}

        {markers.map(renderPassiveMarker)}
        {renderPendingInterval()}
        {renderActiveAnswer()}
        <TimelineTooltip tooltip={tooltip} />

        {!compactLayout && !activeAnswer && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: `${answerAnchorTop}%`,
              transform: "translate(-50%, 34px)",
              color: "#9c927f",
              fontSize: "13px",
              fontWeight: "800",
              pointerEvents: "none",
              textAlign: "center",
              whiteSpace: "nowrap",
              zIndex: 4
            }}
          >
            {pendingIntervalAnswer
              ? "Click again to place the other border"
              : "Click the timeline to place your answer"}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TimelineReview({
  group,
  reviewItems,
  onComplete,
  submitAnswer = sendTimelineAnswer,
  fillAvailableHeight = false
}) {
  const sortedItems = useMemo(
    () => sortReviewItems(reviewItems || []),
    [reviewItems]
  );
  const [orderedIds, setOrderedIds] = useState(() =>
    sortedItems.map(item => item.question_id)
  );
  const [activeId, setActiveId] = useState(sortedItems[0]?.question_id || null);
  const [committedAnswers, setCommittedAnswers] = useState({});
  const [draftAnswers, setDraftAnswers] = useState({});
  const [skippedIds, setSkippedIds] = useState(() => new Set());
  const [recapResults, setRecapResults] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [canvasResetSignal, setCanvasResetSignal] = useState(0);

  const itemById = useMemo(
    () => new Map(sortedItems.map(item => [item.question_id, item])),
    [sortedItems]
  );
  const orderedItems = orderedIds
    .map(id => itemById.get(id))
    .filter(Boolean);
  const orderById = useMemo(
    () => new Map(orderedItems.map((item, index) => [item.question_id, index])),
    [orderedItems]
  );
  const range = useMemo(
    () => group.range || buildRangeFromItems(sortedItems),
    [group.range, sortedItems]
  );
  const bounds = useMemo(() => buildTimelineBounds(range), [range]);
  const activeItem = itemById.get(activeId) || sortedItems[0] || null;
  const activeTimeline = activeItem ? normalizeTimeline(activeItem.timeline) : null;
  const activeAnswer = activeItem
    ? draftAnswers[activeItem.question_id] || committedAnswers[activeItem.question_id] || null
    : null;
  const activeCanBeCommitted = Boolean(activeItem && activeAnswer);
  const placedCount = sortedItems.filter(item =>
    Boolean(committedAnswers[item.question_id]) ||
    (item.question_id === activeItem?.question_id && activeCanBeCommitted)
  ).length;
  const canSubmit = sortedItems.length > 0 && sortedItems.every(item =>
    Boolean(committedAnswers[item.question_id]) ||
    (item.question_id === activeItem?.question_id && activeCanBeCommitted)
  );

  function setActiveDraft(answer) {
    if (!activeItem) return;

    setDraftAnswers(prev => ({
      ...prev,
      [activeItem.question_id]: answer
    }));
    setSkippedIds(prev => {
      const next = new Set(prev);
      next.delete(activeItem.question_id);
      return next;
    });
    setError("");
  }

  function commitQuestion(questionId) {
    const item = itemById.get(questionId);
    const answer = draftAnswers[questionId] || committedAnswers[questionId];

    if (!item || !answer) return null;

    setCommittedAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
    setSkippedIds(prev => {
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });

    return answer;
  }

  function selectItem(questionId) {
    if (activeItem && questionId !== activeItem.question_id) {
      commitQuestion(activeItem.question_id);
    }

    setActiveId(questionId);
    setError("");
  }

  function findNextUncommitted(afterId, committedOverride = committedAnswers) {
    const startIndex = Math.max(0, orderedIds.indexOf(afterId));
    const rotatedIds = [
      ...orderedIds.slice(startIndex + 1),
      ...orderedIds.slice(0, startIndex + 1)
    ];

    return rotatedIds.find(id => !committedOverride[id]);
  }

  function goNext() {
    if (!activeItem) return;

    const answer = commitQuestion(activeItem.question_id);

    if (!answer) {
      setError("Place an answer on the timeline before moving on.");
      return;
    }

    const nextCommitted = {
      ...committedAnswers,
      [activeItem.question_id]: answer
    };
    const nextId = findNextUncommitted(activeItem.question_id, nextCommitted);

    if (nextId) {
      setActiveId(nextId);
    }

    setError("");
  }

  function skipActiveItem() {
    if (!activeItem) return;

    setSkippedIds(prev => {
      const next = new Set(prev);
      if (!committedAnswers[activeItem.question_id]) {
        next.add(activeItem.question_id);
      }
      return next;
    });
    setOrderedIds(prev => [
      ...prev.filter(id => id !== activeItem.question_id),
      activeItem.question_id
    ]);

    const nextId = orderedIds.find(id =>
      id !== activeItem.question_id &&
      !committedAnswers[id]
    ) || orderedIds.find(id => id !== activeItem.question_id) || activeItem.question_id;

    setActiveId(nextId);
    setCanvasResetSignal(prev => prev + 1);
    setError("");
  }

  async function submitTimeline() {
    if (!activeItem) return;

    const activeCommittedAnswer = draftAnswers[activeItem.question_id]
      || committedAnswers[activeItem.question_id];
    const answersForSubmit = {
      ...committedAnswers,
      ...(activeCommittedAnswer
        ? { [activeItem.question_id]: activeCommittedAnswer }
        : {})
    };

    if (!sortedItems.every(item => answersForSubmit[item.question_id])) {
      setError("Answer every timeline question before validating.");
      return;
    }

    const payload = {};

    orderedItems.forEach(item => {
      const timeline = normalizeTimeline(item.timeline);
      payload[item.question_id] = answerToPayload(
        answersForSubmit[item.question_id],
        timeline
      );
    });

    setCommittedAnswers(answersForSubmit);
    setIsSubmitting(true);
    setError("");

    try {
      const response = await submitAnswer(payload);
      const resultOrder = new Map(orderedItems.map((item, index) => [
        item.question_id,
        index
      ]));
      const sortedResults = (response.results || []).slice().sort((a, b) =>
        (resultOrder.get(a.question_id) || 0) - (resultOrder.get(b.question_id) || 0)
      );

      setRecapResults(sortedResults);
    } catch (requestError) {
      setError(requestError.message || "Impossible de valider cette timeline.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function continueReview() {
    const failedQuestionIds = (recapResults || [])
      .filter(result => result.quality === 0)
      .map(result => result.question_id);

    setRecapResults(null);
    onComplete(failedQuestionIds);
  }

  if (!activeItem || !activeTimeline) {
    return null;
  }

  return (
    <>
      <div
        style={{
          background: "#181818",
          border: "1px solid #262626",
          borderRadius: "18px",
          display: "flex",
          flexDirection: "column",
          height: fillAvailableHeight ? "100%" : undefined,
          minHeight: fillAvailableHeight ? 0 : undefined,
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          ...fadeInStyle
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: fillAvailableHeight ? "12px 16px 10px" : "16px 18px 14px",
            borderBottom: "1px solid #262626",
            background: "linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "20px",
              marginBottom: fillAvailableHeight ? "10px" : "14px"
            }}
          >
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                {!fillAvailableHeight && (
                  <div style={typeBadgeStyle}>TIMELINE</div>
                )}
                <div
                  style={{
                    color: "#777",
                    fontSize: "12px",
                    fontWeight: "800"
                  }}
                >
                  Question {(orderById.get(activeItem.question_id) || 0) + 1} / {sortedItems.length}
                </div>
              </div>
              <div
                style={{
                  color: "#f3f3f3",
                  display: "-webkit-box",
                  fontSize: fillAvailableHeight ? "22px" : "30px",
                  fontWeight: "950",
                  lineHeight: 1.1,
                  overflow: "hidden",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2
                }}
              >
                {activeItem.question}
              </div>
              <div
                style={{
                  color: "#858585",
                  fontSize: "12px",
                  fontWeight: "650",
                  marginTop: "8px"
                }}
              >
                {activeAnswer
                  ? `Placed ${activeTimeline.kind === "interval" ? "period" : "date"}: ${formatAnswer(activeAnswer, activeTimeline)}`
                  : "No answer placed"}
              </div>
            </div>

            <div
              style={{
                alignItems: "flex-end",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                flexShrink: 0
              }}
            >
              <div style={{ color: "#fff", fontSize: "24px", fontWeight: "850" }}>
                {placedCount}
                <span style={{ color: "#666", fontSize: "16px", marginLeft: "4px" }}>
                  / {sortedItems.length}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" onClick={skipActiveItem} style={{ ...buttonStyle, padding: "10px 12px" }}>
                  Skip
                </button>
                <button type="button" onClick={goNext} style={{ ...successButtonStyle, padding: "10px 12px" }}>
                  Next
                </button>
                <button
                  type="button"
                  onClick={submitTimeline}
                  disabled={isSubmitting || !canSubmit}
                  style={{
                    ...successButtonStyle,
                    cursor: isSubmitting || !canSubmit ? "not-allowed" : "pointer",
                    opacity: isSubmitting || !canSubmit ? 0.55 : 1,
                    padding: "10px 12px"
                  }}
                >
                  {isSubmitting ? "Validation..." : "Validate"}
                </button>
              </div>
            </div>
          </div>

          <TimelineQueue
            activeId={activeItem.question_id}
            committedAnswers={committedAnswers}
            draftAnswers={draftAnswers}
            items={orderedItems}
            onSelect={selectItem}
            skippedIds={skippedIds}
          />
        </div>

        <div
          style={{
            display: fillAvailableHeight ? "flex" : undefined,
            flex: fillAvailableHeight ? "1 1 auto" : undefined,
            minHeight: fillAvailableHeight ? 0 : undefined,
            padding: fillAvailableHeight ? "12px 16px" : "18px"
          }}
        >
          <TimelineCanvas
            activeAnswer={activeAnswer}
            activeId={activeItem.question_id}
            activeItem={activeItem}
            activeNumber={(orderById.get(activeItem.question_id) || 0) + 1}
            bounds={bounds}
            compactLayout={fillAvailableHeight}
            committedAnswers={committedAnswers}
            items={orderedItems}
            onDraftChange={setActiveDraft}
            onSelect={selectItem}
            orderById={orderById}
            range={range}
            resetSignal={canvasResetSignal}
          />
        </div>

        {(error || !fillAvailableHeight) && (
          <div
            style={{
              borderTop: "1px solid #262626",
              flexShrink: 0,
              padding: "12px 18px"
            }}
          >
            <div
              style={{
                color: error ? "#ff9aa5" : "#777",
                fontSize: "13px",
                fontWeight: error ? "700" : "500"
              }}
            >
              {error || "Click the timeline to place an answer. Wheel zooms; the minimap shows where you are."}
            </div>
          </div>
        )}
      </div>

      {recapResults && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: "24px"
          }}
        >
          <div
            style={{
              width: "min(920px, 100%)",
              maxHeight: "82vh",
              overflow: "auto",
              borderRadius: "18px",
              border: "1px solid #303030",
              background: "#181818",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
              padding: "22px"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "18px",
                marginBottom: "18px"
              }}
            >
              <div>
                <div style={typeBadgeStyle}>TIMELINE RESULT</div>
                <div
                  style={{
                    marginTop: "12px",
                    color: "#f3f3f3",
                    fontSize: "26px",
                    fontWeight: "800"
                  }}
                >
                  Resultat
                </div>
              </div>

              <button type="button" onClick={continueReview} style={successButtonStyle}>
                Continuer
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px"
              }}
            >
              {recapResults.map(result => {
                const item = itemById.get(result.question_id);
                const timeline = normalizeTimeline(result.expected);

                return (
                  <div
                    key={result.question_id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 180px 180px 100px",
                      gap: "12px",
                      alignItems: "center",
                      border: "1px solid #282828",
                      borderRadius: "12px",
                      background: "#141414",
                      padding: "12px"
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          color: "#eee",
                          fontSize: "14px",
                          fontWeight: "800",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {item?.question || `Question #${result.question_id}`}
                      </div>
                      <div style={{ color: "#777", fontSize: "12px", marginTop: "4px" }}>
                        Error: {result.start.distance} {result.start.unit}
                        {result.end
                          ? ` / ${result.end.distance} ${result.end.unit}`
                          : ""}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#666", fontSize: "10px", fontWeight: "800", marginBottom: "4px" }}>
                        ANSWER
                      </div>
                      <div style={{ color: "#ddd", fontSize: "13px", fontWeight: "700" }}>
                        {formatTimelineAnswer(timeline)}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#666", fontSize: "10px", fontWeight: "800", marginBottom: "4px" }}>
                        YOUR ANSWER
                      </div>
                      <div style={{ color: "#ddd", fontSize: "13px", fontWeight: "700" }}>
                        {formatTimelineDate(result.start.guess)}
                        {result.end
                          ? ` - ${formatTimelineDate(result.end.guess)}`
                          : ""}
                      </div>
                    </div>

                    <div
                      style={{
                        justifySelf: "end",
                        color: qualityColor(result.quality),
                        border: `1px solid ${qualityColor(result.quality)}55`,
                        background: `${qualityColor(result.quality)}16`,
                        borderRadius: "999px",
                        padding: "5px 10px",
                        fontSize: "12px",
                        fontWeight: "900"
                      }}
                    >
                      {qualityLabel(result.quality)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
