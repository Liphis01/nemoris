import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeTextMode, TEXT_MODE_MATCH } from "../textModes";

const qualityOptions = [
  { value: 0, icon: "❌", title: "Faux" },
  { value: 1, icon: "😐", title: "Dur" },
  { value: 2, icon: "🙂", title: "Bon" },
  { value: 3, icon: "✅", title: "Facile" }
];

const qualityButtonColors = {
  0: { background: "#3a2420", border: "1px solid #6b2b31", color: "#ff8c94" },
  1: { background: "#3a3420", border: "1px solid #6f6434", color: "#f3d36a" },
  2: { background: "#20303a", border: "1px solid #345b7a", color: "#8fc7ff" },
  3: { background: "#203a2a", border: "1px solid #2c5c3e", color: "#7ee2a8" }
};

const inputStyle = {
  background: "#101010",
  border: "1px solid #2d2d2d",
  borderRadius: "8px",
  boxSizing: "border-box",
  color: "#eee",
  fontSize: "14px",
  outline: "none",
  padding: "9px 11px",
  width: "100%"
};

const buttonStyle = {
  background: "#232323",
  border: "1px solid #333",
  borderRadius: "8px",
  color: "#eee",
  cursor: "pointer",
  fontWeight: 700,
  padding: "10px 16px"
};

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function itemAccepts(item, guess) {
  const normalizedGuess = normalize(guess);

  if (!normalizedGuess) return false;

  return [item.answer, ...(item.aliases || [])].some(
    candidate => normalize(candidate) === normalizedGuess
  );
}

