import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SvgMap from "../../map/components/SvgMap";
import { fadeInStyle } from "../../../shared/styles";
import { centerListItem } from "../../../shared/scroll";
import { useMapReview } from "../hooks/useMapReview";
import TrainingTimerPanel from "./TrainingTimerPanel";
import {
  MAP_MODE_CLICK_PROMPT,
  MAP_MODE_MULTIPLE_CHOICE,
  MAP_MODE_TYPE_ALL,
  MAP_MODE_TYPE_PROMPT,
  mapModeLabels,
  normalizeMapMode
} from "../mapModes";

const typeBadgeStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  width: "fit-content",
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
    background: "#20303a",
    border: "1px solid #345b7a",
    color: "#8fc7ff"
  },
  3: {
    background: "#3a3420",
    border: "1px solid #2c5c3e",
    color: "#7ee2a8"
  }
};

const qualityOptions = [
  { value: 0, icon: "❌", title: "Faux" },
  { value: 1, icon: "😐", title: "Dur" },
  { value: 2, icon: "🙂", title: "Bon" },
  { value: 3, icon: "✅", title: "Facile" }
];

const recapHeaderColumns = [
  { key: "answer", label: "Réponse" },
  { key: "success", label: "Réussite" },
  { key: "interval", label: "Intervalle" },
  { key: "quality", label: "Qualité" }
];

function choiceFeedbackState(option, feedback) {
  if (!feedback) return "";

  if (option.question_id === feedback.correctQuestionId) return "correct";
  if (option.question_id === feedback.selectedQuestionId) return "wrong";

  return "neutral";
}


function choiceFeedbackLabel(option, feedback) {
  const state = choiceFeedbackState(option, feedback);

  if (state === "correct") return "Correct";
  if (state === "wrong") return "Faux";

  return "";
}


function getChoiceButtonStyle(option, feedback) {
  const state = choiceFeedbackState(option, feedback);

  if (state === "correct") {
    return {
      ...choiceButtonStyle,
      background: "linear-gradient(180deg, #183a24, #12291b)",
      border: "1px solid rgba(134, 239, 172, 0.7)",
      boxShadow: "0 0 0 3px rgba(34, 197, 94, 0.16)",
      color: "#d7f5df"
    };
  }

  if (state === "wrong") {
    return {
      ...choiceButtonStyle,
      background: [
        "repeating-linear-gradient(135deg, rgba(127, 29, 29, 0.24) 0 4px, rgba(127, 29, 29, 0) 4px 8px)",
        "linear-gradient(180deg, #3a1d1d, #271414)"
      ].join(", "),
      border: "1px solid rgba(248, 113, 113, 0.72)",
      boxShadow: "0 0 0 3px rgba(248, 113, 113, 0.14)",
      color: "#ffd7d7"
    };
  }

  if (state === "neutral") {
    return {
      ...choiceButtonStyle,
      cursor: "default",
      opacity: 0.55
    };
  }

  return choiceButtonStyle;
}


