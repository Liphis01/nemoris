import { useMemo, useRef, useState } from "react";
import { sendTimelineAnswer } from "../../../api/review";
import { fadeInStyle } from "../../../shared/styles";
import {
  buildRangeFromItems,
  centerOrdinal,
  clampNumber,
  formatTimelineAnswer,
  formatTimelineDate,
  lowerOrdinal,
  normalizeTimeline,
  ordinalToDate,
  ordinalToTimelineDate
} from "../../timeline/timelineUtils";

const colors = [
  "#7dd3fc",
  "#c4b5fd",
  "#f9a8d4",
  "#fcd34d",
  "#86efac",
  "#fca5a5",
  "#93c5fd",
  "#d8b4fe"
];

const typeBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
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
  if (quality === 2) return "Facile";
  if (quality === 1) return "Dur";
  return "Faux";
}

function qualityColor(quality) {
  if (quality === 2) return "#7ee2a8";
  if (quality === 1) return "#ffd36b";
  return "#ff9aa5";
}

function buildTicks(range) {
  const span = Math.max(1, range.end_value - range.start_value);

  return Array.from({ length: 7 }, (_, index) => {
    const value = range.start_value + (span * index) / 6;
    const date = ordinalToDate(value);

    return {
      value,
      label: String(date.year)
    };
  });
}

function percentFromValue(value, range) {
  const span = Math.max(1, range.end_value - range.start_value);
  return clampNumber(((value - range.start_value) / span) * 100, 0, 100);
}

function buildInitialGuesses(items, range) {
  const span = Math.max(1, range.end_value - range.start_value);
  const guesses = {};

  items.forEach((item, index) => {
    const timeline = normalizeTimeline(item.timeline);
    const slot = range.start_value + (span * (index + 1)) / (items.length + 1);
    const start = ordinalToTimelineDate(slot, timeline.start.precision);

    guesses[item.question_id] = {
      start
    };

    if (timeline.kind === "interval") {
      const endSlot = slot + span * 0.08;
      guesses[item.question_id].end = ordinalToTimelineDate(
        clampNumber(endSlot, range.start_value, range.end_value),
        timeline.end.precision
      );
    }
  });

  return guesses;
}

