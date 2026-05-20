import { useState } from "react";
import { parseTimelineInput } from "../timelineUtils";

const inputStyle = {
  width: "100%",
  background: "#101010",
  border: "1px solid #2a2a2a",
  borderRadius: "8px",
  color: "#eee",
  fontSize: "14px",
  outline: "none",
  padding: "11px 12px",
  boxSizing: "border-box"
};

export default function TimelineQuickDateInput({ onApply }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  function applyInput() {
    const result = parseTimelineInput(input);

    if (!result.timeline) {
      setError(result.error);
      return;
    }

    setError("");
    setInput("");
    onApply?.(result.timeline);
  }

  return (
    <div
      style={{
        border: "1px solid #282828",
        borderRadius: "10px",
        background: "#131313",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "8px",
          alignItems: "start"
        }}
      >
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            minWidth: 0
          }}
        >
          <span
            style={{
              color: "#8a8a8a",
              fontSize: "10px",
              fontWeight: "800",
              letterSpacing: "0.06em",
              textTransform: "uppercase"
            }}
          >
            Quick date
          </span>
          <input
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (error) setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyInput();
              }
            }}
            placeholder="1914, 44 av. J.-C., 06/1944, 06/06/1944, 1914-1918"
            style={{
              ...inputStyle,
              border: error ? "1px solid #7f2d35" : inputStyle.border
            }}
          />
        </label>

        <button
          type="button"
          onClick={applyInput}
          style={{
            alignSelf: "end",
            background: "#2b2047",
            border: "1px solid #4b3b72",
            borderRadius: "8px",
            color: "#d8ccff",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: "800",
            height: "40px",
            padding: "0 12px"
          }}
        >
          Apply
        </button>
      </div>

      {error && (
        <div
          style={{
            color: "#ff9aa5",
            fontSize: "12px",
            fontWeight: "700"
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
