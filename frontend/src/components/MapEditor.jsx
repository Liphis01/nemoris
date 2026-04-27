import { useState, useEffect } from "react";
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
  updateQuestionInState
}) {
  const [items, setItems] = useState(q.data?.items || []);
  const [labels, setLabels] = useState(q.data?.labels || {});
  const [aliases, setAliases] = useState(q.data?.aliases || {});
  const [editing, setEditing] = useState(null);
  const [aliasesInput, setAliasesInput] = useState("");

  function handleSelect(code) {
    // Vérifier si editing est dans labels
    if (editing && !labels[editing]) {
      // Si non, on le supprime des items
      setItems(items.filter((c) => c !== editing));

      // Et on supprime aussi de labels et aliases
      const newLabels = { ...labels };
      delete newLabels[editing];
      setLabels(newLabels);

      const newAliases = { ...aliases };
      delete newAliases[editing];
      setAliases(newAliases);
    }

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

  function addAlias(code) {
    const value = aliasesInput.trim();
    if (!value) return;
    if ((aliases[code] || []).includes(value)) return;

    setAliases(prev => ({
      ...prev,
      [code]: [...(prev[code] || []), value]
    }));

    setAliasesInput("");
  }

  function removeAlias(code, index) {
    setAliases(prev => ({
      ...prev,
      [code]: prev[code].filter((_, i) => i !== index)
    }));
  }

  function handleAliasKeyDown(e, code) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAlias(code);
    }
  }

  // function commitAliases(code) {
  //   const parsed = aliasesInput
  //     .split(",")
  //     .map(v => v.trim())
  //     .filter(Boolean);

  //   setAliases(prev => ({
  //     ...prev,
  //     [code]: parsed
  //   }));
  // }

  async function handleClose() {
    const updated = {
      ...q,
      type_q: "map",
      data: {
        ...q.data,
        items,
        labels,
        aliases
      }
    };

    await updateQuestion(q, updated);

    updateQuestionInState(updated);

    onClose();
  }

  useEffect(() => {
    const scrollBarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    document.body.style.paddingRight = scrollBarWidth + "px";

    return () => {
      document.body.style.overflow = "auto";
      document.body.style.paddingRight = "0px";
    };
  }, []);

  // useEffect(() => {
  //   if (!editing) return;

  //   setAliasesInput((aliases[editing] || []).join(", "));
  // }, [editing]);

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

                <div style={{ marginTop: "10px" }}>

                  {/* TAGS */}
                  <div style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    marginBottom: "6px"
                  }}>
                    {(aliases[editing] || []).map((alias, index) => (
                      <div
                        key={index}
                        style={{
                          background: "#333",
                          padding: "4px 8px",
                          borderRadius: "6px",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px"
                        }}
                      >
                        <span>{alias}</span>
                        <span
                          onClick={() => removeAlias(editing, index)}
                          style={{
                            cursor: "pointer",
                            color: "#aaa"
                          }}
                        >
                          ✕
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* INPUT */}
                  <input
                    value={aliasesInput}
                    onChange={(e) => setAliasesInput(e.target.value)}
                    onKeyDown={(e) => handleAliasKeyDown(e, editing)}
                    onBlur={() => addAlias(editing)}
                    placeholder="Ajouter un alias"
                    style={{ width: "100%" }}
                  />

                </div>
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