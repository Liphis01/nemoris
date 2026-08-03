import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeSequenceMode,
  SEQUENCE_MODE_MULTIPLE_CHOICE,
  SEQUENCE_MODE_NEXT_IN_SEQUENCE,
  SEQUENCE_MODE_REORDER,
  SEQUENCE_MODE_TYPE_POSITION
} from "../sequenceModes";

const CHOICE_COUNT = 4;

const qualityColors = {
  0: "#ff8c94",
  1: "#f3d36a",
  2: "#7ee2a8"
};

const qualityLabels = {
  0: "Raté",
  1: "Presque",
  2: "Exact !"
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

const slotBaseStyle = {
  alignItems: "center",
  borderRadius: "8px",
  boxSizing: "border-box",
  display: "flex",
  gap: "10px",
  minHeight: "42px",
  padding: "8px 11px"
};

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function resolvePosition(candidates, guess) {
  const normalizedGuess = normalize(guess);

  if (!normalizedGuess) return null;

  const match = candidates.find(candidate =>
    [candidate.answer, ...(candidate.aliases || [])].some(
      label => normalize(label) === normalizedGuess
    )
  );

  return match ? match.position : null;
}

function shuffled(list) {
  const copy = [...list];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }

  return copy;
}

// Distractors are drawn from the ranks nearest the answer: a QCM whose options
// are scattered across the list is answerable on theme alone.
function buildChoices(item, contextItems) {
  const peers = contextItems.filter(
    candidate => candidate.question_id !== item.question_id
  );
  const byDistance = [...peers].sort(
    (left, right) =>
      Math.abs(left.position - item.position) -
      Math.abs(right.position - item.position)
  );
  const near = byDistance.slice(0, Math.max(0, (CHOICE_COUNT - 1) * 2));

  return shuffled([
    item,
    ...shuffled(near).slice(0, CHOICE_COUNT - 1)
  ]);
}

