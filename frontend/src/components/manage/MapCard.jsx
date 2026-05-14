export default function MapCard({
  q,
  selected,
  onClick
}) {

  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid #262626",
        cursor: "pointer",
        background: selected ? "#252525" : "transparent",
        transition: "background 0.12s ease",
        display: "flex",
        flexDirection: "column",
        gap: "6px"
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
            background: "#5a3b12",
            color: "#ffc76b",
            flexShrink: 0
          }}
        >
          MAP
        </div>

        <div
          style={{
            flex: 1,
            textAlign: "center",
            color: "#e5e5e5",
            fontWeight: "600",
            fontSize: "14px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "0 4px"
          }}
        >
          {q.answer || "Unnamed zone"}
        </div>

        <div
          style={{
            color: "#555",
            fontSize: "10px",
            flexShrink: 0,
            minWidth: "28px",
            textAlign: "right"
          }}
        >
          #{q.id}
        </div>

      </div>

      {/* GROUP */}
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
        {q.group?.name || "Map group"}
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