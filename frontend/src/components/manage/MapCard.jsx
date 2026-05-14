export default function MapCard({
  q,
  selected,
  onClick
}) {

  return (
    <div
      onClick={onClick}
      style={{
        padding: "14px",
        borderBottom: "1px solid #2a2a2a",
        cursor: "pointer",
        background: selected ? "#252525" : "transparent",
        transition: "background 0.15s ease",
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.background = "#1f1f1f";
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.background = "transparent";
        }
      }}
    >

      {/* HEADER */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px"
        }}
      >

        <div
          style={{
            fontSize: "11px",
            fontWeight: "600",
            padding: "3px 8px",
            borderRadius: "999px",
            background: "#3f2f12",
            color: "#f5c26b",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            flexShrink: 0
          }}
        >
          MAP
        </div>

        <div
          style={{
            color: "#555",
            fontSize: "11px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          #{q.id}
        </div>
      </div>

      {/* QUESTION */}
      <div
        style={{
          fontWeight: "600",
          color: "#eee",
          lineHeight: 1.35,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical"
        }}
      >
        {q.answer || q.question || "Unnamed zone"}
      </div>

      {/* MAP INFO */}
      <div
        style={{
          color: "#888",
          fontSize: "13px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {q.group?.name || "Map group"}
      </div>

      {/* FOOTER */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          minWidth: 0
        }}
      >

        {/* TAGS */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            overflow: "hidden",
            minWidth: 0
          }}
        >
          {(q.tags || []).slice(0, 2).map(tag => (
            <div
              key={tag}
              title={tag}
              style={{
                maxWidth: "90px",
                padding: "2px 8px",
                borderRadius: "999px",
                background: "#2a2a2a",
                color: "#999",
                fontSize: "11px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flexShrink: 0
              }}
            >
              #{tag}
            </div>
          ))}

          {(q.tags?.length || 0) > 2 && (
            <div
              style={{
                color: "#666",
                fontSize: "11px",
                flexShrink: 0
              }}
            >
              +{q.tags.length - 2}
            </div>
          )}
        </div>

        {/* REVIEW INFO */}
        <div
          style={{
            fontSize: "11px",
            color: "#555",
            flexShrink: 0
          }}
        >
          {q.interval || 0}d
        </div>

      </div>
    </div>
  );
}