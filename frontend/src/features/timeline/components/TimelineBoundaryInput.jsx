import {
  daysInMonth,
  normalizeTimelineDate,
  timelinePrecisions
} from "../timelineUtils";

const fieldLabelStyle = {
  color: "#8a8a8a",
  fontSize: "10px",
  fontWeight: "800",
  letterSpacing: "0.06em",
  textTransform: "uppercase"
};

const inputStyle = {
  width: "100%",
  background: "#101010",
  border: "1px solid #2a2a2a",
  borderRadius: "8px",
  color: "#eee",
  fontSize: "14px",
  outline: "none",
  padding: "10px 11px",
  boxSizing: "border-box"
};

export default function TimelineBoundaryInput({
  label,
  value,
  precision,
  onChange
}) {
  const date = normalizeTimelineDate(value, precision);

  function update(nextFields) {
    onChange(
      normalizeTimelineDate({
        ...date,
        ...nextFields,
        precision
      }, precision)
    );
  }

  return (
    <div
      style={{
        border: "1px solid #282828",
        borderRadius: "10px",
        background: "#131313",
        padding: "12px",
        minWidth: 0
      }}
    >
      <div
        style={{
          color: "#ddd",
          fontSize: "13px",
          fontWeight: "800",
          marginBottom: "10px"
        }}
      >
        {label}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: precision === "day"
            ? "1fr 1fr 1fr"
            : precision === "month"
              ? "1fr 1fr"
              : "1fr",
          gap: "8px"
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={fieldLabelStyle}>Year</span>
          <input
            type="number"
            min="1"
            max="9999"
            value={date.year}
            onChange={(event) => update({ year: event.target.value })}
            style={inputStyle}
          />
        </label>

        {timelinePrecisions.indexOf(precision) >= timelinePrecisions.indexOf("month") && (
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={fieldLabelStyle}>Month</span>
            <input
              type="number"
              min="1"
              max="12"
              value={date.month || 1}
              onChange={(event) => update({ month: event.target.value })}
              style={inputStyle}
            />
          </label>
        )}

        {precision === "day" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={fieldLabelStyle}>Day</span>
            <input
              type="number"
              min="1"
              max={daysInMonth(date.year, date.month || 1)}
              value={date.day || 1}
              onChange={(event) => update({ day: event.target.value })}
              style={inputStyle}
            />
          </label>
        )}
      </div>
    </div>
  );
}
