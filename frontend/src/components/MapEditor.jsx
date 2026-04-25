import { useState } from "react";

const overlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000
};

const modalStyle = {
  background: "#1e1e1e",
  padding: "20px",
  borderRadius: "10px",
  width: "400px",
  color: "white"
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: "5px"
};

export default function MapEditor({
  q,
  onClose,
  updateQuestion,
}) {
  const [items, setItems] = useState(q.data?.items || []);
  const [input, setInput] = useState("");

  function addItem() {
    if (!input.trim()) return;

    if (items.includes(input.trim())) return;

    setItems([...items, input.trim()]);
    setInput("");
  }

  function removeItem(index) {
    setItems(items.filter((_, i) => i !== index));
  }

  function save() {
    updateQuestion(q, {
      type_q: "map",
      data: { svg: q.data.svg, items }
    });

    onClose();
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2>🗺 Map Editor</h2>

        {/* LISTE */}
        <div style={{ marginBottom: "20px" }}>
          {items.map((item, i) => (
            <div key={i} style={rowStyle}>
              <span>{item}</span>
              <button onClick={() => removeItem(i)}>❌</button>
            </div>
          ))}
        </div>

        {/* INPUT */}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="Ajouter un élément..."
          style={{ width: "100%", marginBottom: "10px" }}
        />

        <button onClick={addItem}>Ajouter</button>

        {/* ACTIONS */}
        <div style={{ marginTop: "20px" }}>
          <button onClick={save}>💾 Sauvegarder</button>
          <button onClick={onClose} style={{ marginLeft: "10px" }}>
            ❌ Fermer
          </button>
        </div>
      </div>
    </div>
  );
}