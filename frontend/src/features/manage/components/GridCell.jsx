import { useLayoutEffect, useRef, useState } from "react";
import { RichText } from "../../../shared/RichText";

// Rendered maths is what the learner will see, so it is what the cell shows at
// rest. The raw source only appears while the cell is being edited.
const MATH_SOURCE = /\$|\\\(|\\\[/;

const cellShellStyle = {
  border: "1px solid #2a2a2a",
  padding: 0,
  position: "relative",
  verticalAlign: "top"
};

const textareaStyle = {
  background: "transparent",
  border: 0,
  boxSizing: "border-box",
  color: "#eee",
  display: "block",
  fontFamily: "inherit",
  fontSize: "14px",
  lineHeight: "20px",
  minWidth: "132px",
  outline: "none",
  overflow: "hidden",
  padding: "8px 10px",
  resize: "none",
  width: "100%"
};

const overlayStyle = {
  alignItems: "center",
  bottom: 0,
  color: "#eee",
  display: "flex",
  fontSize: "14px",
  left: 0,
  lineHeight: "20px",
  overflow: "hidden",
  padding: "8px 10px",
  pointerEvents: "none",
  position: "absolute",
  right: 0,
  top: 0
};

const clearButtonStyle = {
  background: "transparent",
  border: 0,
  color: "#c98a8a",
  cursor: "pointer",
  fontSize: "11px",
  padding: "0 10px 6px"
};

export default function GridCell({
  columnIndex,
  columnLabel,
  highlighted = false,
  onChange,
  onClear,
  onPasteTable,
  rowIndex,
  rowLabel,
  value = ""
}) {
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);
  const valueOnFocusRef = useRef("");
  const filled = Boolean(String(value).trim());

  // A one-line cell keeps a 6x6 grid on screen; the editor only pays for the
  // height it needs while you are actually typing in it.
  useLayoutEffect(() => {
    const element = textareaRef.current;

    if (!element) return;

    if (!focused) {
      element.style.height = "36px";
      return;
    }

    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 36)}px`;
  }, [focused, value]);

  function handleKeyDown(event) {
    if (event.key !== "Escape") return;

    // Escape is an undo for the cell, so it must not bubble up to the matrix
    // (which would only move focus) or to any modal above the editor.
    event.stopPropagation();
    event.preventDefault();
    onChange(valueOnFocusRef.current);
    textareaRef.current?.blur();
  }

  function handlePaste(event) {
    const text = event.clipboardData?.getData("text/plain") || "";

    if (!onPasteTable?.(text, rowIndex, columnIndex)) return;

    event.preventDefault();
  }

  return (
    <td
      style={{
        ...cellShellStyle,
        ...(highlighted
          ? { background: "#1f2418", borderColor: "#6b8f3a" }
          : null)
      }}
    >
      <textarea
        aria-label={`${rowLabel} × ${columnLabel}`}
        data-grid-cell={`${rowIndex}:${columnIndex}`}
        onBlur={() => setFocused(false)}
        onChange={event => onChange(event.target.value)}
        onFocus={() => {
          valueOnFocusRef.current = value;
          setFocused(true);
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        ref={textareaRef}
        rows={1}
        spellCheck={false}
        style={textareaStyle}
        value={value}
      />

      {!focused && filled && MATH_SOURCE.test(value) && (
        <div aria-hidden="true" style={{ ...overlayStyle, background: "#151515" }}>
          <RichText>{value}</RichText>
        </div>
      )}

      {focused && filled && (
        <button
          onClick={() => onClear()}
          onMouseDown={event => event.preventDefault()}
          style={clearButtonStyle}
          tabIndex={-1}
          type="button"
        >
          Vider
        </button>
      )}
    </td>
  );
}
