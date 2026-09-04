import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendAxis,
  axisNoun,
  cardCount,
  cellIndex,
  clearCell,
  filledCountOnAxis,
  insertAxis,
  moveAxis,
  removeAxis,
  renameAxis,
  setCellValue
} from "../gridSource";
import GridCell from "./GridCell";

const axisInputStyle = {
  background: "#121212",
  border: "1px solid #2a2a2a",
  borderRadius: "7px",
  boxSizing: "border-box",
  color: "#eee",
  fontSize: "13px",
  fontWeight: 700,
  outline: "none",
  padding: "6px 8px",
  width: "100%"
};

const axisButtonStyle = {
  background: "#232323",
  border: "1px solid #333",
  borderRadius: "5px",
  color: "#999",
  cursor: "pointer",
  fontSize: "11px",
  lineHeight: 1,
  padding: "3px 5px"
};

const addButtonStyle = {
  ...axisButtonStyle,
  background: "#1d2b28",
  border: "1px dashed #3c5f58",
  color: "#8ee9d4",
  fontSize: "13px",
  padding: "7px 11px",
  whiteSpace: "nowrap"
};

const headerCellStyle = {
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  minWidth: "132px",
  padding: "7px",
  position: "sticky",
  textAlign: "left",
  top: 0,
  zIndex: 2
};

const rowHeaderStyle = {
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  left: 0,
  minWidth: "150px",
  padding: "7px",
  position: "sticky",
  textAlign: "left",
  zIndex: 1
};

const cornerStyle = {
  background: "#161616",
  border: "1px solid #2a2a2a",
  left: 0,
  padding: "7px",
  position: "sticky",
  top: 0,
  zIndex: 3
};

function disabledStyle(style, disabled) {
  return disabled
    ? { ...style, cursor: "not-allowed", opacity: 0.3 }
    : style;
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase().replace(/[-\s]+/g, " ");
}

function AxisControls({ canRemove, count, index, kind, onInsert, onMove, onRemove }) {
  const noun = axisNoun(kind).toLowerCase();
  const isFirst = index === 0;
  const isLast = index === count - 1;
  const [back, forward] = kind === "rows" ? ["↑", "↓"] : ["←", "→"];

  return (
    <div style={{ display: "flex", gap: "3px", marginTop: "5px" }}>
      <button
        aria-label={`Déplacer la ${noun} ${index + 1} vers l'amont`}
        disabled={isFirst}
        onClick={() => onMove(index, index - 1)}
        style={disabledStyle(axisButtonStyle, isFirst)}
        tabIndex={-1}
        type="button"
      >
        {back}
      </button>

      <button
        aria-label={`Déplacer la ${noun} ${index + 1} vers l'aval`}
        disabled={isLast}
        onClick={() => onMove(index, index + 1)}
        style={disabledStyle(axisButtonStyle, isLast)}
        tabIndex={-1}
        type="button"
      >
        {forward}
      </button>

      <button
        aria-label={`Insérer une ${noun} après la ${noun} ${index + 1}`}
        onClick={() => onInsert(index + 1)}
        style={axisButtonStyle}
        tabIndex={-1}
        type="button"
      >
        ⊕
      </button>

      <button
        aria-label={`Supprimer la ${noun} ${index + 1}`}
        disabled={!canRemove}
        onClick={() => onRemove(index)}
        style={disabledStyle({ ...axisButtonStyle, color: "#c98a8a" }, !canRemove)}
        tabIndex={-1}
        type="button"
      >
        ✕
      </button>
    </div>
  );
}

