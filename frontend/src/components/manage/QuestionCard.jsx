export default function QuestionCard({
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
        text
      </div>

      <div
        style={{
          fontWeight: "bold",
          marginBottom: "6px"
        }}
      >
        {q.question}
      </div>

      <div
        style={{
          color: "#999",
          fontSize: "14px"
        }}
      >
        {q.answer}
      </div>

      {q.tags?.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            marginTop: "10px"
          }}
        >
          {q.tags.map(tag => (
            <div
              key={tag}
              style={{
                background: "#333",
                padding: "2px 8px",
                borderRadius: "999px",
                fontSize: "12px",
                color: "#bbb"
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}