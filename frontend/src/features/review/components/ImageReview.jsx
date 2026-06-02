import { useEffect, useRef, useState } from "react";
import { resolveMediaUrl } from "../../../shared/media";
import { fadeInStyle } from "../../../shared/styles";
import { useImageReview } from "../hooks/useImageReview";

const qualityOptions = [
  { value: 1, label: "1 · Dur", background: "#35311f", color: "#ffd36b" },
  { value: 2, label: "2 · Bon", background: "#1f2f3a", color: "#8fc7ff" },
  { value: 3, label: "3 · Facile", background: "#1d3a2b", color: "#7ee2a8" }
];

const buttonStyle = {
  border: "1px solid #333",
  borderRadius: "10px",
  background: "#232323",
  color: "#eee",
  cursor: "pointer",
  fontWeight: 700,
  padding: "12px 16px"
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

function QualityButton({ option, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: selected ? `1px solid ${option.color}` : "1px solid #333",
        borderRadius: "9px",
        background: option.background,
        color: option.color,
        cursor: "pointer",
        fontWeight: 800,
        minWidth: "74px",
        padding: "8px 10px"
      }}
    >
      {option.label}
    </button>
  );
}

function answerLabel(item) {
  return item.label || item.answer || "Image";
}

function tileBackground({ isActive, isFound, isLockedMissed }) {
  if (isLockedMissed) return "#211719";
  if (isFound) return "#17231b";
  if (isActive) return "#211f17";
  return "#151515";
}

function tileBorder({ isActive, isFound, isLockedMissed }) {
  if (isLockedMissed) return "1px solid #6b2b31";
  if (isFound) return "1px solid #2c5c3e";
  if (isActive) return "1px solid #d6a91c";
  return "1px solid #292929";
}