export default function GridMatrix({ grid, onChange, onPasteTable, searchQuery = "" }) {
  const containerRef = useRef(null);
  const [pendingFocus, setPendingFocus] = useState(null);
  const rows = grid?.rows || [];
  const columns = grid?.columns || [];
  const cells = cellIndex(grid);
  const count = cardCount(grid);
  const normalizedSearch = normalizeSearchText(searchQuery);
  const hasSearch = Boolean(normalizedSearch);
  const matchCellKeys = new Set();
  const matchRowKeys = new Set();
  const matchColumnKeys = new Set();

  if (hasSearch) {
    rows.forEach(row => {
      if (normalizeSearchText(row.label).includes(normalizedSearch)) {
        matchRowKeys.add(row.key);
      }
    });
    columns.forEach(column => {
      if (normalizeSearchText(column.label).includes(normalizedSearch)) {
        matchColumnKeys.add(column.key);
      }
    });
    cells.forEach((cell, key) => {
      if (normalizeSearchText(cell?.value).includes(normalizedSearch)) {
        matchCellKeys.add(key);
      }
    });
  }

  const focusCell = useCallback((rowIndex, columnIndex) => {
    const element = containerRef.current?.querySelector(
      `[data-grid-cell="${rowIndex}:${columnIndex}"]`
    );

    if (!element) return;

    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // A row added by keyboard has to exist before it can be focused, so the move
  // waits one render rather than reaching into the not-yet-committed grid.
  useEffect(() => {
    if (!pendingFocus) return;

    focusCell(pendingFocus.row, pendingFocus.column);
    setPendingFocus(null);
  }, [focusCell, pendingFocus]);

  function removeAxisAt(kind, index) {
    const axis = grid[kind][index];
    const filled = filledCountOnAxis(grid, kind, axis.key);
    const noun = axisNoun(kind).toLowerCase();

    if (filled > 0) {
      const plural = filled > 1 ? "s" : "";
      const confirmed = globalThis.confirm?.(
        `Supprimer la ${noun} « ${axis.label} » et ses ${filled} cellule${plural} remplie${plural} ?`
      );

      if (!confirmed) return;
    }

    onChange(removeAxis(grid, kind, axis.key));
  }

  function handleKeyDown(event) {
    const coordinate = event.target?.dataset?.gridCell;

    if (!coordinate) return;

    const [rowIndex, columnIndex] = coordinate.split(":").map(Number);
    const { selectionEnd, selectionStart, value } = event.target;
    const atStart = selectionStart === 0 && selectionEnd === 0;
    const atEnd = selectionStart === value.length && selectionEnd === value.length;

    const move = (rowDelta, columnDelta) => {
      const nextRow = rowIndex + rowDelta;
      const nextColumn = columnIndex + columnDelta;

      if (nextRow < 0 || nextRow >= rows.length) return;
      if (nextColumn < 0 || nextColumn >= columns.length) return;

      event.preventDefault();
      focusCell(nextRow, nextColumn);
    };

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (rowIndex === rows.length - 1) {
        onChange(appendAxis(grid, "rows"));
        setPendingFocus({ row: rows.length, column: columnIndex });
        return;
      }

      focusCell(rowIndex + 1, columnIndex);
      return;
    }

    // Inside a cell the caret comes first: an arrow only leaves the cell once
    // there is nowhere left to go in the text.
    if (event.key === "ArrowUp" && selectionStart === 0) move(-1, 0);
    if (event.key === "ArrowDown" && atEnd) move(1, 0);
    if (event.key === "ArrowLeft" && atStart) move(0, -1);
    if (event.key === "ArrowRight" && atEnd) move(0, 1);
  }

  return (
    <div
      className="app-scrollbar"
      data-testid="grid-matrix"
      onKeyDown={handleKeyDown}
      ref={containerRef}
      style={{ overflow: "auto", position: "relative" }}
    >
      <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={cornerStyle}>
              <span style={{ color: "#5eead4", fontSize: "12px", fontWeight: 700 }}>
                {count} carte{count > 1 ? "s" : ""}
              </span>
            </th>

            {columns.map((column, columnIndex) => (
              <th
                key={column.key}
                style={{
                  ...headerCellStyle,
                  ...(matchColumnKeys.has(column.key)
                    ? { background: "#1f2418", borderColor: "#6b8f3a" }
                    : null)
                }}
              >
                <input
                  aria-label={`Libellé de la colonne ${columnIndex + 1}`}
                  onChange={event => onChange(renameAxis(grid, "columns", column.key, event.target.value))}
                  style={axisInputStyle}
                  value={column.label}
                />

                <AxisControls
                  canRemove={columns.length > 1}
                  count={columns.length}
                  index={columnIndex}
                  kind="columns"
                  onInsert={index => onChange(insertAxis(grid, "columns", index))}
                  onMove={(from, to) => onChange(moveAxis(grid, "columns", from, to))}
                  onRemove={index => removeAxisAt("columns", index)}
                />
              </th>
            ))}

            <th style={{ ...headerCellStyle, minWidth: 0 }}>
              <button
                onClick={() => onChange(appendAxis(grid, "columns"))}
                style={addButtonStyle}
                tabIndex={-1}
                type="button"
              >
                + Colonne
              </button>
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.key}>
              <th
                style={{
                  ...rowHeaderStyle,
                  ...(matchRowKeys.has(row.key)
                    ? { background: "#1f2418", borderColor: "#6b8f3a" }
                    : null)
                }}
              >
                <input
                  aria-label={`Libellé de la ligne ${rowIndex + 1}`}
                  onChange={event => onChange(renameAxis(grid, "rows", row.key, event.target.value))}
                  style={axisInputStyle}
                  value={row.label}
                />

                <AxisControls
                  canRemove={rows.length > 1}
                  count={rows.length}
                  index={rowIndex}
                  kind="rows"
                  onInsert={index => onChange(insertAxis(grid, "rows", index))}
                  onMove={(from, to) => onChange(moveAxis(grid, "rows", from, to))}
                  onRemove={index => removeAxisAt("rows", index)}
                />
              </th>

              {columns.map((column, columnIndex) => (
                <GridCell
                  columnIndex={columnIndex}
                  columnLabel={column.label}
                  highlighted={matchCellKeys.has(`${row.key}:${column.key}`)}
                  key={column.key}
                  onChange={value => onChange(setCellValue(grid, row.key, column.key, value))}
                  onClear={() => onChange(clearCell(grid, row.key, column.key))}
                  onPasteTable={onPasteTable}
                  rowIndex={rowIndex}
                  rowLabel={row.label}
                  value={cells.get(`${row.key}:${column.key}`)?.value || ""}
                />
              ))}

              <td style={{ background: "#151515", border: "1px solid #2a2a2a" }} />
            </tr>
          ))}

          <tr>
            <th style={{ ...rowHeaderStyle, background: "#161616" }}>
              <button
                onClick={() => onChange(appendAxis(grid, "rows"))}
                style={addButtonStyle}
                tabIndex={-1}
                type="button"
              >
                + Ligne
              </button>
            </th>
            <td colSpan={columns.length + 1} style={{ background: "#151515" }} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
