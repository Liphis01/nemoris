import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  { value: 1, label: "Dur", background: "#35311f", color: "#ffd36b" },
  { value: 2, label: "Bon", background: "#1f2f3a", color: "#8fc7ff" },
  { value: 3, label: "Facile", background: "#1d3a2b", color: "#7ee2a8" }
];

const imageRecapHeaderColumns = [
  { key: "answer", label: "Image" },
  { key: "success", label: "Réussite" },
  { key: "interval", label: "Intervalle" },
  { key: "quality", label: "Qualité" }
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

function isImageAnswerRevealed(row, resultMode) {
  return Boolean(
    resultMode ||
    row?.isRevealed ||
    row?.isFound ||
    row?.isMissed ||
    row?.isLockedMissed
  );
}

function isImageAnswerState(feedbackState) {
  return feedbackState === "correct" || feedbackState === "missed";
}

function tileBackground({ feedbackState, isActive, isFound, isLockedMissed, isMissed }) {
  if (feedbackState === "wrong" || isLockedMissed || (isMissed && !isImageAnswerState(feedbackState))) {
    return [
      "repeating-linear-gradient(135deg, rgba(180, 83, 9, 0.24) 0 6px, rgba(180, 83, 9, 0) 6px 12px)",
      "linear-gradient(180deg, #2f2414, #1f1a12)"
    ].join(", ");
  }

  if (isImageAnswerState(feedbackState) || isFound) return "#151f2d";
  if (isActive) return "#211f17";
  return "#151515";
}

function tileBorder({ feedbackState, isActive, isFound, isLockedMissed, isMissed }) {
  if (feedbackState === "wrong" || isLockedMissed || (isMissed && !isImageAnswerState(feedbackState))) {
    return "1px solid rgba(251, 191, 36, 0.78)";
  }

  if (isImageAnswerState(feedbackState) || isFound) {
    return feedbackState === "missed"
      ? "2px dashed rgba(96, 165, 250, 0.86)"
      : "2px solid rgba(96, 165, 250, 0.86)";
  }

  if (isActive) return "1px solid #d6a91c";
  return "1px solid #292929";
}

function tileBoxShadow({ feedbackState, isActive }) {
  if (isActive) return "0 0 0 3px rgba(240, 195, 106, 0.16)";
  if (isImageAnswerState(feedbackState)) return "0 0 0 3px rgba(96, 165, 250, 0.18)";
  if (feedbackState === "wrong") {
    return "0 0 0 3px rgba(251, 191, 36, 0.18)";
  }

  return "none";
}

function tileFeedbackLabel(feedbackState) {
  if (feedbackState === "correct") return "Correct";
  if (feedbackState === "missed") return "Réponse";
  if (feedbackState === "wrong") return "Faux";

  return "";
}

function tileFeedbackBadgeStyle(feedbackState) {
  if (isImageAnswerState(feedbackState)) {
    return {
      background: "#1e3a5f",
      border: "1px solid rgba(147, 197, 253, 0.76)",
      color: "#dbeafe"
    };
  }

  if (feedbackState === "wrong") {
    return {
      background: [
        "repeating-linear-gradient(135deg, rgba(120, 53, 15, 0.36) 0 4px, rgba(120, 53, 15, 0) 4px 8px)",
        "#3b2a13"
      ].join(", "),
      border: "1px solid rgba(251, 191, 36, 0.82)",
      color: "#fde68a"
    };
  }

  return {};
}

function tileOffset(element, key) {
  const offsetKey = key === "left" ? "offsetLeft" : "offsetTop";
  const rectKey = key === "left" ? "left" : "top";
  const offset = element?.[offsetKey];

  if (Number.isFinite(offset)) return offset;

  return element?.getBoundingClientRect?.()[rectKey] || 0;
}

function isIncompleteImageRowItem(row) {
  return !row.isFound && !row.isLockedMissed && !row.isMissed;
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

function imageChoiceFeedbackState(option, feedback) {
  if (!feedback) return "";

  if (option.question_id === feedback.correctQuestionId) return "correct";
  if (option.question_id === feedback.selectedQuestionId) return "wrong";

  return "neutral";
}

function imageChoiceFeedbackLabel(option, feedback) {
  const state = imageChoiceFeedbackState(option, feedback);

  if (state === "correct") return "Correct";
  if (state === "wrong") return "Faux";

  return "";
}

function imageChoiceButtonStyle(option, feedback) {
  const state = imageChoiceFeedbackState(option, feedback);

  if (state === "correct") {
    return {
      ...buttonStyle,
      background: "linear-gradient(180deg, #1e3a5f, #17253d)",
      border: "2px solid rgba(147, 197, 253, 0.82)",
      boxShadow: "0 0 0 3px rgba(96, 165, 250, 0.18)",
      color: "#dbeafe",
      minHeight: "44px",
      overflowWrap: "anywhere",
      textAlign: "center"
    };
  }

  if (state === "wrong") {
    return {
      ...buttonStyle,
      background: [
        "repeating-linear-gradient(135deg, rgba(180, 83, 9, 0.26) 0 6px, rgba(180, 83, 9, 0) 6px 12px)",
        "linear-gradient(180deg, #3b2a13, #241b10)"
      ].join(", "),
      border: "2px dashed rgba(251, 191, 36, 0.82)",
      boxShadow: "0 0 0 3px rgba(251, 191, 36, 0.18)",
      color: "#fde68a",
      minHeight: "44px",
      overflowWrap: "anywhere",
      textAlign: "center"
    };
  }

  return {
    ...buttonStyle,
    background: "#141414",
    border: "1px solid #303030",
    cursor: state === "neutral" ? "default" : buttonStyle.cursor,
    minHeight: "44px",
    opacity: state === "neutral" ? 0.55 : 1,
    overflowWrap: "anywhere",
    textAlign: "center"
  };
}

function imageHistoryStats(item) {
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

function projectedIntervalForImage(item, quality) {
  const value =
    item.projected_intervals?.[quality] ??
    item.progress?.interval ??
    0;
  const interval = Number(value);

  return Number.isFinite(interval) ? interval : 0;
}

export default function ImageReview({
  group,
  reviewItems,
  contextItems = reviewItems,
  mode: requestedMode,
  onComplete,
  submitAnswer,
  separateFoundItems = false,
  separateResolvedItems = separateFoundItems,
  showQualityControls = true,
  trainingElapsedMs = null,
  trainingBestTimeMs = null,
  fillAvailableHeight = false
}) {
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const activeTileRef = useRef(null);
  const tileElementsRef = useRef(new Map());
  const previousFoundQuestionIdsRef = useRef(null);
  const [previewRow, setPreviewRow] = useState(null);
  const [selectedRecapQuestionId, setSelectedRecapQuestionId] = useState(null);
  const {
    activeQuestionId,
    answeredCount,
    choiceOptions,
    currentPromptItem,
    feedbackTone,
    finishReview,
    foundBulkQuality,
    foundQuestionIds,
    gridItems,
    handleChoiceSelect,
    handleImageSelect,
    handleSubmit,
    input,
    interactionFeedback,
    mode,
    promptLabel,
    qualityByQuestionId = {},
    recapMissCount,
    recapRows = [],
    recapSort = { key: null, direction: "asc" },
    recapSuccessCount,
    recapSuccessRate,
    remainingCount,
    resolvedQuestionIds = [],
    resolvedQuestionIdsRecentFirst,
    resultMode,
    selectItem,
    selectNextItem,
    sendResult,
    setFoundImageQualities = () => {},
    setInput,
    setQuality,
    skipCurrentPrompt,
    toggleRecapSort = () => {},
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
  const showPromptPanel = (
    normalizedMode !== IMAGE_MODE_TYPE_ALL &&
    normalizedMode !== IMAGE_MODE_TYPE_PROMPT &&
    (!fillAvailableHeight ||
      normalizedMode === IMAGE_MODE_CLICK_PROMPT ||
      normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE) &&
    !resultMode
  );
  const showLabelChoices = (
    normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_LABEL &&
    !resultMode
  );
  const showImageChoiceBoard = (
    normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE &&
    !resultMode
  );
  const answersByClick = (
    normalizedMode === IMAGE_MODE_CLICK_PROMPT ||
    normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
  );
  const selectsPromptImage = normalizedMode === IMAGE_MODE_TYPE_PROMPT;
  const selectsImageByTile = answersByClick || selectsPromptImage;
  const canSkipPrompt = normalizedMode === IMAGE_MODE_TYPE_PROMPT;
  const recentResolvedQuestionIds = resolvedQuestionIdsRecentFirst ||
    [...resolvedQuestionIds].reverse();
  const resolvedQuestionIdOrder = new Map(
    recentResolvedQuestionIds.map((questionId, index) => [questionId, index])
  );
  const shouldSeparateResolvedItems = (
    separateResolvedItems &&
    !resultMode &&
    (
      normalizedMode === IMAGE_MODE_CLICK_PROMPT ||
      normalizedMode === IMAGE_MODE_TYPE_PROMPT
    )
  );
  const activeGridItems = shouldSeparateResolvedItems
    ? gridItems.filter(row => !resolvedQuestionIdOrder.has(row.item.question_id))
    : gridItems;
  const resolvedGridItems = shouldSeparateResolvedItems
    ? gridItems
      .filter(row => resolvedQuestionIdOrder.has(row.item.question_id))
      .sort((left, right) => (
        resolvedQuestionIdOrder.get(left.item.question_id) -
        resolvedQuestionIdOrder.get(right.item.question_id)
      ))
    : [];
  const completedQuestionCount = answeredCount + wrongAnsweredCount;
  const correctProgressPercent = reviewItems.length
    ? Math.min((answeredCount / reviewItems.length) * 100, 100)
    : 0;
  const wrongProgressPercent = reviewItems.length
    ? Math.min((wrongAnsweredCount / reviewItems.length) * 100, 100)
    : 0;
  const effectiveRecapRows = useMemo(() => {
    if (recapRows.length > 0) return recapRows;

    return gridItems.map(row => {
      const selectedQuality = row.isFound
        ? qualityByQuestionId[row.item.question_id] ?? row.quality ?? 2
        : 0;

      return {
        item: row.item,
        historyStats: imageHistoryStats(row.item),
        isFound: row.isFound,
        selectedQuality,
        projectedInterval: projectedIntervalForImage(row.item, selectedQuality)
      };
    });
  }, [gridItems, qualityByQuestionId, recapRows]);
  const selectedRecapRow = useMemo(() => {
    if (effectiveRecapRows.length === 0) return null;

    return effectiveRecapRows.find(row =>
      row.item.question_id === selectedRecapQuestionId
    ) || effectiveRecapRows[0];
  }, [effectiveRecapRows, selectedRecapQuestionId]);
  const effectiveRecapSuccessCount = recapSuccessCount ??
    effectiveRecapRows.filter(row => row.isFound && row.selectedQuality > 0).length;
  const effectiveRecapMissCount = recapMissCount ??
    Math.max(0, reviewItems.length - effectiveRecapSuccessCount);
  const effectiveRecapSuccessRate = recapSuccessRate ??
    (reviewItems.length
      ? Math.round((effectiveRecapSuccessCount / reviewItems.length) * 100)
      : 0);
  const effectiveFoundBulkQuality = foundBulkQuality !== undefined
    ? foundBulkQuality
    : (() => {
        const foundRows = effectiveRecapRows.filter(row => row.isFound);

        if (foundRows.length === 0) return null;

        const firstQuality = foundRows[0].selectedQuality;

        return foundRows.every(row => row.selectedQuality === firstQuality)
          ? firstQuality
          : null;
      })();
  const showResultRecap = resultMode && showQualityControls;
  const tileImageHeight = fillAvailableHeight ? 154 : 188;
  const tileImageMaxHeight = fillAvailableHeight ? 140 : 174;
  const tileMinHeight = fillAvailableHeight ? "212px" : "250px";
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

  const scrollImageTileIntoView = useCallback((questionId, block = "center") => {
    const tile = tileElementsRef.current.get(questionId);

    if (!tile) return false;

    tile.scrollIntoView({
      behavior: "smooth",
      block,
      inline: "nearest"
    });
    return true;
  }, []);

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
    if (selectsPromptImage) {
      selectItem(questionId);
      focusAnswerInput();
      return;
    }

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

  function selectRecapRow(row) {
    if (!row?.item?.question_id) return;

    setSelectedRecapQuestionId(row.item.question_id);
  }

  useEffect(() => {
    if (!showResultRecap) return;

    if (effectiveRecapRows.length === 0) {
      setSelectedRecapQuestionId(null);
      return;
    }

    if (!effectiveRecapRows.some(row =>
      row.item.question_id === selectedRecapQuestionId
    )) {
      setSelectedRecapQuestionId(effectiveRecapRows[0].item.question_id);
    }
  }, [effectiveRecapRows, selectedRecapQuestionId, showResultRecap]);

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
      previewRow
    ) {
      return;
    }

    const previousFoundQuestionIdSet = new Set(previousFoundQuestionIds);
    const newlyFoundQuestionId = foundQuestionIds.find(questionId =>
      !previousFoundQuestionIdSet.has(questionId)
    );

    if (!newlyFoundQuestionId) return;

    scrollImageTileIntoView(newlyFoundQuestionId, "center");
  }, [
    foundQuestionIds,
    normalizedMode,
    previewRow,
    scrollImageTileIntoView
  ]);

  useEffect(() => {
    if (
      !interactionFeedback?.correctQuestionId ||
      resultMode ||
      previewRow ||
      ![
        IMAGE_MODE_CLICK_PROMPT,
        IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
      ].includes(normalizedMode)
    ) {
      return;
    }

    if (!activeGridItems.some(row =>
      row.item.question_id === interactionFeedback.correctQuestionId
    )) {
      return;
    }

    scrollImageTileIntoView(interactionFeedback.correctQuestionId, "center");
  }, [
    activeGridItems,
    interactionFeedback,
    normalizedMode,
    previewRow,
    resultMode,
    scrollImageTileIntoView
  ]);

  function renderImageTile(
    row,
    { allowSelection = true, registerForScroll = true } = {}
  ) {
    const mediaSrc = resolveMediaUrl(row.item.media);
    const revealed = isImageAnswerRevealed(row, resultMode);
    const isWrongOrMissed = (
      row.feedbackState === "wrong" ||
      row.feedbackState === "missed" ||
      row.isMissed ||
      row.isLockedMissed
    );
    const feedbackBadgeLabel = tileFeedbackLabel(row.feedbackState);
    const selectable = allowSelection && !resultMode && selectsImageByTile;
    const previewByThumbnail = !selectsImageByTile || resultMode;
    const showTileZoomControl = mediaSrc && selectsImageByTile && !resultMode;

    return (
      <div
        key={row.item.question_id}
        data-image-question-id={row.item.question_id}
        data-image-feedback={row.feedbackState || (row.isMissed ? "missed" : "")}
        data-image-revealed={revealed ? "true" : "false"}
        data-image-review-tile
        ref={registerForScroll
          ? (element) => {
            registerTileElement(
              row.item.question_id,
              element,
              row.item.question_id === activeQuestionId
            );
          }
          : undefined}
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
          boxShadow: tileBoxShadow(row),
          boxSizing: "border-box",
          color: "#eee",
          cursor: selectable ? "pointer" : "default",
          display: "grid",
          gap: "10px",
          gridTemplateRows: `${tileImageHeight}px minmax(22px, auto)`,
          minHeight: tileMinHeight,
          overflow: "hidden",
          padding: "10px",
          textAlign: "left",
          transition: "border 0.14s ease, background 0.14s ease, box-shadow 0.14s ease"
        }}
      >
        <span
          onClick={previewByThumbnail
            ? (event) => {
              event.stopPropagation();
              openPreview(row);
            }
            : undefined}
          onKeyDown={previewByThumbnail
            ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              openPreview(row);
            }
            : undefined}
          role={previewByThumbnail ? "button" : undefined}
          tabIndex={previewByThumbnail ? 0 : -1}
          style={{
            alignItems: "center",
            background: "#101010",
            border: "1px solid #262626",
            borderRadius: "9px",
            cursor: previewByThumbnail && mediaSrc
              ? "zoom-in"
              : selectable
                ? "pointer"
                : "default",
            display: "flex",
            height: `${tileImageHeight}px`,
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
            width: "100%"
          }}
        >
          {mediaSrc ? (
            <img
              src={mediaSrc}
              alt={revealed ? answerLabel(row.item) : "image"}
              style={{
                maxHeight: `${tileImageMaxHeight}px`,
                maxWidth: "100%",
                objectFit: "contain"
              }}
            />
          ) : (
            <span style={{ color: "#666", fontSize: "12px" }}>
              Image manquante
            </span>
          )}
          {feedbackBadgeLabel && (
            <span
              data-image-feedback-badge
              style={{
                ...tileFeedbackBadgeStyle(row.feedbackState),
                borderRadius: "999px",
                fontSize: "11px",
                fontWeight: 900,
                left: "7px",
                letterSpacing: 0,
                lineHeight: 1,
                padding: "6px 8px",
                position: "absolute",
                textTransform: "uppercase",
                top: "7px"
              }}
            >
              {feedbackBadgeLabel}
            </span>
          )}
          {showTileZoomControl && (
            <button
              type="button"
              aria-label="Agrandir l'image"
              data-image-zoom-control
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openPreview(row);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
              style={{
                alignItems: "center",
                background: "rgba(20, 20, 20, 0.86)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "7px",
                color: "#f3f3f3",
                cursor: "zoom-in",
                display: "flex",
                fontSize: "12px",
                fontWeight: 900,
                height: "30px",
                justifyContent: "center",
                lineHeight: 1,
                position: "absolute",
                right: "7px",
                top: "7px",
                width: "30px"
              }}
              title="Agrandir l'image"
            >
              +
            </button>
          )}
        </span>

        <ImageAnswerLabel
          color={
            isImageAnswerState(row.feedbackState) || row.isFound
              ? "#bfdbfe"
              : isWrongOrMissed
                ? "#fde68a"
                : "#777"
          }
          label={answerLabel(row.item)}
          revealed={revealed}
        />
      </div>
    );
  }

  function renderImageChoiceTile(row) {
    const mediaSrc = resolveMediaUrl(row.item.media);
    const revealed = isImageAnswerRevealed(row, resultMode);
    const isWrongOrMissed = (
      row.feedbackState === "wrong" ||
      row.feedbackState === "missed" ||
      row.isMissed ||
      row.isLockedMissed
    );
    const feedbackBadgeLabel = tileFeedbackLabel(row.feedbackState);

    return (
      <div
        key={row.item.question_id}
        data-image-choice-tile
        data-image-question-id={row.item.question_id}
        data-image-feedback={row.feedbackState || (row.isMissed ? "missed" : "")}
        data-image-revealed={revealed ? "true" : "false"}
        data-image-review-tile
        ref={(element) => {
          registerTileElement(
            row.item.question_id,
            element,
            row.item.question_id === activeQuestionId
          );
        }}
        onClick={() => selectTile(row.item.question_id)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          event.preventDefault();
          selectTile(row.item.question_id);
        }}
        role="button"
        tabIndex={0}
        style={{
          background: tileBackground(row),
          border: tileBorder(row),
          borderRadius: "10px",
          boxShadow: tileBoxShadow(row),
          boxSizing: "border-box",
          color: "#eee",
          cursor: "pointer",
          display: "grid",
          gap: "10px",
          gridTemplateRows: "minmax(0, 1fr) minmax(22px, auto)",
          height: "100%",
          minHeight: "0",
          minWidth: 0,
          overflow: "hidden",
          padding: "10px",
          textAlign: "left",
          transition: "border 0.14s ease, background 0.14s ease, box-shadow 0.14s ease",
          width: "100%"
        }}
      >
        <span
          style={{
            alignItems: "center",
            background: "#101010",
            border: "1px solid #262626",
            borderRadius: "8px",
            display: "flex",
            height: "100%",
            justifyContent: "center",
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
            width: "100%"
          }}
        >
          {mediaSrc ? (
            <img
              src={mediaSrc}
              alt={revealed ? answerLabel(row.item) : "image"}
              data-image-choice-img
              style={{
                display: "block",
                height: "100%",
                maxHeight: "100%",
                maxWidth: "100%",
                objectFit: "contain",
                objectPosition: "center",
                width: "100%"
              }}
            />
          ) : (
            <span style={{ color: "#666", fontSize: "12px" }}>
              Image manquante
            </span>
          )}
          {feedbackBadgeLabel && (
            <span
              data-image-feedback-badge
              style={{
                ...tileFeedbackBadgeStyle(row.feedbackState),
                borderRadius: "999px",
                fontSize: "11px",
                fontWeight: 900,
                left: "8px",
                letterSpacing: 0,
                lineHeight: 1,
                padding: "6px 8px",
                position: "absolute",
                textTransform: "uppercase",
                top: "8px"
              }}
            >
              {feedbackBadgeLabel}
            </span>
          )}
          {mediaSrc && (
            <button
              type="button"
              aria-label="Agrandir l'image"
              data-image-zoom-control
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openPreview(row);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
              style={{
                alignItems: "center",
                background: "rgba(20, 20, 20, 0.86)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "7px",
                color: "#f3f3f3",
                cursor: "zoom-in",
                display: "flex",
                fontSize: "12px",
                fontWeight: 900,
                height: "30px",
                justifyContent: "center",
                lineHeight: 1,
                position: "absolute",
                right: "8px",
                top: "8px",
                width: "30px"
              }}
              title="Agrandir l'image"
            >
              +
            </button>
          )}
        </span>

        <ImageAnswerLabel
          color={
            isImageAnswerState(row.feedbackState) || row.isFound
              ? "#bfdbfe"
              : isWrongOrMissed
                ? "#fde68a"
                : "#777"
          }
          label={answerLabel(row.item)}
          revealed={revealed}
        />
      </div>
    );
  }

  function renderImageRecapQualityButton({
    disabled = false,
    option,
    selected,
    onClick
  }) {
    return (
      <button
        key={option.value}
        type="button"
        aria-pressed={selected}
        data-image-recap-quality={option.value}
        disabled={disabled}
        onClick={onClick}
        style={{
          ...imageRecapQualityButtonStyle,
          background: selected
            ? option.background
            : disabled
              ? "#181818"
              : "#222",
          border: selected
            ? `1px solid ${option.color}`
            : disabled
              ? "1px solid #2d2d2d"
              : "1px solid #333",
          color: selected
            ? option.color
            : disabled
              ? "#555"
              : "#aaa",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.65 : 1
        }}
        title={option.label}
      >
        {option.label}
      </button>
    );
  }

  function renderImageRecap() {
    if (!showResultRecap) return null;

    return (
      <div data-image-recap-overlay style={imageRecapOverlayStyle}>
        <div className="app-scrollbar" style={imageRecapCardStyle}>
          <div style={imageRecapHeaderStyle}>
            <div>
              <div style={imageRecapTypeBadgeStyle}>IMAGE RESULT</div>
              <div style={imageRecapTitleStyle}>Résultat</div>
            </div>

            <button
              type="button"
              onClick={sendResult}
              style={imageRecapValidateButtonStyle}
            >
              Valider
            </button>
          </div>

          <div style={imageRecapStatsGridStyle}>
            <div style={imageRecapStatStyle}>
              <div style={imageRecapStatValueStyle}>
                {effectiveRecapSuccessRate}%
              </div>
              <div style={imageRecapStatLabelStyle}>réussite</div>
            </div>

            <div style={imageRecapStatStyle}>
              <div style={imageRecapStatValueStyle}>
                {effectiveRecapSuccessCount}
                <span style={imageRecapStatMutedStyle}>
                  {" "}/ {reviewItems.length}
                </span>
              </div>
              <div style={imageRecapStatLabelStyle}>trouvées</div>
            </div>

            <div style={imageRecapStatStyle}>
              <div style={imageRecapStatValueStyle}>
                {effectiveRecapMissCount}
              </div>
              <div style={imageRecapStatLabelStyle}>à revoir</div>
            </div>
          </div>

          <div className="image-recap-content">
            <div style={imageRecapPreviewPanelStyle}>
              <div style={imageRecapPanelHeaderStyle}>
                <span>Aperçu</span>
                <span style={imageRecapPanelCountStyle}>
                  {selectedRecapRow ? answerLabel(selectedRecapRow.item) : ""}
                </span>
              </div>

              <div data-image-recap-selected-preview style={imageRecapSelectedPreviewStyle}>
                {selectedRecapRow ? (
                  <>
                    <button
                      type="button"
                      aria-label="Agrandir l'image sélectionnée"
                      onClick={() => openPreview(selectedRecapRow)}
                      style={{
                        ...imageRecapSelectedPreviewButtonStyle,
                        ...(selectedRecapRow.isFound
                          ? imageRecapSelectedPreviewFoundStyle
                          : imageRecapSelectedPreviewMissedStyle)
                      }}
                      title={answerLabel(selectedRecapRow.item)}
                    >
                      {resolveMediaUrl(selectedRecapRow.item.media) ? (
                        <img
                          src={resolveMediaUrl(selectedRecapRow.item.media)}
                          alt={answerLabel(selectedRecapRow.item)}
                          style={imageRecapSelectedPreviewImageStyle}
                        />
                      ) : (
                        <span style={imageRecapSelectedMissingImageStyle}>
                          Image manquante
                        </span>
                      )}
                    </button>

                    <div style={imageRecapSelectedMetaStyle}>
                      <span
                        style={{
                          ...imageRecapStatusChipStyle,
                          ...(selectedRecapRow.isFound
                            ? imageRecapStatusFoundStyle
                            : imageRecapStatusMissedStyle)
                        }}
                      >
                        {selectedRecapRow.isFound ? "Trouvée" : "À revoir"}
                      </span>
                      <span style={imageRecapSelectedTitleStyle}>
                        {answerLabel(selectedRecapRow.item)}
                      </span>
                      <span style={imageRecapSelectedIntervalStyle}>
                        {(selectedRecapRow.projectedInterval ??
                          projectedIntervalForImage(
                            selectedRecapRow.item,
                            selectedRecapRow.selectedQuality ?? (
                              selectedRecapRow.isFound ? 2 : 0
                            )
                          ))}
                        <span style={imageRecapIntervalUnitStyle}> j</span>
                      </span>
                    </div>
                  </>
                ) : (
                  <div style={imageRecapSelectedEmptyStyle}>
                    Image manquante
                  </div>
                )}
              </div>
            </div>

            <div style={imageRecapTableStyle}>
              <div
                className="image-recap-table-header"
                style={imageRecapTableHeaderStyle}
              >
                {imageRecapHeaderColumns.map(({ key, label }) => {
                  const isActive = recapSort.key === key;
                  const nextDirection = isActive && recapSort.direction === "asc"
                    ? "desc"
                    : "asc";

                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={`${label} : trier ${
                        nextDirection === "asc" ? "croissant" : "décroissant"
                      }`}
                      aria-pressed={isActive}
                      onClick={() => toggleRecapSort(key)}
                      style={{
                        ...imageRecapHeaderButtonStyle,
                        ...(isActive ? imageRecapHeaderButtonActiveStyle : {})
                      }}
                      title={`${label} : trier ${
                        nextDirection === "asc" ? "croissant" : "décroissant"
                      }`}
                    >
                      <span style={imageRecapHeaderLabelStyle}>{label}</span>
                      <span
                        aria-hidden="true"
                        style={{
                          ...imageRecapHeaderSortIndicatorStyle,
                          opacity: isActive ? 1 : 0
                        }}
                      >
                        {recapSort.direction === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="app-scrollbar" style={imageRecapTableBodyStyle}>
                {effectiveRecapSuccessCount > 0 && (
                  <div
                    className="image-recap-bulk-row"
                    style={imageRecapBulkRowStyle}
                  >
                    <div style={imageRecapBulkTextStyle}>
                      <div style={imageRecapBulkTitleStyle}>
                        Images trouvées
                      </div>
                      <div style={imageRecapBulkMetaStyle}>
                        {effectiveRecapSuccessCount} qualité{effectiveRecapSuccessCount > 1 ? "s" : ""}
                      </div>
                    </div>

                    <div style={imageRecapBulkControlsStyle}>
                      {qualityOptions.map(option =>
                        renderImageRecapQualityButton({
                          option,
                          selected: effectiveFoundBulkQuality === option.value,
                          onClick: () => setFoundImageQualities(option.value)
                        })
                      )}
                    </div>
                  </div>
                )}

                {effectiveRecapRows.map(row => {
                  const mediaSrc = resolveMediaUrl(row.item.media);
                  const statusLabel = row.isFound ? "Trouvée" : "À revoir";
                  const selectedQuality = row.selectedQuality ?? (
                    row.isFound ? 2 : 0
                  );
                  const projectedInterval = row.projectedInterval ??
                    projectedIntervalForImage(row.item, selectedQuality);

                  return (
                    <div
                      key={row.item.question_id}
                      className="image-recap-row"
                      data-image-recap-row={row.isFound ? "found" : "missed"}
                      data-image-recap-selected={
                        selectedRecapRow?.item.question_id === row.item.question_id
                          ? "true"
                          : "false"
                      }
                      role="button"
                      tabIndex={0}
                      onClick={() => selectRecapRow(row)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) {
                          return;
                        }

                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectRecapRow(row);
                        }
                      }}
                      style={{
                        ...imageRecapRowStyle,
                        ...(row.isFound
                          ? imageRecapRowFoundStyle
                          : imageRecapRowMissedStyle),
                        ...(selectedRecapRow?.item.question_id === row.item.question_id
                          ? imageRecapRowSelectedStyle
                          : {}),
                        borderLeft: row.isFound
                          ? "3px solid #38bdf8"
                          : "3px solid #f59e0b"
                      }}
                      title={answerLabel(row.item)}
                    >
                      <div style={imageRecapAnswerCellStyle}>
                        <span
                          data-image-recap-status={row.isFound ? "found" : "missed"}
                          style={{
                            ...imageRecapStatusChipStyle,
                            ...(row.isFound
                              ? imageRecapStatusFoundStyle
                              : imageRecapStatusMissedStyle)
                          }}
                        >
                          {statusLabel}
                        </span>

                        <span style={imageRecapThumbnailStyle}>
                          {mediaSrc ? (
                            <img
                              src={mediaSrc}
                              alt={answerLabel(row.item)}
                              style={imageRecapThumbnailImageStyle}
                            />
                          ) : (
                            <span style={imageRecapThumbnailMissingStyle} />
                          )}
                        </span>

                        <span style={imageRecapAnswerTextStyle}>
                          {answerLabel(row.item)}
                        </span>
                      </div>

                      <div style={imageRecapMetricCellStyle}>
                        {row.historyStats?.reviews > 0 ? (
                          <>
                            <span style={imageRecapHistoryRateStyle}>
                              {row.historyStats.successRate}%
                            </span>
                            <span style={imageRecapHistoryMetaStyle}>
                              {row.historyStats.reviews} revue{row.historyStats.reviews > 1 ? "s" : ""}
                            </span>
                          </>
                        ) : (
                          <span style={imageRecapHistoryMetaStyle}>Nouveau</span>
                        )}
                      </div>

                      <div style={imageRecapIntervalCellStyle}>
                        {projectedInterval}
                        <span style={imageRecapIntervalUnitStyle}> j</span>
                      </div>

                      <div style={imageRecapQualityCellStyle}>
                        {row.isFound ? (
                          qualityOptions.map(option =>
                            renderImageRecapQualityButton({
                              option,
                              selected: selectedQuality === option.value,
                              onClick: (event) => {
                                event.stopPropagation();
                                setQuality(row.item.question_id, option.value);
                              }
                            })
                          )
                        ) : (
                          <span
                            data-image-recap-locked-quality
                            style={imageRecapLockedQualityStyle}
                          >
                            0 · Faux
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (gridItems.length === 0) {
    return null;
  }

  return (
    <>
      <div
        data-image-review-shell
        style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: "18px",
          display: "flex",
          flexDirection: "column",
          height: fillAvailableHeight ? "100%" : "calc(100dvh - 220px)",
          minHeight: fillAvailableHeight ? 0 : "420px",
          overflow: "hidden",
          ...fadeInStyle
        }}
      >
      <div
        data-image-review-header
        style={{
          borderBottom: "1px solid #262626",
          padding: fillAvailableHeight ? "8px 12px 9px" : "12px 16px 10px",
          flexShrink: 0
        }}
      >
        <div
          style={{
            alignItems: "flex-start",
            display: "flex",
            gap: "14px",
            justifyContent: "space-between",
            marginBottom: fillAvailableHeight ? "6px" : "8px"
          }}
        >
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            {fillAvailableHeight ? (
              <div
                style={{
                  color: "#888",
                  fontSize: "12px",
                  fontWeight: 800,
                  textTransform: "uppercase"
                }}
              >
                Progression
              </div>
            ) : (
              <>
                <div style={{ color: "#f0c36a", fontSize: "12px", fontWeight: 800 }}>
                  {resultMode ? "IMAGE RESULT" : `IMAGE · ${imageModeLabels[normalizedMode]}`}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
                  <div style={{ color: "#f3f3f3", fontSize: "20px", fontWeight: 800, lineHeight: 1.1 }}>
                    {group.name || "Images"}
                  </div>
                  {trainingElapsedMs !== null && !resultMode && (
                    <TrainingTimerPanel
                      elapsedMs={trainingElapsedMs}
                      bestTimeMs={trainingBestTimeMs}
                    />
                  )}
                </div>
              </>
            )}
          </div>

          <div style={{ color: "#fff", fontSize: "24px", fontWeight: 800, textAlign: "right" }}>
            {answeredCount}
            <span style={{ color: "#666", fontSize: "16px", marginLeft: "4px" }}>
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
            height: "7px",
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
          padding: "16px",
          overflow: "auto",
          flex: 1,
          minHeight: 0,
          position: "relative",
          scrollbarGutter: "stable"
        }}
      >
        {showImageChoiceBoard ? (
          <div
            data-image-choice-board
            style={{
              display: "grid",
              gap: fillAvailableHeight ? "12px" : "14px",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gridTemplateRows: "repeat(2, minmax(0, 1fr))",
              height: "100%",
              margin: "0 auto",
              maxWidth: "720px",
              minHeight: 0,
              width: "min(100%, 720px)"
            }}
          >
            {activeGridItems.map(row => renderImageChoiceTile(row))}
          </div>
        ) : (
          <div
            data-image-active-grid
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))"
            }}
          >
            {activeGridItems.map(row => renderImageTile(row))}
          </div>
        )}

        {!showImageChoiceBoard && resolvedGridItems.length > 0 && (
          <div
            data-image-resolved-section
            style={{
              borderTop: "1px solid #262626",
              marginTop: "16px",
              paddingTop: "14px"
            }}
          >
            <div
              style={{
                alignItems: "center",
                color: "#86efac",
                display: "flex",
                fontSize: "12px",
                fontWeight: 800,
                justifyContent: "space-between",
                marginBottom: "10px",
                textTransform: "uppercase"
              }}
            >
              <span>Traitées</span>
              <span style={{ color: "#6b7280" }}>{resolvedGridItems.length}</span>
            </div>
            <div
              style={{
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))"
              }}
            >
              {resolvedGridItems.map(row =>
                renderImageTile(row, {
                  allowSelection: false
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div
        data-image-control-band
        style={{
          background: "linear-gradient(180deg, #191919, #171717)",
          borderTop: "1px solid #262626",
          flexShrink: 0,
          padding: "12px 14px"
        }}
      >
        {showPromptPanel && (
          <div
            style={{
              background: "#121212",
              border: "1px solid #2a2a2a",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px 12px",
              marginBottom: "10px",
              padding: fillAvailableHeight ? "8px 10px" : "10px 12px"
            }}
          >
            {!fillAvailableHeight && (
              <div
                style={{
                  color: "#777",
                  fontSize: "11px",
                  fontWeight: 800,
                  minWidth: "112px",
                  textTransform: "uppercase"
                }}
              >
                {normalizedMode === IMAGE_MODE_CLICK_PROMPT ||
                  normalizedMode === IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
                  ? "Image demandée"
                  : "Image surlignée"}
              </div>
            )}
            <div
              style={{
                color: "#f3f3f3",
                flex: "1 1 220px",
                fontSize: "18px",
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
          <div style={{ marginBottom: "10px" }}>
            <input
              autoFocus
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Tab" &&
                  normalizedMode === IMAGE_MODE_TYPE_PROMPT &&
                  !event.shiftKey &&
                  !resultMode
                ) {
                  event.preventDefault();
                  skipCurrentPrompt();
                  focusAnswerInput();
                  return;
                }

                if (
                  event.key === "Tab" &&
                  normalizedMode === IMAGE_MODE_TYPE_PROMPT &&
                  !resultMode
                ) {
                  event.preventDefault();
                  selectNextItem(event.shiftKey ? -1 : 1);
                  focusAnswerInput();
                  return;
                }

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
                data-image-choice-feedback={imageChoiceFeedbackState(
                  option,
                  interactionFeedback
                )}
                disabled={Boolean(interactionFeedback)}
                onClick={() => handleChoiceSelect(option.question_id)}
                style={imageChoiceButtonStyle(option, interactionFeedback)}
              >
                <span>{answerLabel(option)}</span>
                {imageChoiceFeedbackLabel(option, interactionFeedback) && (
                  <span
                    style={{
                      display: "block",
                      fontSize: "11px",
                      fontWeight: 900,
                      marginTop: "5px",
                      textTransform: "uppercase"
                    }}
                  >
                    {imageChoiceFeedbackLabel(option, interactionFeedback)}
                  </span>
                )}
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

          {resultMode && !showQualityControls ? (
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
              Continuer
            </button>
          ) : !resultMode ? (
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
          ) : null}
        </div>
      </div>
      </div>

      {renderImageRecap()}

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
                isImageAnswerRevealed(previewRow, resultMode)
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
                  isImageAnswerRevealed(previewRow, resultMode)
                    ? answerLabel(previewRow.item)
                    : "image"
                }
                style={{
                  background: "#0d0d0d",
                  borderRadius: "8px",
                  display: "block",
                  height: isImageAnswerRevealed(previewRow, resultMode)
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
                  height: isImageAnswerRevealed(previewRow, resultMode)
                    ? "min(62vh, 560px)"
                    : "min(68vh, 620px)",
                  justifyContent: "center",
                  width: "100%"
                }}
              >
                Image manquante
              </div>
            )}

            {isImageAnswerRevealed(previewRow, resultMode) && (
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

const imageRecapTableGridColumns = "minmax(210px, 1.35fr) 94px 86px 184px";
const imageRecapTableGap = "10px";
const imageRecapTablePadding = "10px 14px";
const imageRecapStatusStripeBorder = "3px solid transparent";

const imageRecapOverlayStyle = {
  alignItems: "center",
  backdropFilter: "blur(6px)",
  background: "rgba(0,0,0,0.75)",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  padding: "30px",
  position: "fixed",
  zIndex: 1000
};

const imageRecapCardStyle = {
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  borderRadius: "18px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  maxHeight: "100%",
  maxWidth: "1100px",
  overflow: "auto",
  padding: "24px",
  scrollbarGutter: "stable",
  width: "100%"
};

const imageRecapHeaderStyle = {
  alignItems: "center",
  display: "flex",
  justifyContent: "space-between",
  gap: "18px",
  marginBottom: "22px"
};

const imageRecapTypeBadgeStyle = {
  background: "rgba(240, 195, 106, 0.14)",
  border: "1px solid rgba(240, 195, 106, 0.3)",
  borderRadius: "999px",
  color: "#f0c36a",
  display: "flex",
  fontSize: "12px",
  fontWeight: 800,
  padding: "5px 10px",
  width: "fit-content"
};

const imageRecapTitleStyle = {
  color: "#f3f3f3",
  fontSize: "26px",
  fontWeight: 700,
  marginTop: "12px"
};

const imageRecapValidateButtonStyle = {
  ...buttonStyle,
  background: "#1d3a29",
  border: "1px solid #2c5c3e",
  color: "#7ee2a8"
};

const imageRecapStatsGridStyle = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  marginBottom: "18px"
};

const imageRecapStatStyle = {
  background: "#181818",
  border: "1px solid #262626",
  borderRadius: "12px",
  minWidth: 0,
  padding: "12px 14px"
};

const imageRecapStatValueStyle = {
  color: "#f3f3f3",
  fontSize: "22px",
  fontWeight: 700,
  lineHeight: "26px"
};

const imageRecapStatMutedStyle = {
  color: "#666",
  fontSize: "14px",
  marginLeft: "3px"
};

const imageRecapStatLabelStyle = {
  color: "#777",
  fontSize: "12px",
  marginTop: "3px"
};

const imageRecapPreviewPanelStyle = {
  background: "#111",
  border: "1px solid #262626",
  borderRadius: "14px",
  display: "flex",
  flexDirection: "column",
  minHeight: "430px",
  minWidth: 0,
  overflow: "hidden"
};

const imageRecapPanelHeaderStyle = {
  alignItems: "center",
  background: "#151515",
  borderBottom: "1px solid #262626",
  color: "#e5e5e5",
  display: "flex",
  fontSize: "12px",
  fontWeight: 800,
  justifyContent: "space-between",
  letterSpacing: "0.08em",
  padding: "12px 14px",
  textTransform: "uppercase"
};

const imageRecapPanelCountStyle = {
  color: "#777",
  fontSize: "11px",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const imageRecapSelectedPreviewStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateRows: "minmax(0, 1fr) auto",
  minHeight: 0,
  padding: "12px"
};

const imageRecapSelectedPreviewButtonStyle = {
  alignItems: "center",
  background: "#151515",
  border: "1px solid #303030",
  borderRadius: "12px",
  boxSizing: "border-box",
  cursor: "zoom-in",
  display: "flex",
  justifyContent: "center",
  minHeight: "310px",
  minWidth: 0,
  overflow: "hidden",
  padding: "14px",
  width: "100%"
};

const imageRecapSelectedPreviewFoundStyle = {
  borderColor: "rgba(56, 189, 248, 0.52)",
  boxShadow: "inset 0 0 0 1px rgba(37, 99, 235, 0.18)"
};

const imageRecapSelectedPreviewMissedStyle = {
  background: [
    "repeating-linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0 5px, rgba(245, 158, 11, 0) 5px 10px)",
    "#181818"
  ].join(", "),
  borderColor: "rgba(251, 191, 36, 0.58)"
};

const imageRecapSelectedPreviewImageStyle = {
  display: "block",
  height: "min(44vh, 340px)",
  maxHeight: "100%",
  maxWidth: "100%",
  objectFit: "contain",
  width: "100%"
};

const imageRecapSelectedMissingImageStyle = {
  color: "#666",
  fontSize: "13px",
  overflowWrap: "anywhere",
  textAlign: "center"
};

const imageRecapSelectedMetaStyle = {
  alignItems: "center",
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  minWidth: 0
};

const imageRecapSelectedTitleStyle = {
  color: "#f3f3f3",
  fontSize: "16px",
  fontWeight: 800,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const imageRecapSelectedIntervalStyle = {
  color: "#e5e5e5",
  fontSize: "18px",
  fontWeight: 800,
  whiteSpace: "nowrap"
};

const imageRecapSelectedEmptyStyle = {
  alignItems: "center",
  color: "#666",
  display: "flex",
  justifyContent: "center",
  minHeight: "320px"
};

const imageRecapTableStyle = {
  background: "#111",
  border: "1px solid #262626",
  borderRadius: "14px",
  minWidth: 0,
  overflow: "hidden"
};

const imageRecapTableHeaderStyle = {
  alignItems: "center",
  background: "#151515",
  borderBottom: "1px solid #262626",
  borderLeft: imageRecapStatusStripeBorder,
  boxSizing: "border-box",
  color: "#777",
  display: "grid",
  fontSize: "11px",
  fontWeight: 700,
  gap: imageRecapTableGap,
  gridTemplateColumns: imageRecapTableGridColumns,
  letterSpacing: "0.08em",
  padding: imageRecapTablePadding,
  textAlign: "left",
  textTransform: "uppercase"
};

const imageRecapHeaderButtonStyle = {
  alignItems: "center",
  background: "transparent",
  border: 0,
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  font: "inherit",
  fontWeight: "inherit",
  gap: "5px",
  justifyContent: "flex-start",
  letterSpacing: "inherit",
  lineHeight: "16px",
  minWidth: 0,
  padding: 0,
  textAlign: "left",
  textTransform: "inherit",
  width: "100%"
};

const imageRecapHeaderButtonActiveStyle = {
  color: "#e5e5e5"
};

const imageRecapHeaderLabelStyle = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const imageRecapHeaderSortIndicatorStyle = {
  color: "#e5e5e5",
  flex: "0 0 10px",
  fontSize: "12px",
  lineHeight: "12px",
  textAlign: "center",
  width: "10px"
};

const imageRecapTableBodyStyle = {
  background: "#242424",
  display: "flex",
  flexDirection: "column",
  gap: "1px",
  maxHeight: "430px",
  overflow: "auto",
  scrollbarGutter: "stable"
};

const imageRecapBulkRowStyle = {
  alignItems: "center",
  background: "#111",
  borderLeft: imageRecapStatusStripeBorder,
  boxSizing: "border-box",
  display: "grid",
  gap: imageRecapTableGap,
  gridTemplateColumns: imageRecapTableGridColumns,
  padding: imageRecapTablePadding
};

const imageRecapBulkTextStyle = {
  alignItems: "flex-start",
  display: "flex",
  flexDirection: "column",
  gridColumn: "1 / -2",
  justifyContent: "center",
  minWidth: 0
};

const imageRecapBulkTitleStyle = {
  color: "#e5e5e5",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};

const imageRecapBulkMetaStyle = {
  color: "#777",
  fontSize: "11px",
  lineHeight: "15px"
};

const imageRecapBulkControlsStyle = {
  display: "flex",
  flex: "0 0 auto",
  gap: "6px",
  justifyContent: "flex-start"
};

const imageRecapRowStyle = {
  alignItems: "center",
  background: "#181818",
  border: 0,
  borderLeft: imageRecapStatusStripeBorder,
  borderRadius: 0,
  boxSizing: "border-box",
  color: "#e5e5e5",
  cursor: "pointer",
  display: "grid",
  font: "inherit",
  gap: imageRecapTableGap,
  gridTemplateColumns: imageRecapTableGridColumns,
  minHeight: "62px",
  padding: imageRecapTablePadding,
  textAlign: "left",
  transition: "background 0.14s ease, box-shadow 0.14s ease",
  width: "100%"
};

const imageRecapRowFoundStyle = {
  background: "linear-gradient(90deg, rgba(37, 99, 235, 0.14), #181818 46%)"
};

const imageRecapRowMissedStyle = {
  background: [
    "repeating-linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0 5px, rgba(245, 158, 11, 0) 5px 10px)",
    "linear-gradient(90deg, rgba(245, 158, 11, 0.18), #181818 48%)"
  ].join(", ")
};

const imageRecapRowSelectedStyle = {
  boxShadow: "inset 0 0 0 1px rgba(240, 195, 106, 0.78)"
};

const imageRecapAnswerCellStyle = {
  alignItems: "center",
  color: "#f3f3f3",
  display: "flex",
  gap: "8px",
  minWidth: 0
};

const imageRecapStatusChipStyle = {
  alignItems: "center",
  borderRadius: "999px",
  display: "inline-flex",
  flex: "0 0 auto",
  fontSize: "10px",
  fontWeight: 800,
  height: "22px",
  letterSpacing: "0.04em",
  lineHeight: "22px",
  padding: "0 8px",
  textTransform: "uppercase"
};

const imageRecapStatusFoundStyle = {
  background: "rgba(37, 99, 235, 0.24)",
  border: "1px solid rgba(56, 189, 248, 0.62)",
  color: "#bae6fd"
};

const imageRecapStatusMissedStyle = {
  background: [
    "repeating-linear-gradient(135deg, rgba(17, 24, 39, 0.3) 0 3px, rgba(17, 24, 39, 0) 3px 6px)",
    "rgba(245, 158, 11, 0.22)"
  ].join(", "),
  border: "1px solid rgba(251, 191, 36, 0.7)",
  color: "#fde68a"
};

const imageRecapThumbnailStyle = {
  alignItems: "center",
  background: "#101010",
  border: "1px solid #2a2a2a",
  borderRadius: "7px",
  display: "flex",
  flex: "0 0 42px",
  height: "42px",
  justifyContent: "center",
  overflow: "hidden",
  width: "42px"
};

const imageRecapThumbnailImageStyle = {
  display: "block",
  height: "100%",
  maxHeight: "100%",
  maxWidth: "100%",
  objectFit: "contain",
  width: "100%"
};

const imageRecapThumbnailMissingStyle = {
  background: "#262626",
  borderRadius: "999px",
  height: "10px",
  width: "10px"
};

const imageRecapAnswerTextStyle = {
  color: "#f3f3f3",
  fontWeight: 650,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const imageRecapMetricCellStyle = {
  alignItems: "flex-start",
  color: "#777",
  display: "flex",
  flexDirection: "column",
  fontSize: "12px",
  justifyContent: "center",
  lineHeight: "16px",
  minWidth: 0
};

const imageRecapHistoryRateStyle = {
  color: "#e5e5e5",
  fontSize: "17px",
  fontWeight: 700,
  lineHeight: "20px"
};

const imageRecapHistoryMetaStyle = {
  color: "#777",
  fontSize: "11px",
  whiteSpace: "nowrap"
};

const imageRecapIntervalCellStyle = {
  color: "#e5e5e5",
  fontSize: "18px",
  fontWeight: 700,
  whiteSpace: "nowrap"
};

const imageRecapIntervalUnitStyle = {
  color: "#777",
  fontSize: "12px",
  fontWeight: 600
};

const imageRecapQualityCellStyle = {
  display: "flex",
  gap: "6px",
  justifyContent: "flex-start"
};

const imageRecapQualityButtonStyle = {
  borderRadius: "9px",
  fontSize: "12px",
  fontWeight: 800,
  height: "34px",
  lineHeight: "16px",
  minWidth: "50px",
  padding: "0 8px"
};

const imageRecapLockedQualityStyle = {
  background: "#3a1f24",
  border: "1px solid #6b2b31",
  borderRadius: "9px",
  color: "#ff9aa5",
  fontSize: "12px",
  fontWeight: 800,
  lineHeight: "16px",
  padding: "8px 10px",
  whiteSpace: "nowrap"
};
