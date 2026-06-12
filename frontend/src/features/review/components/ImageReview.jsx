import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveMediaUrl } from "../../../shared/media";
import { fadeInStyle } from "../../../shared/styles";
import {
  IMAGE_MODE_CLICK_PROMPT,
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT,
  imageModeLabels,
  normalizeImageMode
} from "../imageModes";
import { useImageReview } from "../hooks/useImageReview";
import TrainingTimerPanel from "./TrainingTimerPanel";

const qualityOptions = [
  { value: 1, label: "1 · Dur", background: "#35311f", color: "#ffd36b" },
  { value: 2, label: "2 · Bon", background: "#1f2f3a", color: "#8fc7ff" },
  { value: 3, label: "3 · Facile", background: "#1d3a2b", color: "#7ee2a8" }
];

const buttonStyle = {
  border: "1px solid #333",
  borderRadius: "8px",
  background: "#232323",
  color: "#eee",
  cursor: "pointer",
  fontWeight: 700,
  padding: "10px 14px"
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  background: "#101010",
  color: "#eee",
  border: "1px solid #2d2d2d",
  borderRadius: "10px",
  boxSizing: "border-box",
  outline: "none",
  fontSize: "14px"
};

const answerTooltipGap = 8;
const answerTooltipGutter = 12;
const answerTooltipMaxWidth = 360;
const answerTooltipMinWidth = 220;
const imageRowPositionTolerance = 6;

function clamp(value, min, max) {
  if (max < min) return min;

  return Math.min(Math.max(value, min), max);
}

function hasTextOverflow(element) {
  if (!element) return false;

  return element.scrollWidth > element.clientWidth + 1;
}

function getAnswerTooltipPosition(anchor) {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const availableWidth = Math.max(
    160,
    viewportWidth - answerTooltipGutter * 2
  );
  const width = Math.min(
    answerTooltipMaxWidth,
    Math.max(answerTooltipMinWidth, rect.width),
    availableWidth
  );
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    answerTooltipGutter,
    viewportWidth - width - answerTooltipGutter
  );
  const shouldPlaceAbove = rect.bottom + 96 > viewportHeight;
  const top = shouldPlaceAbove
    ? Math.max(answerTooltipGutter, rect.top - answerTooltipGap)
    : Math.min(
      viewportHeight - answerTooltipGutter,
      rect.bottom + answerTooltipGap
    );

  return {
    left,
    top,
    transform: shouldPlaceAbove ? "translateY(-100%)" : "none",
    width
  };
}

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

