import { useEffect, useMemo, useRef, useState } from "react";
import {
  anchorBounds,
  anchorCenterValue,
  getEraBands,
  selectVisibleAnchors
} from "../../timeline/anchors";
import { formatTimelineYear, ordinalToDate } from "../../timeline/timelineUtils";

const eraBands = getEraBands();

const axisTop = 88;
const laneOffsets = [34, 58];

// selectVisibleAnchors always keeps tier-0 landmarks, collision or not — which
// is right (a curated landmark should never silently vanish) but leaves the two
// world wars and "Aujourd'hui" printed on top of each other. Staggering the
// survivors across two lanes keeps them all, and keeps them readable.
function assignLanes(entries, widthPx) {
  const minGapPx = 96;
  const lastPxByLane = [-Infinity, -Infinity];

  return entries.map(entry => {
    const px = (entry.percent / 100) * widthPx;
    const lane = px - lastPxByLane[0] >= minGapPx ? 0 : 1;

    lastPxByLane[lane] = px;

    return { ...entry, lane };
  });
}

function percentOf(value, range) {
  const span = Math.max(1, range.end_value - range.start_value);

  return ((value - range.start_value) / span) * 100;
}

function clampPercent(percent) {
  return Math.min(100, Math.max(0, percent));
}

const edgePillStyle = {
  alignItems: "center",
  background: "rgba(16, 16, 16, 0.88)",
  border: "1px solid #2a2a2a",
  borderRadius: "999px",
  color: "#6d6d6d",
  display: "flex",
  fontSize: "10px",
  fontWeight: 700,
  gap: "5px",
  maxWidth: "190px",
  padding: "3px 8px",
  position: "absolute",
  whiteSpace: "nowrap",
  zIndex: 1
};

const markerLabelStyle = {
  borderRadius: "6px",
  fontSize: "11px",
  fontWeight: 800,
  lineHeight: 1,
  padding: "4px 7px",
  whiteSpace: "nowrap"
};

