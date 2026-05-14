export default function QuestionCard({
  q,
  selected,
  onClick,
  deleteOpen,
  isRemoving,
  onDeleteOpen,
  closeDelete,
  deleteQuestion
}) {

  return (
    <div
      data-delete-card-id={q.id}
      onClick={(event) => {
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
        borderBottom: "1px solid #262626",
        cursor: "pointer",
        background: selected ? "#252525" : "transparent",
        transition: "background 0.12s ease, opacity 0.18s ease, transform 0.18s ease",
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
          e.currentTarget.style.background = "#1d1d1d";
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.background = "transparent";
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
            background: "#163b63",
            color: "#5eb6ff",
            flexShrink: 0
          }}
        >
          TEXT
        </div>

        <div
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

        <div
          style={{
            color: "#555",
            fontSize: "10px",
            flexShrink: 0
          }}
        >
          #{q.id}
        </div>

      </div>

      {/* ANSWER */}
      <div
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
        <div
          style={{
            color: "#666",
            fontSize: "10px",
            flexShrink: 0
          }}
        >
          {q.interval || 0}d
        </div>

      </div>

    </div>
  );
}