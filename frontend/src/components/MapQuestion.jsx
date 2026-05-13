import { useState } from "react";
import { sendMapAnswer } from "../api/api";
import SvgMap from "./SvgMap";

export default function MapQuestion({ q, onComplete }) {

  const items = q.items || [];

  const [input, setInput] = useState("");
  const [found, setFound] = useState([]);
  const [showRecap, setShowRecap] = useState(false);
  const [itemQuality, setItemQuality] = useState({});

  function normalize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  }

  function matches(item, input) {
    const all = [item.label, ...(item.data?.aliases || [])];
    return all.some(v => normalize(v) === normalize(input));
  }

  function handleSubmit() {
    const match = items.find(item => matches(item, input));

    if (match && !found.includes(match.id)) {
      setFound(prev => [...prev, match.id]);
    }

    setInput("");
  }

  // 🔥 FIN → initialisation intelligente
  function finishMap() {
    const initial = {};

    items.forEach(item => {
      initial[item.id] = found.includes(item.id) ? 2 : 1;
    });

    setItemQuality(initial);
    setShowRecap(true);
  }

  async function sendResult() {
    await sendMapAnswer(itemQuality);

    setShowRecap(false);
    setFound([]);
    setItemQuality({});

    onComplete(); // passer à la suite
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

      <h2>{q.media}</h2>

      <p style={{ opacity: 0.7 }}>{progress}</p>

      {/* 🗺️ MAP */}
      <SvgMap
        svgPath={`/maps/${q.media}`}
        found={items
          .filter(i => found.includes(i.id))
          .map(i => i.data?.code)}
        dueItems={items.map(i => i.data?.code)}
        onSelect={(code) => {
          const item = items.find(i => i.data?.code === code);
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
      {!showRecap && (
        <button onClick={finishMap} style={{ marginTop: "10px" }}>
          Terminer / Abandonner
        </button>
      )}

      {/* AUTO FIN */}
      {found.length === items.length && !showRecap && (
        <button onClick={finishMap}>
          Voir le résultat
        </button>
      )}

      {/* RECAP */}
      {showRecap && (
        <div style={overlayStyle}>

          <h2>Résultat</h2>

          {/* 🗺️ MAP RECAP */}
          <SvgMap
            svgPath={`/maps/${q.media}`}
            found={items
              .filter(i => found.includes(i.id))
              .map(i => i.data?.code)}
            dueItems={[]}
          />

          <table style={{ width: "100%", marginTop: "20px" }}>
            <thead>
              <tr>
                <th>Zone</th>
                <th>Résultat</th>
                <th>Difficulté</th>
              </tr>
            </thead>

            <tbody>
              {items.map(item => {
                const isFound = found.includes(item.id);

                return (
                  <tr key={item.id}>
                    <td>{item.label}</td>

                    <td>
                      {isFound ? "✅" : "❌"}
                    </td>

                    <td>
                      {[0, 1, 2].map(qVal => (
                        <button
                          key={qVal}
                          onClick={() => setQuality(item.id, qVal)}
                          style={{
                            marginRight: "5px",
                            background:
                              itemQuality[item.id] === qVal
                                ? "#2ecc71"
                                : "#333"
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

          <button onClick={sendResult} style={{ marginTop: "20px" }}>
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

const overlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  background: "#111",
  padding: "20px",
  overflow: "auto"
};