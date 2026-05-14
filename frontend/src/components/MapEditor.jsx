import { useState, useEffect, useRef } from "react";
import SvgMap from "./SvgMap";

export default function MapEditor({
  group,
  onClose
}) {

  const [items, setItems] = useState([]); // List of zone codes on the map
  const [zones, setZones] = useState([]); // List of questions linked to this group
  const [editing, setEditing] = useState(null);
  const [aliasesInput, setAliasesInput] = useState("");
  const labelInputRef = useRef(null);

  // Load zones from questions
  useEffect(() => {
    async function loadZones() {
      try {
        const res = await fetch("http://localhost:8000/questions");
        const data = await res.json();
        const mapZones = data.filter(
          item => item.type_q === "map" && item.group.id === group.id
        );
        setZones(mapZones);
        setItems(mapZones.map(z => z.data?.code || z.code));
      } catch (err) {
        console.error("Error loading zones:", err);
      }
    }

    if (group.id) {
      loadZones();
    }
  }, [group.id]);

  function handleSelect(code) {
    let zone = zones.find(z => (z.data?.code || z.code) === code);

    if (!zone) {
      zone = {
        id: "tmp-" + code,
        type_q: "map",
        question: "",
        answer: "",
        tags: [],
        group_id: group.id,
        data: { code, aliases: [] }
      };
      setZones(prev => [...prev, zone]);
    }

    setEditing(zone);
  }

  function updateLabel(value) {
    setZones(prev =>
      prev.map(z =>
        z.data?.code === editing.data?.code ? { ...z, answer: value } : z
      )
    );
    setEditing(prev => ({ ...prev, answer: value }));
  }

  function addAlias() {
    const value = aliasesInput.trim();
    if (!value) return;

    const currentAliases = editing.data?.aliases || [];
    const newAliases = [...currentAliases, value];

    setZones(prev =>
      prev.map(z =>
        z.data?.code === editing.code
          ? {
            ...z,
            data: { ...z.data, aliases: newAliases }
          }
          : z
      )
    );

    setEditing(prev => ({
      ...prev,
      data: { ...prev.data, aliases: newAliases }
    }));

    setAliasesInput("");
  }

  function removeAlias(index) {
    const currentAliases = editing.data?.aliases || [];
    const newAliases = currentAliases.filter((_, i) => i !== index);

    setZones(prev =>
      prev.map(z =>
        z.data?.code === editing.code
          ? {
            ...z,
            data: { ...z.data, aliases: newAliases }
          }
          : z
      )
    );
    setEditing(prev => ({
      ...prev,
      data: { ...prev.data, aliases: newAliases }
    }));
  }

  function handleAliasKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addAlias();
    }
  }

  // utile ??
  function handleRowClick(code) {
    handleSelect(code);
  }

  async function saveZones() {
    for (const z of zones) {
      const code = z.data?.code;
      const aliases = z.data?.aliases || [];

      if (!z.id || String(z.id).startsWith("tmp-")) {
        // New zone - create via POST
        await fetch("http://localhost:8000/questions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          // body: JSON.stringify({
          //   type_q: "map",
          //   question: "",
          //   answer: z.answer || "",
          //   tags: [],
          //   group_id: group.id,
          //   data: {
          //     code: code,
          //     aliases: aliases
          //   }
          // })
          body: JSON.stringify({
            "question": group.name + " - " + code,
            "answer": z.answer || "",
            "type_q": "map",
            "media": "",
            "tags": [],
            "group_id": group.id,
            // "map_id": 0,
            "data": {
              "code": code,
              "aliases": aliases
            },
            "collection_ids": []
          })
        })
      } else {
        // Update existing zone
        await fetch(`http://localhost:8000/questions/${z.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            answer: z.answer || "",
            data: {
              code: code,
              aliases: aliases
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
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
        overflow: "hidden"
      }}
    >

      {/* 🗺️ MAP SECTION */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0
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
              {group.name || "Map Editor"}
            </div>

            <div style={{ color: "#777", fontSize: "13px" }}>
              {items.length} zones
            </div>
          </div>
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
              svgPath={`/maps/${group.media}`}
              found={zones.map(z => z.data?.code || z.code)}
              selected={editing?.data.code}
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
                Zone : {editing.data?.code}
              </div>

              <input
                autoFocus
                ref={labelInputRef}
                value={editing.answer || ""}
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
                {(editing.data?.aliases || []).map((alias, index) => (
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

      {/* 📋 ZONES LIST */}
      <div
        style={{
          width: "300px",
          display: "flex",
          flexDirection: "column",
          background: "#161616",
          borderLeft: "1px solid #333",
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
                {zones.find(z => (z.data?.code || z.code) === code)?.question || zones.find(z => (z.data?.code || z.code) === code)?.label || "???"}
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
            onClick={saveZones}
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