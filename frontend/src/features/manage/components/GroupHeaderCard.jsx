import { useCallback } from "react";
import { useManageTextPreview } from "./ManageTextPreview";
import { questionTypeChipStyles } from "../../../shared/questionTypes";

export default function GroupHeaderCard({
  row,
  sticky = false,
  isOpen,
  selectedInside,
  highlightedInside,
  setRowRef,
  onToggle
}) {
  const { groupInfo } = row;
  const mapTypeStyle = questionTypeChipStyles.map;
  const textTypeStyle = questionTypeChipStyles.text;
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
    }
  ]);
  const setRefs = useCallback((element) => {
    setAnchorElement(element);
    setRowRef?.(element);
  }, [setAnchorElement, setRowRef]);

  return (
    <>
      <button
        ref={setRefs}
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        {...triggerProps}
        style={{
          width: "100%",
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
          transition: "border 0.16s ease, background 0.16s ease, box-shadow 0.16s ease"
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
        </span>
      </button>
      {preview}
    </>
  );
}
