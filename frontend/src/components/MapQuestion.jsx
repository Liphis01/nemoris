import { useState } from "react";
import { sendAnswer } from "../api/api";
import { sendMapAnswer } from "../api/api";
import SvgMap from "./SvgMap";

export default function MapQuestion({ q, onAnswer }) {
  const items = q.data?.items || [];
  const labels = q.data?.labels || {};
  const aliases = q.data?.aliases || {};

  const [input, setInput] = useState("");
  const [found, setFound] = useState([]);
  const [missed, setMissed] = useState([]);
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

  function matches(code, input) {
    const name = labels[code] || code;
    const all = [name, ...(aliases[code] || [])];

    return all.some(v => normalize(v) === normalize(input));
  }

  function handleSubmit() {
    const value = normalize(input);

    const match = items.find(code => matches(code, input));

    if (match && !found.includes(match)) {
      setFound(prev => [...prev, match]);
    }

    setInput("");
  }

  function finishMap() {
    const allItems = q.data.items;

    const missedItems = allItems.filter(
      item => !found.includes(item)
    );

    // ✅ init qualité par défaut
    const initialQuality = {};
    allItems.forEach(code => {
      if (found.includes(code)) {
        initialQuality[code] = 2; // facile
      } else {
        initialQuality[code] = 0; // difficile
      }
    });

    setItemQuality(initialQuality);
    setMissed(missedItems);
    setShowRecap(true);
  }

  async function sendResult() {
    await sendMapAnswer(q.id, itemQuality);


    setShowRecap(false);
    setFound([]);
    setMissed([]);
    setItemQuality({});

    onAnswer(); // juste passer à la suite
  }

  function setQuality(code, quality) {
    setItemQuality(prev => ({
      ...prev,
      [code]: quality
    }));
  }

  function computeQuality() {
    const total = items.length;

    const score = items.reduce((acc, code) => {
      return acc + (itemQuality[code] ?? 0);
    }, 0);

    const ratio = score / (total * 2);

    if (ratio < 0.5) return 0;
    if (ratio < 0.8) return 1;
    return 2;
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
        missed={missed}
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

      <button
        onClick={finishMap}
        style={{ marginBottom: "10px" }}
      >
        Abandonner
      </button>


      {/* Fin */}
      {found.length === items.length && !showRecap && (
        <div style={{ marginTop: "20px" }}>
          <p>🎉 Terminé !</p>
          <button onClick={finishMap}>
            Voir le résultat
          </button>
        </div>
      )}

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

          <table style={{ width: "100%", marginTop: "20px" }}>
            <thead>
              <tr>
                <th>Zone</th>
                <th>Résultat</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {items.map(code => {
                const label = labels[code] || code;
                const isFound = found.includes(code);

                return (
                  <tr key={code}>
                    <td>{label}</td>

                    <td>
                      {isFound ? "✅" : "❌"}
                    </td>

                    <td>
                      <button
                        onClick={() => setQuality(code, 0)}
                        style={{
                          background: itemQuality[code] === 0 ? "#2ecc71" : "#333",
                          ...(itemQuality[code] === 0 ? activeStyle : {})
                        }}
                      >
                        ❌
                      </button>

                      <button
                        onClick={() => setQuality(code, 1)}
                        style={{
                          background: itemQuality[code] === 1 ? "#2ecc71" : "#333",
                          ...(itemQuality[code] === 1 ? activeStyle : {})
                        }}
                      >
                        😐
                      </button>

                      <button
                        onClick={() => setQuality(code, 2)}
                        style={{
                          background: itemQuality[code] === 2 ? "#2ecc71" : "#333",
                          ...(itemQuality[code] === 2 ? activeStyle : {})
                        }}
                      >
                        ✅
                      </button>
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