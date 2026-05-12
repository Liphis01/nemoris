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
        background: selected ? "#222" : "transparent"
      }}
    >
      <div
        style={{
          fontSize: "12px",
          color: "#888",
          marginBottom: "6px"
        }}
      >
        map
      </div>

      <div
        style={{
          fontWeight: "bold",
          marginBottom: "8px"
        }}
      >
        {q.svg}
      </div>

      <div
        style={{
          color: "#999",
          fontSize: "14px"
        }}
      >
        {q.zones?.length || 0} zones
      </div>
    </div>
  );
}