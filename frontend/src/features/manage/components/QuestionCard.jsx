import ReviewBadge from "./ReviewBadge";
import { useManageTextPreview } from "./ManageTextPreview";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import FavoriteToggleButton from "./FavoriteToggleButton";

export default function QuestionCard({
  q,
  selected,
  onClick,
  deleteOpen,
  isRemoving,
  isHighlighted,
  onDeleteOpen,
  closeDelete,
  deleteQuestion,
  onToggleFavorite
}) {
  const cardBackground = selected
    ? "#252525"
    : isHighlighted
      ? "rgba(22, 101, 52, 0.32)"
      : "transparent";
  const cardBorder = selected
    ? "1px solid #3a3a3a"
    : isHighlighted
      ? "1px solid rgba(134, 239, 172, 0.85)"
      : "1px solid #262626";
  const typeStyle = getQuestionTypeChipStyle(q.type_q);
  const {
    setAnchorElement,
    triggerProps,
    preview
  } = useManageTextPreview([
    {
      label: "Question",
      value: q.question,
      tone: typeStyle.color
    },
    {
      label: "Answer",
      value: q.answer || "—",
      tone: "#8f8f8f"
    }
  ], { media: q.media });

  return (
    <>
      <div
        ref={setAnchorElement}
        {...triggerProps}
        data-delete-card-id={q.id}
        onClick={() => {
          if (deleteOpen) {
            closeDelete?.();
            return;
          }
          onClick?.();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onDeleteOpen?.();
        }}
        style={{
          position: "relative",
          padding: "10px 12px",
          border: cardBorder,
          borderRadius: "14px",
          cursor: "pointer",
          background: cardBackground,
          boxShadow: isHighlighted
            ? "0 0 0 4px rgba(134, 239, 172, 0.12), 0 0 26px rgba(34, 197, 94, 0.28)"
            : "none",
          transition: "background 0.16s ease, border 0.16s ease, box-shadow 0.16s ease, opacity 0.18s ease, transform 0.18s ease",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          overflow: "hidden",
          transform: isRemoving ? "scaleY(0.95)" : "scaleY(1)",
          opacity: isRemoving ? 0 : 1,
          transformOrigin: "top"
        }}
        onMouseEnter={(e) => {
          if (!selected) {
            e.currentTarget.style.background = isHighlighted
              ? "rgba(22, 101, 52, 0.42)"
              : "#1d1d1d";
          }
        }}
        onMouseLeave={(e) => {
          if (!selected) {
            e.currentTarget.style.background = cardBackground;
          }
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            height: "100%",
            width: "52px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: deleteOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform 0.18s ease",
            background: "rgba(139, 15, 15, 0.95)",
            borderLeft: "1px solid rgba(255,255,255,0.05)",
            zIndex: 1
          }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              deleteQuestion?.();
              closeDelete?.();
            }}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "999px",
              border: "none",
              background: "#b01d1d",
              color: "white",
              cursor: "pointer",
              fontSize: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            🗑
          </button>
        </div>

        {/* TOP */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: 0
          }}
        >

          <div
            style={{
              fontSize: "10px",
              fontWeight: "700",
              padding: "2px 6px",
              borderRadius: "999px",
              background: typeStyle.background,
              color: typeStyle.color,
              flexShrink: 0
            }}
          >
            {typeStyle.label}
          </div>

          <div
            data-manage-preview-text
            style={{
              color: "#e5e5e5",
              fontWeight: "600",
              fontSize: "14px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1
            }}
          >
            {q.question}
          </div>

          {q.media && (
            <div
              title="Image"
              style={{
                border: "1px solid rgba(126, 226, 168, 0.35)",
                borderRadius: "999px",
                color: "#7ee2a8",
                flexShrink: 0,
                fontSize: "9px",
                fontWeight: "800",
                lineHeight: 1,
                padding: "3px 5px"
              }}
            >
              IMG
            </div>
          )}

          <FavoriteToggleButton
            favorite={Boolean(q.data?.favorite)}
            onToggle={onToggleFavorite}
          />
        </div>

        {/* ANSWER */}
        <div
          data-manage-preview-text
          style={{
            color: "#888",
            fontSize: "12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            paddingLeft: "2px"
          }}
        >
          {q.answer || "—"}
        </div>

        {/* BOTTOM */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            minWidth: 0
          }}
        >

          {/* TAGS */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              overflow: "hidden",
              minWidth: 0
            }}
          >
            {(q.tags || []).slice(0, 3).map(tag => (
              <div
                key={tag}
                title={tag}
                style={{
                  maxWidth: "80px",
                  padding: "1px 6px",
                  borderRadius: "999px",
                  background: "#2a2a2a",
                  color: "#999",
                  fontSize: "10px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flexShrink: 0
                }}
              >
                #{tag}
              </div>
            ))}

            {(q.tags?.length || 0) > 3 && (
              <div
                style={{
                  color: "#666",
                  fontSize: "10px",
                  flexShrink: 0
                }}
              >
                +{q.tags.length - 3}
              </div>
            )}
          </div>

          {/* REVIEW */}
          <ReviewBadge progress={q.progress} />

        </div>

      </div>
      {preview}
    </>
  );
}
