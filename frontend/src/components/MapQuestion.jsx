import { useState } from "react";
import SvgMap from "./SvgMap";

export default function MapQuestion({ q, onAnswer }) {
  const items = q.data?.items || [];
  const labels = q.data?.labels || {};
  const aliases = q.data?.aliases || {};

  const [input, setInput] = useState("");
  const [found, setFound] = useState([]);

  function normalize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  }

  function matches(code, input) {
    const name = labels[code] || code;
    const all = [name, ...(aliases[code] || [])];

    return all.some(v => normalize(v) === normalize(input));
  }

  function handleSubmit() {
    const value = normalize(input);

    const match = items.find(code => matches(code, input));

    if (match && !found.includes(match)) {
      setFound([...found, match]);
    }

    setInput("");
  }

  const progress = `${found.length} / ${items.length}`;

  return (
    <div>
      <h2>{q.question}</h2>

      {/* Progression */}
      <p style={{ opacity: 0.7 }}>{progress}</p>

      {/* Carte */}
      <SvgMap
        svgPath={`/maps/${q.fichier}`}
        found={found}
        onSelect={(code) => {
          if (items.includes(code) && !found.includes(code)) {
            setFound([...found, code]);
          }
        }}
      />

      {/* Input */}
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="Tape ta réponse..."
        style={{ width: "100%", marginBottom: "15px" }}
      />

      {/* Liste */}
      <div style={gridStyle}>
        {items.map(code => {
          const label = labels[code] || code;
          return (
            <div
              key={code}
              style={{
                padding: "5px",
                borderRadius: "5px",
                background: found.includes(code)
                  ? "#2ecc71"
                  : "#444",
                textAlign: "center"
              }}
            >
              {found.includes(code) ? label : "???"}
            </div>
          );
        })
        }
      </div>


      {/* Fin */}
      {found.length === items.length && (
        <div style={{ marginTop: "20px" }}>
          <p>🎉 Terminé !</p>
          <button onClick={() => onAnswer(2)}>
            Continuer
          </button>
        </div>
      )}
    </div>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
  gap: "5px"
};