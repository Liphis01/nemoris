import ReviewBadge from "./ReviewBadge";
import { useManageTextPreview } from "./ManageTextPreview";
import { questionTypeChipStyles } from "../../../shared/questionTypes";
import FavoriteToggleButton from "./FavoriteToggleButton";
import RichText from "../../../shared/RichText";

export default function MapCard({
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
  const mapTypeStyle = questionTypeChipStyles.map;
  const isDisabled = !String(q.answer || "").trim();
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
  const {
    setAnchorElement,
    triggerProps,
    preview
  } = useManageTextPreview([
    {
      label: "Zone",
      value: q.answer || "Zone à nommer (désactivée)",
      tone: mapTypeStyle.color
    },
    {
      label: "Group",
      value: q.group?.name || "Map group",
      tone: "#8f8f8f"
    }
  ]);

  return (
    <>
      <div
        ref={setAnchorElement}
        {...triggerProps}
        className="manage-card"
        data-delete-card-id={q.id}
        data-map-zone-ready={isDisabled ? "false" : "true"}
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
          opacity: isRemoving
            ? 0
            : isDisabled || q.suspended
              ? 0.55
              : 1,
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
            justifyContent: "space-between",
            gap: "8px"
          }}
        >

          <div
            style={{
              fontSize: "10px",
              fontWeight: "700",
              padding: "2px 6px",
              borderRadius: "999px",
              background: mapTypeStyle.background,
              color: mapTypeStyle.color,
              flexShrink: 0
            }}
          >
            MAP
          </div>

          <div
            data-manage-preview-text
            style={{
              flex: 1,
              textAlign: "center",
              color: isDisabled ? "#999" : "#e5e5e5",
              fontWeight: "600",
              fontSize: "14px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: "0 4px"
            }}
          >
            <RichText compact style={{ whiteSpace: "inherit" }}>
              {q.answer || "Zone à nommer"}
            </RichText>
          </div>

          <FavoriteToggleButton
            favorite={Boolean(q.data?.favorite)}
            onToggle={onToggleFavorite}
          />
        </div>

        {/* GROUP */}
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
          <RichText compact style={{ whiteSpace: "inherit" }}>
            {q.group?.name || "Map group"}
          </RichText>
        </div>

        {/* BOTTOM */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "8px",
            minWidth: 0
          }}
        >
          {/* REVIEW */}
          {isDisabled ? (
            <span style={{
              background: "#2b2b2b",
              border: "1px solid #444",
              borderRadius: "999px",
              color: "#aaa",
              fontSize: "10px",
              fontWeight: 700,
              padding: "3px 7px"
            }}>
              Désactivée
            </span>
          ) : (
            <ReviewBadge progress={q.progress} />
          )}

        </div>

      </div>
      {preview}
    </>
  );
}
