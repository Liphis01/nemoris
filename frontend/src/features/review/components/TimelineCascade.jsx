import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildYearTicks,
  clampSlice,
  percentForYear,
  sliceSpan,
  yearFromPercent,
  zoomSliceAt
} from "../../timeline/railGeometry";
import {
  clampNumber,
  daysInMonth,
  formatTimelineYear,
  timelineIndexToYear,
  yearToTimelineIndex
} from "../../timeline/timelineUtils";

const monthNames = [
  "Janv", "Févr", "Mars", "Avr", "Mai", "Juin",
  "Juil", "Août", "Sept", "Oct", "Nov", "Déc"
];

const railStyle = {
  background: "#0d0d0d",
  border: "1px solid #262626",
  borderRadius: "12px",
  boxSizing: "border-box",
  position: "relative"
};

const railLabelStyle = {
  color: "#6d6d6d",
  fontSize: "10px",
  fontWeight: 800,
  letterSpacing: "0.09em",
  textTransform: "uppercase"
};

const cellRowStyle = {
  display: "flex",
  gap: "3px",
  height: "100%",
  padding: "6px",
  boxSizing: "border-box"
};

function cellStyle({ selected, correct, wrong, disabled }) {
  const base = {
    alignItems: "center",
    background: "#161616",
    border: "1px solid transparent",
    borderRadius: "7px",
    color: "#8a8a8a",
    cursor: disabled ? "default" : "pointer",
    display: "flex",
    flex: "1 1 0",
    fontSize: "12px",
    fontWeight: 700,
    justifyContent: "center",
    minWidth: 0,
    padding: 0,
    transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease"
  };

  if (correct) {
    return {
      ...base,
      animation: "answer-pop 0.42s ease",
      background: "#183a24",
      border: "1px solid rgba(134, 239, 172, 0.7)",
      color: "#d7f5df"
    };
  }

  if (wrong) {
    return {
      ...base,
      background: "#3a1d1d",
      border: "1px solid rgba(248, 113, 113, 0.72)",
      color: "#ffd7d7"
    };
  }

  if (selected) {
    return {
      ...base,
      background: "#2b2047",
      border: "1px solid rgba(196, 181, 253, 0.7)",
      boxShadow: "0 0 0 3px rgba(196, 181, 253, 0.12)",
      color: "#e5dcff"
    };
  }

  return base;
}

// The trapezoid that ties a rail's selected cell to the full width of the rail
// below it, so the stack reads as one continuous zoom rather than three
// unrelated pickers.
function Connector({ fromPercent, fromWidthPercent, active }) {
  const left = clampNumber(fromPercent, 0, 100);
  const right = clampNumber(fromPercent + fromWidthPercent, 0, 100);

  return (
    <div aria-hidden="true" style={{ flexShrink: 0, height: "16px" }}>
      <svg
        preserveAspectRatio="none"
        style={{ display: "block", height: "100%", width: "100%" }}
        viewBox="0 0 100 16"
      >
        <polygon
          fill={active ? "rgba(196, 181, 253, 0.10)" : "rgba(120, 120, 120, 0.05)"}
          points={`${left},0 ${right},0 100,16 0,16`}
        />
        <line
          stroke={active ? "rgba(196, 181, 253, 0.42)" : "rgba(120,120,120,0.22)"}
          strokeWidth="0.4"
          x1={left}
          x2="0"
          y1="0"
          y2="16"
        />
        <line
          stroke={active ? "rgba(196, 181, 253, 0.42)" : "rgba(120,120,120,0.22)"}
          strokeWidth="0.4"
          x1={right}
          x2="100"
          y1="0"
          y2="16"
        />
      </svg>
    </div>
  );
}

