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
  alignItems: "center",
  background: "linear-gradient(180deg, #1f1d17 0%, #171615 100%)",
  border: "1px solid #d6a91c",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 0 3px rgba(250, 204, 21, 0.08)",
  color: "#ffe58a",
  display: "inline-flex",
  gap: "8px",
  fontWeight: "700",
  justifyContent: "center",
  transition: "background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, color 0.16s ease, opacity 0.16s ease"
};

export const pendingSaveDotStyle = {
  background: "#facc15",
  borderRadius: "999px",
  boxShadow: "0 0 10px rgba(250, 204, 21, 0.58)",
  flex: "0 0 auto",
  height: "7px",
  width: "7px"
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
