import { useState } from "react";
import { sendMapAnswer } from "../api/api";
import SvgMap from "./SvgMap";

export default function MapQuestion({ q, onAnswer }) {

  const items = q.items || [];

  const [input, setInput] = useState("");
  const [found, setFound] = useState([]); // ids
  const [showRecap, setShowRecap] = useState(false);
  const [itemQuality, setItemQuality] = useState({});

  const activeStyle = {
    transform: "scale(1.1)",
    border: "1px solid #fff"
  };

  function normalize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  }

  function matches(item, input) {
    const all = [item.label, ...(item.aliases || [])];
    return all.some(v => normalize(v) === normalize(input));
  }

  function handleSubmit() {
    const match = items.find(item => matches(item, input));

    if (match && !found.includes(match.id)) {
      setFound(prev => [...prev, match.id]);
    }

    setInput("");
  }

  function finishMap() {
    const initialQuality = {};

    items.forEach(item => {
      if (found.includes(item.id)) {
        initialQuality[item.id] = 2; // facile
      } else {
        initialQuality[item.id] = 0; // raté
      }
    });

    setItemQuality(initialQuality);
    setShowRecap(true);
  }

  async function sendResult() {
    await sendMapAnswer(itemQuality);

    setShowRecap(false);
    setFound([]);
    setItemQuality({});

    onAnswer();
  }

  function setQuality(id, quality) {
    setItemQuality(prev => ({
      ...prev,
      [id]: quality
    }));
  }

  const progress = `${found.length} / ${items.length}`;

  return (
    <div>
      <h2>{q.svg}</h2>

      <p style={{ opacity: 0.7 }}>{progress}</p>

      {/* 🗺️ MAP */}
      <SvgMap
        svgPath={`/maps/${q.svg}`}
        found={items
          .filter(i => found.includes(i.id))
          .map(i => i.code)}
        dueItems={items.map(i => i.code)}
        onSelect={(code) => {
          const item = items.find(i => i.code === code);
          if (item && !found.includes(item.id)) {
            setFound(prev => [...prev, item.id]);
          }
        }}
      />

      {/* INPUT */}
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="Tape ta réponse..."
        style={{ width: "100%", marginBottom: "15px" }}
      />

      {/* LISTE */}
      <div style={gridStyle}>
        {items.map(item => {
          const isFound = found.includes(item.id);

          return (
            <div
              key={item.id}
              style={{
                padding: "5px",
                borderRadius: "5px",
                background: isFound ? "#2ecc71" : "#444",
                textAlign: "center"
              }}
            >
              {isFound ? item.label : "???"}
            </div>
          );
        })}
      </div>

      {/* ABANDON */}
      <button onClick={finishMap} style={{ marginBottom: "10px" }}>
        Abandonner
      </button>

      {/* FIN */}
      {found.length === items.length && !showRecap && (
        <div style={{ marginTop: "20px" }}>
          <p>🎉 Terminé !</p>
          <button onClick={finishMap}>
            Voir le résultat
          </button>
        </div>
      )}

      {/* RECAP */}
      {showRecap && (
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "#111",
          padding: "20px"
        }}>
          <h2>Résultat</h2>

          {/* 🗺️ MAP RECAP */}
          <SvgMap
            svgPath={`/maps/${q.svg}`}
            found={items
              .filter(i => found.includes(i.id))
              .map(i => i.code)}
            dueItems={[]}
          />

          <table style={{ width: "100%", marginTop: "20px" }}>
            <thead>
              <tr>
                <th>Zone</th>
                <th>Résultat</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {items.map(item => {
                const isFound = found.includes(item.id);

                return (
                  <tr key={item.id}>
                    <td>{item.label}</td>

                    <td>{isFound ? "✅" : "❌"}</td>

                    <td>
                      {[0,1,2].map(qVal => (
                        <button
                          key={qVal}
                          onClick={() => setQuality(item.id, qVal)}
                          style={{
                            background:
                              itemQuality[item.id] === qVal
                                ? "#2ecc71"
                                : "#333",
                            ...(itemQuality[item.id] === qVal ? activeStyle : {})
                          }}
                        >
                          {qVal === 0 ? "❌" : qVal === 1 ? "😐" : "✅"}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button onClick={sendResult}>
            Valider
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