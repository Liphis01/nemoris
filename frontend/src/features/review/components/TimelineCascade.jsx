import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildYearTicks,
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

const accent = "rgba(196, 181, 253, 0.75)";

// A first-time user sees three rulers and no reason to touch any of them. So
// exactly one rail is lit at a time — the next one that needs an answer — and
// the light moves down the cascade as units get chosen.
function railChrome(state) {
  if (state === "active") {
    return {
      border: `1px solid ${accent}`,
      boxShadow: "0 0 0 3px rgba(196, 181, 253, 0.10)",
      opacity: 1
    };
  }

  if (state === "pending") {
    return { border: "1px solid #262626", boxShadow: "none", opacity: 0.35 };
  }

  return { border: "1px solid #262626", boxShadow: "none", opacity: 1 };
}

const stepBadgeStyle = (state) => ({
  alignItems: "center",
  background: state === "active" ? "#2b2047" : "#161616",
  border: `1px solid ${state === "active" ? accent : "#2d2d2d"}`,
  borderRadius: "999px",
  color: state === "active" ? "#d9ccff" : "#5f5f5f",
  display: "inline-flex",
  fontSize: "9px",
  fontWeight: 900,
  height: "15px",
  justifyContent: "center",
  minWidth: "15px"
});

function RailHeader({ step, title, state, hint }) {
  return (
    <div
      style={{
        ...railLabelStyle,
        alignItems: "center",
        color: state === "active" ? "#c4b5fd" : "#6d6d6d",
        display: "flex",
        gap: "7px",
        marginBottom: "clamp(2px, 0.5vh, 4px)",
        opacity: state === "pending" ? 0.5 : 1
      }}
    >
      <span style={stepBadgeStyle(state)}>{step}</span>
      <span>{title}</span>
      {state === "active" && hint && (
        <span
          style={{
            color: "#7d7d7d",
            fontWeight: 700,
            letterSpacing: "0.02em",
            textTransform: "none"
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

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

function YearRail({ slice, setSlice, bounds, selectedYear, onSelectYear, disabled, truthYear, state }) {
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

  const { ticks } = useMemo(() => buildYearTicks(slice, width), [slice, width]);

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
        ...railChrome(state),
        cursor: disabled ? "default" : "crosshair",
        // Fills its wrapper. The floor is viewport-relative so a short window
        // shrinks the rails instead of overflowing them; the cap stops a
        // year-only question stretching the ruler into a 300px void.
        flex: "1 1 auto",
        maxHeight: "132px",
        minHeight: "clamp(46px, 7.6vh, 72px)",
        touchAction: "none",
        transition: "border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease"
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

function CellRail({ cells, selected, onSelect, disabled, truth, testId, minHeight, maxHeight, state }) {
  return (
    <div
      data-testid={testId}
      style={{
        ...railStyle,
        ...railChrome(state),
        flex: "1 1 auto",
        maxHeight,
        minHeight,
        transition: "border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease"
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

  // The lit rail is the first one still missing a value. Once a correction is on
  // screen nothing is actionable, so nothing is lit.
  const activeUnit = disabled
    ? null
    : draft.year === null
      ? "year"
      : showMonth && draft.month === null
        ? "month"
        : showDay && draft.day === null
          ? "day"
          : null;

  function stateOf(unit, parentChosen) {
    if (activeUnit === unit) return "active";
    if (!parentChosen) return "pending";

    return "idle";
  }

  return (
    <div
      style={{
        display: "flex",
        // Grows into spare height, but never shrinks: the rails are the surface
        // you answer with, and squeezing them made them overflow their box and
        // slide under the correction bar.
        flex: "1 0 auto",
        flexDirection: "column",
        gap: "clamp(6px, 1.2vh, 10px)",
        // With the rails capped, leftover height sits evenly around the cascade
        // instead of pooling under it.
        justifyContent: "center"
      }}
    >
      {/* flex-basis auto (not 0) and no minHeight:0 — otherwise the wrapper
          collapses, contributes no intrinsic height to the cascade, and the rail
          inside it overflows downward onto the correction bar. */}
      <div style={{ display: "flex", flex: "2 1 auto", flexDirection: "column" }}>
        <RailHeader
          hint="cliquez sur la règle, ou tapez la date · molette pour zoomer"
          state={stateOf("year", true)}
          step={1}
          title="Année"
        />
        <YearRail
          bounds={bounds}
          disabled={disabled}
          onSelectYear={year => onUnit("year", year)}
          selectedYear={draft.year}
          setSlice={setSlice}
          slice={slice}
          state={stateOf("year", true)}
          truthYear={disabled ? truthYear : null}
        />
      </div>

      {showMonth && (
        <div style={{ display: "flex", flex: "1 1 auto", flexDirection: "column" }}>
          <RailHeader
            hint="choisissez le mois"
            state={stateOf("month", draft.year !== null)}
            step={2}
            title="Mois"
          />
          <CellRail
            cells={monthCells}
            disabled={disabled || draft.year === null}
            maxHeight="66px"
            minHeight="clamp(30px, 4.8vh, 46px)"
            onSelect={value => onUnit("month", value)}
            selected={draft.month}
            state={stateOf("month", draft.year !== null)}
            testId="timeline-month-rail"
            truth={disabled ? truthMonth : null}
          />
        </div>
      )}

      {showDay && (
        <div style={{ display: "flex", flex: "1 1 auto", flexDirection: "column" }}>
          <RailHeader
            hint="choisissez le jour"
            state={stateOf("day", draft.month !== null)}
            step={3}
            title="Jour"
          />
          <CellRail
            cells={dayCells}
            disabled={disabled || draft.month === null}
            maxHeight="62px"
            minHeight="clamp(28px, 4.4vh, 42px)"
            onSelect={value => onUnit("day", value)}
            selected={draft.day}
            state={stateOf("day", draft.month !== null)}
            testId="timeline-day-rail"
            truth={disabled ? truthDay : null}
          />
        </div>
      )}
    </div>
  );
}
