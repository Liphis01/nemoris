import { useState, useEffect, useRef } from "react";
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

export default function MapEditor({ q, onClose }) {

  const [zones, setZones] = useState([]); // 🔥 vraies questions map
  const [editing, setEditing] = useState(null);
  const [aliasesInput, setAliasesInput] = useState("");
  const labelInputRef = useRef(null);

  // 🔥 charger zones depuis DB
  useEffect(() => {
    fetch("http://localhost:8000/questions")
      .then(res => res.json())
      .then(data => {
        const mapZones = data.filter(
          item => item.type_q === "map" && item.media === q.media
        );
        setZones(mapZones);
      });
  }, [q.media]);

  function handleSelect(code) {
    let zone = zones.find(z => z.code === code);

    // 🔥 si zone inexistante → créer localement
    if (!zone) {
      zone = {
        id: "tmp-" + code,
        code,
        question: "",
        aliases: [],
        media: q.media,
        type_q: "map"
      };

      setZones(prev => [...prev, zone]);
    }

    setEditing(zone);
  }

  function updateLabel(value) {
    setZones(prev =>
      prev.map(z =>
        z === editing ? { ...z, question: value, answer: value } : z
      )
    );
    setEditing(prev => ({ ...prev, question: value, answer: value }));
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
  }

  async function handleClose() {
    for (const z of zones) {
      await fetch("http://localhost:8000/map_zone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          media: q.media,
          code: z.code,
          label: z.question,
          aliases: z.aliases || []
        })
      });
    }

    onClose();
  }

  useEffect(() => {
    if (editing) {
      labelInputRef.current?.focus();
    }
  }, [editing]);

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>

        {/* 🗺️ MAP */}
        <div style={{ padding: "12px" }}>
          <SvgMap
            svgPath={`/maps/${q.media}`}
            found={zones.map(z => z.code)}
            selected={editing?.code}
            onSelect={handleSelect}
          />
        </div>

        {/* 📋 PANEL */}
        <div style={{ padding: "12px" }}>
          {editing ? (
            <>
              <div>Code: {editing.code}</div>

              <input
                ref={labelInputRef}
                value={editing.question || ""}
                onChange={(e) => updateLabel(e.target.value)}
                placeholder="Label"
              />

              {/* ALIASES */}
              <div>
                {(editing.aliases || []).map((a, i) => (
                  <div key={i}>
                    {a}
                    <span onClick={() => removeAlias(i)}>✕</span>
                  </div>
                ))}
              </div>

              <input
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAlias()}
                placeholder="Ajouter alias"
              />
            </>
          ) : (
            <div>Sélectionne une zone</div>
          )}
        </div>

      </div>
    </div>
  );
}