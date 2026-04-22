import { useState } from "react";

export default function MapEditor({ q, setMode }) {
  const [items, setItems] = useState(q.data?.items || []);

  function addItem(value) {
    setItems([...items, value]);
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "auto" }}>

      <button
        onClick={() => setMode("manage")}
        style={{
          marginBottom: "20px",
          background: "#2a2a2a",
          color: "#eee",
          border: "1px solid #333",
          padding: "8px 14px",
          borderRadius: "6px",
          cursor: "pointer"
        }}
        onMouseEnter={(e) => e.target.style.opacity = "0.8"}
        onMouseLeave={(e) => e.target.style.opacity = "1"}
        onMouseDown={(e) => e.target.style.transform = "scale(0.95)"}
        onMouseUp={(e) => e.target.style.transform = "scale(1)"}
      >
        ⬅ Retour
      </button>

      <h2 style={{ marginBottom: "20px" }}>
        Map Editor - {q.question}
      </h2>

      {items.map((item, i) => (
        <div key={i}>{item}</div>
      ))}

      <input
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            addItem(e.target.value);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}