export default function MapReview({
  group,
  reviewZones,
  onComplete,
  submitAnswer,
  showQualityControls = true,
  trainingElapsedMs = null,
  trainingBestTimeMs = null,
  mode: modeProp,
  contextItems = [],
  fillAvailableHeight = false
}) {
  const normalizedMode = normalizeMapMode(modeProp || group.mode);
  const {
    activeMissedCodes,
    choiceFeedback,
    choiceOptions,
    dueCodes,
    feedbackTone,
    flashCodes,
    focusedCode,
    focusNextRemainingZone,
    focusVersion,
    foundQuestionIds,
    foundCodes,
    foundQuestionIdSet,
    finishMap,
    handleChoiceSelect,
    handleSubmit,
    handleZoneSelect,
    input,
    mode,
    qualityByQuestionId,
    missedCodes,
    promptLabel,
    recapMissCount,
    recapRows,
    recapSort,
    recapSuccessCount,
    recapSuccessRate,
    remainingFocusCode,
    remainingZones,
    selectedCode,
    sendResult,
    setFocusedCode,
    setFoundZoneQualities,
    setInput,
    setQuality,
    showRecap,
    showRecapSections,
    skipCurrentPrompt,
    toggleRecapSort
  } = useMapReview(reviewZones, onComplete, submitAnswer, {
    mode: normalizedMode,
    contextItems
  });
  const inputRef = useRef(null);
  const recapTableBodyRef = useRef(null);
  const recapRowRefs = useRef(new Map());
  const [recapFocusCode, setRecapFocusCode] = useState(null);
  const [recapFocusVersion, setRecapFocusVersion] = useState(0);
  const recapRowKey = recapRows.map(row => row.item.code).join("|");
  const recapGridColumns = showQualityControls
    ? recapTableGridColumns
    : "minmax(0, 1fr)";
  const visibleRecapHeaderColumns = showQualityControls
    ? recapHeaderColumns
    : recapHeaderColumns.filter(column => column.key === "answer");
  const showTrainingTimer = trainingElapsedMs !== null && !showRecap;
  const showTextInput = mode === MAP_MODE_TYPE_ALL || mode === MAP_MODE_TYPE_PROMPT;
  const showPromptPanel = (
    mode !== MAP_MODE_TYPE_ALL &&
    mode !== MAP_MODE_TYPE_PROMPT &&
    mode !== MAP_MODE_MULTIPLE_CHOICE &&
    !showRecap
  );
  const canSkipPrompt = mode === MAP_MODE_TYPE_PROMPT;
  const completedQuestionCount = Math.max(0, reviewZones.length - remainingZones.length);
  const wrongQuestionCount = mode !== MAP_MODE_TYPE_ALL
    ? Math.max(0, completedQuestionCount - foundQuestionIds.length)
    : 0;
  const correctProgressPercent = reviewZones.length
    ? Math.min((foundQuestionIds.length / reviewZones.length) * 100, 100)
    : 0;
  const wrongProgressPercent = reviewZones.length
    ? Math.min((wrongQuestionCount / reviewZones.length) * 100, 100)
    : 0;
  const baseFeedbackCopy = feedbackTone === "incorrect"
    ? mode === MAP_MODE_TYPE_PROMPT
      ? "Réponse incorrecte."
      : "Mauvaise zone."
    : feedbackTone === "correct"
      ? "Bonne réponse."
      : mode === MAP_MODE_TYPE_ALL
        ? "Tape les réponses."
        : mode === MAP_MODE_CLICK_PROMPT
          ? "Clique la zone demandée."
          : mode === MAP_MODE_MULTIPLE_CHOICE
            ? "Choisis la réponse."
            : "Tape le nom de la zone.";
  const feedbackCopy = fillAvailableHeight && !feedbackTone ? "" : baseFeedbackCopy;
  const foundBulkQuality = useMemo(() => {
    if (foundQuestionIds.length === 0) return null;

    const firstQuality = qualityByQuestionId[foundQuestionIds[0]] ?? 2;

    return foundQuestionIds.every(
      questionId => (qualityByQuestionId[questionId] ?? 2) === firstQuality
    )
      ? firstQuality
      : null;
  }, [foundQuestionIds, qualityByQuestionId]);
  const foundZoneLabels = useMemo(() => {
    const labels = {};
    const activeMissedCodeSet = new Set(activeMissedCodes);

    reviewZones.forEach(item => {
      if (
        !item.code ||
        !item.label ||
        (
          !foundQuestionIdSet.has(item.question_id) &&
          !activeMissedCodeSet.has(item.code)
        )
      ) {
        return;
      }

      labels[item.code] = item.label;
    });

    return labels;
  }, [activeMissedCodes, foundQuestionIdSet, reviewZones]);

  function setRecapRowRef(code) {
    return (element) => {
      if (!code) return;

      if (element) {
        recapRowRefs.current.set(code, element);
      } else {
        recapRowRefs.current.delete(code);
      }
    };
  }

  const scrollRecapRowIntoView = useCallback((code) => {
    const list = recapTableBodyRef.current;
    const row = recapRowRefs.current.get(code);
    if (!list || !row) return;

    centerListItem(list, row);
  }, []);

  const selectRecapCode = useCallback((code) => {
    if (!code) return;

    setFocusedCode(code);
    window.requestAnimationFrame(() => scrollRecapRowIntoView(code));
  }, [scrollRecapRowIntoView, setFocusedCode]);

  const focusRecapCode = useCallback((code) => {
    if (!code) return;

    selectRecapCode(code);
    setRecapFocusCode(code);
    setRecapFocusVersion(version => version + 1);
  }, [selectRecapCode]);

  const handleZoomRemaining = useCallback(() => {
    focusNextRemainingZone();
    inputRef.current?.focus({ preventScroll: true });
  }, [focusNextRemainingZone]);

  useEffect(() => {
    if (
      ![MAP_MODE_TYPE_ALL, MAP_MODE_MULTIPLE_CHOICE].includes(mode) ||
      showRecap ||
      remainingZones.length === 0
    ) {
      return undefined;
    }

    function handleMapKeyDown(event) {
      if (
        event.defaultPrevented ||
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      event.preventDefault();
      handleZoomRemaining();
    }

    window.addEventListener("keydown", handleMapKeyDown);

    return () => {
      window.removeEventListener("keydown", handleMapKeyDown);
    };
  }, [handleZoomRemaining, mode, remainingZones.length, showRecap]);

  useLayoutEffect(() => {
    if (!showRecap || !focusedCode) return;

    scrollRecapRowIntoView(focusedCode);
  }, [focusedCode, recapRowKey, scrollRecapRowIntoView, showRecap]);

  return (
    <>
      <div
        data-map-review-shell
        style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
            borderRadius: "18px",
            display: "flex",
            flexDirection: "column",
            height: fillAvailableHeight ? "100%" : undefined,
            minHeight: fillAvailableHeight ? 0 : undefined,
            overflow: "hidden",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            ...fadeInStyle
          }}
      >

        {/* HEADER */}
        <div
          data-map-review-header
          style={{
            padding: fillAvailableHeight ? "8px 12px 9px" : "22px 24px 18px",
            borderBottom: "1px solid #262626",
            flexShrink: 0,
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
              marginBottom: fillAvailableHeight ? "6px" : "16px"
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
                  <div style={typeBadgeStyle}>
                    MAP · {mapModeLabels[mode]}
                  </div>

                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "12px",
                      marginTop: "14px",
                      minWidth: 0
                    }}
                  >
                    <div
                      style={{
                        color: "#f3f3f3",
                        fontSize: "28px",
                        fontWeight: "700",
                        lineHeight: 1.15,
                        minWidth: 0
                      }}
                    >
                      {group.name || group.media}
                    </div>

                    {showTrainingTimer && (
                      <TrainingTimerPanel
                        elapsedMs={trainingElapsedMs}
                        bestTimeMs={trainingBestTimeMs}
                      />
                    )}
                  </div>
                </>
              )}
            </div>

            <div
              style={{
                minWidth: "90px",
                textAlign: "right"
              }}
            >
              <div
                style={{
                  fontSize: fillAvailableHeight ? "22px" : "28px",
                  fontWeight: "700",
                  color: "#fff"
                }}
              >
                {foundQuestionIds.length}
                <span
                  style={{
                    color: "#666",
                    fontSize: "18px",
                    marginLeft: "4px"
                  }}
                >
                  / {reviewZones.length}
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

          <div
            aria-label="Progression"
            aria-valuemax={reviewZones.length}
            aria-valuemin={0}
            aria-valuenow={completedQuestionCount}
            role="progressbar"
            style={{
              background: "linear-gradient(180deg, #0d0d0d, #141414)",
              border: "1px solid #2a2a2a",
              boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.55)",
              borderRadius: "999px",
              height: "10px",
              overflow: "hidden",
              position: "relative"
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
                data-map-progress-correct
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
                data-map-progress-wrong
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

          <div style={{ color: "#777", display: "flex", fontSize: "12px", justifyContent: "space-between", marginTop: "8px" }}>
            <span>{remainingZones.length} restantes</span>
            <span>{showRecap ? "Résultat" : "En cours"}</span>
          </div>
        </div>

        {/* MAP */}
        <div
          style={{
            borderBottom: "1px solid #262626",
            display: fillAvailableHeight ? "flex" : undefined,
            flex: fillAvailableHeight ? "1 1 auto" : undefined,
            flexDirection: fillAvailableHeight ? "column" : undefined,
            minHeight: fillAvailableHeight ? 0 : undefined,
            padding: fillAvailableHeight ? "12px 16px" : "18px"
          }}
        >
          <div
            style={{
              ...activeMapPanelStyle,
              ...(fillAvailableHeight
                ? {
                    flex: "1 1 auto",
                    height: "auto",
                    minHeight: "260px"
                  }
                : {})
            }}
          >
            <SvgMap
              svgPath={`/maps/${group.media}`}
              found={foundCodes}
              missed={activeMissedCodes}
              dueItems={dueCodes}
              flashCodes={flashCodes}
              focusCode={remainingFocusCode}
              focusVersion={focusVersion}
              selected={selectedCode || undefined}
              zoneLabels={foundZoneLabels}
              onSelect={handleZoneSelect}
            />
          </div>
        </div>

        {/* INPUT */}
        <div
          style={{
            flexShrink: 0,
            padding: fillAvailableHeight ? "12px 16px 14px" : "20px 24px"
          }}
        >
          {showPromptPanel && (
            <div style={promptPanelStyle}>
              {!fillAvailableHeight && (
                <div style={promptKickerStyle}>
                  {mode === MAP_MODE_CLICK_PROMPT
                    ? "Zone demandée"
                    : mode === MAP_MODE_MULTIPLE_CHOICE
                      ? "Zone surlignée"
                      : "Nom attendu"}
                </div>
              )}
              <div style={promptValueStyle}>
                {mode === MAP_MODE_CLICK_PROMPT ? promptLabel : "Zone surlignée"}
              </div>
            </div>
          )}

          {showTextInput && (
            <input
              autoFocus
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Tab" &&
                  mode === MAP_MODE_TYPE_PROMPT &&
                  !e.shiftKey
                ) {
                  e.preventDefault();
                  skipCurrentPrompt();
                  inputRef.current?.focus({ preventScroll: true });
                  return;
                }

                if (e.key === "Enter") {
                  handleSubmit();
                }
              }}
              placeholder={mode === MAP_MODE_TYPE_PROMPT ? "Nom de la zone..." : "Tape une zone..."}
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
          )}

          {mode === MAP_MODE_MULTIPLE_CHOICE && !showRecap && (
            <div style={choiceGridStyle}>
              {choiceOptions.map(option => (
                <button
                  key={option.question_id}
                  type="button"
                  data-map-choice-feedback={choiceFeedbackState(option, choiceFeedback)}
                  disabled={Boolean(choiceFeedback)}
                  onClick={() => handleChoiceSelect(option.question_id)}
                  style={getChoiceButtonStyle(option, choiceFeedback)}
                >
                  <span>{option.label}</span>
                  {choiceFeedbackLabel(option, choiceFeedback) && (
                    <span style={choiceFeedbackLabelStyle}>
                      {choiceFeedbackLabel(option, choiceFeedback)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* FOOTER */}
          {!showRecap && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "18px",
                marginTop: "24px",
                flexWrap: "wrap"
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
                {feedbackCopy}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                  marginLeft: "auto"
                }}
              >
                {(mode === MAP_MODE_TYPE_ALL || mode === MAP_MODE_MULTIPLE_CHOICE) && (
                  <button
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleZoomRemaining}
                    disabled={remainingZones.length === 0}
                    style={{
                      ...buttonStyle,
                      cursor: remainingZones.length === 0 ? "not-allowed" : "pointer",
                      opacity: remainingZones.length === 0 ? 0.55 : 1
                    }}
                  >
                    {mode === MAP_MODE_TYPE_ALL ? "Zone suivante" : "Recentrer"}
                  </button>
                )}

                {canSkipPrompt && (
                  <button
                    type="button"
                    onClick={skipCurrentPrompt}
                    disabled={remainingZones.length === 0}
                    style={{
                      ...buttonStyle,
                      cursor: remainingZones.length === 0 ? "not-allowed" : "pointer",
                      opacity: remainingZones.length === 0 ? 0.55 : 1
                    }}
                  >
                    Passer
                  </button>
                )}

                <button
                  onClick={finishMap}
                  style={buttonStyle}
                >
                  Terminer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RECAP */}
      {showRecap && (
        <div style={overlayStyle}>

          <div className="app-scrollbar" style={recapCardStyle}>

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
                {showQualityControls ? "Valider" : "Continuer"}
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
                  <span style={recapStatMutedStyle}> / {reviewZones.length}</span>
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
                  focusCode={recapFocusCode}
                  focusVersion={recapFocusVersion}
                  onSelect={selectRecapCode}
                />
              </div>

              <div style={recapTableStyle}>
                <div
                  className="map-recap-table-header"
                  style={{
                    ...recapTableHeaderStyle,
                    gridTemplateColumns: recapGridColumns
                  }}
                >
                  {visibleRecapHeaderColumns.map(({ key, label }) => {
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
                          ...recapHeaderButtonStyle,
                          ...(isActive ? recapHeaderButtonActiveStyle : {})
                        }}
                        title={`${label} : trier ${
                          nextDirection === "asc" ? "croissant" : "décroissant"
                        }`}
                      >
                        <span style={recapHeaderLabelStyle}>{label}</span>
                        <span
                          aria-hidden="true"
                          style={{
                            ...recapHeaderSortIndicatorStyle,
                            opacity: isActive ? 1 : 0
                          }}
                        >
                          {recapSort.direction === "asc" ? "↑" : "↓"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  ref={recapTableBodyRef}
                  className="app-scrollbar"
                  style={recapTableBodyStyle}
                >
                  {showQualityControls && foundQuestionIds.length > 0 && (
                    <div className="map-recap-bulk-row" style={recapBulkQualityStyle}>
                      <div style={recapBulkQualityTextStyle}>
                        <div style={recapBulkQualityTitleStyle}>
                          Zones trouvées
                        </div>
                        <div style={recapBulkQualityMetaStyle}>
                          {foundQuestionIds.length} qualité{foundQuestionIds.length > 1 ? "s" : ""}
                        </div>
                      </div>

                      <div style={recapBulkQualityControlsStyle}>
                        {qualityOptions.map(({ value: qVal, icon, title }) => {
                          const disabled = qVal === 0;
                          const selected = !disabled && foundBulkQuality === qVal;
                          const activeStyle = qualityButtonStyles[qVal];

                          return (
                            <button
                              key={qVal}
                              type="button"
                              disabled={disabled}
                              onClick={() => setFoundZoneQualities(qVal)}
                              style={{
                                ...recapQualityButtonStyle,
                                cursor: disabled ? "not-allowed" : "pointer",
                                border: selected
                                  ? activeStyle.border
                                  : disabled
                                    ? "1px solid #2d2d2d"
                                    : "1px solid #333",
                                background: selected
                                  ? activeStyle.background
                                  : disabled
                                    ? "#181818"
                                    : "#222",
                                color: selected
                                  ? activeStyle.color
                                  : disabled
                                    ? "#555"
                                    : "#999",
                                opacity: disabled ? 0.65 : 1
                              }}
                              title={disabled
                                ? "Faux indisponible pour les zones trouvées"
                                : `Appliquer aux zones trouvées : ${title}`}
                            >
                              {icon}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {recapRows.map((row, index) => {
                    const { item, historyStats, isFound } = row;
                    const showSection =
                      showRecapSections &&
                      (index === 0 || recapRows[index - 1].isFound !== isFound);
                    const isFocused = focusedCode === item.code;
                    const selectedQuality = qualityByQuestionId[item.question_id] ?? (isFound ? 2 : 0);
                    const recapStatusLabel = isFound ? "Trouvée" : "À revoir";
                    const projectedInterval =
                      item.projected_intervals?.[selectedQuality] ??
                      item.progress?.interval ??
                      0;

                    return (
                      <Fragment key={item.question_id}>
                        {showSection && (
                          <div
                            style={{
                              ...recapSectionStyle,
                              ...(isFound
                                ? recapSectionFoundStyle
                                : recapSectionMissedStyle)
                            }}
                          >
                            {isFound ? "Trouvées" : "À revoir"}
                          </div>
                        )}

                        <div
                          className="map-recap-row"
                          data-map-recap-row={isFound ? "found" : "missed"}
                          ref={setRecapRowRef(item.code)}
                          role="button"
                          tabIndex={0}
                          onClick={() => focusRecapCode(item.code)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) {
                              return;
                            }

                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              focusRecapCode(item.code);
                            }
                          }}
                          style={{
                            ...recapRowStyle,
                            gridTemplateColumns: recapGridColumns,
                            ...(isFound ? recapRowFoundStyle : recapRowMissedStyle),
                            ...(isFocused ? recapRowFocusedStyle : {}),
                            borderLeft: isFound
                              ? "3px solid #38bdf8"
                              : "3px solid #f59e0b"
                          }}
                          title={item.code ? `Voir ${item.label} sur la carte` : item.label}
                        >
                          <div style={recapAnswerCellStyle}>
                            <span
                              data-map-recap-status={isFound ? "found" : "missed"}
                              style={{
                                ...recapStatusChipStyle,
                                ...(isFound
                                  ? recapStatusChipFoundStyle
                                  : recapStatusChipMissedStyle)
                              }}
                            >
                              {recapStatusLabel}
                            </span>
                            <span style={recapAnswerTextStyle}>
                              {item.label}
                            </span>
                          </div>

                          {showQualityControls && (
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
                          )}

                          {showQualityControls && (
                          <div style={recapIntervalCellStyle}>
                            {projectedInterval}
                            <span style={recapIntervalUnitStyle}> j</span>
                          </div>
                          )}

                          {showQualityControls && (
                          <div style={recapQualityCellStyle}>
                            {qualityOptions.map(({ value: qVal, icon, title }) => {

                              const selected =
                                qualityByQuestionId[item.question_id] === qVal;
                              const activeStyle = qualityButtonStyles[qVal];

                              return (
                                <button
                                  key={qVal}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setQuality(item.question_id, qVal);
                                  }}
                                  style={{
                                    ...recapQualityButtonStyle,
                                    cursor: "pointer",
                                    border: selected
                                      ? activeStyle.border
                                      : "1px solid #333",
                                    background: selected
                                      ? activeStyle.background
                                      : "#222",
                                    color: selected
                                      ? activeStyle.color
                                      : "#999"
                                  }}
                                  title={title}
                                >
                                  {icon}
                                </button>
                              );
                            })}
                          </div>
                          )}
                        </div>
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

const activeMapPanelStyle = {
  background: "#111",
  borderRadius: "14px",
  overflow: "hidden",
  border: "1px solid #262626",
  height: "clamp(300px, 55vh, 480px)"
};

const promptPanelStyle = {
  background: "#121212",
  border: "1px solid #2a2a2a",
  borderRadius: "12px",
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  marginBottom: "14px",
  padding: "14px 16px"
};

const promptKickerStyle = {
  color: "#777",
  fontSize: "11px",
  fontWeight: "800",
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};

const promptValueStyle = {
  color: "#f3f3f3",
  fontSize: "20px",
  fontWeight: "800",
  lineHeight: 1.15
};

const choiceGridStyle = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))"
};

const choiceButtonStyle = {
  ...buttonStyle,
  alignItems: "center",
  background: "#181818",
  display: "flex",
  gap: "10px",
  justifyContent: "space-between",
  minHeight: "54px",
  textAlign: "left"
};

const choiceFeedbackLabelStyle = {
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: "999px",
  flex: "0 0 auto",
  fontSize: "11px",
  fontWeight: 900,
  padding: "3px 8px",
  textTransform: "uppercase"
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
  scrollbarGutter: "stable",
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

const recapTableGridColumns = "minmax(150px, 1.35fr) 94px 86px 158px";
const recapTableGap = "10px";
const recapTablePadding = "10px 14px";
const recapStatusStripeBorder = "3px solid transparent";

const recapTableHeaderStyle = {
  display: "grid",
  gridTemplateColumns: recapTableGridColumns,
  gap: recapTableGap,
  alignItems: "center",
  padding: recapTablePadding,
  background: "#151515",
  borderBottom: "1px solid #262626",
  borderLeft: recapStatusStripeBorder,
  boxSizing: "border-box",
  color: "#777",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "left"
};

const recapHeaderButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: "5px",
  minWidth: 0,
  width: "100%",
  padding: 0,
  background: "transparent",
  border: 0,
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  fontWeight: "inherit",
  letterSpacing: "inherit",
  lineHeight: "16px",
  textAlign: "left",
  textTransform: "inherit"
};

const recapHeaderButtonActiveStyle = {
  color: "#e5e5e5"
};

const recapHeaderLabelStyle = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const recapHeaderSortIndicatorStyle = {
  flex: "0 0 10px",
  width: "10px",
  color: "#e5e5e5",
  fontSize: "12px",
  lineHeight: "12px",
  textAlign: "center"
};

const recapTableBodyStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "1px",
  maxHeight: "430px",
  overflow: "auto",
  scrollbarGutter: "stable",
  background: "#242424"
};

const recapSectionStyle = {
  padding: "10px 14px 8px",
  background: "#111",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "left"
};

const recapSectionFoundStyle = {
  color: "#7dd3fc"
};

const recapSectionMissedStyle = {
  color: "#fbbf24"
};

const recapBulkQualityStyle = {
  display: "grid",
  gridTemplateColumns: recapTableGridColumns,
  alignItems: "center",
  gap: recapTableGap,
  padding: recapTablePadding,
  background: "#111",
  borderLeft: recapStatusStripeBorder,
  boxSizing: "border-box"
};

const recapBulkQualityTextStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "center",
  gridColumn: "1 / -2",
  minWidth: 0
};

const recapBulkQualityTitleStyle = {
  color: "#e5e5e5",
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase"
};

const recapBulkQualityMetaStyle = {
  color: "#777",
  fontSize: "11px",
  lineHeight: "15px"
};

const recapBulkQualityControlsStyle = {
  display: "flex",
  gap: "6px",
  flex: "0 0 auto"
};

const recapRowStyle = {
  display: "grid",
  gridTemplateColumns: recapTableGridColumns,
  gap: recapTableGap,
  alignItems: "center",
  width: "100%",
  minHeight: "58px",
  padding: recapTablePadding,
  background: "#181818",
  border: "0",
  borderLeft: recapStatusStripeBorder,
  borderRadius: 0,
  color: "#e5e5e5",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  boxSizing: "border-box",
  transition: "background 0.14s ease, box-shadow 0.14s ease"
};

const recapRowFoundStyle = {
  background: "linear-gradient(90deg, rgba(37, 99, 235, 0.14), #181818 46%)"
};

const recapRowMissedStyle = {
  background: [
    "repeating-linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0 5px, rgba(245, 158, 11, 0) 5px 10px)",
    "linear-gradient(90deg, rgba(245, 158, 11, 0.18), #181818 48%)"
  ].join(", ")
};

const recapRowFocusedStyle = {
  boxShadow: "inset 0 0 0 1px rgba(243, 156, 18, 0.78)"
};

const recapAnswerCellStyle = {
  alignItems: "center",
  display: "flex",
  gap: "8px",
  minWidth: 0,
  color: "#f3f3f3"
};

const recapStatusChipStyle = {
  alignItems: "center",
  borderRadius: "999px",
  display: "inline-flex",
  flex: "0 0 auto",
  fontSize: "10px",
  fontWeight: "800",
  height: "22px",
  letterSpacing: "0.04em",
  lineHeight: "22px",
  padding: "0 8px",
  textTransform: "uppercase"
};

const recapStatusChipFoundStyle = {
  background: "rgba(37, 99, 235, 0.24)",
  border: "1px solid rgba(56, 189, 248, 0.62)",
  color: "#bae6fd"
};

const recapStatusChipMissedStyle = {
  background: [
    "repeating-linear-gradient(135deg, rgba(17, 24, 39, 0.3) 0 3px, rgba(17, 24, 39, 0) 3px 6px)",
    "rgba(245, 158, 11, 0.22)"
  ].join(", "),
  border: "1px solid rgba(251, 191, 36, 0.7)",
  color: "#fde68a"
};

const recapAnswerTextStyle = {
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
  width: "32px",
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
