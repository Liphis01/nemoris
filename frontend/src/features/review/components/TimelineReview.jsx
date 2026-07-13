import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendTimelineAnswer } from "../../../api/review";
import { fadeInStyle } from "../../../shared/styles";
import { buildSessionAnchors, describeValue } from "../../timeline/anchors";
import {
  buildDisplayRange,
  clampSlice,
  sliceToOrdinalRange,
  yearBoundsFromRange,
  zoomSliceAt
} from "../../timeline/railGeometry";
import {
  centerOrdinal,
  clampNumber,
  daysInMonth,
  formatTimelineDate,
  lowerOrdinal,
  parseTimelineInput
} from "../../timeline/timelineUtils";
import TimelineCascade from "./TimelineCascade";
import TimelineGlobalTrack from "./TimelineGlobalTrack";
import useTimelineReview from "../hooks/useTimelineReview";

const emptyAnchors = [];

// The correction bar's slot is held open for the whole question. If it only took
// up space once a date was graded, the rails below it would shift by exactly
// that much mid-question and the whole cascade would jump under the pointer.
const feedbackSlotHeight = 64;

const typeBadgeStyle = {
  alignItems: "center",
  background: "rgba(196, 181, 253, 0.15)",
  border: "1px solid rgba(196, 181, 253, 0.3)",
  borderRadius: "999px",
  color: "#c4b5fd",
  display: "flex",
  fontSize: "12px",
  fontWeight: 700,
  gap: "6px",
  padding: "5px 10px",
  width: "fit-content"
};

const buttonStyle = {
  background: "#232323",
  border: "1px solid #333",
  borderRadius: "10px",
  color: "#eee",
  cursor: "pointer",
  fontWeight: 700,
  padding: "11px 16px",
  transition: "all 0.15s ease"
};

const primaryButtonStyle = {
  ...buttonStyle,
  background: "#2b2047",
  border: "1px solid rgba(196, 181, 253, 0.45)",
  color: "#d9ccff"
};

const successButtonStyle = {
  ...buttonStyle,
  background: "#1d3a29",
  border: "1px solid #2c5c3e",
  color: "#7ee2a8"
};

const zoomButtonStyle = {
  background: "#161616",
  border: "1px solid #2d2d2d",
  borderRadius: "7px",
  color: "#8a8a8a",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 800,
  padding: "3px 9px"
};

const keycapStyle = {
  alignItems: "center",
  background: "#0d0d0d",
  border: "1px solid #363636",
  borderRadius: "5px",
  color: "#8a8a8a",
  display: "inline-flex",
  fontSize: "10px",
  fontWeight: 800,
  justifyContent: "center",
  lineHeight: 1,
  minWidth: "18px",
  padding: "3px 5px"
};

const endpointPillStyle = (active) => ({
  background: active ? "#2b2047" : "#161616",
  border: `1px solid ${active ? "rgba(196, 181, 253, 0.6)" : "#2d2d2d"}`,
  borderRadius: "8px",
  color: active ? "#d9ccff" : "#7d7d7d",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 800,
  padding: "6px 12px"
});

const placeholderByPrecision = {
  day: "14/07/1789",
  month: "07/1789",
  year: "1789"
};

const unitNouns = {
  days: ["jour", "jours"],
  months: ["mois", "mois"],
  years: ["an", "ans"]
};

