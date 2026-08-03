import { useManageTextPreview } from "./ManageTextPreview";
import { useTagLabels } from "../../../shared/tagLabels";

export default function GroupCardItem({
  group,
  selected,
  deleteOpen,
  isRemoving,
  isHighlighted,
  onClick,
  onDeleteOpen,
  closeDelete,
  deleteGroup
}) {
  const tags = group.tags || [];
  const labelFor = useTagLabels();
  const cardBackground = selected
    ? "#222"
    : isHighlighted
      ? "rgba(22, 101, 52, 0.32)"
      : "transparent";
  const {
    setAnchorElement,
    triggerProps,
    preview
  } = useManageTextPreview([
    {
      label: "Group",
      value: group.name,
      tone: "#8ab4f8"
    },
    {
      label: "Type",
      value: group.type_group,
      tone: "#8f8f8f"
    },
    {
      label: "Tags",
      value: tags.map(tag => `#${labelFor(tag)}`).join(" "),
      tone: "#999"
    }
  ]);

  return (
    <>
      <div
        ref={setAnchorElement}
        {...triggerProps}
        data-delete-card-id={group.id}
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
          padding: "14px",
          borderBottom: isHighlighted
            ? "1px solid rgba(134, 239, 172, 0.85)"
            : "1px solid #2a2a2a",
          cursor: "pointer",
          background: cardBackground,
          boxShadow: isHighlighted
            ? "0 0 0 4px rgba(134, 239, 172, 0.12), 0 0 26px rgba(34, 197, 94, 0.28)"
            : "none",
          transition: "background 0.16s ease, border 0.16s ease, box-shadow 0.16s ease, opacity 0.18s ease, transform 0.18s ease",
          overflow: "hidden",
          position: "relative",
          transform: isRemoving ? "scaleY(0.92)" : "scaleY(1)",
          opacity: isRemoving ? 0 : 1,
          transformOrigin: "top",
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
              deleteGroup?.();
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
        <div
          data-manage-preview-text
          style={{
            fontSize: "12px",
            color: "#888",
            marginBottom: "6px"
          }}
        >
          {group.type_group}
        </div>

        <div
          data-manage-preview-text
          style={{
            fontWeight: "bold",
            marginBottom: "6px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {group.name}
        </div>

        <div
          style={{
            color: "#999",
            fontSize: "14px"
          }}
        >
          {group.question_count || 0} questions
        </div>

        {tags.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "4px",
              marginTop: "8px",
              overflow: "hidden"
            }}
          >
            {tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                title={labelFor(tag)}
                style={{
                  background: "#242424",
                  borderRadius: "999px",
                  color: "#999",
                  flexShrink: 0,
                  fontSize: "10px",
                  maxWidth: "78px",
                  overflow: "hidden",
                  padding: "2px 7px",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                #{labelFor(tag)}
              </span>
            ))}
            {tags.length > 3 && (
              <span
                style={{
                  color: "#666",
                  flexShrink: 0,
                  fontSize: "10px"
                }}
              >
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
      {preview}
    </>
  );
}
