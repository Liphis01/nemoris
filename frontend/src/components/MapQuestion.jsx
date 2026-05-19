import { Fragment, useEffect, useMemo, useState } from "react";
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

const DESIRED_RETENTION = 0.9;

function normalize(str = "") {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function pythonRoundPositive(value) {
  const floorValue = Math.floor(value);
  const fraction = value - floorValue;

  if (fraction < 0.5) {
    return floorValue;
  }

  if (fraction > 0.5) {
    return floorValue + 1;
  }

  return floorValue % 2 === 0
    ? floorValue
    : floorValue + 1;
}

function nextInterval(stability) {
  return Math.max(
    1,
    pythonRoundPositive(stability * Math.log(DESIRED_RETENTION) / Math.log(0.9))
  );
}

export default function MapQuestion({ group, items, onComplete }) {

  const [input, setInput] = useState("");
  const [found, setFound] = useState([]);
  const [showRecap, setShowRecap] = useState(false);
  const [itemQuality, setItemQuality] = useState({});
  const [focusedCode, setFocusedCode] = useState(null);
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

  const answerLookup = useMemo(() => {
    const lookup = new Map();

    items.forEach(item => {
      const aliases = item.aliases || item.data?.aliases || [];
      const values = [item.label, ...aliases];

      values.forEach(value => {
        const normalized = normalize(value);

        if (normalized && !lookup.has(normalized)) {
          lookup.set(normalized, item);
        }
      });
    });

    return lookup;
  }, [items]);

  const itemByCode = useMemo(() => {
    const lookup = new Map();

    items.forEach(item => {
      if (item.code) {
        lookup.set(item.code, item);
      }
    });

    return lookup;
  }, [items]);

  const foundSet = useMemo(
    () => new Set(found),
    [found]
  );

  const foundCodes = useMemo(
    () =>
      items
        .filter(i => foundSet.has(i.question_id))
        .map(i => i.code),
    [foundSet, items]
  );

  const missedCodes = useMemo(
    () =>
      items
        .filter(i => !foundSet.has(i.question_id))
        .map(i => i.code),
    [foundSet, items]
  );

  const dueCodes = useMemo(
    () => items.map(i => i.code),
    [items]
  );

  function handleSubmit() {
    const match = answerLookup.get(normalize(input));

    if (match && !foundSet.has(match.question_id)) {
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
      initial[item.question_id] = foundSet.has(item.question_id) ? 2 : 0;
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
    setFocusedCode(null);

    onComplete(failedQuestionIds);
  }

  function setQuality(id, quality) {
    setItemQuality(prev => ({
      ...prev,
      [id]: quality
    }));
  }

  function getHistoryStats(item) {
    const history = item.progress?.history || [];

    if (history.length > 0) {
      const successes = history.filter(entry => entry.quality > 0).length;

      return {
        reviews: history.length,
        successRate: Math.round((successes / history.length) * 100)
      };
    }

    const reps = item.progress?.reps || 0;
    const lapses = item.progress?.lapses || 0;

    if (reps > 0) {
      const successes = Math.max(0, reps - lapses);

      return {
        reviews: reps,
        successRate: Math.round((successes / reps) * 100)
      };
    }

    return {
      reviews: 0,
      successRate: null
    };
  }

  function getDifficultyScore(item, historyStats) {
    const explicitDifficulty = Number(item.progress?.difficulty);

    if (Number.isFinite(explicitDifficulty)) {
      return explicitDifficulty;
    }

    if (historyStats.successRate !== null) {
      return 10 - (historyStats.successRate / 10);
    }

    return 5;
  }

  function getProjectedInterval(item, quality) {
    const progress = item.progress || {};
    let stability = progress.stability || 1.0;
    let difficulty = progress.difficulty || 5.0;

    if (quality === 0) {
      stability = Math.max(0.5, stability * 0.45);
    } else if (quality === 1) {
      difficulty = Math.min(10, difficulty + 0.1);
      stability = stability * (1.2 + (10 - difficulty) * 0.03);
    } else {
      difficulty = Math.max(1, difficulty - 0.08);
      stability = stability * (1.8 + (10 - difficulty) * 0.05);
    }

    return quality === 0 ? 0 : nextInterval(stability);
  }

  const progressPercent = items.length
    ? (found.length / items.length) * 100
    : 0;
  const isIncorrectFlash = incorrectFlashId > 0;
  const isCorrectFlash = correctFlashId > 0;
  const feedbackTone = isIncorrectFlash ? "incorrect" : isCorrectFlash ? "correct" : null;
  const recapSuccessCount = Object.values(itemQuality)
    .filter(quality => quality > 0)
    .length;
  const recapMissCount = items.length - recapSuccessCount;
  const recapSuccessRate = items.length
    ? Math.round((recapSuccessCount / items.length) * 100)
    : 0;
  const recapRows = useMemo(() => {
    return items
      .map(item => {
        const historyStats = getHistoryStats(item);
        const isFound = foundSet.has(item.question_id);

        return {
          item,
          historyStats,
          isFound,
          difficultyScore: getDifficultyScore(item, historyStats)
        };
      })
      .sort((a, b) => {
        if (a.isFound !== b.isFound) {
          return a.isFound ? -1 : 1;
        }

        if (b.difficultyScore !== a.difficultyScore) {
          return b.difficultyScore - a.difficultyScore;
        }

        return String(a.item.label || "").localeCompare(String(b.item.label || ""));
      });
  }, [items, foundSet]);
  const hasCorrectRecapRows = recapRows.some(row => row.isFound);
  const hasWrongRecapRows = recapRows.some(row => !row.isFound);
  const showRecapSections = hasCorrectRecapRows && hasWrongRecapRows;

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
              found={foundCodes}
              dueItems={dueCodes}
              onSelect={(code) => {
                const item = itemByCode.get(code);

                if (item && !foundSet.has(item.question_id)) {
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
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "10px",
                marginBottom: "18px"
              }}
            >
              <div style={recapStatStyle}>
                <div style={recapStatValueStyle}>{recapSuccessRate}%</div>
                <div style={recapStatLabelStyle}>réussite</div>
              </div>

              <div style={recapStatStyle}>
                <div style={recapStatValueStyle}>
                  {recapSuccessCount}
                  <span style={recapStatMutedStyle}> / {items.length}</span>
                </div>
                <div style={recapStatLabelStyle}>trouvées</div>
              </div>

              <div style={recapStatStyle}>
                <div style={recapStatValueStyle}>{recapMissCount}</div>
                <div style={recapStatLabelStyle}>à revoir</div>
              </div>
            </div>

            <div className="map-recap-content">
              <div style={recapMapPanelStyle}>
                <SvgMap
                  svgPath={`/maps/${group.media}`}
                  found={foundCodes}
                  missed={missedCodes}
                  dueItems={[]}
                  selected={focusedCode}
                  focusCode={focusedCode}
                />
              </div>

              <div style={recapTableStyle}>
                <div className="map-recap-table-header" style={recapTableHeaderStyle}>
                  <div>Réponse</div>
                  <div>Réussite</div>
                  <div>Intervalle</div>
                  <div>Qualité</div>
                </div>

                <div style={recapTableBodyStyle}>
                  {recapRows.map((row, index) => {
                    const { item, historyStats, isFound } = row;
                    const showSection =
                      showRecapSections &&
                      (index === 0 || recapRows[index - 1].isFound !== isFound);
                    const isFocused = focusedCode === item.code;
                    const selectedQuality = itemQuality[item.question_id] ?? (isFound ? 2 : 0);
                    const projectedInterval = getProjectedInterval(item, selectedQuality);

                    return (
                      <Fragment key={item.question_id}>
                        {showSection && (
                          <div style={recapSectionStyle}>
                            {isFound ? "Correct" : "Wrong"}
                          </div>
                        )}

                        <button
                          className="map-recap-row"
                          type="button"
                          onClick={() => setFocusedCode(item.code)}
                          style={{
                            ...recapRowStyle,
                            ...(isFocused ? recapRowFocusedStyle : {}),
                            borderLeft: isFound
                              ? "3px solid rgba(126, 226, 168, 0.75)"
                              : "3px solid rgba(255, 140, 148, 0.75)"
                          }}
                          title={item.code ? `Voir ${item.label} sur la carte` : item.label}
                        >
                          <div style={recapAnswerCellStyle}>
                            {item.label}
                          </div>

                          <div style={recapMetricCellStyle}>
                            {historyStats.reviews > 0 ? (
                              <>
                                <span style={zoneHistoryRateStyle}>
                                  {historyStats.successRate}%
                                </span>
                                <span style={zoneHistoryMetaStyle}>
                                  {historyStats.reviews} revue{historyStats.reviews > 1 ? "s" : ""}
                                </span>
                              </>
                            ) : (
                              <span style={zoneHistoryMetaStyle}>Nouveau</span>
                            )}
                          </div>

                          <div style={recapIntervalCellStyle}>
                            {projectedInterval}
                            <span style={recapIntervalUnitStyle}> j</span>
                          </div>

                          <div style={recapQualityCellStyle}>
                            {[0, 1, 2].map(qVal => {

                              const selected =
                                itemQuality[item.question_id] === qVal;
                              const wasFound = foundSet.has(item.question_id);
                              const disabled =
                                (wasFound && qVal === 0) ||
                                (!wasFound && qVal !== 0);
                              const activeStyle = qualityButtonStyles[qVal];

                              return (
                                <button
                                  key={qVal}
                                  type="button"
                                  disabled={disabled}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setQuality(item.question_id, qVal);
                                  }}
                                  style={{
                                    ...recapQualityButtonStyle,
                                    cursor: disabled ? "not-allowed" : "pointer",
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
                                  title={qVal === 0 ? "Raté" : qVal === 1 ? "Fragile" : "Réussi"}
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
                        </button>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
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

const recapStatStyle = {
  background: "#181818",
  border: "1px solid #262626",
  borderRadius: "12px",
  padding: "12px 14px",
  minWidth: 0
};

const recapStatValueStyle = {
  color: "#f3f3f3",
  fontSize: "22px",
  fontWeight: "700",
  lineHeight: "26px"
};

const recapStatMutedStyle = {
  color: "#666",
  fontSize: "14px",
  marginLeft: "3px"
};

const recapStatLabelStyle = {
  color: "#777",
  fontSize: "12px",
  marginTop: "3px"
};

const recapMapPanelStyle = {
  background: "#111",
  borderRadius: "14px",
  overflow: "hidden",
  border: "1px solid #262626",
  minHeight: "430px"
};

const recapTableStyle = {
  minWidth: 0,
  border: "1px solid #262626",
  borderRadius: "14px",
  overflow: "hidden",
  background: "#111"
};

const recapTableHeaderStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 1.35fr) 94px 86px 124px",
  gap: "10px",
  alignItems: "center",
  padding: "10px 14px",
  background: "#151515",
  borderBottom: "1px solid #262626",
  color: "#777",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "left"
};

const recapTableBodyStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "1px",
  maxHeight: "430px",
  overflow: "auto",
  background: "#242424"
};

const recapSectionStyle = {
  padding: "10px 14px 8px",
  background: "#111",
  color: "#8a8a8a",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "left"
};

const recapRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 1.35fr) 94px 86px 124px",
  gap: "10px",
  alignItems: "center",
  width: "100%",
  minHeight: "58px",
  padding: "10px 12px",
  background: "#181818",
  border: "0",
  borderRadius: 0,
  color: "#e5e5e5",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  boxSizing: "border-box",
  transition: "background 0.14s ease, box-shadow 0.14s ease"
};

const recapRowFocusedStyle = {
  background: "#202018",
  boxShadow: "inset 0 0 0 1px rgba(243, 156, 18, 0.65)"
};

const recapAnswerCellStyle = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: "650",
  color: "#f3f3f3"
};

const recapMetricCellStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  minWidth: 0,
  color: "#777",
  fontSize: "12px",
  lineHeight: "16px"
};

const recapIntervalCellStyle = {
  color: "#e5e5e5",
  fontSize: "18px",
  fontWeight: "700",
  whiteSpace: "nowrap"
};

const recapIntervalUnitStyle = {
  color: "#777",
  fontSize: "12px",
  fontWeight: "600"
};

const recapQualityCellStyle = {
  display: "flex",
  gap: "6px",
  justifyContent: "flex-start"
};

const recapQualityButtonStyle = {
  width: "34px",
  height: "34px",
  padding: 0,
  borderRadius: "9px",
  fontWeight: "600",
  lineHeight: "34px"
};

const zoneHistoryRateStyle = {
  color: "#e5e5e5",
  fontSize: "17px",
  fontWeight: "700",
  lineHeight: "20px"
};

const zoneHistoryMetaStyle = {
  color: "#777",
  fontSize: "11px",
  whiteSpace: "nowrap"
};