function TimelineMarker({
  item,
  color,
  guess,
  index,
  isFocused,
  onFocus,
  onPointerDown,
  range
}) {
  const timeline = normalizeTimeline(item.timeline);
  const startValue = centerOrdinal(guess.start);
  const left = percentFromValue(startValue, range);

  if (timeline.kind === "interval") {
    const endValue = centerOrdinal(guess.end);
    const endLeft = percentFromValue(endValue, range);
    const barLeft = Math.min(left, endLeft);
    const barWidth = Math.max(1.8, Math.abs(endLeft - left));

    return (
      <div
        style={{
          position: "absolute",
          left: `${barLeft}%`,
          top: `${index * 36 + 18}px`,
          width: `${barWidth}%`,
          height: "16px",
          transform: "translateY(-50%)",
          zIndex: isFocused ? 5 : 2
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "5px 0",
            borderRadius: "999px",
            background: `${color}44`,
            border: `1px solid ${color}99`
          }}
        />
        {["start", "end"].map(handle => (
          <button
            key={handle}
            type="button"
            onPointerDown={(event) => onPointerDown(event, item, handle)}
            onFocus={onFocus}
            title={item.question}
            style={{
              position: "absolute",
              left: handle === "start" ? 0 : "100%",
              top: "50%",
              width: "24px",
              height: "24px",
              borderRadius: "999px",
              border: isFocused ? `2px solid #fff` : `2px solid ${color}`,
              background: "#121212",
              color,
              transform: "translate(-50%, -50%)",
              cursor: "ew-resize",
              fontSize: "11px",
              fontWeight: "900",
              boxShadow: isFocused ? `0 0 0 5px ${color}22` : "none"
            }}
          >
            {handle === "start" ? "S" : "E"}
          </button>
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={(event) => onPointerDown(event, item, "start")}
      onFocus={onFocus}
      title={item.question}
      style={{
        position: "absolute",
        left: `${left}%`,
        top: `${index * 36 + 18}px`,
        width: "28px",
        height: "28px",
        borderRadius: "999px",
        border: isFocused ? "2px solid #fff" : `2px solid ${color}`,
        background: "#121212",
        color,
        transform: "translate(-50%, -50%)",
        cursor: "ew-resize",
        fontSize: "12px",
        fontWeight: "900",
        boxShadow: isFocused ? `0 0 0 5px ${color}22` : "none",
        zIndex: isFocused ? 5 : 2
      }}
    >
      {index + 1}
    </button>
  );
}

export default function TimelineReview({ group, reviewItems, onComplete }) {
  const axisRef = useRef(null);
  const items = reviewItems || [];
  const range = group.range || buildRangeFromItems(items);
  const ticks = useMemo(() => buildTicks(range), [range]);
  const [focusedId, setFocusedId] = useState(items[0]?.question_id || null);
  const [guesses, setGuesses] = useState(() => buildInitialGuesses(items, range));
  const [recapResults, setRecapResults] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  function guessFromPointer(event, precision) {
    const axis = axisRef.current;
    if (!axis) return null;

    const rect = axis.getBoundingClientRect();
    const ratio = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
    const value = range.start_value + (range.end_value - range.start_value) * ratio;

    return ordinalToTimelineDate(value, precision);
  }

  function updateGuess(item, handle, value) {
    const timeline = normalizeTimeline(item.timeline);

    setGuesses(prev => {
      const current = prev[item.question_id] || {};
      const next = {
        ...current,
        [handle]: value
      };

      if (timeline.kind === "interval") {
        const start = next.start || current.start;
        const end = next.end || current.end;

        if (start && end && lowerOrdinal(end) < lowerOrdinal(start)) {
          if (handle === "start") {
            next.end = start;
          } else {
            next.start = end;
          }
        }
      }

      return {
        ...prev,
        [item.question_id]: next
      };
    });
  }

  function handlePointerDown(event, item, handle) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setFocusedId(item.question_id);

    const timeline = normalizeTimeline(item.timeline);
    const precision = handle === "end"
      ? timeline.end.precision
      : timeline.start.precision;

    const firstGuess = guessFromPointer(event, precision);
    if (firstGuess) updateGuess(item, handle, firstGuess);

    function handlePointerMove(moveEvent) {
      const nextGuess = guessFromPointer(moveEvent, precision);
      if (nextGuess) updateGuess(item, handle, nextGuess);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  async function submitTimeline() {
    const payload = {};

    items.forEach(item => {
      const timeline = normalizeTimeline(item.timeline);
      const guess = guesses[item.question_id];

      payload[item.question_id] = {
        start: guess.start
      };

      if (timeline.kind === "interval") {
        payload[item.question_id].end = guess.end;
      }
    });

    setIsSubmitting(true);
    setError("");

    try {
      const response = await sendTimelineAnswer(payload);
      setRecapResults(response.results || []);
    } catch (submitError) {
      setError(submitError.message || "Impossible de valider cette timeline.");
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

  return (
    <>
      <div
        style={{
          background: "#181818",
          border: "1px solid #262626",
          borderRadius: "18px",
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          ...fadeInStyle
        }}
      >
        <div
          style={{
            padding: "22px 24px 18px",
            borderBottom: "1px solid #262626",
            background: "linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "20px"
            }}
          >
            <div>
              <div style={typeBadgeStyle}>TIMELINE</div>
              <div
                style={{
                  marginTop: "14px",
                  color: "#f3f3f3",
                  fontSize: "28px",
                  fontWeight: "800"
                }}
              >
                Dates a placer
              </div>
            </div>

            <div style={{ color: "#888", textAlign: "right" }}>
              <div style={{ color: "#fff", fontSize: "28px", fontWeight: "800" }}>
                {items.length}
              </div>
              <div style={{ fontSize: "12px" }}>items</div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px minmax(0, 1fr)",
            minHeight: "420px"
          }}
        >
          <div
            style={{
              borderRight: "1px solid #262626",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxHeight: "560px",
              overflow: "auto"
            }}
          >
            {items.map((item, index) => {
              const color = colors[index % colors.length];
              const guess = guesses[item.question_id];
              const timeline = normalizeTimeline(item.timeline);
              const selected = focusedId === item.question_id;

              return (
                <button
                  key={item.question_id}
                  type="button"
                  onClick={() => setFocusedId(item.question_id)}
                  style={{
                    border: selected ? `1px solid ${color}` : "1px solid #2a2a2a",
                    borderRadius: "12px",
                    background: selected ? `${color}18` : "#141414",
                    color: "#eee",
                    cursor: "pointer",
                    padding: "12px",
                    textAlign: "left"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "8px"
                    }}
                  >
                    <span
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "999px",
                        background: `${color}22`,
                        border: `1px solid ${color}`,
                        color,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        fontWeight: "900",
                        flexShrink: 0
                      }}
                    >
                      {index + 1}
                    </span>
                    <span
                      style={{
                        color: "#f3f3f3",
                        fontSize: "14px",
                        fontWeight: "800",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {item.question}
                    </span>
                  </div>

                  <div
                    style={{
                      color: "#999",
                      fontSize: "12px",
                      lineHeight: 1.45
                    }}
                  >
                    {timeline.kind === "interval" ? "Intervalle" : "Date"} · {timeline.start.precision}
                  </div>

                  {guess && (
                    <div
                      style={{
                        color,
                        fontSize: "12px",
                        fontWeight: "700",
                        marginTop: "6px"
                      }}
                    >
                      {formatTimelineDate(guess.start)}
                      {timeline.kind === "interval" && guess.end
                        ? ` - ${formatTimelineDate(guess.end)}`
                        : ""}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div
            style={{
              padding: "24px",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "22px"
            }}
          >
            <div
              ref={axisRef}
              style={{
                position: "relative",
                minHeight: `${Math.max(240, items.length * 36 + 64)}px`,
                border: "1px solid #2a2a2a",
                borderRadius: "14px",
                background: "#101010",
                overflow: "hidden",
                padding: "34px 18px 40px",
                boxSizing: "border-box"
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "18px",
                  right: "18px",
                  top: "36px",
                  bottom: "42px"
                }}
              >
                {items.map((item, index) => (
                  <div
                    key={`lane-${item.question_id}`}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: `${index * 36 + 18}px`,
                      height: "1px",
                      background: "#242424"
                    }}
                  />
                ))}

                {ticks.map((tick, index) => {
                  const left = percentFromValue(tick.value, range);

                  return (
                    <div
                      key={`${tick.label}-${index}`}
                      style={{
                        position: "absolute",
                        left: `${left}%`,
                        top: "-14px",
                        bottom: "-8px",
                        borderLeft: "1px solid #242424",
                        color: "#777",
                        fontSize: "11px",
                        pointerEvents: "none"
                      }}
                    >
                      <div
                        style={{
                          transform: "translateX(-50%)",
                          marginTop: "-18px",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {tick.label}
                      </div>
                    </div>
                  );
                })}

                {items.map((item, index) => {
                  const color = colors[index % colors.length];
                  const guess = guesses[item.question_id];

                  if (!guess) return null;

                  return (
                    <TimelineMarker
                      key={item.question_id}
                      item={item}
                      color={color}
                      guess={guess}
                      index={index}
                      isFocused={focusedId === item.question_id}
                      onFocus={() => setFocusedId(item.question_id)}
                      onPointerDown={handlePointerDown}
                      range={range}
                    />
                  );
                })}
              </div>
            </div>

            {error && (
              <div
                style={{
                  border: "1px solid #6b2b31",
                  borderRadius: "12px",
                  background: "#3a1f24",
                  color: "#ff9aa5",
                  padding: "12px 14px",
                  fontSize: "13px"
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "14px"
              }}
            >
              <div style={{ color: "#777", fontSize: "13px" }}>
                Glisse les marqueurs sur la frise, puis valide.
              </div>

              <button
                type="button"
                onClick={submitTimeline}
                disabled={isSubmitting || items.length === 0}
                style={{
                  ...successButtonStyle,
                  opacity: isSubmitting ? 0.7 : 1
                }}
              >
                {isSubmitting ? "Validation..." : "Valider"}
              </button>
            </div>
          </div>
        </div>
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
                const item = items.find(entry => entry.question_id === result.question_id);
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
                        Erreur: {result.start.distance} {result.start.unit}
                        {result.end
                          ? ` / ${result.end.distance} ${result.end.unit}`
                          : ""}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#666", fontSize: "10px", fontWeight: "800", marginBottom: "4px" }}>
                        REPONSE
                      </div>
                      <div style={{ color: "#ddd", fontSize: "13px", fontWeight: "700" }}>
                        {formatTimelineAnswer(timeline)}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#666", fontSize: "10px", fontWeight: "800", marginBottom: "4px" }}>
                        TA REPONSE
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
