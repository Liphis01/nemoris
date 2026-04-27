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
  width: "65vw",
  height: "70vh",
  background: "#1e1e1e",
  borderRadius: "12px",
  display: "grid",
  gridTemplateColumns: "2fr 1fr",
  overflow: "hidden",
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
  const [editing, setEditing] = useState(null);

  function handleSelect(code) {
    setEditing(code);

    setItems(prev =>
      prev.includes(code) ? prev : [...prev, code]
    );
  }

  function handleRowClick(code) {
    setEditing(code);
  }

  function updateLabel(code, value) {
    setLabels(prev => ({
      ...prev,
      [code]: value
    }));
  }

  function updateAliases(code, value) {
    setAliases(prev => ({
      ...prev,
      [code]: value.split(",").map(v => v.trim())
    }));
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

  function handleClose() {
    console.log("Saving map question with items:", items);
    updateQuestion(q, {
      type_q: "map",
      data: {
        ...q.data,
        items,
        labels,
        aliases
      }
    });

    onClose();
  }

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>

        {/* 🗺️ GAUCHE */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid #333",
            padding: "12px",
            gap: "10px",
            boxSizing: "border-box"
          }}>

          {/* MAP */}
          <div
            style={{
              flex: 2,
              minHeight: 0,
              background: "#111",
              borderRadius: "8px",
              overflow: "hidden",
              padding: "8px"
            }}
          >
            <SvgMap
              svgPath={`/maps/${q.data?.svg}`}
              found={items}
              selected={editing}
              onSelect={handleSelect}
            />
          </div>

          {/* INPUTS */}
          <div
            style={{
              flex: 1,
              borderTop: "1px solid #333",
              padding: "10px",
              background: "#181818",
              borderRadius: "8px"
            }}
          >
            {editing ? (
              <>
                <div style={{ marginBottom: "5px" }}>
                  Code : {editing}
                </div>

                <input
                  autoFocus
                  value={labels[editing] || ""}
                  onChange={(e) =>
                    updateLabel(editing, e.target.value)
                  }
                  placeholder="Label"
                  style={{ width: "90%", marginBottom: "5px" }}
                />

                <input
                  value={(aliases[editing] || []).join(", ")}
                  onChange={(e) =>
                    updateAliases(editing, e.target.value)
                  }
                  placeholder="Aliases"
                  style={{ width: "90%" }}
                />
              </>
            ) : (
              <div>Sélectionner une zone</div>
            )}
          </div>

        </div>

        {/* 📋 DROITE */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          padding: "12px",
          gap: "10px",
          boxSizing: "border-box"
        }}>

          <div style={{
            padding: "10px",
            borderBottom: "1px solid #333"
          }}>
            Zones ({items.length})
          </div>

          <div style={{
            flex: 1,
            overflow: "auto",
            minHeight: 0,
            background: "#181818",
            borderRadius: "0 0 8px 8px"
          }}>
            {items.map((code) => (
              <div
                key={code}
                ref={(el) => {
                  if (editing === code && el) {
                    el.scrollIntoView({ block: "nearest" });
                  }
                }}
                onClick={() => handleRowClick(code)}
                style={{
                  padding: "8px",
                  cursor: "pointer",
                  background:
                    editing === code ? "#2a2a2a" : "transparent"
                }}
              >
                {code} → {labels[code] || "???"}
              </div>
            ))}
          </div>

        </div>

      </div>
    </div >
  );
}