export default function ImageReview({
  group,
  reviewItems,
  onComplete,
  submitAnswer,
  showQualityControls = true
}) {
  const inputRef = useRef(null);
  const [previewRow, setPreviewRow] = useState(null);
  const {
    activeQuestionId,
    answeredCount,
    feedbackTone,
    finishReview,
    gridItems,
    handleSubmit,
    input,
    progressPercent,
    remainingCount,
    resultMode,
    selectItem,
    selectNextItem,
    sendResult,
    setInput,
    setQuality
  } = useImageReview(reviewItems, onComplete, submitAnswer);

  function focusAnswerInput() {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }

  function selectTile(questionId) {
    selectItem(questionId);
    focusAnswerInput();
  }

  function selectNextTile() {
    selectNextItem();
    focusAnswerInput();
  }

  function openPreview(row) {
    setPreviewRow(row);
  }

  function closePreview() {
    setPreviewRow(null);
    focusAnswerInput();
  }

  useEffect(() => {
    if (!previewRow) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setPreviewRow(null);
        window.requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewRow]);

  useEffect(() => {
    if (resultMode || previewRow) return;

    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }, [activeQuestionId, previewRow, resultMode]);

  if (gridItems.length === 0) {
    return null;
  }

  return (
    <>
      <div
        onKeyDownCapture={(event) => {
          if (resultMode || previewRow || event.key !== "Tab") {
            return;
          }

          event.preventDefault();
          selectNextTile();
        }}
        style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: "18px",
          overflow: "hidden",
          ...fadeInStyle
        }}
      >
      <div
        style={{
          borderBottom: "1px solid #262626",
          padding: "22px 24px 18px"
        }}
      >
        <div
          style={{
            alignItems: "flex-start",
            display: "flex",
            gap: "20px",
            justifyContent: "space-between",
            marginBottom: "16px"
          }}
        >
          <div>
            <div style={{ color: "#f0c36a", fontSize: "12px", fontWeight: 800 }}>
              {resultMode ? "IMAGE RESULT" : "IMAGE"}
            </div>
            <div style={{ color: "#f3f3f3", fontSize: "28px", fontWeight: 800, marginTop: "12px" }}>
              {group.name || "Images"}
            </div>
          </div>

          <div style={{ color: "#fff", fontSize: "28px", fontWeight: 800, textAlign: "right" }}>
            {answeredCount}
            <span style={{ color: "#666", fontSize: "18px", marginLeft: "4px" }}>
              / {reviewItems.length}
            </span>
          </div>
        </div>

        <div
          style={{
            background: "#111",
            border: "1px solid #2a2a2a",
            borderRadius: "999px",
            height: "10px",
            overflow: "hidden"
          }}
        >
          <div
            style={{
              background: "linear-gradient(90deg, #f0c36a, #8fc7ff)",
              height: "100%",
              transition: "width 0.2s ease",
              width: `${progressPercent}%`
            }}
          />
        </div>

        <div style={{ color: "#777", display: "flex", fontSize: "12px", justifyContent: "space-between", marginTop: "8px" }}>
          <span>{remainingCount} restantes</span>
          <span>{resultMode ? "Résultat" : "En cours"}</span>
        </div>
      </div>

      <div style={{ padding: "18px" }}>
        <div
          style={{
            display: "grid",
            gap: "12px",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))"
          }}
        >
          {gridItems.map((row) => {
            const mediaSrc = resolveMediaUrl(row.item.media);
            const revealed = row.isFound || resultMode;
            const selectable = !resultMode && !row.isFound;

            return (
              <div
                key={row.item.question_id}
                onClick={() => selectTile(row.item.question_id)}
                onKeyDown={(event) => {
                  if (!selectable || (event.key !== "Enter" && event.key !== " ")) {
                    return;
                  }

                  event.preventDefault();
                  selectTile(row.item.question_id);
                }}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : -1}
                style={{
                  background: tileBackground(row),
                  border: tileBorder(row),
                  borderRadius: "12px",
                  boxShadow: row.isActive
                    ? "0 0 0 3px rgba(240, 195, 106, 0.16)"
                    : "none",
                  boxSizing: "border-box",
                  color: "#eee",
                  cursor: selectable ? "pointer" : "default",
                  display: "grid",
                  gap: "10px",
                  gridTemplateRows: "126px minmax(24px, auto) auto",
                  minHeight: resultMode ? "236px" : "182px",
                  overflow: "hidden",
                  padding: "10px",
                  textAlign: "left",
                  transition: "border 0.14s ease, background 0.14s ease, box-shadow 0.14s ease"
                }}
              >
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    openPreview(row);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    openPreview(row);
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    alignItems: "center",
                    background: "#101010",
                    border: "1px solid #262626",
                    borderRadius: "9px",
                    cursor: mediaSrc ? "zoom-in" : "default",
                    display: "flex",
                    height: "126px",
                    justifyContent: "center",
                    overflow: "hidden",
                    width: "100%"
                  }}
                >
                  {mediaSrc ? (
                    <img
                      src={mediaSrc}
                      alt={revealed ? answerLabel(row.item) : "image"}
                      style={{
                        maxHeight: "112px",
                        maxWidth: "100%",
                        objectFit: "contain"
                      }}
                    />
                  ) : (
                    <span style={{ color: "#666", fontSize: "12px" }}>
                      Image manquante
                    </span>
                  )}
                </span>

                <span
                  style={{
                    color: row.isLockedMissed ? "#ff9aa5" : row.isFound ? "#86efac" : "#777",
                    fontSize: "13px",
                    fontWeight: 800,
                    minHeight: "20px",
                    overflow: "hidden",
                    textAlign: "center",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                  title={revealed ? answerLabel(row.item) : ""}
                >
                  {revealed ? answerLabel(row.item) : ""}
                </span>

                {resultMode && showQualityControls && (
                  <span
                    style={{
                      alignItems: "center",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px",
                      justifyContent: "center",
                      minHeight: "38px"
                    }}
                  >
                    {row.isLockedMissed ? (
                      <span
                        style={{
                          background: "#3a1f24",
                          border: "1px solid #6b2b31",
                          borderRadius: "9px",
                          color: "#ff9aa5",
                          fontSize: "13px",
                          fontWeight: 800,
                          padding: "8px 10px"
                        }}
                      >
                        0 · Faux
                      </span>
                    ) : (
                      qualityOptions.map(option => (
                        <QualityButton
                          key={option.value}
                          option={option}
                          selected={row.quality === option.value}
                          onClick={(event) => {
                            event.stopPropagation();
                            setQuality(row.item.question_id, option.value);
                          }}
                        />
                      ))
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {!resultMode && (
          <div style={{ marginTop: "20px" }}>
            <input
              autoFocus
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSubmit();
                  focusAnswerInput();
                }
              }}
              placeholder="Tape la réponse..."
              style={{
                ...inputStyle,
                border: feedbackTone === "incorrect"
                  ? "1px solid rgba(248, 113, 113, 0.9)"
                  : inputStyle.border,
                boxShadow: feedbackTone === "incorrect"
                  ? "0 0 0 4px rgba(248, 113, 113, 0.1)"
                  : "none"
              }}
            />
          </div>
        )}

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            justifyContent: "space-between",
            marginTop: "18px"
          }}
        >
          <div
            style={{
              color: feedbackTone === "incorrect" ? "#fca5a5" : "#777",
              fontSize: "13px"
            }}
          >
            {feedbackTone === "incorrect" ? "Réponse incorrecte." : " "}
          </div>

          {resultMode ? (
            <button
              type="button"
              onClick={sendResult}
              style={{
                ...buttonStyle,
                background: "#1d3a29",
                border: "1px solid #2c5c3e",
                color: "#7ee2a8"
              }}
            >
              {showQualityControls ? "Valider" : "Continuer"}
            </button>
          ) : (
            <button type="button" onClick={finishReview} style={buttonStyle}>
              Terminer
            </button>
          )}
        </div>
      </div>
      </div>

      {previewRow && (
        <div
          role="presentation"
          onClick={closePreview}
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.82)",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            padding: "28px",
            position: "fixed",
            zIndex: 1000
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "#111",
              border: "1px solid #333",
              borderRadius: "12px",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
              boxSizing: "border-box",
              display: "grid",
              gridTemplateRows:
                previewRow.isFound || resultMode
                  ? "auto auto"
                  : "auto",
              maxHeight: "86vh",
              width: "min(82vw, 900px)",
              overflow: "hidden",
              padding: "14px",
              position: "relative"
            }}
          >
            <button
              type="button"
              onClick={closePreview}
              aria-label="Fermer l'image agrandie"
              style={{
                alignItems: "center",
                background: "#1f1f1f",
                border: "1px solid #3a3a3a",
                borderRadius: "999px",
                color: "#ddd",
                cursor: "pointer",
                display: "flex",
                fontSize: "20px",
                height: "34px",
                justifyContent: "center",
                lineHeight: 1,
                position: "absolute",
                right: "12px",
                top: "12px",
                width: "34px",
                zIndex: 1
              }}
            >
              ×
            </button>

            {resolveMediaUrl(previewRow.item.media) ? (
              <img
                src={resolveMediaUrl(previewRow.item.media)}
                alt={
                  previewRow.isFound || resultMode
                    ? answerLabel(previewRow.item)
                    : "image"
                }
                style={{
                  background: "#0d0d0d",
                  borderRadius: "8px",
                  display: "block",
                  height: previewRow.isFound || resultMode
                    ? "min(62vh, 560px)"
                    : "min(68vh, 620px)",
                  objectFit: "contain",
                  width: "100%"
                }}
              />
            ) : (
              <div
                style={{
                  alignItems: "center",
                  background: "#0d0d0d",
                  borderRadius: "8px",
                  color: "#777",
                  display: "flex",
                  height: previewRow.isFound || resultMode
                    ? "min(62vh, 560px)"
                    : "min(68vh, 620px)",
                  justifyContent: "center",
                  width: "100%"
                }}
              >
                Image manquante
              </div>
            )}

            {(previewRow.isFound || resultMode) && (
              <div
                style={{
                  color: "#eee",
                  fontSize: "16px",
                  fontWeight: 800,
                  padding: "12px 44px 0",
                  textAlign: "center"
                }}
              >
                {answerLabel(previewRow.item)}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