function YearRail({ slice, setSlice, bounds, selectedYear, onSelectYear, disabled, truthYear }) {
  const railRef = useRef(null);
  const [width, setWidth] = useState(960);
  const draggingRef = useRef(false);

  useEffect(() => {
    const node = railRef.current;

    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(entries => {
      const measured = entries[0]?.contentRect?.width;

      if (measured) setWidth(measured);
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const { ticks, pxPerYear } = useMemo(
    () => buildYearTicks(slice, width),
    [slice, width]
  );

  const percentFromEvent = useCallback((event) => {
    const rect = railRef.current?.getBoundingClientRect();

    if (!rect || rect.width === 0) return 0;

    return clampNumber(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
  }, []);

  const selectFromEvent = useCallback((event) => {
    if (disabled) return;

    const yearIndex = yearFromPercent(percentFromEvent(event), slice);

    onSelectYear(timelineIndexToYear(
      clampNumber(yearIndex, Math.ceil(bounds.start), Math.floor(bounds.end) - 1)
    ));
  }, [bounds, disabled, onSelectYear, percentFromEvent, slice]);

  // Wheel needs a manual non-passive listener: React's onWheel is passive, so it
  // cannot preventDefault and the page would scroll while zooming.
  useEffect(() => {
    const node = railRef.current;

    if (!node) return undefined;

    function handleWheel(event) {
      if (disabled) return;

      event.preventDefault();

      const rect = node.getBoundingClientRect();
      const focusPercent = rect.width
        ? ((event.clientX - rect.left) / rect.width) * 100
        : 50;

      setSlice(current => zoomSliceAt(
        current,
        focusPercent,
        event.deltaY > 0 ? 1.25 : 0.8,
        bounds
      ));
    }

    node.addEventListener("wheel", handleWheel, { passive: false });

    return () => node.removeEventListener("wheel", handleWheel);
  }, [bounds, disabled, setSlice]);

  function handlePointerDown(event) {
    if (disabled) return;

    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    selectFromEvent(event);
  }

  function handlePointerMove(event) {
    if (!draggingRef.current) return;

    selectFromEvent(event);
  }

  function handlePointerUp(event) {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  const selectedIndex = selectedYear === null ? null : yearToTimelineIndex(selectedYear);
  const cellWidthPercent = (1 / sliceSpan(slice)) * 100;
  const truthIndex = truthYear === null || truthYear === undefined
    ? null
    : yearToTimelineIndex(truthYear);

  return (
    <div
      data-testid="timeline-year-rail"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={railRef}
      style={{
        ...railStyle,
        cursor: disabled ? "default" : "crosshair",
        // The rails share the card's spare height rather than letting it pool as
        // dead space: bigger targets on a tall screen, still usable on a short one.
        // Capped, because a year-only question has no month/day rails to share
        // with and the ruler would otherwise stretch into a 300px void.
        flex: "2 1 0",
        maxHeight: "132px",
        minHeight: "72px",
        touchAction: "none"
      }}
    >
      {ticks.map(tick => (
        <div
          key={tick.yearIndex}
          style={{
            background: tick.isLabel ? "#3f3f3f" : "#2a2a2a",
            bottom: tick.isLabel ? "20px" : "26px",
            left: `${tick.percent}%`,
            position: "absolute",
            top: "8px",
            width: "1px"
          }}
        />
      ))}

      {ticks.filter(tick => tick.isLabel).map(tick => (
        <div
          key={`label-${tick.yearIndex}`}
          style={{
            bottom: "5px",
            color: "#7d7d7d",
            fontSize: "10px",
            fontWeight: 700,
            left: `${tick.percent}%`,
            position: "absolute",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap"
          }}
        >
          {formatTimelineYear(tick.year)}
        </div>
      ))}

      {/* The selected year is a cell, not a hairline: at low zoom one year is
          sub-pixel, so it gets a minimum width to stay grabbable and visible. */}
      {selectedIndex !== null && (
        <div
          data-timeline-year-selected
          style={{
            background: "rgba(196, 181, 253, 0.16)",
            border: "1px solid rgba(196, 181, 253, 0.75)",
            borderRadius: "5px",
            bottom: "20px",
            left: `${percentForYear(selectedIndex, slice)}%`,
            minWidth: "3px",
            pointerEvents: "none",
            position: "absolute",
            top: "6px",
            transform: "translateX(-50%)",
            transition: "left 0.14s ease",
            width: `${Math.max(cellWidthPercent, 0.3)}%`
          }}
        />
      )}

      {truthIndex !== null && (
        <div
          style={{
            background: "rgba(126, 226, 168, 0.2)",
            border: "1px solid #7ee2a8",
            borderRadius: "5px",
            bottom: "20px",
            left: `${percentForYear(truthIndex, slice)}%`,
            minWidth: "3px",
            pointerEvents: "none",
            position: "absolute",
            top: "6px",
            transform: "translateX(-50%)",
            width: `${Math.max(cellWidthPercent, 0.3)}%`
          }}
        />
      )}

    </div>
  );
}

function CellRail({ cells, selected, onSelect, disabled, truth, testId, minHeight, maxHeight }) {
  return (
    <div
      data-testid={testId}
      style={{
        ...railStyle,
        flex: "1 1 0",
        maxHeight: `${maxHeight}px`,
        minHeight: `${minHeight}px`,
        // A rail whose parent unit is still unchosen is inert — say so, rather
        // than offering 31 buttons that quietly do nothing.
        opacity: disabled ? 0.4 : 1,
        transition: "opacity 0.15s ease"
      }}
    >
      <div style={cellRowStyle}>
        {cells.map(cell => {
          const isSelected = selected === cell.value;
          const isTruth = truth !== null && truth !== undefined && truth === cell.value;

          return (
            <button
              aria-pressed={isSelected}
              disabled={disabled}
              key={cell.value}
              onClick={() => onSelect(cell.value)}
              style={cellStyle({
                correct: isTruth,
                disabled,
                selected: isSelected && !isTruth,
                wrong: Boolean(truth) && isSelected && !isTruth
              })}
              type="button"
            >
              {cell.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Year → month → day, each rail a literal zoom into the cell selected above it.
// Only the rails the question's precision actually requires are rendered, so a
// year-precision question is a single rail and the screen stays calm.
export default function TimelineCascade({
  precision,
  draft,
  onUnit,
  slice,
  setSlice,
  bounds,
  disabled,
  truthDate
}) {
  const showMonth = precision === "month" || precision === "day";
  const showDay = precision === "day";
  const truthYear = truthDate ? truthDate.year : null;
  const truthMonth = truthDate && showMonth ? truthDate.month : null;
  const truthDay = truthDate && showDay ? truthDate.day : null;

  const monthCells = useMemo(
    () => monthNames.map((label, index) => ({ label, value: index + 1 })),
    []
  );
  const dayCells = useMemo(() => {
    const total = draft.year !== null && draft.month !== null
      ? daysInMonth(draft.year, draft.month)
      : 31;

    return Array.from({ length: total }, (unused, index) => ({
      label: String(index + 1),
      value: index + 1
    }));
  }, [draft.month, draft.year]);

  const selectedYearIndex = draft.year === null ? null : yearToTimelineIndex(draft.year);
  const yearCellPercent = selectedYearIndex === null
    ? 50
    : clampNumber(percentForYear(selectedYearIndex, slice) - (1 / sliceSpan(slice)) * 50, 0, 100);
  const yearCellWidth = Math.max((1 / sliceSpan(slice)) * 100, 0.6);
  const monthCellPercent = draft.month === null ? 50 : ((draft.month - 1) / 12) * 100;

  return (
    <div
      style={{
        display: "flex",
        flex: "1 1 auto",
        flexDirection: "column",
        // With the rails capped, leftover height sits evenly around the cascade
        // instead of pooling under it.
        justifyContent: "center",
        minHeight: 0
      }}
    >
      <div style={{ ...railLabelStyle, alignItems: "baseline", display: "flex", gap: "8px", marginBottom: "4px" }}>
        <span>Année</span>
        {draft.year === null && !disabled && (
          <span style={{ color: "#4f4f4f", letterSpacing: "0.02em", textTransform: "none" }}>
            cliquez sur la règle, ou tapez la date · molette pour zoomer
          </span>
        )}
      </div>
      <YearRail
        bounds={bounds}
        disabled={disabled}
        onSelectYear={year => onUnit("year", year)}
        selectedYear={draft.year}
        setSlice={setSlice}
        slice={slice}
        truthYear={disabled ? truthYear : null}
      />

      {showMonth && (
        <>
          <Connector
            active={draft.year !== null}
            fromPercent={yearCellPercent}
            fromWidthPercent={yearCellWidth}
          />
          <div style={{ ...railLabelStyle, marginBottom: "4px" }}>Mois</div>
          <CellRail
            cells={monthCells}
            disabled={disabled || draft.year === null}
            maxHeight={66}
            minHeight={46}
            onSelect={value => onUnit("month", value)}
            selected={draft.month}
            testId="timeline-month-rail"
            truth={disabled ? truthMonth : null}
          />
        </>
      )}

      {showDay && (
        <>
          <Connector
            active={draft.month !== null}
            fromPercent={monthCellPercent}
            fromWidthPercent={100 / 12}
          />
          <div style={{ ...railLabelStyle, marginBottom: "4px" }}>Jour</div>
          <CellRail
            cells={dayCells}
            disabled={disabled || draft.month === null}
            maxHeight={62}
            minHeight={42}
            onSelect={value => onUnit("day", value)}
            selected={draft.day}
            testId="timeline-day-rail"
            truth={disabled ? truthDay : null}
          />
        </>
      )}
    </div>
  );
}

export { clampSlice };