function isEditableTarget(target) {
  if (!target || typeof target.closest !== "function") return false;

  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

function qualityColor(quality) {
  if (quality === 2) return "#7ee2a8";
  if (quality === 1) return "#f3d36a";

  return "#ff9aa5";
}

// The backend returns an unsigned distance; the direction is ours to work out,
// and "3 ans trop tôt" teaches far more than "3 ans d'écart".
function describeGap(result) {
  if (!result || result.quality === 2) return "Exact !";

  const distance = result.start?.distance ?? 0;
  const unit = result.start?.unit || "years";
  const [singular, plural] = unitNouns[unit] || unitNouns.years;
  const noun = distance > 1 ? plural : singular;
  const expectedValue = lowerOrdinal(result.expected?.start);
  const guessValue = lowerOrdinal(result.guess?.start || result.start?.guess);
  const direction = guessValue < expectedValue ? "trop tôt" : "trop tard";

  return `${distance} ${noun} ${direction}`;
}

function answerCenterValue(answer, isInterval, precision) {
  const start = draftCenter(answer.start, precision);

  if (!isInterval) return start;

  const end = draftCenter(answer.end, precision);

  if (start === null || end === null) return start;

  return Math.round((start + end) / 2);
}

function draftCenter(draft, precision) {
  if (!draft || draft.year === null) return null;

  return centerOrdinal({
    year: draft.year,
    month: draft.month ?? 1,
    day: draft.day ?? 1,
    precision
  });
}

function formatDraft(draft, precision) {
  if (!draft || draft.year === null) return "";

  return formatTimelineDate({
    year: draft.year,
    month: draft.month ?? 1,
    day: draft.day ?? 1,
    precision: draft.month === null
      ? "year"
      : draft.day === null
        ? "month"
        : precision
  });
}

export default function TimelineReview({
  group,
  reviewItems,
  onAnsweringComplete,
  onComplete,
  submitAnswer = sendTimelineAnswer,
  fillAvailableHeight = false
}) {
  const {
    activeItem,
    activeTimeline,
    answer,
    answeredCount,
    draft,
    endpoint,
    error,
    goNext,
    isComplete,
    isInterval,
    isSubmitting,
    precision,
    range,
    result,
    revealed,
    setEndpoint,
    setParsedDate,
    setUnit,
    skip,
    toggleEndpoint,
    totalCount,
    validate
  } = useTimelineReview({
    group,
    onAnsweringComplete,
    onComplete,
    reviewItems,
    submitAnswer
  });

  const displayRange = useMemo(() => buildDisplayRange(range), [range]);
  const bounds = useMemo(() => yearBoundsFromRange(displayRange), [displayRange]);
  const [slice, setSliceState] = useState(() => ({ ...bounds }));
  const [quickInput, setQuickInput] = useState("");
  const [quickError, setQuickError] = useState("");
  const inputRef = useRef(null);
  const activeId = activeItem?.question_id ?? null;

  // One stable frame per question: the rail always opens on the whole range, so
  // every card of the session starts from the same picture.
  useEffect(() => {
    setSliceState({ ...bounds });
    setQuickInput("");
    setQuickError("");
  }, [activeId, bounds]);

  const setSlice = useCallback((updater) => {
    setSliceState(current => clampSlice(
      typeof updater === "function" ? updater(current) : updater,
      bounds
    ));
  }, [bounds]);

  const anchors = useMemo(
    () => buildSessionAnchors(reviewItems || [], group?.anchors || emptyAnchors),
    [group?.anchors, reviewItems]
  );

  const nudge = useCallback((unit, delta) => {
    if (revealed) return;

    if (unit === "year") {
      const base = draft.year ?? 0;
      const next = base + delta;

      setUnit("year", next === 0 ? (delta > 0 ? 1 : -1) : next);
      return;
    }

    if (unit === "month" && draft.month !== null) {
      setUnit("month", clampNumber(draft.month + delta, 1, 12));
      return;
    }

    if (unit === "day" && draft.day !== null && draft.year !== null && draft.month !== null) {
      setUnit("day", clampNumber(draft.day + delta, 1, daysInMonth(draft.year, draft.month)));
    }
  }, [draft, revealed, setUnit]);

  // The finest unit the question asks for is the one the arrows should move —
  // on a day question you almost always want to shift by a day, not a year.
  const finestUnit = precision === "day" && draft.day !== null
    ? "day"
    : (precision === "month" || precision === "day") && draft.month !== null
      ? "month"
      : "year";

  useEffect(() => {
    function handleKeyDown(event) {
      if (isEditableTarget(event.target)) return;

      if (event.key === "Enter") {
        event.preventDefault();

        if (revealed) {
          goNext();
        } else {
          validate();
        }

        return;
      }

      if (revealed) return;

      if (event.key === "Tab" && isInterval) {
        event.preventDefault();
        toggleEndpoint();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        nudge(finestUnit, (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1));
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        nudge("year", (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
        return;
      }

      // Typing a digit anywhere means "I know the date" — hand the keystroke to
      // the quick field rather than making the user click into it first.
      if (/^[0-9-]$/.test(event.key)) {
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [finestUnit, goNext, isInterval, nudge, revealed, toggleEndpoint, validate]);

  function applyQuickInput() {
    const parsed = parseTimelineInput(quickInput);

    if (!parsed.timeline) {
      setQuickError(parsed.error || "Format de date invalide");
      return;
    }

    setParsedDate(parsed.timeline.start);
    setQuickError("");
    setQuickInput("");
    inputRef.current?.blur();
  }

  function handleQuickKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();

      if (quickInput.trim()) {
        applyQuickInput();
      } else if (revealed) {
        goNext();
      } else {
        validate();
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setQuickInput("");
      setQuickError("");
      inputRef.current?.blur();
    }
  }

  if (!activeItem || !activeTimeline) {
    return null;
  }

  const expected = result?.expected || null;
  const truthDate = expected ? expected.start : null;
  const guessCenter = answerCenterValue(answer, isInterval, precision);
  const guessLabel = isInterval
    ? `${formatDraft(answer.start, precision)} – ${formatDraft(answer.end, precision)}`
    : formatDraft(answer.start, precision);
  const context = draft.year !== null && guessCenter !== null
    ? describeValue(guessCenter)
    : null;
  const sliceRange = sliceToOrdinalRange(slice);

  return (
    <div
      style={{
        background: "#181818",
        border: "1px solid #262626",
        borderRadius: "18px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        height: fillAvailableHeight ? "100%" : undefined,
        minHeight: fillAvailableHeight ? 0 : undefined,
        overflow: "hidden",
        padding: fillAvailableHeight ? "14px 18px 16px" : "20px 22px 22px",
        ...fadeInStyle
      }}
    >
      <div style={{ alignItems: "flex-start", display: "flex", flexShrink: 0, gap: "16px" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          {!fillAvailableHeight && (
            <div style={{ alignItems: "center", display: "flex", gap: "10px", marginBottom: "8px" }}>
              <div style={typeBadgeStyle}>TIMELINE</div>
            </div>
          )}
          <div
            style={{
              color: "#f3f3f3",
              fontSize: fillAvailableHeight ? "19px" : "26px",
              fontWeight: 900,
              lineHeight: 1.15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {activeItem.question}
          </div>
        </div>

        <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "10px" }}>
          {isInterval && !revealed && (
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                data-timeline-endpoint={endpoint === "start" ? "active" : "idle"}
                onClick={() => setEndpoint("start")}
                style={endpointPillStyle(endpoint === "start")}
                type="button"
              >
                Début
              </button>
              <button
                data-timeline-endpoint={endpoint === "end" ? "active" : "idle"}
                onClick={() => setEndpoint("end")}
                style={endpointPillStyle(endpoint === "end")}
                type="button"
              >
                Fin
              </button>
            </div>
          )}
          <div style={{ color: "#777", fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap" }}>
            {/* While a correction is on screen the card is still the current one:
                answeredCount already counts it, so don't advance the counter too. */}
            {Math.min(revealed ? answeredCount : answeredCount + 1, totalCount)} / {totalCount}
          </div>
        </div>
      </div>

      <TimelineGlobalTrack
        anchors={anchors}
        guess={guessCenter === null ? null : { label: guessLabel, value: guessCenter }}
        quality={result?.quality}
        range={displayRange}
        sliceRange={sliceRange}
        truth={truthDate
          ? { label: formatTimelineDate(truthDate), value: centerOrdinal(truthDate) }
          : null}
      />

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexShrink: 0,
          gap: "12px",
          justifyContent: "space-between"
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "10px", minWidth: 0 }}>
          <input
            aria-label="Saisir la date"
            className="app-scrollbar"
            disabled={revealed}
            onBlur={() => quickInput.trim() && applyQuickInput()}
            onChange={event => {
              setQuickInput(event.target.value);
              setQuickError("");
            }}
            onKeyDown={handleQuickKeyDown}
            placeholder={placeholderByPrecision[precision]}
            ref={inputRef}
            style={{
              background: "#101010",
              border: `1px solid ${quickError ? "#f87171" : "#2d2d2d"}`,
              borderRadius: "10px",
              boxSizing: "border-box",
              color: "#eee",
              fontSize: "16px",
              fontWeight: 700,
              outline: "none",
              padding: "10px 14px",
              transition: "border 0.18s ease",
              width: "150px"
            }}
            value={quickInput}
          />
          <div
            data-testid="timeline-answer"
            style={{
              color: guessLabel ? "#e5dcff" : "#5a5a5a",
              fontSize: "20px",
              fontWeight: 900,
              whiteSpace: "nowrap"
            }}
          >
            {guessLabel || "—"}
          </div>
          {context && !revealed && (
            <div style={{ color: "#6d6d6d", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
              {context.eraLabel} · {context.centuryLabel}
            </div>
          )}
        </div>

        <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "6px" }}>
          <button
            onClick={() => setSlice(current => zoomSliceAt(current, 50, 1.6, bounds))}
            style={zoomButtonStyle}
            type="button"
          >
            −
          </button>
          <button
            onClick={() => setSlice(current => zoomSliceAt(current, 50, 0.55, bounds))}
            style={zoomButtonStyle}
            type="button"
          >
            +
          </button>
          <button
            onClick={() => setSlice({ ...bounds })}
            style={zoomButtonStyle}
            type="button"
          >
            Tout voir
          </button>
        </div>
      </div>

      <TimelineCascade
        bounds={bounds}
        disabled={revealed || isSubmitting}
        draft={revealed && truthDate ? (answer[endpoint] || draft) : draft}
        onUnit={setUnit}
        precision={precision}
        setSlice={setSlice}
        slice={slice}
        truthDate={truthDate}
      />

      <div style={{ flexShrink: 0, height: `${feedbackSlotHeight}px` }}>
        {revealed && result && (
          <div
            data-timeline-feedback={result.quality === 0 ? "wrong" : result.quality === 1 ? "close" : "correct"}
            style={{
              alignItems: "center",
              animation: result.quality === 0 ? "answer-shake 0.4s ease" : "answer-pop 0.42s ease",
              background: result.quality === 0 ? "#3a1d1d" : result.quality === 1 ? "#35311f" : "#183a24",
              border: `1px solid ${qualityColor(result.quality)}`,
              borderRadius: "12px",
              boxSizing: "border-box",
              display: "flex",
              gap: "14px",
              height: "100%",
              padding: "0 16px"
            }}
          >
            <div style={{ color: qualityColor(result.quality), fontSize: "17px", fontWeight: 900 }}>
              {result.quality === 2 ? "Exact !" : result.quality === 1 ? "Presque" : "Raté"}
            </div>
            <div style={{ color: "#ddd", fontSize: "14px", fontWeight: 700 }}>
              {formatTimelineDate(expected.start)}
              {expected.end ? ` – ${formatTimelineDate(expected.end)}` : ""}
            </div>
            {result.quality !== 2 && (
              <div style={{ color: "#9a9a9a", fontSize: "13px", fontWeight: 700 }}>
                {describeGap(result)}
              </div>
            )}
          </div>
        )}
        {!revealed && (error || quickError) && (
          <div
            style={{
              alignItems: "center",
              color: "#ff9aa5",
              display: "flex",
              fontSize: "13px",
              fontWeight: 700,
              height: "100%"
            }}
          >
            {error || quickError}
          </div>
        )}
      </div>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexShrink: 0,
          gap: "10px",
          justifyContent: "space-between"
        }}
      >
        <div style={{ color: "#5f5f5f", fontSize: "11px", fontWeight: 700 }}>
          <span style={keycapStyle}>↑↓</span> année · <span style={keycapStyle}>←→</span> ajuster ·{" "}
          <span style={keycapStyle}>↵</span> valider
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          {!revealed && (
            <button onClick={skip} style={buttonStyle} type="button">
              Passer
            </button>
          )}
          {revealed ? (
            <button data-timeline-continue onClick={goNext} style={successButtonStyle} type="button">
              Continuer ↵
            </button>
          ) : (
            <button
              disabled={!isComplete || isSubmitting}
              onClick={validate}
              style={{
                ...primaryButtonStyle,
                cursor: isComplete && !isSubmitting ? "pointer" : "default",
                opacity: isComplete && !isSubmitting ? 1 : 0.45
              }}
              type="button"
            >
              {isSubmitting ? "…" : "Valider ↵"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
