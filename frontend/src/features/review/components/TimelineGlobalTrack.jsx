import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  anchorBounds,
  anchorCenterValue,
  getEraBands,
  selectVisibleAnchors
} from "../../timeline/anchors";
import {
  clampViewport,
  panViewport,
  zoomViewportAt
} from "../../timeline/railGeometry";
import { formatTimelineYear, ordinalToDate } from "../../timeline/timelineUtils";

const eraBands = getEraBands();

const laneOffsets = [34, 58, 82];
// Room kept below the axis for the guess chip, which hangs off it.
const belowAxisPx = 46;
// Lane gap and label width move together: labels are centred on their anchor, so
// a lane can hold two anchors laneGapPx apart only if a label is no wider than
// that. A wide frame packs landmarks tightly, so both are kept modest and long
// names ellipsise — a truncated "Découverte de l'Amé…" on the map still beats a
// landmark that is not on the map at all.
const laneGapPx = 84;
const anchorLabelMaxPx = 80;

// Anchor priority: curated landmarks first, then the user's own mastered cards,
// then the optional tier-1 curated set. Mastered cards outrank tier-1 because
// they are the personal scaffold — the whole reason the anchor layer exists.
function anchorPriority(entry) {
  if ((entry.anchor.tier ?? 1) === 0) return 0;
  if (entry.anchor.source === "mastered") return 1;

  return 2;
}

