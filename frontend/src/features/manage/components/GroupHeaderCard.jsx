import { useCallback } from "react";
import { useManageTextPreview } from "./ManageTextPreview";
import SuspendToggleButton from "./SuspendToggleButton";
import { questionTypeChipStyles } from "../../../shared/questionTypes";

export default function GroupHeaderCard({
  row,
  sticky = false,
  isOpen,
  selectedInside,
  highlightedInside,
  setRowRef,
  onToggle,
  onToggleSuspended
}) {
  const { groupInfo } = row;
  const tags = groupInfo.tags || [];
  // There is no group-level flag: the header reflects its questions, so a
  // partially suspended group reads as "mixed" rather than silently picking a
  // side.
  const groupQuestions = groupInfo.questions || [];
  const suspendedCount = groupQuestions.filter(
    question => question.suspended
  ).length;
  const allSuspended = (
    groupQuestions.length > 0 && suspendedCount === groupQuestions.length
  );
  const someSuspended = suspendedCount > 0 && !allSuspended;
  const mapTypeStyle = questionTypeChipStyles.map;
  const imageTypeStyle = questionTypeChipStyles.media;
  const textTypeStyle = questionTypeChipStyles.text;
  const sequenceTypeStyle = questionTypeChipStyles.sequence;
  const background = isOpen
    ? "#1a1a1a"
    : selectedInside
      ? "#181818"
      : "transparent";
  const border = selectedInside
    ? "1px solid #3a3a3a"
    : highlightedInside
      ? "1px solid rgba(134, 239, 172, 0.75)"
      : "1px solid #262626";
  const {
    setAnchorElement,
    triggerProps,
    preview
  } = useManageTextPreview([
    {
      label: "Group",
      value: groupInfo.name,
      tone: "#8ab4f8"
    },
    {
      label: "Type",
      value: groupInfo.type,
      tone: "#8f8f8f"
    },
    {
      label: "Tags",
      value: tags.map(tag => `#${tag}`).join(" "),
      tone: "#999"
    }
  ]);
  const setRefs = useCallback((element) => {
    setAnchorElement(element);
    setRowRef?.(element);
  }, [setAnchorElement, setRowRef]);

  return (
    <>
      {/* role="button" rather than a real <button>: the suspend control lives
          inside this card, and nesting a button inside a button is invalid. */}
      <div
        ref={setRefs}
        className="manage-card"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          // Only when the card itself has focus: Enter/Space on the nested
          // suspend button must not also expand the group.
          if (event.target !== event.currentTarget) return;

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle?.();
          }
        }}
        aria-expanded={isOpen}
        {...triggerProps}
        style={{
          width: "100%",
          boxSizing: "border-box",
          ...(sticky
            ? {
              position: "sticky",
              top: 0,
              zIndex: 3
            }
            : {}),
          border,
          borderRadius: "12px",
          background,
          color: "#eee",
          padding: "9px 10px",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "18px minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "8px",
          textAlign: "left",
          boxShadow: highlightedInside
            ? "0 0 0 4px rgba(134, 239, 172, 0.08), 0 0 22px rgba(34, 197, 94, 0.2)"
            : "none",
          opacity: allSuspended ? 0.55 : 1,
          transition: "border 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, opacity 0.18s ease"
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = isOpen ? "#1d1d1d" : "#181818";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = background;
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: "#777",
            fontSize: "14px",
            lineHeight: 1,
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.14s ease"
          }}
        >
          ▸
        </span>

        <span
          style={{
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "3px"
          }}
        >
          <span
            data-manage-preview-text
            style={{
              color: "#e5e5e5",
              fontSize: "14px",
              fontWeight: "700",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {groupInfo.name}
          </span>
          <span
            data-manage-preview-text
            style={{
              color: "#777",
              fontSize: "11px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {groupInfo.type}
          </span>
        </span>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            flexWrap: "wrap",
            gap: "6px",
            minWidth: 0
          }}
        >
          {tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              title={tag}
              style={{
                background: "#242424",
                borderRadius: "999px",
                color: "#999",
                flexShrink: 1,
                fontSize: "10px",
                fontWeight: "700",
                maxWidth: "70px",
                minWidth: 0,
                overflow: "hidden",
                padding: "2px 6px",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              #{tag}
            </span>
          ))}
          {tags.length > 3 && (
            <span
              style={{
                color: "#666",
                fontSize: "10px",
                flexShrink: 0
              }}
            >
              +{tags.length - 3}
            </span>
          )}
          {groupInfo.mapCount > 0 && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: "700",
                padding: "2px 6px",
                borderRadius: "999px",
                background: mapTypeStyle.background,
                color: mapTypeStyle.color,
                whiteSpace: "nowrap"
              }}
            >
              {groupInfo.mapCount} MAP
            </span>
          )}
          {groupInfo.imageCount > 0 && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: "700",
                padding: "2px 6px",
                borderRadius: "999px",
                background: imageTypeStyle.background,
                color: imageTypeStyle.color,
                whiteSpace: "nowrap"
              }}
            >
              {groupInfo.imageCount} MÉDIA
            </span>
          )}
          {groupInfo.textCount > 0 && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: "700",
                padding: "2px 6px",
                borderRadius: "999px",
                background: textTypeStyle.background,
                color: textTypeStyle.color,
                whiteSpace: "nowrap"
              }}
            >
              {groupInfo.textCount} TEXT
            </span>
          )}
          {groupInfo.sequenceCount > 0 && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: "700",
                padding: "2px 6px",
                borderRadius: "999px",
                background: sequenceTypeStyle.background,
                color: sequenceTypeStyle.color,
                whiteSpace: "nowrap"
              }}
            >
              {groupInfo.sequenceCount} SÉQ
            </span>
          )}
          {allSuspended && (
            <span
              style={{
                background: "#2b2118",
                border: "1px solid rgba(224, 160, 92, 0.4)",
                borderRadius: "999px",
                color: "#e0a05c",
                flexShrink: 0,
                fontSize: "10px",
                fontWeight: "700",
                padding: "2px 6px",
                whiteSpace: "nowrap"
              }}
            >
              En pause
            </span>
          )}

          <span
            style={{
              color: "#777",
              fontSize: "11px",
              minWidth: "16px",
              textAlign: "right",
              whiteSpace: "nowrap"
            }}
          >
            {groupInfo.questions.length}
          </span>

          <SuspendToggleButton
            scope="group"
            suspended={allSuspended}
            mixed={someSuspended}
            disabled={groupQuestions.length === 0}
            onToggle={() => onToggleSuspended?.(!allSuspended)}
          />
        </span>
      </div>
      {preview}
    </>
  );
}