export default function SequenceReview({
  group,
  reviewItems,
  contextItems = reviewItems,
  mode: requestedMode,
  onAnsweringComplete,
  onComplete,
  submitAnswer,
  fillAvailableHeight = false
}) {
  const mode = normalizeSequenceMode(requestedMode);
  const items = useMemo(
    () => [...(reviewItems || [])].sort((a, b) => a.position - b.position),
    [reviewItems]
  );
  const pool = useMemo(
    () => (contextItems && contextItems.length ? contextItems : items),
    [contextItems, items]
  );
  const length = group?.length || items.length;
  const anchors = useMemo(() => group?.anchors || [], [group]);

  const [phase, setPhase] = useState("answer");
  const [inputs, setInputs] = useState({});
  const [placements, setPlacements] = useState({});
  const [heldId, setHeldId] = useState(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [results, setResults] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const revealed = phase === "review";
  const isTyped =
    mode === SEQUENCE_MODE_TYPE_POSITION ||
    mode === SEQUENCE_MODE_NEXT_IN_SEQUENCE;
  const isChoice = mode === SEQUENCE_MODE_MULTIPLE_CHOICE;
  const isReorder = mode === SEQUENCE_MODE_REORDER;

  const inputRefs = useRef({});
  const failedRef = useRef([]);

  const choicesByItem = useMemo(() => {
    if (!isChoice) return {};

    return items.reduce((acc, item) => {
      acc[item.question_id] = buildChoices(item, pool);

      return acc;
    }, {});
  }, [isChoice, items, pool]);

  // The reorder rail draws every slot in the list, not just the due ones, so
  // the player places items in their absolute position rather than a relative
  // order. Anchors are already-known peers; the remaining locked slots belong to
  // items that have never been reviewed, so they stay blank -- revealing them
  // would teach the answer before the card's first review.
  const slots = useMemo(() => {
    if (!isReorder) return [];

    const anchorByPosition = new Map(
      anchors.map(anchor => [anchor.position, anchor])
    );
    const duePositions = new Set(items.map(item => item.position));

    return Array.from({ length }, (unused, index) => {
      const position = index + 1;
      const anchor = anchorByPosition.get(position);

      if (anchor) {
        return { position, kind: "anchor", label: anchor.label };
      }

      if (duePositions.has(position)) {
        return { position, kind: "free" };
      }

      return { position, kind: "hidden" };
    });
  }, [anchors, isReorder, items, length]);

  const tray = useMemo(() => (isReorder ? shuffled(items) : []), [isReorder, items]);

  const placedByPosition = useMemo(() => {
    const map = new Map();

    Object.entries(placements).forEach(([questionId, position]) => {
      map.set(position, Number(questionId));
    });

    return map;
  }, [placements]);

  const itemsById = useMemo(
    () =>
      items.reduce((acc, item) => {
        acc[item.question_id] = item;

        return acc;
      }, {}),
    [items]
  );

  const activeChoiceItem = isChoice ? items[choiceIndex] : null;

  const answeredCount = isChoice
    ? Object.keys(inputs).length
    : isReorder
      ? Object.keys(placements).length
      : items.filter(item => (inputs[item.question_id] || "").trim()).length;

  const canSubmit = isChoice
    ? Object.keys(inputs).length >= items.length
    : isReorder
      ? Object.keys(placements).length >= items.length
      : answeredCount > 0;

  const place = useCallback((questionId, position) => {
    if (!questionId) return;

    setPlacements(prev => {
      const next = {};

      // A slot holds one item and an item sits in one slot, so placing evicts
      // whatever was in either.
      Object.entries(prev).forEach(([id, slot]) => {
        if (Number(id) !== questionId && slot !== position) {
          next[id] = slot;
        }
      });

      next[questionId] = position;

      return next;
    });
    setHeldId(null);
  }, []);

  const unplace = useCallback(questionId => {
    setPlacements(prev => {
      const next = { ...prev };
      delete next[questionId];

      return next;
    });
  }, []);

  const buildPositions = useCallback((currentInputs) => {
    const positions = {};

    items.forEach(item => {
      if (isReorder) {
        positions[item.question_id] = {
          position: placements[item.question_id] ?? null
        };

        return;
      }

      if (isChoice) {
        positions[item.question_id] = {
          position: currentInputs[item.question_id] ?? null
        };

        return;
      }

      positions[item.question_id] = {
        position: resolvePosition(pool, currentInputs[item.question_id])
      };
    });

    return positions;
  }, [isChoice, isReorder, items, placements, pool]);

  // Takes the answers explicitly so the QCM can submit on its last pick without
  // waiting for the state update to land.
  const submit = useCallback(async (currentInputs = inputs) => {
    if (submitting || revealed) return;

    setSubmitting(true);

    try {
      const response = await submitAnswer?.(
        buildPositions(currentInputs),
        mode,
        pool.length
      );
      const graded = (response?.results || []).reduce((acc, result) => {
        acc[result.question_id] = result;

        return acc;
      }, {});

      failedRef.current = Object.values(graded)
        .filter(result => result.quality === 0)
        .map(result => result.question_id);

      setResults(graded);
      setPhase("review");
      onAnsweringComplete?.(failedRef.current);
    } catch (error) {
      console.error(error);
      onComplete?.([]);
    } finally {
      setSubmitting(false);
    }
  }, [
    buildPositions,
    inputs,
    mode,
    onAnsweringComplete,
    onComplete,
    pool.length,
    revealed,
    submitAnswer,
    submitting
  ]);

  function finish() {
    onComplete?.(failedRef.current);
  }

  const pickChoice = useCallback(
    (item, choice) => {
      const nextInputs = { ...inputs, [item.question_id]: choice.position };

      setInputs(nextInputs);
      setChoiceIndex(prev => prev + 1);

      // Last card answered: grade the set straight away rather than bouncing
      // through an effect.
      if (choiceIndex + 1 >= items.length) {
        submit(nextInputs);
      }
    },
    [choiceIndex, inputs, items.length, submit]
  );

  // The session's global grading shortcuts are suppressed for this type, so the
  // digit keys are free for the QCM options.
  useEffect(() => {
    if (!isChoice || revealed || !activeChoiceItem) return undefined;

    function onKeyDown(event) {
      const index = Number(event.key) - 1;
      const choices = choicesByItem[activeChoiceItem.question_id] || [];

      if (index >= 0 && index < choices.length) {
        event.preventDefault();
        pickChoice(activeChoiceItem, choices[index]);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeChoiceItem, choicesByItem, isChoice, pickChoice, revealed]);

  const containerStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    ...(fillAvailableHeight ? { flex: 1, minHeight: 0 } : {})
  };

  function renderFeedback(item) {
    const result = results?.[item.question_id];

    if (!result) return null;

    const gap =
      result.quality === 2 || result.distance === null
        ? ""
        : ` · ${result.distance} rang${result.distance > 1 ? "s" : ""} d'écart`;

    return (
      <span
        data-sequence-feedback={
          result.quality === 0 ? "wrong" : result.quality === 1 ? "close" : "correct"
        }
        style={{ color: qualityColors[result.quality], fontSize: "13px" }}
      >
        {qualityLabels[result.quality]} · n° {result.expected_position}
        {gap}
      </span>
    );
  }

  return (
    <div style={containerStyle} data-sequence-review={mode}>
      <div style={{ color: "#888", fontSize: "13px" }}>
        {!fillAvailableHeight && group?.name && `${group.name} · `}
        {answeredCount}/{items.length}
      </div>

      {isTyped && (
        <div
          className="app-scrollbar"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            overflowY: "auto"
          }}
        >
          {items.map(item => (
            <div
              key={item.question_id}
              data-sequence-row={item.position}
              style={{
                alignItems: "center",
                display: "grid",
                gap: "10px",
                gridTemplateColumns: "minmax(120px, 200px) 1fr auto"
              }}
            >
              <span style={{ color: "#aaa", fontSize: "14px" }}>
                {mode === SEQUENCE_MODE_NEXT_IN_SEQUENCE
                  ? item.previous_label
                    ? `après « ${item.previous_label} »`
                    : "premier élément"
                  : `n° ${item.position}`}
              </span>

              <input
                ref={node => {
                  inputRefs.current[item.question_id] = node;
                }}
                aria-label={
                  mode === SEQUENCE_MODE_NEXT_IN_SEQUENCE
                    ? `Élément après ${item.previous_label || "le début"}`
                    : `Élément au rang ${item.position}`
                }
                disabled={revealed}
                onChange={event =>
                  setInputs(prev => ({
                    ...prev,
                    [item.question_id]: event.target.value
                  }))
                }
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
                style={inputStyle}
                value={inputs[item.question_id] || ""}
              />

              {revealed ? renderFeedback(item) : <span />}
            </div>
          ))}
        </div>
      )}

      {isChoice && !revealed && activeChoiceItem && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ color: "#eee", fontSize: "16px", fontWeight: 700 }}>
            Quel élément occupe le rang {activeChoiceItem.position} ?
          </div>

          <div
            style={{
              display: "grid",
              gap: "8px",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))"
            }}
          >
            {(choicesByItem[activeChoiceItem.question_id] || []).map(
              (choice, index) => (
                <button
                  key={choice.question_id}
                  data-sequence-choice={choice.position}
                  onClick={() => pickChoice(activeChoiceItem, choice)}
                  style={{ ...buttonStyle, textAlign: "left" }}
                  type="button"
                >
                  <span style={{ color: "#666", marginRight: "8px" }}>
                    {index + 1}
                  </span>
                  {choice.label}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {isChoice && revealed && (
        <div
          className="app-scrollbar"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            overflowY: "auto"
          }}
        >
          {items.map(item => (
            <div
              key={item.question_id}
              data-sequence-row={item.position}
              style={{
                alignItems: "center",
                display: "flex",
                gap: "10px",
                justifyContent: "space-between"
              }}
            >
              <span style={{ color: "#eee" }}>{item.label}</span>
              {renderFeedback(item)}
            </div>
          ))}
        </div>
      )}

      {isReorder && (
        <div
          style={{
            display: "grid",
            gap: "16px",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
            minHeight: 0
          }}
        >
          <div
            className="app-scrollbar"
            data-sequence-rail=""
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              overflowY: "auto"
            }}
          >
            {slots.map(slot => {
              const placedId = placedByPosition.get(slot.position);
              const placedItem = placedId ? itemsById[placedId] : null;
              const result = placedItem ? results?.[placedItem.question_id] : null;

              return (
                <div
                  key={slot.position}
                  data-sequence-slot={slot.kind}
                  data-sequence-slot-position={slot.position}
                  onClick={() => {
                    if (slot.kind !== "free" || revealed) return;

                    if (heldId) {
                      place(heldId, slot.position);
                    } else if (placedItem) {
                      unplace(placedItem.question_id);
                    }
                  }}
                  onDragOver={event => {
                    if (slot.kind === "free" && !revealed) event.preventDefault();
                  }}
                  onDrop={event => {
                    if (slot.kind !== "free" || revealed) return;

                    event.preventDefault();
                    place(
                      Number(event.dataTransfer.getData("text/plain")),
                      slot.position
                    );
                  }}
                  style={{
                    ...slotBaseStyle,
                    background: slot.kind === "free" ? "#151515" : "#101010",
                    border:
                      slot.kind === "free"
                        ? `1px ${placedItem ? "solid" : "dashed"} ${
                            result ? qualityColors[result.quality] : "#3a3a3a"
                          }`
                        : "1px solid #1e1e1e",
                    cursor: slot.kind === "free" && !revealed ? "pointer" : "default",
                    opacity: slot.kind === "hidden" ? 0.45 : 1
                  }}
                >
                  <span
                    style={{
                      color: "#666",
                      fontSize: "12px",
                      minWidth: "28px"
                    }}
                  >
                    {slot.position}
                  </span>

                  {slot.kind === "anchor" && (
                    <span style={{ color: "#777" }}>{slot.label}</span>
                  )}

                  {slot.kind === "hidden" && (
                    <span style={{ color: "#444" }}>•</span>
                  )}

                  {slot.kind === "free" && (
                    <span style={{ color: "#eee" }}>
                      {placedItem ? placedItem.label : ""}
                    </span>
                  )}

                  {revealed && result && (
                    <span
                      data-sequence-feedback={
                        result.quality === 0
                          ? "wrong"
                          : result.quality === 1
                            ? "close"
                            : "correct"
                      }
                      style={{
                        color: qualityColors[result.quality],
                        fontSize: "12px",
                        marginLeft: "auto"
                      }}
                    >
                      {result.quality === 2
                        ? qualityLabels[2]
                        : `${qualityLabels[result.quality]} · n° ${result.expected_position}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div
            className="app-scrollbar"
            data-sequence-tray=""
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              overflowY: "auto"
            }}
          >
            {tray
              .filter(item => placements[item.question_id] === undefined)
              .map(item => (
                <button
                  key={item.question_id}
                  data-sequence-tray-item={item.question_id}
                  disabled={revealed}
                  draggable={!revealed}
                  onClick={() =>
                    setHeldId(prev =>
                      prev === item.question_id ? null : item.question_id
                    )
                  }
                  onDragStart={event => {
                    event.dataTransfer.setData(
                      "text/plain",
                      String(item.question_id)
                    );
                  }}
                  style={{
                    ...buttonStyle,
                    background:
                      heldId === item.question_id ? "#2f3a2f" : buttonStyle.background,
                    borderColor: heldId === item.question_id ? "#4a7a52" : "#333",
                    fontWeight: 500,
                    textAlign: "left"
                  }}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
        {revealed ? (
          <button onClick={finish} style={buttonStyle} type="button">
            Continuer ↵
          </button>
        ) : (
          !isChoice && (
            <button
              disabled={!canSubmit || submitting}
              onClick={() => submit()}
              style={{
                ...buttonStyle,
                opacity: canSubmit && !submitting ? 1 : 0.5
              }}
              type="button"
            >
              Valider ↵
            </button>
          )
        )}
      </div>
    </div>
  );
}
