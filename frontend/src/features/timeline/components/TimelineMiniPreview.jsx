import { getEraBands } from "../anchors";
import {
  centerOrdinal,
  dateToOrdinal,
  formatTimelineYear,
  formatTimelineAnswer,
  lowerOrdinal,
  maxTimelineValue,
  minTimelineValue,
  normalizeTimeline,
  ordinalToDate,
  upperOrdinal
} from "../timelineUtils";

const eraBands = getEraBands();

function percent(value, start, end) {
  return ((value - start) / Math.max(1, end - start)) * 100;
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

// The named eras that fall inside the preview window, each as a tinted slice —
// the same landscape the reviewer sees, so the author places the date in
// context (is 1789 really in the Contemporaine band?) rather than on a bare line.
function visibleEraBands(range) {
  return eraBands
    .map((band) => {
      const startPercent = clampPercent(percent(band.startValue, range.start, range.end));
      const endPercent = clampPercent(percent(band.endValue, range.start, range.end));

      return {
        id: band.id,
        label: band.label,
        labelColor: band.labelColor,
        tint: band.tint,
        left: startPercent,
        width: endPercent - startPercent
      };
    })
    .filter((band) => band.width > 1);
}

// A wide, era-scale window rather than one hugging the date. Hugging it (the old
// ±10-year behaviour) reduced the named eras to a meaningless sliver; the point
// of this preview is "which era does this land in, and where relative to the ones
// around it". So the window reaches back at least to the medieval boundary (or
// past the date if it is older) and forward to today, guaranteeing several named
// eras are on screen with the date placed among them.
function buildRange(timeline) {
  const values = [lowerOrdinal(timeline.start), upperOrdinal(timeline.start)];

  if (timeline.kind === "interval" && timeline.end) {
    values.push(lowerOrdinal(timeline.end), upperOrdinal(timeline.end));
  }

  const dateLowYear = ordinalToDate(Math.min(...values)).year;
  const dateHighYear = ordinalToDate(Math.max(...values)).year;
  const currentYear = new Date().getFullYear();
  const lowYear = Math.min(dateLowYear, 476);
  const highYear = Math.max(dateHighYear, currentYear);
  const pad = Math.max(60, Math.round((highYear - lowYear) * 0.05));

  return {
    start: Math.max(minTimelineValue, dateToOrdinal(lowYear - pad, 1, 1)),
    end: Math.min(maxTimelineValue, dateToOrdinal(highYear + pad, 12, 31))
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
  const bands = visibleEraBands(range);

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
          {normalized.kind === "interval" ? "Période" : "Date"}
        </div>
      </div>

      <div
        style={{
          height: "58px",
          position: "relative"
        }}
      >
        {bands.map((band) => (
          <div
            key={band.id}
            style={{
              position: "absolute",
              left: `${band.left}%`,
              width: `${band.width}%`,
              top: 0,
              bottom: "16px",
              background: band.tint,
              borderRight: "1px solid rgba(255,255,255,0.05)",
              overflow: "hidden"
            }}
          >
            <span
              style={{
                color: band.labelColor,
                fontSize: "9px",
                fontWeight: 800,
                letterSpacing: "0.05em",
                opacity: 0.75,
                padding: "3px 5px",
                textTransform: "uppercase",
                whiteSpace: "nowrap"
              }}
            >
              {band.label}
            </span>
          </div>
        ))}

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
