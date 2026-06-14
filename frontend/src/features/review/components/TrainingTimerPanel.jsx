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
  bestTimeMs = null,
  variant = "default"
}) {
  const bestTimeValue = Number(bestTimeMs);
  const showBestTime = Number.isFinite(bestTimeValue) && bestTimeValue > 0;
  const prominent = variant === "prominent";

  return (
    <div
      data-training-timer-panel={variant}
      style={prominent ? prominentTimerPanelStyle : timerPanelStyle}
    >
      <div style={prominent ? prominentTimerMainStyle : timerMainStyle}>
        <ClockMark prominent={prominent} />
        <div>
          <div style={timerLabelStyle}>Temps</div>
          <div style={prominent ? prominentTimerValueStyle : timerValueStyle}>
            {formatTrainingTimer(elapsedMs)}
          </div>
        </div>
      </div>

      {showBestTime && (
        <div style={prominent ? prominentBestTimeStyle : bestTimeStyle}>
          <span style={bestTimeLabelStyle}>Meilleur</span>
          <strong style={prominent ? prominentBestTimeValueStyle : bestTimeValueStyle}>
            {formatTrainingTimer(bestTimeMs)}
          </strong>
        </div>
      )}
    </div>
  );
}

function ClockMark({ prominent = false }) {
  return (
    <div
      style={prominent ? prominentTimerMarkerStyle : timerMarkerStyle}
      aria-hidden="true"
    >
      <span style={prominent ? prominentClockHourHandStyle : clockHourHandStyle} />
      <span style={prominent ? prominentClockMinuteHandStyle : clockMinuteHandStyle} />
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

const prominentTimerPanelStyle = {
  alignItems: "center",
  background:
    "linear-gradient(135deg, rgba(240, 195, 106, 0.24), rgba(143, 199, 255, 0.1))",
  border: "1px solid rgba(240, 195, 106, 0.46)",
  borderRadius: "12px",
  boxShadow: "0 14px 34px rgba(0, 0, 0, 0.34)",
  boxSizing: "border-box",
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  justifyContent: "flex-end",
  minHeight: "58px",
  padding: "8px 12px"
};

const prominentTimerMainStyle = {
  alignItems: "center",
  display: "flex",
  gap: "10px"
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

const prominentTimerMarkerStyle = {
  ...timerMarkerStyle,
  background: "rgba(240, 195, 106, 0.22)",
  border: "1px solid rgba(240, 195, 106, 0.52)",
  height: "36px",
  width: "36px"
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

const prominentClockHourHandStyle = {
  ...clockHourHandStyle,
  height: "11px",
  left: "17px",
  top: "8px"
};

const prominentClockMinuteHandStyle = {
  ...clockMinuteHandStyle,
  left: "17px",
  top: "17px",
  width: "10px"
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

const prominentTimerValueStyle = {
  ...timerValueStyle,
  fontSize: "31px",
  lineHeight: "32px",
  marginTop: "3px"
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

const prominentBestTimeStyle = {
  ...bestTimeStyle,
  alignSelf: "stretch",
  flexDirection: "column",
  gap: "3px",
  justifyContent: "center",
  minWidth: "70px",
  padding: "7px 9px"
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

const prominentBestTimeValueStyle = {
  ...bestTimeValueStyle,
  color: "#f0f0f0",
  fontSize: "16px"
};
