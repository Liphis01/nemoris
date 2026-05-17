import { useEffect, useState } from "react";
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
    background: "#3a3420",
    border: "1px solid #6b2b31",
    color: "#ff8c94"
  },
  1: {
    background: "#3a3420",
    border: "1px solid #6f6434",
    color: "#f3d36a"
  },
  2: {
    background: "#3a3420",
    border: "1px solid #2c5c3e",
    color: "#7ee2a8"
  }
};

export default function MapQuestion({ group, items, onComplete }) {

  const [input, setInput] = useState("");
  const [found, setFound] = useState([]);
  const [showRecap, setShowRecap] = useState(false);
  const [itemQuality, setItemQuality] = useState({});
  const [incorrectFlashId, setIncorrectFlashId] = useState(0);
  const [correctFlashId, setCorrectFlashId] = useState(0);

  useEffect(() => {
    if (!incorrectFlashId && !correctFlashId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIncorrectFlashId(0);
      setCorrectFlashId(0);
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [incorrectFlashId, correctFlashId]);

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

    if (match && !found.includes(match.question_id)) {
      setFound(prev => [...prev, match.question_id]);
      setCorrectFlashId(Date.now());
      setIncorrectFlashId(0);
    } else if (input.trim()) {
      setIncorrectFlashId(Date.now());
      setCorrectFlashId(0);
    }

    setInput("");
  }

  function finishMap() {
    const initial = {};

    items.forEach(item => {
      initial[item.question_id] = found.includes(item.question_id) ? 2 : 0;
    });

    setItemQuality(initial);
    setShowRecap(true);
  }

  async function sendResult() {
    await sendMapAnswer(itemQuality);
    console.log("answer sent", itemQuality);

    const failedQuestionIds = Object.entries(itemQuality)
      .filter(([, quality]) => quality === 0)
      .map(([questionId]) => Number(questionId));

    setShowRecap(false);
    setFound([]);
    setItemQuality({});

    onComplete(failedQuestionIds);
  }

  function setQuality(id, quality) {
    setItemQuality(prev => ({
      ...prev,
      [id]: quality
    }));
  }

  const progressPercent = (found.length / items.length) * 100;
  const isIncorrectFlash = incorrectFlashId > 0;
  const isCorrectFlash = correctFlashId > 0;
  const feedbackTone = isIncorrectFlash ? "incorrect" : isCorrectFlash ? "correct" : null;

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
                {group.name || group.media}
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
                background: feedbackTone === "incorrect"
                  ? "rgba(127, 29, 29, 0.45)"
                  : feedbackTone === "correct"
                    ? "rgba(20, 83, 45, 0.42)"
                  : "#111",
                overflow: "hidden",
                border: feedbackTone === "incorrect"
                  ? "1px solid rgba(248, 113, 113, 0.9)"
                  : feedbackTone === "correct"
                    ? "1px solid rgba(134, 239, 172, 0.85)"
                  : "1px solid #2a2a2a",
                boxShadow: feedbackTone === "incorrect"
                  ? "0 0 0 4px rgba(248, 113, 113, 0.12), 0 0 24px rgba(239, 68, 68, 0.35)"
                  : feedbackTone === "correct"
                    ? "0 0 0 4px rgba(134, 239, 172, 0.12), 0 0 24px rgba(34, 197, 94, 0.28)"
                  : "none",
                transition: "background 0.18s ease, border 0.18s ease, box-shadow 0.18s ease"
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  background: feedbackTone === "incorrect"
                    ? "linear-gradient(90deg, #ef4444, #fb7185)"
                    : feedbackTone === "correct"
                      ? "linear-gradient(90deg, #86efac, #4ade80)"
                    : "linear-gradient(90deg, #38bdf8, #60a5fa)",
                  transition: "width 0.2s ease, background 0.18s ease"
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
              svgPath={`/maps/${group.media}`}
              found={items
                .filter(i => found.includes(i.question_id))
                .map(i => i.code)}
              dueItems={items.map(i => i.code)}
              onSelect={(code) => {
                const item = items.find(i => i.code === code);

                if (item && !found.includes(item.question_id)) {
                  setFound(prev => [...prev, item.question_id]);
                  setCorrectFlashId(Date.now());
                  setIncorrectFlashId(0);
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
            style={{
              ...inputStyle,
              border: feedbackTone === "incorrect"
                ? "1px solid rgba(248, 113, 113, 0.9)"
                : feedbackTone === "correct"
                  ? "1px solid rgba(134, 239, 172, 0.85)"
                : inputStyle.border,
              boxShadow: feedbackTone === "incorrect"
                ? "0 0 0 4px rgba(248, 113, 113, 0.1)"
                : feedbackTone === "correct"
                  ? "0 0 0 4px rgba(134, 239, 172, 0.1)"
                : "none",
              transition: "border 0.18s ease, box-shadow 0.18s ease"
            }}
          />

          {/* FOOTER */}
          {!showRecap && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "18px",
                marginTop: "24px"
              }}
            >
              <div
                style={{
                  color: feedbackTone === "incorrect"
                    ? "#fca5a5"
                    : feedbackTone === "correct"
                      ? "#86efac"
                      : "#666",
                  fontSize: "13px",
                  transition: "color 0.18s ease"
                }}
              >
                {feedbackTone === "incorrect"
                  ? "Réponse incorrecte, essaie encore."
                  : feedbackTone === "correct"
                    ? "Bonne réponse."
                    : "Clique sur la carte ou tape les réponses."}
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
                svgPath={`/maps/${group.media}`}
                found={items
                  .filter(i => found.includes(i.question_id))
                  .map(i => i.code)}
                missed={items
                  .filter(i => !found.includes(i.question_id))
                  .map(i => i.code)}
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
              {items.map(item => (
                  <div
                    key={item.question_id}
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
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: "8px"
                      }}
                    >
                      {[0, 1, 2].map(qVal => {

                        const selected =
                          itemQuality[item.question_id] === qVal;
                        const wasFound = found.includes(item.question_id);
                        const disabled =
                          (wasFound && qVal === 0) ||
                          (!wasFound && qVal !== 0);
                        const activeStyle = qualityButtonStyles[qVal];

                        return (
                          <button
                            key={qVal}
                            disabled={disabled}
                            onClick={() => setQuality(item.question_id, qVal)}
                            style={{
                              padding: "10px 12px",
                              borderRadius: "10px",
                              cursor: disabled ? "not-allowed" : "pointer",
                              fontWeight: "600",
                              border: selected
                                ? activeStyle.border
                                : disabled
                                  ? "1px solid #2a2a2a"
                                  : "1px solid #333",
                              background: selected
                                ? activeStyle.background
                                : disabled
                                  ? "#181818"
                                  : "#222",
                              color: selected
                                ? activeStyle.color
                                : disabled
                                  ? "#4a4a4a"
                                  : "#999",
                              opacity: disabled ? 0.55 : 1
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
              ))}
            </div>

          </div>

        </div>
      )}
    </>
  );
}

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