function ImageAnswerLabel({ color, label, revealed }) {
  const labelRef = useRef(null);
  const tooltipId = useId();
  const [hasOverflow, setHasOverflow] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const canShowTooltip = revealed && label && hasOverflow;

  const updateOverflow = useCallback(() => {
    const nextHasOverflow = revealed && hasTextOverflow(labelRef.current);

    setHasOverflow((current) =>
      current === nextHasOverflow ? current : nextHasOverflow
    );

    return nextHasOverflow;
  }, [revealed]);

  const closeTooltip = useCallback(() => {
    setOpen(false);
  }, []);

  const showTooltip = useCallback(() => {
    const nextHasOverflow = updateOverflow();
    const anchor = labelRef.current;

    if (!revealed || !label || !nextHasOverflow || !anchor) return;

    setPosition(getAnswerTooltipPosition(anchor));
    setOpen(true);
  }, [label, revealed, updateOverflow]);

  useLayoutEffect(() => {
    updateOverflow();

    const anchor = labelRef.current;
    const resizeObserver = anchor && "ResizeObserver" in window
      ? new window.ResizeObserver(updateOverflow)
      : null;

    resizeObserver?.observe(anchor);
    window.addEventListener("resize", updateOverflow);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [label, updateOverflow]);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeTooltip();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeTooltip);
    window.addEventListener("scroll", closeTooltip, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeTooltip);
      window.removeEventListener("scroll", closeTooltip, true);
    };
  }, [closeTooltip, open]);

  useEffect(() => {
    if ((!canShowTooltip || !revealed) && open) {
      closeTooltip();
    }
  }, [canShowTooltip, closeTooltip, open, revealed]);

  const tooltip = canShowTooltip && open && position && typeof document !== "undefined"
    ? createPortal(
      <div
        id={tooltipId}
        role="tooltip"
        style={{
          animation: "fadeIn 0.12s ease",
          background: "rgba(22, 22, 22, 0.98)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "10px",
          boxShadow: "0 18px 42px rgba(0, 0, 0, 0.45)",
          boxSizing: "border-box",
          color: "#f0f0f0",
          fontSize: "13px",
          fontWeight: 800,
          left: `${position.left}px`,
          lineHeight: 1.4,
          maxHeight: "180px",
          overflowWrap: "anywhere",
          overflowY: "auto",
          padding: "9px 11px",
          pointerEvents: "none",
          position: "fixed",
          textAlign: "left",
          top: `${position.top}px`,
          transform: position.transform,
          whiteSpace: "normal",
          width: `${position.width}px`,
          zIndex: 1000
        }}
      >
        {label}
      </div>,
      document.body
    )
    : null;

  return (
    <>
      <span
        ref={labelRef}
        aria-describedby={canShowTooltip && open ? tooltipId : undefined}
        data-image-answer-label
        onBlur={closeTooltip}
        onFocus={showTooltip}
        onPointerEnter={showTooltip}
        onPointerLeave={closeTooltip}
        tabIndex={canShowTooltip ? 0 : undefined}
        style={{
          color,
          fontSize: "13px",
          fontWeight: 800,
          minHeight: "20px",
          overflow: "hidden",
          outline: "none",
          textAlign: "center",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {revealed ? label : ""}
      </span>
      {tooltip}
    </>
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

function tileOffset(element, key) {
  const offsetKey = key === "left" ? "offsetLeft" : "offsetTop";
  const rectKey = key === "left" ? "left" : "top";
  const offset = element?.[offsetKey];

  if (Number.isFinite(offset)) return offset;

  return element?.getBoundingClientRect?.()[rectKey] || 0;
}

function isIncompleteImageRowItem(row) {
  return !row.isFound && !row.isLockedMissed;
}

function buildVisualImageRows(gridItems, tileElements) {
  const rows = [];

  gridItems.forEach(row => {
    const element = tileElements.get(row.item.question_id);

    if (!element) return;

    const top = tileOffset(element, "top");
    const left = tileOffset(element, "left");
    const visualRow = rows.find(existing =>
      Math.abs(existing.top - top) <= imageRowPositionTolerance
    );
    const rowItem = {
      element,
      left,
      questionId: row.item.question_id,
      row
    };

    if (visualRow) {
      visualRow.items.push(rowItem);
      visualRow.top = Math.min(visualRow.top, top);
      return;
    }

    rows.push({
      items: [rowItem],
      top
    });
  });

  return rows
    .sort((left, right) => left.top - right.top)
    .map(row => ({
      ...row,
      items: row.items.sort((left, right) => left.left - right.left)
    }));
}

function imageVisualRowHasIncompleteItem(row) {
  return row.items.some(item => isIncompleteImageRowItem(item.row));
}

function findImageVisualRowIndex(rows, questionId) {
  return rows.findIndex(row =>
    row.items.some(item => item.questionId === questionId)
  );
}

function findAdjacentIncompleteImageRowIndex(rows, startIndex, direction) {
  if (startIndex < 0 || rows.length <= 1) return -1;

  for (let offset = 1; offset < rows.length; offset += 1) {
    const index = (
      startIndex + offset * direction + rows.length
    ) % rows.length;

    if (imageVisualRowHasIncompleteItem(rows[index])) {
      return index;
    }
  }

  return -1;
}

function findTypeAllScrollAnchorRowIndex(rows, container, direction) {
  const incompleteRowIndexes = rows
    .map((row, index) => (
      imageVisualRowHasIncompleteItem(row) ? index : null
    ))
    .filter(index => index !== null);

  if (incompleteRowIndexes.length === 0) return -1;

  const scrollTop = container?.scrollTop || 0;

  if (direction < 0) {
    return [...incompleteRowIndexes].reverse().find(index =>
      rows[index].top <= scrollTop + imageRowPositionTolerance
    ) ?? incompleteRowIndexes[0];
  }

  return incompleteRowIndexes.find(index =>
    rows[index].top >= scrollTop - imageRowPositionTolerance
  ) ?? incompleteRowIndexes[incompleteRowIndexes.length - 1];
}

function scrollImageVisualRowIntoView(row) {
  row?.items[0]?.element?.scrollIntoView({
    behavior: "smooth",
    block: "start",
    inline: "nearest"
  });
}

export default function ImageReview({
  group,
  reviewItems,
  contextItems = reviewItems,
  mode: requestedMode,
  onComplete,
  submitAnswer,
  showQualityControls = true,
  trainingElapsedMs = null,
  trainingBestTimeMs = null
}) {
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const activeTileRef = useRef(null);
  const tileElementsRef = useRef(new Map());
  const previousFoundQuestionIdsRef = useRef(null);
  const [previewRow, setPreviewRow] = useState(null);
  const {
    activeQuestionId,
    answeredCount,
    choiceOptions,
    currentPromptItem,
    feedbackTone,
    finishReview,
    foundQuestionIds,
    gridItems,
    handleChoiceSelect,
    handleImageSelect,
    handleSubmit,
    input,
    mode,
    promptLabel,
    remainingCount,
    resultMode,
    sendResult,
    setInput,
    setQuality,
    skipCurrentPrompt,
    wrongAnsweredCount
  } = useImageReview(reviewItems, onComplete, submitAnswer, {
    contextItems,
    mode: requestedMode
  });
  const normalizedMode = normalizeImageMode(mode);
  const showTextInput = (
    normalizedMode === IMAGE_MODE_TYPE_ALL ||
    normalizedMode === IMAGE_MODE_TYPE_PROMPT
  );
  const showPromptPanel = normalizedMode !== IMAGE_MODE_TYPE_ALL && !resultMode;
  const showLabelChoices = (
    normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_LABEL &&
    !resultMode
  );
  const answersByClick = (
    normalizedMode === IMAGE_MODE_CLICK_PROMPT ||
    normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
  );
  const canSkipPrompt = normalizedMode === IMAGE_MODE_TYPE_PROMPT;
  const completedQuestionCount = answeredCount + wrongAnsweredCount;
  const correctProgressPercent = reviewItems.length
    ? Math.min((answeredCount / reviewItems.length) * 100, 100)
    : 0;
  const wrongProgressPercent = reviewItems.length
    ? Math.min((wrongAnsweredCount / reviewItems.length) * 100, 100)
    : 0;
  const feedbackCopy = feedbackTone === "incorrect"
    ? answersByClick
      ? "Mauvaise image."
      : showLabelChoices
        ? "Mauvais choix."
        : "Réponse incorrecte."
    : feedbackTone === "correct"
      ? "Bonne réponse."
      : normalizedMode === IMAGE_MODE_TYPE_ALL
        ? "Tape les réponses."
        : normalizedMode === IMAGE_MODE_CLICK_PROMPT
          ? "Clique la bonne image."
          : normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
            ? "Choisis la bonne image."
            : normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_LABEL
              ? "Choisis le bon nom."
              : "Tape le nom de l'image.";

  const focusAnswerInput = useCallback(() => {
    if (!showTextInput) return;

    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }, [showTextInput]);

  const registerTileElement = useCallback((questionId, element, isActive) => {
    if (element) {
      tileElementsRef.current.set(questionId, element);
    } else {
      tileElementsRef.current.delete(questionId);
    }

    if (isActive) {
      activeTileRef.current = element;
    }
  }, []);

  const scrollFromCompletedTypeAllQuestion = useCallback((questionId) => {
    if (normalizedMode !== IMAGE_MODE_TYPE_ALL || resultMode) return false;

    const visualRows = buildVisualImageRows(
      gridItems,
      tileElementsRef.current
    );
    const completedRowIndex = findImageVisualRowIndex(
      visualRows,
      questionId
    );

    if (
      completedRowIndex < 0 ||
      imageVisualRowHasIncompleteItem(visualRows[completedRowIndex])
    ) {
      return false;
    }

    const targetRowIndex = findAdjacentIncompleteImageRowIndex(
      visualRows,
      completedRowIndex,
      1
    );

    if (targetRowIndex < 0) return false;

    scrollImageVisualRowIntoView(visualRows[targetRowIndex]);
    return true;
  }, [gridItems, normalizedMode, resultMode]);

  const scrollToAdjacentTypeAllRow = useCallback((direction) => {
    if (normalizedMode !== IMAGE_MODE_TYPE_ALL || resultMode) return false;

    const visualRows = buildVisualImageRows(
      gridItems,
      tileElementsRef.current
    );
    const anchorRowIndex = findTypeAllScrollAnchorRowIndex(
      visualRows,
      containerRef.current,
      direction
    );
    const targetRowIndex = findAdjacentIncompleteImageRowIndex(
      visualRows,
      anchorRowIndex,
      direction
    );

    if (targetRowIndex < 0) return false;

    scrollImageVisualRowIntoView(visualRows[targetRowIndex]);
    return true;
  }, [gridItems, normalizedMode, resultMode]);

  function selectTile(questionId) {
    if (!answersByClick) return;

    handleImageSelect(questionId);
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
        if (showTextInput) {
          window.requestAnimationFrame(() => {
            inputRef.current?.focus({ preventScroll: true });
          });
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewRow, showTextInput]);

  useEffect(() => {
    if (resultMode || previewRow) return;
    if (!showTextInput) return;

    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });

      const tile = activeTileRef.current;
      if (!tile) return;

      tile.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    });
  }, [activeQuestionId, previewRow, resultMode, showTextInput]);

  useEffect(() => {
    const previousFoundQuestionIds = previousFoundQuestionIdsRef.current;

    previousFoundQuestionIdsRef.current = foundQuestionIds;

    if (
      previousFoundQuestionIds === null ||
      normalizedMode !== IMAGE_MODE_TYPE_ALL ||
      resultMode ||
      previewRow
    ) {
      return;
    }

    const previousFoundQuestionIdSet = new Set(previousFoundQuestionIds);
    const newlyFoundQuestionId = foundQuestionIds.find(questionId =>
      !previousFoundQuestionIdSet.has(questionId)
    );

    if (!newlyFoundQuestionId) return;

    scrollFromCompletedTypeAllQuestion(newlyFoundQuestionId);
  }, [
    foundQuestionIds,
    normalizedMode,
    previewRow,
    resultMode,
    scrollFromCompletedTypeAllQuestion
  ]);

  if (gridItems.length === 0) {
    return null;
  }

  return (
    <>
      <div
        style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: "18px",
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100vh - 140px)",
          ...fadeInStyle
        }}
      >
      <div
        style={{
          borderBottom: "1px solid #262626",
          padding: "16px 18px 14px",
          flexShrink: 0
        }}
      >
        <div
          style={{
            alignItems: "flex-start",
            display: "flex",
            gap: "16px",
            justifyContent: "space-between",
            marginBottom: "12px"
          }}
        >
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{ color: "#f0c36a", fontSize: "12px", fontWeight: 800 }}>
              {resultMode ? "IMAGE RESULT" : `IMAGE · ${imageModeLabels[normalizedMode]}`}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "10px", flexWrap: "wrap" }}>
              <div style={{ color: "#f3f3f3", fontSize: "24px", fontWeight: 800, lineHeight: 1 }}>
                {group.name || "Images"}
              </div>
              {trainingElapsedMs !== null && !resultMode && (
                <TrainingTimerPanel
                  elapsedMs={trainingElapsedMs}
                  bestTimeMs={trainingBestTimeMs}
                />
              )}
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
          aria-label="Progression"
          aria-valuemax={reviewItems.length}
          aria-valuemin={0}
          aria-valuenow={completedQuestionCount}
          role="progressbar"
          style={{
            background: "linear-gradient(180deg, #0d0d0d, #141414)",
            border: "1px solid #2a2a2a",
            borderRadius: "999px",
            boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.55)",
            height: "8px",
            overflow: "hidden"
          }}
        >
          <div
            style={{
              display: "flex",
              height: "100%",
              width: "100%"
            }}
          >
            <div
              data-image-progress-correct
              style={{
                background: "linear-gradient(90deg, #2563eb, #38bdf8)",
                boxShadow: correctProgressPercent > 0
                  ? "0 0 14px rgba(56, 189, 248, 0.22)"
                  : "none",
                height: "100%",
                transition: "width 0.22s ease",
                width: `${correctProgressPercent}%`
              }}
            />
            <div
              data-image-progress-wrong
              style={{
                background: [
                  "repeating-linear-gradient(135deg, rgba(17, 24, 39, 0.34) 0 4px, rgba(17, 24, 39, 0) 4px 8px)",
                  "linear-gradient(90deg, #f59e0b, #f97316)"
                ].join(", "),
                boxShadow: wrongProgressPercent > 0
                  ? "0 0 14px rgba(245, 158, 11, 0.24)"
                  : "none",
                height: "100%",
                transition: "width 0.22s ease",
                width: `${wrongProgressPercent}%`
              }}
            />
          </div>
        </div>

        <div style={{ color: "#777", display: "flex", fontSize: "11px", justifyContent: "space-between", marginTop: "6px" }}>
          <span>{remainingCount} restantes</span>
          <span>{resultMode ? "Résultat" : "En cours"}</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="app-scrollbar"
        data-image-grid-scroll
        style={{
          padding: "14px",
          overflow: "auto",
          flex: 1,
          minHeight: 0,
          position: "relative"
        }}
      >
        <div
          style={{
            display: "grid",
            gap: "10px",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))"
          }}
        >
          {gridItems.map((row) => {
            const mediaSrc = resolveMediaUrl(row.item.media);
            const revealed = row.isFound || resultMode;
            const selectable = !resultMode && answersByClick;

            return (
              <div
                key={row.item.question_id}
                data-image-question-id={row.item.question_id}
                data-image-review-tile
                ref={(element) => {
                  registerTileElement(
                    row.item.question_id,
                    element,
                    row.item.question_id === activeQuestionId
                  );
                }}
                onClick={selectable
                  ? () => selectTile(row.item.question_id)
                  : undefined}
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
                  gap: "8px",
                  gridTemplateRows: "116px minmax(20px, auto) auto",
                  minHeight: resultMode && showQualityControls ? "220px" : "170px",
                  overflow: "hidden",
                  padding: "8px",
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

                <ImageAnswerLabel
                  color={row.isLockedMissed ? "#ff9aa5" : row.isFound ? "#86efac" : "#777"}
                  label={answerLabel(row.item)}
                  revealed={revealed}
                />

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
      </div>

      <div style={{ padding: "14px", borderTop: "1px solid #262626", flexShrink: 0 }}>
        {showPromptPanel && (
          <div
            style={{
              background: "#121212",
              border: "1px solid #2a2a2a",
              borderRadius: "10px",
              marginBottom: "12px",
              padding: "12px 14px"
            }}
          >
            <div
              style={{
                color: "#777",
                fontSize: "11px",
                fontWeight: 800,
                marginBottom: "6px",
                textTransform: "uppercase"
              }}
            >
              {normalizedMode === IMAGE_MODE_CLICK_PROMPT ||
                normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
                ? "Image demandée"
                : "Image surlignée"}
            </div>
            <div
              style={{
                color: "#f3f3f3",
                fontSize: "20px",
                fontWeight: 900,
                lineHeight: 1.2,
                overflowWrap: "anywhere"
              }}
            >
              {normalizedMode === IMAGE_MODE_CLICK_PROMPT ||
                normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
                ? promptLabel
                : currentPromptItem
                  ? "Trouve son nom"
                  : " "}
            </div>
          </div>
        )}

        {!resultMode && showTextInput && (
          <div style={{ marginBottom: "14px" }}>
            <input
              autoFocus
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Tab" &&
                  normalizedMode === IMAGE_MODE_TYPE_ALL &&
                  !resultMode
                ) {
                  event.preventDefault();
                  scrollToAdjacentTypeAllRow(event.shiftKey ? -1 : 1);
                  focusAnswerInput();
                  return;
                }

                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSubmit();
                  focusAnswerInput();
                }
              }}
              placeholder={normalizedMode === IMAGE_MODE_TYPE_PROMPT
                ? "Nom de l'image..."
                : "Tape une image..."}
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

        {showLabelChoices && (
          <div
            style={{
              display: "grid",
              gap: "8px",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              marginBottom: "14px"
            }}
          >
            {choiceOptions.map(option => (
              <button
                key={option.question_id}
                type="button"
                onClick={() => handleChoiceSelect(option.question_id)}
                style={{
                  ...buttonStyle,
                  background: "#141414",
                  border: "1px solid #303030",
                  minHeight: "44px",
                  overflowWrap: "anywhere",
                  textAlign: "center"
                }}
              >
                {answerLabel(option)}
              </button>
            ))}
          </div>
        )}

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            justifyContent: "space-between"
          }}
        >
          <div
            style={{
              color: feedbackTone === "incorrect"
                ? "#fca5a5"
                : feedbackTone === "correct"
                  ? "#86efac"
                  : "#777",
              fontSize: "13px"
            }}
          >
              {feedbackCopy}
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
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {canSkipPrompt && (
                <button type="button" onClick={skipCurrentPrompt} style={buttonStyle}>
                  Passer
                </button>
              )}

              <button type="button" onClick={finishReview} style={buttonStyle}>
                Terminer
              </button>
            </div>
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