// Collisions are resolved *vertically*, not by dropping. Two landmarks 60 years
// apart on a 1000-year frame cannot share a row — their labels are wider than
// the gap — but they sit fine one above the other. So each anchor takes the
// first lane it fits in, and only a genuinely hopeless one (no free lane at all)
// is dropped. Resolving these horizontally instead is what used to make the
// user's mastered anchors quietly disappear whenever the frame got wide.
function assignLanes(entries, widthPx, lanes) {
  const placedByLane = lanes.map(() => []);
  const ordered = [...entries].sort((a, b) =>
    anchorPriority(a) - anchorPriority(b) || a.percent - b.percent
  );
  const laned = [];

  ordered.forEach(entry => {
    const px = (entry.percent / 100) * widthPx;
    const lane = placedByLane.findIndex(placed =>
      placed.every(other => Math.abs(other - px) >= laneGapPx)
    );

    if (lane === -1) return;

    placedByLane[lane].push(px);
    laned.push({ ...entry, lane });
  });

  return laned.sort((a, b) => a.percent - b.percent);
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
  quality,
  resetSignal
}) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(960);
  const [height, setHeight] = useState(200);
  const [viewport, setViewport] = useState(() => ({ ...range }));
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef(null);

  // One stable frame per question: however far you roamed on the last card, the
  // next one opens on the same full picture.
  useEffect(() => {
    setViewport({ ...range });
  }, [range, resetSignal]);

  useEffect(() => {
    const node = containerRef.current;

    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;

      if (rect?.width) setWidth(rect.width);
      if (rect?.height) setHeight(rect.height);
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  // Wheel must be a manual non-passive listener; React's onWheel is passive and
  // cannot preventDefault, so the page would scroll while zooming.
  useEffect(() => {
    const node = containerRef.current;

    if (!node) return undefined;

    function handleWheel(event) {
      event.preventDefault();

      const rect = node.getBoundingClientRect();
      const focusPercent = rect.width
        ? ((event.clientX - rect.left) / rect.width) * 100
        : 50;

      setViewport(current => zoomViewportAt(
        current,
        focusPercent,
        event.deltaY > 0 ? 1.25 : 0.8,
        range
      ));
    }

    node.addEventListener("wheel", handleWheel, { passive: false });

    return () => node.removeEventListener("wheel", handleWheel);
  }, [range]);

  const handlePointerDown = useCallback((event) => {
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect) return;

    panRef.current = { rect, x: event.clientX };
    setIsPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event) => {
    const pan = panRef.current;

    if (!pan || !pan.rect.width) return;

    const deltaPercent = ((pan.x - event.clientX) / pan.rect.width) * 100;

    panRef.current = { ...pan, x: event.clientX };
    setViewport(current => panViewport(current, deltaPercent, range));
  }, [range]);

  const handlePointerUp = useCallback((event) => {
    panRef.current = null;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const bands = useMemo(() => eraBands
    .map(band => {
      const startPercent = clampPercent(percentOf(band.startValue, viewport));
      const endPercent = clampPercent(percentOf(band.endValue, viewport));

      return {
        ...band,
        startPercent,
        widthPercent: endPercent - startPercent
      };
    })
    .filter(band => band.widthPercent > 0.6), [viewport]);

  // minGapPx: 1 turns selectVisibleAnchors into a pure in-view / off-view split —
  // all the crowding is settled by the lane pass below, which can use the vertical
  // axis that the horizontal filter cannot.
  const anchorLayer = useMemo(
    () => selectVisibleAnchors(anchors || [], viewport, width, { minGapPx: 1 }),
    [anchors, viewport, width]
  );
  // The axis rides the bottom of the track, always leaving the guess chip its
  // room. When the card is short the track gives up height first — it is context,
  // while the rails below are the thing you actually answer with — so it must
  // stay coherent at any height rather than clipping its own chip.
  const axisTop = Math.max(36, height - belowAxisPx);
  // Only the lanes that still have headroom above the axis are offered; a short
  // track simply shows fewer anchors rather than stacking them off the top.
  const lanes = useMemo(
    () => laneOffsets.filter(offset => axisTop - offset >= 22),
    [axisTop]
  );
  const lanedAnchors = useMemo(
    () => assignLanes(anchorLayer.visible, width, lanes),
    [anchorLayer.visible, lanes, width]
  );

  const isZoomed = clampViewport(viewport, range).end_value - viewport.start_value <
    (range.end_value - range.start_value) - 1;
  const sliceCoverage = sliceRange
    ? (sliceRange.end_value - sliceRange.start_value) /
      Math.max(1, viewport.end_value - viewport.start_value)
    : 1;
  const truthPercent = truth ? clampPercent(percentOf(truth.value, viewport)) : null;
  const guessPercent = guess ? clampPercent(percentOf(guess.value, viewport)) : null;
  const truthColor = quality === 0 ? "#f87171" : quality === 1 ? "#f3d36a" : "#7ee2a8";

  return (
    <div
      data-timeline-global
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={containerRef}
      style={{
        background: "#101010",
        border: "1px solid #262626",
        borderRadius: "14px",
        boxSizing: "border-box",
        // Read-only in the sense that you cannot answer on it — but you can roam
        // it, which is the whole point of a map.
        cursor: isPanning ? "grabbing" : "grab",
        // The track is the elastic member of the card: a tall screen's spare
        // height goes here (the map is worth more than an empty gap above the
        // footer was), and a short screen takes it back from here rather than
        // squeezing the rails you answer with. The axis adapts, so it stays
        // coherent all the way down.
        //
        // The basis must be explicit: every child is absolutely positioned, so the
        // track's intrinsic content height is 0 and a basis of `auto` collapses it
        // to nothing the moment its floor is lowered.
        flex: "1 1 220px",
        maxHeight: "244px",
        minHeight: "56px",
        overflow: "hidden",
        position: "relative",
        touchAction: "none",
        // Without this a pan drag selects the era labels it passes over.
        userSelect: "none"
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
            // Chrome, not data: this says "the rail below is showing this slice".
            // It is not something you placed, so it does not get the violet.
            background: "rgba(255, 255, 255, 0.045)",
            borderLeft: "1px solid rgba(255, 255, 255, 0.28)",
            borderRight: "1px solid rgba(255, 255, 255, 0.28)",
            bottom: 0,
            left: `${clampPercent(percentOf(sliceRange.start_value, viewport))}%`,
            position: "absolute",
            top: 0,
            transition: "left 0.18s ease, width 0.18s ease",
            width: `${Math.max(0.4, clampPercent(percentOf(sliceRange.end_value, viewport)) - clampPercent(percentOf(sliceRange.start_value, viewport)))}%`
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
            {/* Mastered cards used to be painted #9fc2ff — the exact colour of the
                "Époque contemporaine" era label, which means something else
                entirely. They now read as ordinary anchors carrying a small violet
                dot: "yours", said in the one hue that means you. */}
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "4px",
                justifyContent: align === "left"
                  ? "flex-start"
                  : align === "right" ? "flex-end" : "center"
              }}
            >
              {entry.anchor.source === "mastered" && (
                <span
                  style={{
                    background: "#c4b5fd",
                    borderRadius: "50%",
                    flexShrink: 0,
                    height: "4px",
                    width: "4px"
                  }}
                />
              )}
              <span
                style={{
                  color: "#8a8a8a",
                  fontSize: "10px",
                  fontWeight: 700,
                  maxWidth: `${anchorLabelMaxPx}px`,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {entry.anchor.label}
              </span>
            </div>
            <div style={{ color: "#666", fontSize: "9px", fontWeight: 700, textAlign: align }}>
              {formatTimelineYear(ordinalToDate(anchorCenterValue(entry.anchor)).year)}
            </div>
            <div
              style={{
                background: "#4a4a4a",
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
          const left = clampPercent(percentOf(span.startValue, viewport));
          const right = clampPercent(percentOf(span.endValue, viewport));

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

      {isZoomed && (
        <button
          data-timeline-global-reset
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setViewport({ ...range })}
          style={{
            background: "rgba(20, 20, 20, 0.9)",
            border: "1px solid #333",
            borderRadius: "7px",
            color: "#9a9a9a",
            cursor: "pointer",
            fontSize: "10px",
            fontWeight: 800,
            padding: "3px 8px",
            position: "absolute",
            // Bottom-right: the top-right corner is where off-screen anchors
            // stack their edge pills.
            bottom: "6px",
            right: "6px",
            zIndex: 3
          }}
          type="button"
        >
          Reset
        </button>
      )}

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
