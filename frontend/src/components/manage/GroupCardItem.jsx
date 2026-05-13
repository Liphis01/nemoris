export default function GroupCardItem({
  group,
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
        background: selected ? "#222" : "transparent",
        transition: "0.15s"
      }}
    >
      <div
        style={{
          fontSize: "12px",
          color: "#888",
          marginBottom: "6px"
        }}
      >
        {group.type_group}
      </div>

      <div
        style={{
          fontWeight: "bold",
          marginBottom: "6px"
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
    </div>
  );
}
