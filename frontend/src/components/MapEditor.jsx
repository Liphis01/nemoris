import { useState } from "react";
import SvgMap from "./SvgMap";

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
  const [labels, setLabels] = useState(q.data?.labels || {});
  const [aliases, setAliases] = useState(q.data?.aliases || {});
  const [selected, setSelected] = useState(null);
  // const [input, setInput] = useState("");

  function handleSelect(code) {
    setSelected(code);

    if (!items.includes(code)) {
      setItems([...items, code]);
    }
  }

  // function addItem() {
  //   if (!input.trim()) return;

  //   if (items.includes(input.trim())) return;

  //   setItems([...items, input.trim()]);
  //   setInput("");
  // }

  function updateLabel(code, value) {
    setLabels({ ...labels, [code]: value });
  }

  function updateAliases(code, value) {
    setAliases({
      ...aliases,
      [code]: value.split(",").map((v) => v.trim())
    });
  }

  function removeItem(code) {
    setItems(items.filter((c) => c !== code));

    const newLabels = { ...labels };
    delete newLabels[code];
    setLabels(newLabels);

    const newAliases = { ...aliases };
    delete newAliases[code];
    setAliases(newAliases);
  }

  // function removeItem(index) {
  //   setItems(items.filter((_, i) => i !== index));
  // }

  function save() {
    updateQuestion(q, {
      type_q: "map",
      data: {
        svg: q.data.svg,
        ...q.data,
        items,
        labels,
        aliases
      }
    });

    onClose();
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2>🗺 Map Editor</h2>

        {/* CARTE */}
        <SvgMap
          svgPath={`/maps/${q.data?.svg}`}
          found={items}
          onSelect={handleSelect}
        />

        {/* SELECTED */}
        {selected && (
          <div style={{ marginTop: "15px" }}>
            <h4>Zone sélectionnée : {selected}</h4>

            <input
              placeholder="Label (France)"
              value={labels[selected] || ""}
              onChange={(e) =>
                updateLabel(selected, e.target.value)
              }
              style={{ width: "100%", marginBottom: "5px" }}
            />

            <input
              placeholder="Aliases (séparés par des virgules)"
              value={(aliases[selected] || []).join(", ")}
              onChange={(e) =>
                updateAliases(selected, e.target.value)
              }
              style={{ width: "100%" }}
            />
          </div>
        )}

        {/* LISTE */}
        <div style={{ marginTop: "20px" }}>
          {items.map((code) => (
            <div key={code} style={rowStyle}>
              <span>{code} → {labels[code]}</span>
              <button onClick={() => removeItem(code)}>❌</button>
            </div>
          ))}
        </div>

        <button onClick={save}>💾 Sauvegarder</button>
        <button onClick={onClose}>❌ Fermer</button>
      </div>
    </div>
  );
}