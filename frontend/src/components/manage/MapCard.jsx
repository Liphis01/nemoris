export default function MapCard({
  q,
  selected,
  onClick
}) {

  const zoneName =
    q.answer ||
    q.question ||
    "Unnamed zone";

  const mapName =
    q.group?.name ||
    q.media ||
    "Unknown map";

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        gap: "14px",
        padding: "14px",
        borderBottom: "1px solid #262626",
        cursor: "pointer",
        background: selected ? "#252525" : "transparent",
        transition: "background 0.15s"
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

      {/* CONTENT */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center"
        }}
      >

        {/* HEADER */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "6px"
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: "bold",
              letterSpacing: "0.08em",
              color: "#4da3ff",
              background: "#172434",
              padding: "3px 7px",
              borderRadius: "999px"
            }}
          >
            MAP
          </div>

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
                title={tag}
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
        </div>

        {/* ZONE NAME */}
        <div
          style={{
            fontSize: "16px",
            fontWeight: "600",
            color: "#eee",
            marginBottom: "4px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}
        >
          {zoneName}
        </div>

        {/* MAP NAME */}
        <div
          style={{
            fontSize: "13px",
            color: "#777",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}
        >
          {mapName}
        </div>

      </div>

    </div>
  );
}