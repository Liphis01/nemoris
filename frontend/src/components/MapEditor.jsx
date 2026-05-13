import { useState, useEffect, useRef } from "react";
import SvgMap from "./SvgMap";

export default function MapEditor({
  q,
  embedded = false,
  onClose,
  updateQuestion,
  updateQuestionInState
}) {

  const [items, setItems] = useState([]);
  const [zones, setZones] = useState([]);
  const [editing, setEditing] = useState(null);
  const [aliasesInput, setAliasesInput] = useState("");
  const labelInputRef = useRef(null);

  // Load zones from API
  useEffect(() => {
    async function loadZones() {
      try {
        const res = await fetch(
          `http://localhost:8000/maps/${q.group_id}/zones`
        );
        const data = await res.json();
        setZones(data);
        setItems(data.map(z => z.code));
      } catch (err) {
        console.error("Error loading zones:", err);
      }
    }

    if (q.group_id) {
      loadZones();
    }
  }, [q.group_id]);

  // 🔥 charger zones depuis DB
  useEffect(() => {
    fetch("http://localhost:8000/questions")
      .then(res => res.json())
      .then(data => {
        const mapZones = data.filter(
          item => item.type_q === "map_zone" && item.group_id === q.group_id
        );
        setZones(mapZones);
      });
  }, [q.group_id]);

  function handleSelect(code) {
    let zone = zones.find(z => z.code === code);

    if (!zone) {
      zone = {
        id: "tmp-" + code,
        code,
        label: "",
        aliases: []
      };
      setZones(prev => [...prev, zone]);
    }

    setEditing(zone);
  }

  function updateLabel(value) {
    setZones(prev =>
      prev.map(z =>
        z === editing ? { ...z, label: value } : z
      )
    );
    setEditing(prev => ({ ...prev, label: value }));
  }

  function addAlias() {
    const value = aliasesInput.trim();
    if (!value) return;

    setZones(prev =>
      prev.map(z =>
        z === editing
          ? {
            ...z,
            aliases: [...(z.aliases || []), value]
          }
          : z
      )
    );

    setEditing(prev => ({
      ...prev,
      aliases: [...(prev.aliases || []), value]
    }));

    setAliasesInput("");
  }

  function removeAlias(index) {
    setZones(prev =>
      prev.map(z =>
        z === editing
          ? {
            ...z,
            aliases: z.aliases.filter((_, i) => i !== index)
          }
          : z
      )
    );
    setEditing(prev => ({
      ...prev,
      aliases: prev.aliases.filter((_, i) => i !== index)
    }));
  }

  function handleAliasKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addAlias();
    }
  }

  function handleRowClick(code) {
    handleSelect(code);
  }

  async function handleClose() {
    for (const z of zones) {
      if (!z.id || z.id.startsWith("tmp-")) {
        // New zone - create via POST
        await fetch("http://localhost:8000/questions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            type_q: "map_zone",
            question: z.label,
            answer: z.label,
            tags: [],
            group_id: q.group_id,
            data: {
              code: z.code,
              aliases: z.aliases || []
            }
          })
        });
      } else {
        // Update existing zone
        await fetch(`http://localhost:8000/questions/${z.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            question: z.label,
            answer: z.label,
            data: {
              code: z.code,
              aliases: z.aliases || []
            }
          })
        });
      }
    }

    if (onClose) {
      onClose();
    }
  }

  useEffect(() => {
    if (editing) {
      labelInputRef.current?.focus();
    }
  }, [editing]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: "2fr 320px",
        background: "#1e1e1e",
        overflow: "hidden"
      }}
    >

      {/* 🗺️ LEFT */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #333",
          minWidth: 0
        }}
      >

        {/* HEADER */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #333",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#181818"
          }}
        >
          <div>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>
              {q.svg}
            </div>

            <div style={{ color: "#777", fontSize: "13px" }}>
              {items.length} zones
            </div>
          </div>

          {!embedded && (
            <button onClick={handleClose}>
              Fermer
            </button>
          )}
        </div>

        {/* MAP */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: "10px"
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "#111",
              borderRadius: "10px",
              overflow: "hidden"
            }}
          >
            <SvgMap
              svgPath={`/maps/${q.svg}`}
              found={items}
              selected={editing?.code}
              onSelect={handleSelect}
            />
          </div>
        </div>

        {/* EDITOR */}
        <div
          style={{
            borderTop: "1px solid #333",
            padding: "15px",
            background: "#181818"
          }}
        >
          {editing ? (
            <>
              <div
                style={{
                  marginBottom: "8px",
                  color: "#888"
                }}
              >
                Zone : {editing.code}
              </div>

              <input
                autoFocus
                ref={labelInputRef}
                value={editing.label || ""}
                onChange={(e) =>
                  updateLabel(e.target.value)
                }
                placeholder="Nom"
                style={{
                  width: "100%",
                  marginBottom: "12px",
                  padding: "10px",
                  background: "#111",
                  color: "#eee",
                  border: "1px solid #333",
                  borderRadius: "8px",
                  boxSizing: "border-box"
                }}
              />

              {/* TAGS */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginBottom: "10px"
                }}
              >
                {(editing.aliases || []).map((alias, index) => (
                  <div
                    key={index}
                    style={{
                      background: "#333",
                      padding: "5px 8px",
                      borderRadius: "6px",
                      display: "flex",
                      gap: "6px",
                      alignItems: "center"
                    }}
                  >
                    <span>{alias}</span>

                    <span
                      onClick={() => removeAlias(index)}
                      style={{
                        cursor: "pointer",
                        color: "#999"
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ))}
              </div>

              <input
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                onKeyDown={handleAliasKeyDown}
                onBlur={addAlias}
                placeholder="Ajouter un alias"
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "#111",
                  color: "#eee",
                  border: "1px solid #333",
                  borderRadius: "8px",
                  boxSizing: "border-box"
                }}
              />
            </>
          ) : (
            <div style={{ color: "#666" }}>
              Sélectionner une zone
            </div>
          )}
        </div>

      </div>

      {/* 📋 RIGHT */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "#161616",
          minHeight: 0
        }}
      >

        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #333",
            fontWeight: "bold"
          }}
        >
          Zones
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto"
          }}
        >
          {items.map((code) => (
            <div
              key={code}
              onClick={() => handleRowClick(code)}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                borderBottom: "1px solid #222",
                background:
                  editing?.code === code
                    ? "#2a2a2a"
                    : "transparent"
              }}
            >
              <div
                style={{
                  fontWeight: "bold",
                  marginBottom: "4px"
                }}
              >
                {zones.find(z => z.code === code)?.label || "???"}
              </div>

              <div
                style={{
                  fontSize: "12px",
                  color: "#777"
                }}
              >
                {code}
              </div>
            </div>
          ))}
        </div>

        {/* FOOTER */}
        <div
          style={{
            padding: "12px",
            borderTop: "1px solid #333",
            background: "#181818"
          }}
        >
          <button
            onClick={handleClose}
            style={{
              width: "100%",
              padding: "12px",
              background: "#3a7afe",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer"
            }}
          >
            Sauvegarder
          </button>
        </div>

      </div>

    </div>
  );
}