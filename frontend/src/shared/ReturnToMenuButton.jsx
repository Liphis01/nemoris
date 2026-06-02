import React from "react";

export default function ReturnToMenuButton({ onClick, style, className, type = "button", ariaLabel }) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={className}
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        cursor: "pointer",
        fontSize: "14px",
        ...style
      }}
    >
      ← Retour
    </button>
  );
}
