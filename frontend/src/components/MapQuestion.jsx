import { useState } from "react";
import { sendMapAnswer } from "../api/api";
import { fadeInStyle } from "../styles";
import SvgMap from "./SvgMap";

const typeBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "5px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "600",
  background: "rgba(56, 189, 248, 0.16)",
  color: "#7dd3fc",
  border: "1px solid rgba(56, 189, 248, 0.28)"
};

const inputStyle = {
  width: "100%",
  padding: "14px 16px",
  background: "#101010",
  color: "#eee",
  border: "1px solid #2d2d2d",
  borderRadius: "12px",
  boxSizing: "border-box",
  outline: "none",
  fontSize: "15px"
};

const buttonStyle = {
  padding: "12px 18px",
  borderRadius: "10px",
  border: "1px solid #333",
  background: "#232323",
  color: "#eee",
  cursor: "pointer",
  fontWeight: "600"
};

const successButton = {
  ...buttonStyle,
  background: "#1d3a29",
  border: "1px solid #2c5c3e",
  color: "#7ee2a8"
};

const qualityButtonStyles = {
  0: {
    background: "#3a1f22",
    border: "1px solid #6b2b31",
    color: "#ff8c94"
  },
  1: {
    background: "#3a3420",
    border: "1px solid #6f6434",
    color: "#f3d36a"
  },
  2: {
    background: "#1d3a29",
    border: "1px solid #2c5c3e",
    color: "#7ee2a8"
  }
};

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

    onComplete();
  }

  function setQuality(id, quality) {
    setItemQuality(prev => ({
      ...prev,
      [id]: quality
    }));
  }

  const progressPercent = (found.length / items.length) * 100;

  return (
    <>
      <div
        style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: "18px",
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          ...fadeInStyle
        }}
      >

        {/* HEADER */}
        <div
          style={{
            padding: "22px 24px 18px",
            borderBottom: "1px solid #262626",
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "20px",
              marginBottom: "16px"
            }}
          >
            <div>
              <div style={typeBadgeStyle}>
                🗺 MAP
              </div>

              <div
                style={{
                  marginTop: "14px",
                  fontSize: "28px",
                  fontWeight: "700",
                  color: "#f3f3f3"
                }}
              >
                {q.group_name || q.media}
              </div>
            </div>

            <div
              style={{
                minWidth: "90px",
                textAlign: "right"
              }}
            >
              <div
                style={{
                  fontSize: "28px",
                  fontWeight: "700",
                  color: "#fff"
                }}
              >
                {found.length}
                <span
                  style={{
                    color: "#666",
                    fontSize: "18px",
                    marginLeft: "4px"
                  }}
                >
                  / {items.length}
                </span>
              </div>

              <div
                style={{
                  fontSize: "12px",
                  color: "#777",
                  marginTop: "2px"
                }}
              >
                zones trouvées
              </div>
            </div>
          </div>

          {/* PROGRESS BAR */}
          <div>
            <div
              style={{
                height: "10px",
                borderRadius: "999px",
                background: "#111",
                overflow: "hidden",
                border: "1px solid #2a2a2a"
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  background:
                    "linear-gradient(90deg, #38bdf8, #60a5fa)",
                  transition: "0.2s"
                }}
              />
            </div>

            <div
              style={{
                marginTop: "8px",
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
                color: "#777"
              }}
            >
              <span>{items.length - found.length} restantes</span>
              <span>{Math.round(progressPercent)}%</span>
            </div>
          </div>
        </div>

        {/* MAP */}
        <div
          style={{
            padding: "18px",
            borderBottom: "1px solid #262626"
          }}
        >
          <div
            style={{
              background: "#111",
              borderRadius: "14px",
              overflow: "hidden",
              border: "1px solid #262626"
            }}
          >
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
          </div>
        </div>

        {/* INPUT */}
        <div
          style={{
            padding: "20px 24px"
          }}
        >
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Tape une zone..."
            style={inputStyle}
          />

          {/* FOOTER */}
          {!showRecap && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "24px"
              }}
            >
              <div
                style={{
                  color: "#666",
                  fontSize: "13px"
                }}
              >
                Clique sur la carte ou tape les réponses.
              </div>

              <button
                onClick={finishMap}
                style={buttonStyle}
              >
                Terminer
              </button>
            </div>
          )}
        </div>
      </div>

      {/* RECAP */}
      {showRecap && (
        <div style={overlayStyle}>

          <div style={recapCardStyle}>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "22px"
              }}
            >
              <div>
                <div style={typeBadgeStyle}>
                  🗺 MAP RESULT
                </div>

                <div
                  style={{
                    marginTop: "12px",
                    fontSize: "26px",
                    fontWeight: "700"
                  }}
                >
                  Résultat
                </div>
              </div>

              <button
                onClick={sendResult}
                style={successButton}
              >
                Valider
              </button>
            </div>

            <div
              style={{
                background: "#111",
                borderRadius: "14px",
                overflow: "hidden",
                border: "1px solid #262626",
                marginBottom: "24px"
              }}
            >
              <SvgMap
                svgPath={`/maps/${q.media}`}
                found={items
                  .filter(i => found.includes(i.id))
                  .map(i => i.data?.code)}
                dueItems={[]}
              />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px"
              }}
            >
              {items.map(item => {

                const isFound = found.includes(item.id);

                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "16px",
                      padding: "14px 16px",
                      borderRadius: "12px",
                      background: "#181818",
                      border: "1px solid #262626"
                    }}
                  >

                    <div>
                      <div
                        style={{
                          fontWeight: "600",
                          marginBottom: "4px"
                        }}
                      >
                        {item.label}
                      </div>

                      <div
                        style={{
                          fontSize: "13px",
                          color: isFound
                            ? "#7ee2a8"
                            : "#ff8c94"
                        }}
                      >
                        {isFound ? "Trouvé" : "Manqué"}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: "8px"
                      }}
                    >
                      {[0, 1, 2].map(qVal => {

                        const selected =
                          itemQuality[item.id] === qVal;

                        return (
                          <button
                            key={qVal}
                            onClick={() => setQuality(item.id, qVal)}
                            style={{
                              padding: "10px 12px",
                              borderRadius: "10px",
                              cursor: "pointer",
                              fontWeight: "600",
                              border: selected
                                ? qualityButtonStyles[qVal].border
                                : "1px solid #333",
                              background: selected
                                ? qualityButtonStyles[qVal].background
                                : "#222",
                              color: selected
                                ? qualityButtonStyles[qVal].color
                                : "#999"
                            }}
                          >
                            {qVal === 0
                              ? "❌"
                              : qVal === 1
                                ? "😐"
                                : "✅"}
                          </button>
                        );
                      })}
                    </div>

                  </div>
                );
              })}
            </div>

          </div>

        </div>
      )}
    </>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
  gap: "8px",
  marginTop: "18px"
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.75)",
  backdropFilter: "blur(6px)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "30px",
  zIndex: 1000
};

const recapCardStyle = {
  width: "100%",
  maxWidth: "1100px",
  maxHeight: "100%",
  overflow: "auto",
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  borderRadius: "18px",
  padding: "24px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)"
};