// The read-only landscape: named eras, landmark anchors, and — once the rails
// have a value — where the guess and (after grading) the truth fall inside it.
// This never moves and never zooms, so the same picture backs every question of
// the session and spatial memory has something stable to attach to.
export default function TimelineGlobalTrack({
  range,
  anchors,
  sliceRange,
  guess,
  truth,
  quality
}) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(960);

  useEffect(() => {
    const node = containerRef.current;

    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(entries => {
      const measured = entries[0]?.contentRect?.width;

      if (measured) setWidth(measured);
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const bands = useMemo(() => eraBands
    .map(band => {
      const startPercent = clampPercent(percentOf(band.startValue, range));
      const endPercent = clampPercent(percentOf(band.endValue, range));

      return {
        ...band,
        startPercent,
        widthPercent: endPercent - startPercent
      };
    })
    .filter(band => band.widthPercent > 0.6), [range]);

  const anchorLayer = useMemo(
    () => selectVisibleAnchors(anchors || [], range, width, { minGapPx: 92 }),
    [anchors, range, width]
  );
  const lanedAnchors = useMemo(
    () => assignLanes(anchorLayer.visible, width),
    [anchorLayer.visible, width]
  );

  const sliceCoverage = sliceRange
    ? (sliceRange.end_value - sliceRange.start_value) /
      Math.max(1, range.end_value - range.start_value)
    : 1;
  const truthPercent = truth ? clampPercent(percentOf(truth.value, range)) : null;
  const guessPercent = guess ? clampPercent(percentOf(guess.value, range)) : null;
  const truthColor = quality === 0 ? "#f87171" : quality === 1 ? "#f3d36a" : "#7ee2a8";

  return (
    <div
      data-timeline-global
      ref={containerRef}
      style={{
        background: "#101010",
        border: "1px solid #262626",
        borderRadius: "14px",
        boxSizing: "border-box",
        flex: "1 1 auto",
        // Deep enough that the guess chip, which hangs below the axis, is never
        // clipped by the bottom edge.
        maxHeight: "168px",
        minHeight: "142px",
        overflow: "hidden",
        position: "relative"
      }}
    >
      {bands.map(band => (
        <div
          key={band.id}
          style={{
            background: band.tint,
            borderRight: "1px solid rgba(255,255,255,0.05)",
            bottom: 0,
            left: `${band.startPercent}%`,
            position: "absolute",
            top: 0,
            width: `${band.widthPercent}%`
          }}
        >
          <div
            style={{
              color: band.labelColor,
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              opacity: 0.75,
              overflow: "hidden",
              padding: "7px 8px",
              textOverflow: "ellipsis",
              textTransform: "uppercase",
              whiteSpace: "nowrap"
            }}
          >
            {band.label}
          </div>
        </div>
      ))}

      {/* The window the year rail is currently magnifying. At rest the rail shows
          the whole range, and a bracket around everything says nothing — it just
          tints the track. It earns its place only once the rail is zoomed in. */}
      {sliceRange && sliceCoverage < 0.85 && (
        <div
          data-timeline-slice-bracket
          style={{
            background: "rgba(196, 181, 253, 0.09)",
            borderLeft: "1px solid rgba(196, 181, 253, 0.55)",
            borderRight: "1px solid rgba(196, 181, 253, 0.55)",
            bottom: 0,
            left: `${clampPercent(percentOf(sliceRange.start_value, range))}%`,
            position: "absolute",
            top: 0,
            transition: "left 0.18s ease, width 0.18s ease",
            width: `${Math.max(0.4, clampPercent(percentOf(sliceRange.end_value, range)) - clampPercent(percentOf(sliceRange.start_value, range)))}%`
          }}
        />
      )}

      <div
        style={{
          background: "#3a3a3a",
          height: "1px",
          left: 0,
          position: "absolute",
          right: 0,
          top: `${axisTop}px`
        }}
      />

      {lanedAnchors.map(entry => {
        const percent = clampPercent(entry.percent);
        // A label centred on an anchor near either edge would hang off the track
        // and get clipped, so the outermost ones align inward instead.
        const align = percent < 7 ? "left" : percent > 93 ? "right" : "center";
        const tickAlign = align === "left"
          ? "0 auto 0 0"
          : align === "right"
            ? "0 0 0 auto"
            : "0 auto";

        return (
          <div
            key={entry.anchor.id}
            style={{
              left: `${percent}%`,
              position: "absolute",
              top: `${axisTop - laneOffsets[entry.lane]}px`,
              transform: align === "left"
                ? "translateX(0)"
                : align === "right"
                  ? "translateX(-100%)"
                  : "translateX(-50%)"
            }}
          >
            <div
              style={{
                color: entry.anchor.source === "mastered" ? "#9fc2ff" : "#8a8a8a",
                fontSize: "10px",
                fontWeight: 700,
                maxWidth: "112px",
                overflow: "hidden",
                textAlign: align,
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {entry.anchor.label}
            </div>
            <div style={{ color: "#666", fontSize: "9px", fontWeight: 700, textAlign: align }}>
              {formatTimelineYear(ordinalToDate(anchorCenterValue(entry.anchor)).year)}
            </div>
            <div
              style={{
                background: entry.anchor.source === "mastered" ? "#3d5170" : "#4a4a4a",
                height: `${laneOffsets[entry.lane] - 22}px`,
                margin: tickAlign,
                marginTop: "2px",
                width: "1px"
              }}
            />
          </div>
        );
      })}

      {/* Span anchors (a war, a reign) get a bar under the axis, not just a tick. */}
      {anchorLayer.visible
        .filter(entry => entry.anchor.end)
        .map(entry => {
          const span = anchorBounds(entry.anchor);
          const left = clampPercent(percentOf(span.startValue, range));
          const right = clampPercent(percentOf(span.endValue, range));

          return (
            <div
              key={`${entry.anchor.id}-span`}
              style={{
                background: "rgba(160, 160, 160, 0.35)",
                borderRadius: "2px",
                height: "3px",
                left: `${left}%`,
                position: "absolute",
                top: `${axisTop - 1}px`,
                width: `${Math.max(0.3, right - left)}%`
              }}
            />
          );
        })}

      {/* A session sitting in one century leaves every landmark off-screen. They
          still orient you — "1789 is behind us" — so they collapse to an edge
          pill rather than disappearing. */}
      {[
        ...anchorLayer.offLeft.map(entry => ({ entry, side: "left" })),
        ...anchorLayer.offRight.map(entry => ({ entry, side: "right" }))
      ].map(({ entry, side }, index) => (
        <div
          key={`edge-${entry.anchor.id}`}
          style={{
            ...edgePillStyle,
            [side]: "6px",
            top: `${6 + (side === "left"
              ? index
              : index - anchorLayer.offLeft.length) * 20}px`
          }}
        >
          {side === "left" && <span>‹</span>}
          <span style={{ color: "#8f8f8f" }}>
            {formatTimelineYear(ordinalToDate(entry.value).year)}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {entry.anchor.label}
          </span>
          {side === "right" && <span>›</span>}
        </div>
      ))}

      {guessPercent !== null && (
        <div
          data-timeline-guess-pin
          style={{
            left: `${guessPercent}%`,
            position: "absolute",
            top: `${axisTop + 2}px`,
            transform: "translateX(-50%)",
            transition: "left 0.18s ease"
          }}
        >
          <div style={{ background: "#c4b5fd", height: "14px", margin: "0 auto", width: "2px" }} />
          <div
            style={{
              ...markerLabelStyle,
              background: "#2b2047",
              border: "1px solid rgba(196, 181, 253, 0.45)",
              color: "#c4b5fd",
              marginTop: "3px"
            }}
          >
            {guess.label}
          </div>
        </div>
      )}

      {truthPercent !== null && (
        <div
          data-timeline-truth-pin
          style={{
            animation: "answer-pop 0.42s ease",
            left: `${truthPercent}%`,
            position: "absolute",
            top: `${axisTop - 46}px`,
            transform: "translateX(-50%)",
            zIndex: 2
          }}
        >
          <div
            style={{
              ...markerLabelStyle,
              background: "#12291b",
              border: `1px solid ${truthColor}`,
              color: truthColor
            }}
          >
            {truth.label}
          </div>
          <div
            style={{
              background: truthColor,
              height: "30px",
              margin: "3px auto 0",
              width: "2px"
            }}
          />
        </div>
      )}

      {/* The gap between guess and truth, drawn as the distance it actually is. */}
      {truthPercent !== null && guessPercent !== null && (
        <div
          style={{
            background: `repeating-linear-gradient(90deg, ${truthColor} 0 3px, transparent 3px 6px)`,
            height: "2px",
            left: `${Math.min(truthPercent, guessPercent)}%`,
            opacity: 0.8,
            position: "absolute",
            top: `${axisTop}px`,
            width: `${Math.abs(truthPercent - guessPercent)}%`
          }}
        />
      )}
    </div>
  );
}
