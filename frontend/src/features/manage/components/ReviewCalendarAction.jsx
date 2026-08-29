import { formatReviewDate } from "../hooks/useInspectorPreviewState";

const calendarButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  borderRadius: "999px",
  border: "1px solid #24583a",
  background: "#151c18",
  color: "#7ee2a8",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: "700",
  lineHeight: 1,
  whiteSpace: "nowrap"
};

export default function ReviewCalendarAction({ compact = false, nextReview, onOpen }) {
  if (!nextReview) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Voir cette question dans le calendrier"
      style={{
        ...calendarButtonStyle,
        ...(compact
          ? {
            alignItems: "flex-start",
            flexDirection: "column",
            gap: "3px",
            padding: "7px 10px",
            borderRadius: "10px"
          }
          : {})
      }}
    >
      <span
        style={{
          color: "#8a8a8a",
          fontSize: compact ? "10px" : undefined,
          letterSpacing: compact ? "0.04em" : undefined,
          textTransform: compact ? "uppercase" : undefined
        }}
      >
        Révision
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px"
        }}
      >
        {formatReviewDate(nextReview)}
        <span aria-hidden="true">→</span>
      </span>
    </button>
  );
}
