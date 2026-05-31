import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import SvgMap from "../../map/components/SvgMap";
import { fadeInStyle } from "../../../shared/styles";
import { centerListItem } from "../../../shared/scroll";
import { useMapReview } from "../hooks/useMapReview";

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

export default function MapReview({ group, reviewZones, onComplete }) {
  const {
    dueCodes,
    feedbackTone,
    focusedCode,
    focusNextRemainingZone,
    focusVersion,
    foundQuestionIds,
    foundCodes,
    foundQuestionIdSet,
    finishMap,
    handleSubmit,
    handleZoneSelect,
    input,
    qualityByQuestionId,
    missedCodes,
    progressPercent,
    recapMissCount,
    recapRows,
    recapSort,
    recapSuccessCount,
    recapSuccessRate,
    remainingFocusCode,
    remainingZones,
    sendResult,
    setFocusedCode,
    setFoundZoneQualities,
    setInput,
    setQuality,
    showRecap,
    showRecapSections,
    toggleRecapSort
  } = useMapReview(reviewZones, onComplete);
  const inputRef = useRef(null);
  const recapTableBodyRef = useRef(null);
  const recapRowRefs = useRef(new Map());
  const recapRowKey = recapRows.map(row => row.item.code).join("|");
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

    reviewZones.forEach(item => {
      if (!item.code || !item.label || !foundQuestionIdSet.has(item.question_id)) {
        return;
      }

      labels[item.code] = item.label;
    });

    return labels;
  }, [foundQuestionIdSet, reviewZones]);

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

  const focusRecapCode = useCallback((code) => {
    if (!code) return;

    setFocusedCode(code);
    window.requestAnimationFrame(() => scrollRecapRowIntoView(code));
  }, [scrollRecapRowIntoView, setFocusedCode]);

  const handleZoomRemaining = useCallback(() => {
    focusNextRemainingZone();
    inputRef.current?.focus({ preventScroll: true });
  }, [focusNextRemainingZone]);

  useEffect(() => {
    if (showRecap || remainingZones.length === 0) {
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
  }, [handleZoomRemaining, remainingZones.length, showRecap]);

  useLayoutEffect(() => {
    if (!showRecap || !focusedCode) return;

    scrollRecapRowIntoView(focusedCode);
  }, [focusedCode, recapRowKey, scrollRecapRowIntoView, showRecap]);

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
              <span>{reviewZones.length - foundQuestionIds.length} restantes</span>
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
          <div style={activeMapPanelStyle}>
            <SvgMap
              svgPath={`/maps/${group.media}`}
              found={foundCodes}
              dueItems={dueCodes}
              focusCode={remainingFocusCode}
              focusVersion={focusVersion}
              zoneLabels={foundZoneLabels}
              onSelect={handleZoneSelect}
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
            ref={inputRef}
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
                {feedbackTone === "incorrect"
                  ? "Réponse incorrecte, essaie encore."
                  : feedbackTone === "correct"
                    ? "Bonne réponse."
                    : "Clique sur la carte ou tape les réponses."}
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
                  Zone suivante
                </button>

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
                  focusCode={focusedCode}
                  onSelect={focusRecapCode}
                />
              </div>

              <div style={recapTableStyle}>
                <div className="map-recap-table-header" style={recapTableHeaderStyle}>
                  {recapHeaderColumns.map(({ key, label }) => {
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
                  {foundQuestionIds.length > 0 && (
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
                    const projectedInterval =
                      item.projected_intervals?.[selectedQuality] ??
                      item.progress?.interval ??
                      0;

                    return (
                      <Fragment key={item.question_id}>
                        {showSection && (
                          <div style={recapSectionStyle}>
                            {isFound ? "Correct" : "Wrong"}
                          </div>
                        )}

                        <div
                          className="map-recap-row"
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
  color: "#8a8a8a",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "left"
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
