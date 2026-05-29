import { useState } from "react";
import { parseTimelineInput } from "../timelineUtils";

const inputStyle = {
  width: "100%",
  background: "#121212",
  border: "1px solid #2a2a2a",
  borderRadius: "10px",
  color: "#eee",
  outline: "none",
  padding: "12px 14px",
  boxSizing: "border-box"
};

const labelStyle = {
  color: "#bbb",
  fontSize: "14px"
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
        display: "flex",
        flexDirection: "column",
        gap: "7px"
      }}
    >
      <span style={labelStyle}>Quick date</span>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "8px",
          alignItems: "stretch"
        }}
      >
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

        <button
          type="button"
          onClick={applyInput}
          style={{
            background: "#2b2047",
            border: "1px solid #4b3b72",
            borderRadius: "10px",
            color: "#d8ccff",
            cursor: "pointer",
            padding: "0 16px"
          }}
        >
          Apply
        </button>
      </div>

      {error && (
        <div
          style={{
            color: "#ff9aa5",
            fontWeight: "700"
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
