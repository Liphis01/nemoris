import {
  centerOrdinal,
  formatTimelineYear,
  formatTimelineAnswer,
  lowerOrdinal,
  maxTimelineValue,
  minTimelineValue,
  normalizeTimeline,
  ordinalToDate,
  upperOrdinal
} from "../timelineUtils";

function percent(value, start, end) {
  return ((value - start) / Math.max(1, end - start)) * 100;
}

function buildRange(timeline) {
  const values = [
    lowerOrdinal(timeline.start),
    upperOrdinal(timeline.start)
  ];

  if (timeline.kind === "interval" && timeline.end) {
    values.push(lowerOrdinal(timeline.end), upperOrdinal(timeline.end));
  }

  let start = Math.min(...values);
  let end = Math.max(...values);
  const minimumSpan = timeline.start.precision === "day"
    ? 90
    : timeline.start.precision === "month"
      ? 730
      : 3650;
  const currentSpan = Math.max(1, end - start);

  if (currentSpan < minimumSpan) {
    const extra = minimumSpan - currentSpan;
    start -= Math.floor(extra / 2);
    end += Math.ceil(extra / 2);
  }

  const span = Math.max(1, end - start);

  return {
    start: Math.max(minTimelineValue, start - Math.round(span * 0.12)),
    end: Math.min(maxTimelineValue, end + Math.round(span * 0.12))
  };
}

export default function TimelineMiniPreview({ timeline }) {
  const normalized = normalizeTimeline(timeline);
  const range = buildRange(normalized);
  const startPercent = percent(centerOrdinal(normalized.start), range.start, range.end);
  const endPercent = normalized.kind === "interval" && normalized.end
    ? percent(centerOrdinal(normalized.end), range.start, range.end)
    : startPercent;
  const barLeft = Math.min(startPercent, endPercent);
  const barWidth = Math.max(2, Math.abs(endPercent - startPercent));
  const firstYear = ordinalToDate(range.start).year;
  const lastYear = ordinalToDate(range.end).year;

  return (
    <div
      style={{
        border: "1px solid #282828",
        borderRadius: "10px",
        background: "#101010",
        padding: "14px",
        minWidth: 0
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "14px"
        }}
      >
        <div
          style={{
            color: "#ddd",
            fontSize: "15px",
            fontWeight: "900",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {formatTimelineAnswer(normalized)}
        </div>
        <div
          style={{
            color: "#9f8cff",
            fontSize: "11px",
            fontWeight: "800",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            whiteSpace: "nowrap"
          }}
        >
          {normalized.kind === "interval" ? "Period" : "Date"}
        </div>
      </div>

      <div
        style={{
          height: "58px",
          position: "relative"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "28px",
            height: "2px",
            background: "#2d2d2d",
            borderRadius: "999px"
          }}
        />

        {normalized.kind === "interval" && (
          <div
            style={{
              position: "absolute",
              left: `${barLeft}%`,
              top: "23px",
              width: `${barWidth}%`,
              height: "12px",
              borderRadius: "999px",
              background: "rgba(196, 181, 253, 0.32)",
              border: "1px solid rgba(196, 181, 253, 0.6)",
              boxSizing: "border-box"
            }}
          />
        )}

        {[startPercent, endPercent].map((left, index) => {
          if (normalized.kind !== "interval" && index === 1) return null;

          return (
            <div
              key={index}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: "19px",
                width: "20px",
                height: "20px",
                borderRadius: "999px",
                border: "2px solid #c4b5fd",
                background: "#151515",
                boxShadow: "0 0 0 5px rgba(196, 181, 253, 0.12)",
                transform: "translateX(-50%)",
                boxSizing: "border-box"
              }}
            />
          );
        })}

        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            justifyContent: "space-between",
            color: "#666",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums"
          }}
        >
          <span>{formatTimelineYear(firstYear)}</span>
          <span>{formatTimelineYear(lastYear)}</span>
        </div>
      </div>
    </div>
  );
}
