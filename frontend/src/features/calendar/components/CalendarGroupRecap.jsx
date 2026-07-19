import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SvgMap from "../../map/components/SvgMap";
import { centerListItem } from "../../../shared/scroll";

const compactDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

function getQuestionCode(question) {
  return question?.data?.code || question?.code || "";
}

function answerLabel(question) {
  return question?.answer || question?.question || "Réponse sans titre";
}

function historyLabel(quality) {
  const value = Number(quality);
  if (value === 0) return "Faux";
  if (value === 1) return "Dur";
  if (value === 2) return "Bon";
  if (value === 3) return "Facile";
  return "Revu";
}

function historyColor(quality) {
  const value = Number(quality);
  if (value === 0) return "#ff9c9c";
  if (value === 1) return "#ffcc7a";
  if (value === 2) return "#8fc7ff";
  if (value === 3) return "#7ee2a8";
  return "#8f9aa3";
}

function parseDateKey(value) {
  if (!value) return null;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

function formatDateKey(value) {
  const date = parseDateKey(value);
  return date ? compactDateFormatter.format(date) : "Non planifié";
}

function statusLabel(event, todayKey) {
  if (event.kind === "history") {
    return historyLabel(event.history?.quality);
  }

  return event.dateKey < todayKey ? "Due" : "À revoir";
}

function statusColor(event, todayKey) {
  if (event.kind === "history") {
    return historyColor(event.history?.quality);
  }

  return event.dateKey < todayKey ? "#ff9c9c" : "#b69cff";
}

function getHistoryStats(question) {
  const history = question.progress?.history || [];

  if (history.length > 0) {
    const successes = history.filter((entry) => Number(entry?.quality) > 0).length;

    return {
      reviews: history.length,
      successRate: Math.round((successes / history.length) * 100)
    };
  }

  const reps = question.progress?.reps || 0;
  const lapses = question.progress?.lapses || 0;

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

function groupMediaPath(media) {
  if (!media) return null;
  if (/^(https?:)?\/\//.test(media) || media.startsWith("/")) return media;
  return `/maps/${media}`;
}

function getFocusedEvent(events, focusedQuestionId) {
  return events.find((event) => event.question.id === focusedQuestionId) || events[0];
}

function mergeTags(...tagLists) {
  const tagsByKey = new Map();

  tagLists.forEach((tagList) => {
    (tagList || []).forEach((tag) => {
      const value = String(tag || "").trim();
      const key = value.toLowerCase();

      if (value && !tagsByKey.has(key)) {
        tagsByKey.set(key, value);
      }
    });
  });

  return [...tagsByKey.values()];
}

export default function CalendarGroupRecap({
  expanded = false,
  focusedQuestionId,
  onClose,
  onFocusQuestion,
  onOpenQuestion,
  row,
  showHeader = true,
  todayKey
}) {
  const listRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [selectedCode, setSelectedCode] = useState(null);
  const focusedEvent = getFocusedEvent(row.events, focusedQuestionId);
  const focusedCode = getQuestionCode(focusedEvent?.question);
  const group = row.group || {};
  const mapPath = groupMediaPath(group.media);
  const hasMapPreview = group.type_group === "map" && mapPath;
  const groupTags = mergeTags(
    row.tags,
    group.tags,
    ["map", "media"].includes(group.type_group)
      ? row.events.map((event) => event.question.tags || []).flat()
      : []
  );
  const questionCount = row.events.length;
  const totalReviews = row.events.reduce(
    (sum, event) => sum + getHistoryStats(event.question).reviews,
    0
  );
  const zoneLabels = useMemo(() => {
    const labels = {};

    row.events.forEach((event) => {
      const code = getQuestionCode(event.question);
      if (code) labels[code] = answerLabel(event.question);
    });

    return labels;
  }, [row.events]);
  const activeCode = selectedCode || focusedCode;
  const selectedCodes = useMemo(
    () => row.events.map((event) => getQuestionCode(event.question)).filter(Boolean),
    [row.events]
  );
  const highlightedCodes = row.kind === "history" ? selectedCodes : [];
  const dueCodes = row.kind === "scheduled" ? selectedCodes : [];
  const sectionLabel = row.kind === "history"
    ? "Historique"
    : row.events[0]?.dateKey < todayKey
      ? "Due"
      : "À revoir";

  function setRowRef(questionId) {
    return (element) => {
      if (element) {
        rowRefs.current.set(questionId, element);
      } else {
        rowRefs.current.delete(questionId);
      }
    };
  }

  const focusQuestion = useCallback((event) => {
    const code = getQuestionCode(event.question);

    setSelectedCode(code || null);
    onFocusQuestion?.(event.question.id);
  }, [onFocusQuestion]);

  function handleMapSelect(code) {
    const event = row.events.find((candidate) =>
      getQuestionCode(candidate.question) === code
    );

    if (!event) return;

    setSelectedCode(code || null);
    onFocusQuestion?.(event.question.id);
  }

  useEffect(() => {
    setSelectedCode(focusedCode || null);
  }, [focusedCode, row.key]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const questionId = focusedEvent?.question.id;
    const focusedRow = questionId ? rowRefs.current.get(questionId) : null;

    if (!list || !focusedRow) return;

    centerListItem(list, focusedRow);
  }, [focusedEvent?.question.id, row.key]);

  return (
    <div style={{ ...recapStyle, ...(expanded ? expandedRecapStyle : {}) }}>
      {showHeader && (
        <div style={recapHeaderStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={eyebrowStyle}>Récap groupe</div>
            <div style={recapTitleStyle}>{group.name || `Groupe #${row.groupId}`}</div>
            {groupTags.length > 0 && (
              <div style={chipRowStyle}>
                {groupTags.slice(0, 3).map((tag) => (
                  <span key={tag} title={tag} style={tagChipStyle}>#{tag}</span>
                ))}
                {groupTags.length > 3 && (
                  <span style={infoChipStyle}>+{groupTags.length - 3}</span>
                )}
              </div>
            )}
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={closeButtonStyle}
              aria-label="Fermer le récap"
              title="Fermer"
            >
              ×
            </button>
          )}
        </div>
      )}

      <div style={{ ...statsGridStyle, ...(expanded ? expandedStatsGridStyle : {}) }}>
        <div style={{ ...statStyle, ...(expanded ? expandedStatStyle : {}) }}>
          <div style={{ ...statValueStyle, ...(expanded ? expandedStatValueStyle : {}) }}>{questionCount}</div>
          <div style={statLabelStyle}>réponse{questionCount > 1 ? "s" : ""}</div>
        </div>

        <div style={{ ...statStyle, ...(expanded ? expandedStatStyle : {}) }}>
          <div style={{ ...statValueStyle, ...(expanded ? expandedStatValueStyle : {}) }}>{totalReviews}</div>
          <div style={statLabelStyle}>revue{totalReviews > 1 ? "s" : ""}</div>
        </div>

        <div style={{ ...statStyle, ...(expanded ? expandedStatStyle : {}) }}>
          <div style={{ ...statValueStyle, ...(expanded ? expandedStatValueStyle : {}) }}>{sectionLabel}</div>
          <div style={statLabelStyle}>section</div>
        </div>
      </div>

      {hasMapPreview && (
        <div style={{ ...mapPanelStyle, ...(expanded ? expandedMapPanelStyle : {}) }}>
          <SvgMap
            svgPath={mapPath}
            found={highlightedCodes}
            dueItems={dueCodes}
            selected={activeCode}
            focusCode={activeCode}
            zoneLabels={zoneLabels}
            onSelect={handleMapSelect}
          />
        </div>
      )}

      <div
        ref={listRef}
        className="app-scrollbar"
        style={{ ...rowListStyle, ...(expanded ? expandedRowListStyle : {}) }}
      >
        {row.events.map((event) => {
          const question = event.question;
          const historyStats = getHistoryStats(question);
          const isFocused = question.id === focusedEvent?.question.id;
          const shouldShowQuestionTags =
            !["map", "media"].includes(group.type_group) &&
            (question.tags || []).length > 0;

          return (
            <div
              key={event.id}
              ref={setRowRef(question.id)}
              role="button"
              tabIndex={0}
              onClick={() => focusQuestion(event)}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") {
                  return;
                }

                keyboardEvent.preventDefault();
                focusQuestion(event);
              }}
              style={{
                ...answerRowStyle,
                ...(isFocused ? answerRowFocusedStyle : {})
              }}
            >
              <div style={answerTopLineStyle}>
                <div style={answerTitleStyle}>{answerLabel(question)}</div>
                <span
                  style={{
                    ...statusBadgeStyle,
                    color: statusColor(event, todayKey)
                  }}
                >
                  {statusLabel(event, todayKey)}
                </span>
              </div>

              <div style={expanded ? expandedMetaGridStyle : metaGridStyle}>
                <div style={metaBlockStyle}>
                  <span style={metaLabelStyle}>Réussite</span>
                  <span style={metaValueStyle}>
                    {historyStats.reviews > 0
                      ? `${historyStats.successRate}% (${historyStats.reviews})`
                      : "Nouveau"}
                  </span>
                </div>

                <div style={metaBlockStyle}>
                  <span style={metaLabelStyle}>Intervalle</span>
                  <span style={metaValueStyle}>{question.progress?.interval ?? 0} j</span>
                </div>

                <div style={metaBlockStyle}>
                  <span style={metaLabelStyle}>Dernière</span>
                  <span style={metaValueStyle}>
                    {formatDateKey(question.progress?.last_review)}
                  </span>
                </div>

                <div style={metaBlockStyle}>
                  <span style={metaLabelStyle}>Prochaine</span>
                  <span style={metaValueStyle}>
                    {formatDateKey(question.progress?.next_review)}
                  </span>
                </div>
              </div>

              {shouldShowQuestionTags && (
                <div style={chipRowStyle}>
                  {(question.tags || []).slice(0, 3).map((tag) => (
                    <span key={tag} style={tagChipStyle}>#{tag}</span>
                  ))}
                </div>
              )}

              <div style={rowFooterStyle}>
                <span style={idStyle}>Question #{question.id}</span>
                <button
                  type="button"
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    onOpenQuestion?.(question);
                  }}
                  style={manageButtonStyle}
                >
                  Ouvrir dans le gestionnaire ↗
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const recapStyle = {
  background: "#141414",
  border: "1px solid #282828",
  borderRadius: "12px",
  margin: "-2px 0 10px",
  padding: "12px",
  textAlign: "left"
};

const expandedRecapStyle = {
  background: "transparent",
  border: "none",
  borderRadius: 0,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  height: "100%",
  margin: 0,
  minHeight: 0,
  padding: "10px"
};

const recapHeaderStyle = {
  alignItems: "flex-start",
  display: "flex",
  gap: "10px",
  justifyContent: "space-between",
  marginBottom: "12px"
};

const eyebrowStyle = {
  color: "#777",
  fontSize: "10px",
  fontWeight: "800",
  letterSpacing: "0.06em",
  marginBottom: "4px",
  textTransform: "uppercase"
};

const recapTitleStyle = {
  color: "#eee",
  fontSize: "15px",
  fontWeight: "800",
  lineHeight: 1.25,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const closeButtonStyle = {
  alignItems: "center",
  background: "#1d1d1d",
  border: "1px solid #303030",
  borderRadius: "8px",
  color: "#aaa",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "17px",
  height: "28px",
  justifyContent: "center",
  lineHeight: 1,
  padding: 0,
  width: "28px"
};

const statsGridStyle = {
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  marginBottom: "12px"
};

const expandedStatsGridStyle = {
  gap: "6px",
  marginBottom: "8px"
};

const statStyle = {
  background: "#181818",
  border: "1px solid #262626",
  borderRadius: "8px",
  minWidth: 0,
  padding: "9px 10px"
};

const expandedStatStyle = {
  padding: "6px 9px"
};

const statValueStyle = {
  color: "#eee",
  fontSize: "15px",
  fontWeight: "800",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const expandedStatValueStyle = {
  fontSize: "13px"
};

const statLabelStyle = {
  color: "#777",
  fontSize: "10px",
  marginTop: "3px"
};

const mapPanelStyle = {
  background: "#101010",
  border: "1px solid #242424",
  borderRadius: "10px",
  height: "210px",
  marginBottom: "12px",
  overflow: "hidden"
};

const expandedMapPanelStyle = {
  flex: "0 1 clamp(160px, 24vh, 230px)",
  height: "auto",
  marginBottom: "10px",
  minHeight: "150px"
};

const rowListStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  maxHeight: "360px",
  overflow: "auto",
  paddingRight: "2px"
};

const expandedRowListStyle = {
  flex: "1 1 0",
  maxHeight: "none",
  minHeight: 0,
  paddingRight: "4px"
};

const answerRowStyle = {
  background: "#181818",
  border: "1px solid #262626",
  borderLeft: "3px solid transparent",
  borderRadius: "10px",
  color: "#eee",
  cursor: "pointer",
  padding: "10px",
  transition: "border 0.15s ease, background 0.15s ease, box-shadow 0.15s ease"
};

const answerRowFocusedStyle = {
  background: "#1a211d",
  border: "1px solid rgba(126, 226, 168, 0.6)",
  borderLeft: "3px solid rgba(126, 226, 168, 0.8)",
  boxShadow: "0 0 0 3px rgba(126, 226, 168, 0.08)"
};

const answerTopLineStyle = {
  alignItems: "center",
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  marginBottom: "6px"
};

const answerTitleStyle = {
  color: "#f1f1f1",
  fontSize: "13px",
  fontWeight: "800",
  lineHeight: 1.3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const statusBadgeStyle = {
  background: "#222",
  borderRadius: "999px",
  flexShrink: 0,
  fontSize: "10px",
  fontWeight: "800",
  letterSpacing: "0.04em",
  padding: "3px 7px",
  textTransform: "uppercase"
};

const metaGridStyle = {
  display: "grid",
  gap: "7px",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))"
};

const expandedMetaGridStyle = {
  ...metaGridStyle,
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))"
};

const metaBlockStyle = {
  minWidth: 0
};

const metaLabelStyle = {
  color: "#666",
  display: "block",
  fontSize: "10px",
  fontWeight: "800",
  letterSpacing: "0.04em",
  marginBottom: "2px",
  textTransform: "uppercase"
};

const metaValueStyle = {
  color: "#cfcfcf",
  display: "block",
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const chipRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "5px",
  marginTop: "9px"
};

const infoChipStyle = {
  background: "#222",
  borderRadius: "999px",
  color: "#9ca3af",
  fontSize: "10px",
  fontWeight: "700",
  padding: "2px 7px"
};

const tagChipStyle = {
  ...infoChipStyle,
  color: "#999"
};

const rowFooterStyle = {
  alignItems: "center",
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  marginTop: "10px"
};

const idStyle = {
  color: "#666",
  fontSize: "11px"
};

const manageButtonStyle = {
  background: "#202020",
  border: "1px solid #363636",
  borderRadius: "8px",
  color: "#d6d6d6",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: "700",
  padding: "6px 9px"
};
