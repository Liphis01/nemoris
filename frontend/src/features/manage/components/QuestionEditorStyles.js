export const panelStyle = {
  padding: "28px",
  overflow: "overlay",
  background: "#141414",
  height: "100%",
  boxSizing: "border-box"
};

export const labelStyle = {
  color: "#bbb",
  fontSize: "14px"
};

export const inputStyle = {
  width: "100%",
  background: "#121212",
  border: "1px solid #2a2a2a",
  borderRadius: "10px",
  color: "#eee",
  outline: "none",
  padding: "12px 14px",
  boxSizing: "border-box"
};

export const buttonStyle = {
  background: "#2a2a2a",
  border: "none",
  borderRadius: "10px",
  color: "#eee",
  cursor: "pointer",
  padding: "12px 16px"
};

export const primaryButtonStyle = {
  ...buttonStyle,
  background: "#2b2047",
  border: "1px solid #5f4b8f",
  color: "#d8ccff"
};

export const pendingSaveButtonStyle = {
  ...primaryButtonStyle,
  background: "linear-gradient(180deg, #5a3f12 0%, #362712 100%)",
  border: "1px solid #facc15",
  boxShadow: "0 0 0 3px rgba(250, 204, 21, 0.12), 0 10px 24px rgba(0, 0, 0, 0.28)",
  color: "#fff3b8",
  fontWeight: "700",
  transition: "background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, color 0.16s ease, opacity 0.16s ease"
};

export const disabledSaveButtonStyle = {
  ...primaryButtonStyle,
  background: "#202020",
  border: "1px solid #333",
  boxShadow: "none",
  color: "#777",
  cursor: "not-allowed",
  opacity: 0.72,
  transition: "background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, color 0.16s ease, opacity 0.16s ease"
};

export const dangerButtonStyle = {
  ...buttonStyle,
  background: "#641c1c",
  border: "1px solid #7b2929"
};
