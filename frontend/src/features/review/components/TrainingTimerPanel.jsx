function formatTrainingTimer(ms) {
  const value = Number(ms);

  if (!Number.isFinite(value) || value < 0) {
    return "-";
  }

  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  return `${seconds}s`;
}

export default function TrainingTimerPanel({
  elapsedMs,
  bestTimeMs = null
}) {
  const bestTimeValue = Number(bestTimeMs);
  const showBestTime = Number.isFinite(bestTimeValue) && bestTimeValue > 0;

  return (
    <div style={timerPanelStyle}>
      <div style={timerMainStyle}>
        <ClockMark />
        <div>
          <div style={timerLabelStyle}>Temps</div>
          <div style={timerValueStyle}>
            {formatTrainingTimer(elapsedMs)}
          </div>
        </div>
      </div>

      {showBestTime && (
        <div style={bestTimeStyle}>
          <span style={bestTimeLabelStyle}>Meilleur</span>
          <strong style={bestTimeValueStyle}>
            {formatTrainingTimer(bestTimeMs)}
          </strong>
        </div>
      )}
    </div>
  );
}

function ClockMark() {
  return (
    <div style={timerMarkerStyle} aria-hidden="true">
      <span style={clockHourHandStyle} />
      <span style={clockMinuteHandStyle} />
    </div>
  );
}

const timerPanelStyle = {
  alignItems: "center",
  background:
    "linear-gradient(135deg, rgba(240, 195, 106, 0.16), rgba(143, 199, 255, 0.08))",
  border: "1px solid rgba(240, 195, 106, 0.34)",
  borderRadius: "8px",
  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.28)",
  boxSizing: "border-box",
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  minHeight: "54px",
  padding: "8px 10px"
};

const timerMainStyle = {
  alignItems: "center",
  display: "flex",
  gap: "9px"
};

const timerMarkerStyle = {
  alignItems: "center",
  background: "rgba(240, 195, 106, 0.18)",
  border: "1px solid rgba(240, 195, 106, 0.38)",
  borderRadius: "999px",
  display: "flex",
  height: "30px",
  justifyContent: "center",
  position: "relative",
  width: "30px"
};

const clockHourHandStyle = {
  background: "#f5d690",
  borderRadius: "999px",
  height: "9px",
  left: "14px",
  position: "absolute",
  top: "7px",
  transform: "rotate(12deg)",
  transformOrigin: "50% 100%",
  width: "2px"
};

const clockMinuteHandStyle = {
  background: "#f5d690",
  borderRadius: "999px",
  height: "2px",
  left: "14px",
  position: "absolute",
  top: "14px",
  transform: "rotate(42deg)",
  transformOrigin: "0 50%",
  width: "8px"
};

const timerLabelStyle = {
  color: "#b9b9b9",
  fontSize: "10px",
  fontWeight: 900,
  lineHeight: 1,
  textTransform: "uppercase"
};

const timerValueStyle = {
  color: "#fff4d8",
  fontSize: "22px",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 900,
  lineHeight: "24px",
  marginTop: "4px"
};

const bestTimeStyle = {
  alignItems: "center",
  background: "rgba(12, 12, 12, 0.46)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: "7px",
  display: "flex",
  gap: "7px",
  padding: "7px 8px"
};

const bestTimeLabelStyle = {
  color: "#8e8e8e",
  fontSize: "10px",
  fontWeight: 900,
  textTransform: "uppercase"
};

const bestTimeValueStyle = {
  color: "#e8e8e8",
  fontSize: "14px",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 900,
  lineHeight: 1
};