function shuffled(list) {
  const copy = [...list];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

export default function TextGroupReview({
  reviewItems,
  contextItems = reviewItems,
  mode: requestedMode,
  onAnsweringComplete,
  onComplete,
  submitAnswer,
  showQualityControls = true,
  fillAvailableHeight = false
}) {
  const mode = normalizeTextMode(requestedMode);
  const isMatch = mode === TEXT_MODE_MATCH;
  const items = useMemo(() => reviewItems || [], [reviewItems]);

  const [phase, setPhase] = useState("answer");
  // type_all
  const [inputs, setInputs] = useState({});
  const [foundIds, setFoundIds] = useState(() => new Set());
  // match
  const [selectedPromptId, setSelectedPromptId] = useState(null);
  const [matchedIds, setMatchedIds] = useState(() => new Set());
  const [failedIds, setFailedIds] = useState(() => new Set());
  const [wrongFlash, setWrongFlash] = useState(null);
  // recap
  const [qualities, setQualities] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [selectedRecapIndex, setSelectedRecapIndex] = useState(0);

  const answerOrder = useMemo(() => shuffled(items), [items]);
  const inputRefs = useRef({});
  const recapRowRefs = useRef({});

  const allResolved = isMatch
    ? matchedIds.size >= items.length
    : foundIds.size >= items.length;

  function finishAnswering() {
    onAnsweringComplete?.();

    const nextQualities = {};

    items.forEach(item => {
      const resolvedOk = isMatch
        ? matchedIds.has(item.question_id) && !failedIds.has(item.question_id)
        : foundIds.has(item.question_id);

      nextQualities[item.question_id] = resolvedOk ? 2 : 0;
    });

    setQualities(nextQualities);

    if (showQualityControls) {
      setSelectedRecapIndex(0);
      setPhase("recap");
    } else {
      submitResult(nextQualities);
    }
  }

  async function submitResult(finalQualities) {
    if (submitting) return;

    setSubmitting(true);

    const failed = Object.entries(finalQualities)
      .filter(([, quality]) => Number(quality) === 0)
      .map(([questionId]) => Number(questionId));

    try {
      await submitAnswer?.(finalQualities, mode, contextItems.length);
    } catch (error) {
      console.error(error);
    } finally {
      onComplete?.(failed);
    }
  }

  // ---- type_all ----
  const handleInputChange = useCallback((questionId, value) => {
    setInputs(prev => ({ ...prev, [questionId]: value }));
  }, []);

  const checkTypedAnswer = useCallback((item) => {
    if (foundIds.has(item.question_id)) return;

    if (itemAccepts(item, inputs[item.question_id])) {
      setFoundIds(prev => new Set(prev).add(item.question_id));
    }
  }, [foundIds, inputs]);

  const handleInputKeyDown = useCallback((event, item, index) => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    checkTypedAnswer(item);

    const next = items[index + 1];
    if (next) {
      inputRefs.current[next.question_id]?.focus();
    }
  }, [checkTypedAnswer, items]);

  // ---- match ----
  const handlePromptClick = useCallback((item) => {
    if (matchedIds.has(item.question_id)) return;

    setSelectedPromptId(prev =>
      prev === item.question_id ? null : item.question_id
    );
  }, [matchedIds]);

  const handleAnswerClick = useCallback((answerItem) => {
    if (matchedIds.has(answerItem.question_id)) return;
    if (selectedPromptId == null) return;

    const promptItem = items.find(item => item.question_id === selectedPromptId);
    if (!promptItem) return;

    const correct = normalize(promptItem.answer) === normalize(answerItem.answer);

    if (correct) {
      setMatchedIds(prev => new Set(prev).add(promptItem.question_id));
      setSelectedPromptId(null);
    } else {
      setFailedIds(prev => new Set(prev).add(promptItem.question_id));
      setWrongFlash({ prompt: promptItem.question_id, answer: answerItem.question_id });
      window.setTimeout(() => setWrongFlash(null), 450);
    }
  }, [items, matchedIds, selectedPromptId]);

  useEffect(() => {
    if (items.length > 0 && allResolved && phase === "answer") {
      finishAnswering();
    }
    // finishAnswering reads current state each render; the guard makes it fire once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResolved, items.length, phase]);

  const setItemQuality = useCallback((questionId, quality) => {
    setQualities(prev => ({ ...prev, [questionId]: quality }));
  }, []);

  // Keyboard: up/down to move through the rows, 0-3 to grade the selected one.
  useEffect(() => {
    if (phase !== "recap") return undefined;

    function handleKeyDown(event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelectedRecapIndex(prev =>
          Math.min(items.length - 1, Math.max(0, prev + delta))
        );
        return;
      }

      // Accept the character (0-3) or the physical key, so the shortcut works
      // on AZERTY layouts where the top-row digits need Shift.
      const digitMatch = /^(?:Digit|Numpad)([0-3])$/.exec(event.code);
      const quality = ["0", "1", "2", "3"].includes(event.key)
        ? Number(event.key)
        : digitMatch
          ? Number(digitMatch[1])
          : null;

      if (quality !== null) {
        const item = items[selectedRecapIndex];
        if (!item) return;

        event.preventDefault();
        setItemQuality(item.question_id, quality);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, items, selectedRecapIndex, setItemQuality]);

  // Keep the selected row visible as the selection moves.
  useEffect(() => {
    if (phase !== "recap") return;
    recapRowRefs.current[selectedRecapIndex]?.scrollIntoView({ block: "nearest" });
  }, [phase, selectedRecapIndex]);

  const containerStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    height: fillAvailableHeight ? "100%" : "auto",
    margin: "0 auto",
    maxWidth: "760px",
    width: "100%"
  };

  const headerLabel = isMatch ? "TEXTE · Associer" : "TEXTE · Tout taper";

  if (phase === "recap") {
    return (
      <div style={{ ...containerStyle, maxWidth: "1180px" }}>
        <div style={{ alignItems: "center", color: "#8fc7ff", display: "flex", fontSize: "12px", fontWeight: 800, gap: "10px", justifyContent: "space-between", letterSpacing: 1 }}>
          <span>RÉSULTAT</span>
          <span style={{ color: "#666", fontSize: "11px", fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>
            ↑/↓ pour naviguer · 0-3 pour noter
          </span>
        </div>
        <div
          className="app-scrollbar"
          style={{ display: "grid", gap: "8px", overflowY: "auto", paddingRight: "4px" }}
        >
          {items.map((item, index) => {
            const quality = qualities[item.question_id] ?? 0;
            const isSelected = index === selectedRecapIndex;

            return (
              <div
                key={item.question_id}
                ref={(element) => { recapRowRefs.current[index] = element; }}
                data-text-recap-row
                data-selected={isSelected ? "true" : undefined}
                onClick={() => setSelectedRecapIndex(index)}
                style={{
                  alignItems: "center",
                  background: isSelected ? "#1c1c1c" : "#161616",
                  border: "1px solid #2a2a2a",
                  borderLeft: `3px solid ${quality > 0 ? "#38bdf8" : "#f59e0b"}`,
                  borderRadius: "10px",
                  boxShadow: isSelected ? "0 0 0 2px rgba(143, 199, 255, 0.55)" : "none",
                  cursor: "pointer",
                  display: "grid",
                  gap: "10px",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  padding: "10px 12px"
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#eee", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.question}
                  </div>
                  <div style={{ color: "#8fc7ff", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.answer}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "5px" }}>
                  {qualityOptions.map(option => {
                    const active = quality === option.value;
                    const colors = qualityButtonColors[option.value];

                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        data-text-recap-quality={option.value}
                        title={option.title}
                        onClick={() => {
                          setSelectedRecapIndex(index);
                          setItemQuality(item.question_id, option.value);
                        }}
                        style={{
                          background: active ? colors.background : "#222",
                          border: active ? colors.border : "1px solid #333",
                          borderRadius: "8px",
                          color: active ? colors.color : "#999",
                          cursor: "pointer",
                          fontSize: "15px",
                          padding: "6px 9px"
                        }}
                      >
                        {option.icon}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => submitResult(qualities)}
            style={{
              ...buttonStyle,
              background: "#1e3a5f",
              border: "1px solid #345b7a",
              color: "#dbeafe",
              opacity: submitting ? 0.6 : 1
            }}
          >
            Valider
          </button>
        </div>
      </div>
    );
  }

  if (isMatch) {
    const activePrompts = items;
    const activeAnswers = answerOrder;

    return (
      <div style={containerStyle}>
        <div style={{ color: "#8fc7ff", fontSize: "12px", fontWeight: 800, letterSpacing: 1 }}>
          {headerLabel}
        </div>
        <div
          className="app-scrollbar"
          style={{
            display: "grid",
            gap: "18px",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            overflowY: "auto",
            paddingRight: "4px"
          }}
        >
          <div style={{ display: "grid", gap: "8px", alignContent: "start" }}>
            {activePrompts.map(item => {
              const matched = matchedIds.has(item.question_id);
              const selected = selectedPromptId === item.question_id;
              const flashing = wrongFlash?.prompt === item.question_id;

              return (
                <button
                  key={item.question_id}
                  type="button"
                  data-text-match-prompt
                  disabled={matched}
                  onClick={() => handlePromptClick(item)}
                  style={{
                    ...buttonStyle,
                    background: matched ? "#17253d" : selected ? "#2a2410" : "#1a1a1a",
                    border: flashing
                      ? "1px solid #f59e0b"
                      : matched
                        ? "1px solid #345b7a"
                        : selected
                          ? "1px solid #d6a91c"
                          : "1px solid #2c2c2c",
                    color: matched ? "#7fb2e6" : "#eee",
                    cursor: matched ? "default" : "pointer",
                    opacity: matched ? 0.65 : 1,
                    textAlign: "left"
                  }}
                >
                  {item.question}
                </button>
              );
            })}
          </div>
          <div style={{ display: "grid", gap: "8px", alignContent: "start" }}>
            {activeAnswers.map(item => {
              const matched = matchedIds.has(item.question_id);
              const flashing = wrongFlash?.answer === item.question_id;

              return (
                <button
                  key={item.question_id}
                  type="button"
                  data-text-match-answer
                  disabled={matched}
                  onClick={() => handleAnswerClick(item)}
                  style={{
                    ...buttonStyle,
                    background: matched ? "#17253d" : "#1a1a1a",
                    border: flashing
                      ? "1px solid #f59e0b"
                      : matched
                        ? "1px solid #345b7a"
                        : "1px solid #2c2c2c",
                    color: matched ? "#7fb2e6" : "#eee",
                    cursor: matched ? "default" : "pointer",
                    opacity: matched ? 0.4 : 1,
                    textAlign: "left"
                  }}
                >
                  {item.answer}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ color: "#777", fontSize: "13px" }}>
          Clique un élément à gauche puis sa réponse à droite.
        </div>
      </div>
    );
  }

  // type_all
  return (
    <div style={containerStyle}>
      <div style={{ color: "#8fc7ff", fontSize: "12px", fontWeight: 800, letterSpacing: 1 }}>
        {headerLabel}
      </div>
      <div
        className="app-scrollbar"
        style={{ display: "grid", gap: "8px", overflowY: "auto", paddingRight: "4px" }}
      >
        {items.map((item, index) => {
          const found = foundIds.has(item.question_id);

          return (
            <div
              key={item.question_id}
              data-text-type-row
              style={{
                alignItems: "center",
                background: found ? "#15202b" : "#161616",
                border: found ? "1px solid #345b7a" : "1px solid #2a2a2a",
                borderRadius: "10px",
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                padding: "9px 12px"
              }}
            >
              <div
                style={{
                  color: "#eee",
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {item.question}
              </div>
              {found ? (
                <div style={{ color: "#7ee2a8", fontWeight: 700 }}>
                  {item.answer}
                </div>
              ) : (
                <input
                  ref={(element) => { inputRefs.current[item.question_id] = element; }}
                  value={inputs[item.question_id] || ""}
                  onChange={(event) => handleInputChange(item.question_id, event.target.value)}
                  onKeyDown={(event) => handleInputKeyDown(event, item, index)}
                  onBlur={() => checkTypedAnswer(item)}
                  placeholder="Réponse…"
                  style={inputStyle}
                />
              )}
            </div>
          );
        })}
      </div>
      <div>
        <button
          type="button"
          onClick={finishAnswering}
          style={{
            ...buttonStyle,
            background: "#1e3a5f",
            border: "1px solid #345b7a",
            color: "#dbeafe"
          }}
        >
          Terminer
        </button>
      </div>
    </div>
  );
}
