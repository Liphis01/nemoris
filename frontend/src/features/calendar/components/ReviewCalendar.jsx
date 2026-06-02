import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getQuestionTypeChipStyle,
  questionTypeChipStyles
} from "../../../shared/questionTypes";
import { resolveMediaUrl } from "../../../shared/media";
import CalendarGroupRecap from "./CalendarGroupRecap";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";

const monthFormatter = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric"
});

const weekdayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short"
});

const detailDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric"
});

const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short"
});

const compactDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const calendarTypeOrder = ["text", "map", "timeline", "image"];
const maxCalendarCellTypeBars = 4;

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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

function getNextReview(question) {
  return question.progress?.next_review || question.next_review || null;
}

function isNewQuestion(question) {
  const history = question.progress?.history || [];
  return (question.progress?.reps || 0) === 0 && history.length === 0;
}

function isSuccessfulHistoryEntry(entry) {
  return Number(entry?.quality) > 0;
}

function buildCalendarDays(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - firstWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function dueLabel(question) {
  if (question.group?.name) return question.group.name;
  if (question.type_q === "map") return "Map zone";
  if (question.type_q === "image") return question.answer || "Image";
  if (question.type_q === "timeline") return question.answer || "Timeline";
  return question.answer || "Question";
}

function dueTitle(question) {
  if (question.type_q === "map") {
    return question.answer || question.question || "Zone sans titre";
  }

  if (question.type_q === "image") {
    return question.answer || question.question || "Image sans titre";
  }

  return question.question || "Question sans titre";
}

function getQuestionGroupId(question) {
  const groupId = question?.group_id ?? question?.group?.id;

  if (groupId === null || groupId === undefined || groupId === "") {
    return null;
  }

  return String(groupId);
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

function getEventGroup(event, groupId) {
  return event.question.group || {
    id: groupId,
    name: `Groupe #${groupId}`,
    type_group: event.question.type_q || "groupe",
    media: null,
    tags: ["map", "image"].includes(event.question.type_q)
      ? event.question.tags || []
      : []
  };
}

function groupRowKey(kind, groupId) {
  return `${kind}:group:${groupId}`;
}

function typeBadgeStyle(type) {
  const typeStyle = getQuestionTypeChipStyle(type);

  return {
    background: typeStyle.background,
    color: typeStyle.color,
    borderRadius: "999px",
    padding: "3px 8px",
    fontSize: "10px",
    fontWeight: "800",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    flexShrink: 0
  };
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

function getQuestionReviewStats(question) {
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

function normalizeQuestionType(type) {
  return type || "unknown";
}

function compareQuestionTypes(a, b) {
  const aRank = calendarTypeOrder.indexOf(a);
  const bRank = calendarTypeOrder.indexOf(b);

  if (aRank !== -1 || bRank !== -1) {
    if (aRank === -1) return 1;
    if (bRank === -1) return -1;
    return aRank - bRank;
  }

  return a.localeCompare(b);
}

function buildTypeSummaries(events) {
  const total = events.length;
  const counts = new Map();

  for (const event of events) {
    const type = normalizeQuestionType(event.question.type_q);
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => compareQuestionTypes(a, b))
    .map(([type, count]) => ({
      type,
      count,
      ratio: total > 0 ? count / total : 0
    }));
}

function compareTypeSummariesBySize(a, b) {
  if (b.count !== a.count) return b.count - a.count;
  return compareQuestionTypes(a.type, b.type);
}

function calendarTypeLabel(type) {
  return questionTypeChipStyles[type]?.label || type;
}

function calendarTypeHelperLabel(type, count) {
  if (type === "map") return count > 1 ? "maps" : "map";
  if (type === "text") return "text";
  if (type === "timeline") return count > 1 ? "timelines" : "timeline";

  const label = calendarTypeLabel(type).toLowerCase();
  return count > 1 ? `${label}s` : label;
}

function barSummaryLabel(typeSummaries) {
  return typeSummaries
    .map(({ type, count }) => `${count} ${calendarTypeHelperLabel(type, count)}`)
    .join("\n");
}

function addEvent(result, event) {
  if (!result[event.dateKey]) result[event.dateKey] = [];
  result[event.dateKey].push(event);
}

function eventSortValue(event, sortMode) {
  const question = event.question;

  if (sortMode === "title") {
    return [
      dueTitle(question),
      question.group?.name || "",
      question.type_q || "",
      String(question.id)
    ].join("|").toLowerCase();
  }

  if (sortMode === "quality") {
    const qualityRank = event.kind === "history"
      ? event.history?.quality ?? 9
      : event.dateKey;

    return [
      String(qualityRank),
      dueTitle(question),
      String(question.id)
    ].join("|").toLowerCase();
  }

  if (sortMode === "id") {
    return String(question.id).padStart(8, "0");
  }

  return [
    question.type_q || "",
    question.group?.name || "",
    dueTitle(question),
    String(question.id)
  ].join("|").toLowerCase();
}

function compareEvents(a, b, sortMode) {
  return eventSortValue(a, sortMode).localeCompare(eventSortValue(b, sortMode));
}

function findQuestionEvent(events, questionId) {
  if (!questionId) return null;
  return events.find((event) => event.question.id === questionId) || null;
}

function buildDisplayRows(events) {
  const rows = [];
  const groupRows = new Map();

  for (const event of events) {
    const groupId = getQuestionGroupId(event.question);

    if (!groupId) {
      rows.push({
        type: "question",
        key: event.id,
        event
      });
      continue;
    }

    const key = groupRowKey(event.kind, groupId);
    let row = groupRows.get(key);

    if (!row) {
      row = {
        type: "group",
        key,
        id: key,
        kind: event.kind,
        groupId,
        group: getEventGroup(event, groupId),
        tags: [],
        events: []
      };
      groupRows.set(key, row);
      rows.push(row);
    }

    row.events.push(event);
    row.tags = mergeTags(
      row.tags,
      row.group?.tags,
      ["map", "image"].includes(event.question.type_q)
        ? event.question.tags
        : []
    );
  }

  return rows;
}

function SectionHeader({ count, label }) {
  if (count === 0) return null;

  return (
    <div
      style={{
        alignItems: "center",
        color: "#666",
        display: "flex",
        fontSize: "10px",
        fontWeight: "800",
        gap: "8px",
        letterSpacing: "0.06em",
        lineHeight: 1,
        margin: "7px 2px 6px",
        textTransform: "uppercase"
      }}
    >
      <span>{label}</span>
      <span
        style={{
          color: "#555",
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {count}
      </span>
      <span
        style={{
          background: "#2a2a2a",
          flex: 1,
          height: "1px"
        }}
      />
    </div>
  );
}

function EventCard({
  cardRef,
  event,
  isSelected,
  onOpenQuestion,
  onSelectQuestion,
  todayKey
}) {
  const question = event.question;
  const isHistory = event.kind === "history";
  const mediaSrc = resolveMediaUrl(question.media);
  const tags = question.tags || [];
  const visibleTags = isSelected ? tags : tags.slice(0, 3);
  const reviewStats = getQuestionReviewStats(question);
  const reviewLabel = reviewStats.reviews > 0
    ? `${reviewStats.successRate}% (${reviewStats.reviews})`
    : "Nouveau";

  function selectQuestion() {
    onSelectQuestion?.(question.id);
  }

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={selectQuestion}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.target !== keyboardEvent.currentTarget) return;
        if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;

        keyboardEvent.preventDefault();
        selectQuestion();
      }}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: isSelected ? "13px 14px" : "11px 12px",
        borderRadius: "12px",
        border: isSelected
          ? "1px solid rgba(126, 226, 168, 0.85)"
          : isHistory
            ? "1px solid #242424"
            : "1px solid #262626",
        background: isSelected
          ? "rgba(22, 53, 36, 0.72)"
          : isHistory
            ? "#141414"
            : "#151515",
        color: "inherit",
        boxShadow: isSelected
          ? "0 0 0 4px rgba(126, 226, 168, 0.1), 0 0 24px rgba(126, 226, 168, 0.14)"
          : "none",
        cursor: "pointer",
        marginBottom: "8px",
        textAlign: "left",
        font: "inherit",
        transition: "border 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, padding 0.16s ease"
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gap: "8px",
          alignItems: "center",
          marginBottom: "7px"
        }}
      >
        <span style={typeBadgeStyle(question.type_q)}>
          {question.type_q || "text"}
        </span>

        <span
          style={{
            color: "#777",
            fontSize: "12px",
            lineHeight: 1.3,
            overflow: isSelected ? "visible" : "hidden",
            textOverflow: isSelected ? "clip" : "ellipsis",
            whiteSpace: isSelected ? "normal" : "nowrap"
          }}
        >
          {dueLabel(question)}
        </span>

        <span
          style={{
            background: isHistory ? "#222" : "#2b2047",
            color: isHistory
              ? historyColor(event.history?.quality)
              : "#b69cff",
            borderRadius: "999px",
            padding: "3px 8px",
            fontSize: "10px",
            fontWeight: "800",
            letterSpacing: "0.04em",
            textTransform: "uppercase"
          }}
        >
          {isHistory
            ? historyLabel(event.history?.quality)
            : event.dateKey < todayKey
              ? "Due"
              : "À revoir"}
        </span>
      </div>

      <div
        style={{
          display: mediaSrc ? "grid" : "block",
          gridTemplateColumns: mediaSrc
            ? isSelected
              ? "minmax(0, 1fr) 58px"
              : "minmax(0, 1fr) 48px"
            : undefined,
          gap: mediaSrc ? "10px" : undefined,
          alignItems: isSelected ? "start" : "center"
        }}
      >
        <div
          style={{
            color: "#eee",
            fontSize: "14px",
            fontWeight: "700",
            lineHeight: 1.35,
            overflow: isSelected ? "visible" : "hidden",
            textOverflow: isSelected ? "clip" : "ellipsis",
            whiteSpace: isSelected ? "normal" : "nowrap"
          }}
        >
          {dueTitle(question)}
        </div>

        {mediaSrc && (
          <img
            src={mediaSrc}
            alt=""
            style={{
              width: isSelected ? "58px" : "48px",
              height: isSelected ? "46px" : "38px",
              borderRadius: "7px",
              border: "1px solid #2d2d2d",
              objectFit: "cover",
              background: "#101010"
            }}
          />
        )}
      </div>

      {mediaSrc && isSelected && (
        <img
          src={mediaSrc}
          alt=""
          style={{
            width: "100%",
            maxHeight: "260px",
            objectFit: "contain",
            borderRadius: "10px",
            border: "1px solid #2d2d2d",
            background: "#101010",
            marginTop: "10px"
          }}
        />
      )}

      {isSelected && (
        <div style={cardMetaGridStyle}>
          <div style={cardMetaBlockStyle}>
            <span style={cardMetaLabelStyle}>Réussite</span>
            <span style={cardMetaValueStyle}>{reviewLabel}</span>
          </div>

          <div style={cardMetaBlockStyle}>
            <span style={cardMetaLabelStyle}>Intervalle</span>
            <span style={cardMetaValueStyle}>{question.progress?.interval ?? 0} j</span>
          </div>

          <div style={cardMetaBlockStyle}>
            <span style={cardMetaLabelStyle}>Dernière</span>
            <span style={cardMetaValueStyle}>
              {formatDateKey(question.progress?.last_review)}
            </span>
          </div>

          <div style={cardMetaBlockStyle}>
            <span style={cardMetaLabelStyle}>Prochaine</span>
            <span style={cardMetaValueStyle}>
              {formatDateKey(question.progress?.next_review)}
            </span>
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "5px",
            marginTop: "8px"
          }}
        >
          {visibleTags.map((tag) => (
            <span
              key={tag}
              style={{
                background: "#2a2a2a",
                color: "#999",
                borderRadius: "999px",
                padding: "2px 7px",
                fontSize: "10px",
                fontWeight: "700"
              }}
            >
              #{tag}
            </span>
          ))}
          {!isSelected && tags.length > visibleTags.length && (
            <span style={tagOverflowStyle}>+{tags.length - visibleTags.length}</span>
          )}
        </div>
      )}

      <div style={cardFooterStyle}>
        <span style={cardHintStyle}>Question #{question.id}</span>
        <button
          type="button"
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            onOpenQuestion?.(question);
          }}
          style={cardActionButtonStyle}
        >
          Gérer dans Manage ↗
        </button>
      </div>
    </div>
  );
}

function groupStatusLabel(row, todayKey) {
  if (row.kind === "history") {
    const labels = new Set(
      row.events.map((event) => historyLabel(event.history?.quality))
    );

    if (labels.size === 1) {
      return [...labels][0];
    }

    return "Historique";
  }

  return row.events[0]?.dateKey < todayKey ? "Due" : "À revoir";
}

function groupStatusColor(row, todayKey) {
  if (row.kind === "history") {
    const qualities = new Set(
      row.events.map((event) => event.history?.quality)
    );

    if (qualities.size === 1) {
      return historyColor([...qualities][0]);
    }

    return "#8f9aa3";
  }

  return row.events[0]?.dateKey < todayKey ? "#ff9c9c" : "#b69cff";
}

function GroupEventCard({
  cardRef,
  isSelected,
  onOpenGroup,
  row,
  todayKey
}) {
  const group = row.group || {};
  const groupType = group.type_group || row.events[0]?.question.type_q || "groupe";
  const tags = row.tags || group.tags || [];

  return (
    <div
      ref={cardRef}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "11px 12px",
        borderRadius: "12px",
        border: isSelected
          ? "1px solid rgba(126, 226, 168, 0.85)"
          : "1px solid #262626",
        background: isSelected ? "rgba(22, 53, 36, 0.72)" : "#151515",
        color: "inherit",
        boxShadow: isSelected
          ? "0 0 0 4px rgba(126, 226, 168, 0.1), 0 0 24px rgba(126, 226, 168, 0.14)"
          : "none",
        marginBottom: "8px",
        textAlign: "left",
        font: "inherit",
        transition: "border 0.16s ease, background 0.16s ease, box-shadow 0.16s ease"
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gap: "8px",
          alignItems: "center",
          marginBottom: "7px"
        }}
      >
        <span style={typeBadgeStyle(groupType)}>
          {groupType}
        </span>

        <span
          style={{
            color: "#777",
            fontSize: "12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {row.events.length} réponse{row.events.length > 1 ? "s" : ""}
        </span>

        <span
          style={{
            background: "#222",
            color: groupStatusColor(row, todayKey),
            borderRadius: "999px",
            padding: "3px 8px",
            fontSize: "10px",
            fontWeight: "800",
            letterSpacing: "0.04em",
            textTransform: "uppercase"
          }}
        >
          {groupStatusLabel(row, todayKey)}
        </span>
      </div>

      <div
        style={{
          color: "#eee",
          fontSize: "14px",
          fontWeight: "800",
          lineHeight: 1.35,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {group.name || `Groupe #${row.groupId}`}
      </div>

      {tags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "5px",
            marginTop: "8px"
          }}
        >
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              title={tag}
              style={{
                background: "#242424",
                borderRadius: "999px",
                color: "#999",
                fontSize: "10px",
                fontWeight: "700",
                maxWidth: "82px",
                overflow: "hidden",
                padding: "2px 7px",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              #{tag}
            </span>
          ))}
          {tags.length > 3 && (
            <span
              style={{
                color: "#666",
                fontSize: "10px",
                fontWeight: "700"
              }}
            >
              +{tags.length - 3}
            </span>
          )}
        </div>
      )}

      <div style={groupSummaryStyle}>
        {row.events.length} réponse{row.events.length > 1 ? "s" : ""} dans ce groupe
      </div>

      <div style={cardFooterStyle}>
        <span style={cardHintStyle}>Groupe #{row.groupId}</span>
        <button
          type="button"
          onClick={() => onOpenGroup?.(row)}
          style={cardActionButtonStyle}
        >
          Récap
        </button>
      </div>
    </div>
  );
}

export default function ReviewCalendar({
  setMode,
  questions,
  onOpenQuestion,
  openQuestionId,
  clearOpenQuestionId
}) {
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const calendarCardRef = useRef(null);
  const detailListRef = useRef(null);
  const highlightedQuestionRef = useRef(null);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [selectedCalendarQuestionId, setSelectedCalendarQuestionId] = useState(null);
  const [activeGroupKey, setActiveGroupKey] = useState(null);
  const [sortMode, setSortMode] = useState("type");
  const [calendarCardHeight, setCalendarCardHeight] = useState(null);

  const newQuestions = useMemo(
    () => questions.filter(isNewQuestion),
    [questions]
  );

  const scheduledEvents = useMemo(
    () => questions
      .filter((question) => !isNewQuestion(question))
      .map((question) => ({
        id: `scheduled-${question.id}`,
        dateKey: getNextReview(question),
        kind: "scheduled",
        question
      }))
      .filter((event) => event.dateKey)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    [questions]
  );

  const historyEvents = useMemo(
    () => questions.flatMap((question) =>
      (question.progress?.history || [])
        .filter((entry) => entry.reviewed_on)
        .filter(isSuccessfulHistoryEntry)
        .map((entry, index) => ({
          id: `history-${question.id}-${entry.reviewed_on}-${index}`,
          dateKey: entry.reviewed_on,
          kind: "history",
          question,
          history: entry
        }))
    ).sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    [questions]
  );

  const eventsByDate = useMemo(() => {
    const result = {};

    for (const event of historyEvents) {
      addEvent(result, event);
    }

    for (const event of scheduledEvents) {
      addEvent(result, event);
    }

    for (const events of Object.values(result)) {
      events.sort((a, b) => {
        if (a.kind === b.kind) return a.question.id - b.question.id;
        return a.kind === "history" ? -1 : 1;
      });
    }

    return result;
  }, [historyEvents, scheduledEvents]);

  const monthDays = useMemo(
    () => buildCalendarDays(visibleMonth),
    [visibleMonth]
  );

  const selectedDate = parseDateKey(selectedDateKey) || today;
  const selectedEvents = eventsByDate[selectedDateKey] || [];
  const selectedScheduledEvents = selectedEvents
    .filter((event) => event.kind === "scheduled")
    .sort((a, b) => compareEvents(a, b, sortMode));
  const selectedHistoryEvents = selectedEvents
    .filter((event) => event.kind === "history")
    .sort((a, b) => compareEvents(a, b, sortMode));
  const selectedScheduledRows = buildDisplayRows(selectedScheduledEvents);
  const selectedHistoryRows = buildDisplayRows(selectedHistoryEvents);
  const activeGroupRow = [...selectedScheduledRows, ...selectedHistoryRows]
    .find((row) => row.type === "group" && row.key === activeGroupKey);
  const activeGroupTags = activeGroupRow?.tags || activeGroupRow?.group?.tags || [];
  const selectedHistoryCount = selectedHistoryEvents.length;
  const selectedScheduledCount = selectedScheduledEvents.length;
  const overdueCount = scheduledEvents.filter(
    (event) => event.dateKey < todayKey
  ).length;
  const todayCount = (eventsByDate[todayKey] || []).filter(
    (event) => event.kind === "scheduled"
  ).length;
  const upcomingCount = scheduledEvents.filter(
    (event) => event.dateKey > todayKey
  ).length;
  const nextScheduledEvent = scheduledEvents.find(
    (event) => event.dateKey >= todayKey
  );
  const calendarLegendTypes = useMemo(() => {
    const types = new Set(calendarTypeOrder);

    for (const event of scheduledEvents) {
      types.add(normalizeQuestionType(event.question.type_q));
    }

    for (const event of historyEvents) {
      types.add(normalizeQuestionType(event.question.type_q));
    }

    return Array.from(types).sort(compareQuestionTypes);
  }, [historyEvents, scheduledEvents]);
  const selectedPanelLabel = selectedDateKey < todayKey
    ? "Historique"
    : selectedDateKey === todayKey
      ? "Aujourd'hui"
      : "À venir";

  useLayoutEffect(() => {
    const calendarCard = calendarCardRef.current;
    if (!calendarCard) return undefined;

    function updateCalendarCardHeight() {
      const nextHeight = Math.ceil(calendarCard.getBoundingClientRect().height);
      setCalendarCardHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      );
    }

    updateCalendarCardHeight();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateCalendarCardHeight);
      observer.observe(calendarCard);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateCalendarCardHeight);
    return () => window.removeEventListener("resize", updateCalendarCardHeight);
  }, []);

  useEffect(() => {
    if (!openQuestionId) return;

    const event = scheduledEvents.find(
      (item) => item.question.id === openQuestionId
    );

    if (!event?.dateKey) return;

    const dueDate = parseDateKey(event.dateKey);
    if (!dueDate) return;

    setVisibleMonth(new Date(dueDate.getFullYear(), dueDate.getMonth(), 1));
    setSelectedDateKey(event.dateKey);
    setSelectedCalendarQuestionId(event.question.id);
    const groupId = getQuestionGroupId(event.question);
    setActiveGroupKey(groupId ? groupRowKey(event.kind, groupId) : null);
    clearOpenQuestionId?.();
  }, [clearOpenQuestionId, openQuestionId, scheduledEvents]);

  useEffect(() => {
    if (!activeGroupKey || activeGroupRow) return;

    setActiveGroupKey(null);
    setSelectedCalendarQuestionId(null);
  }, [activeGroupKey, activeGroupRow]);

  useLayoutEffect(() => {
    if (!selectedCalendarQuestionId || activeGroupKey) return;

    const detailList = detailListRef.current;
    const highlightedQuestion = highlightedQuestionRef.current;
    if (!detailList || !highlightedQuestion) return;

    const listRect = detailList.getBoundingClientRect();
    const questionRect = highlightedQuestion.getBoundingClientRect();
    const nextTop =
      detailList.scrollTop +
      questionRect.top -
      listRect.top -
      detailList.clientHeight / 2 +
      highlightedQuestion.offsetHeight / 2;

    detailList.scrollTo({
      top: Math.max(0, nextTop),
      behavior: "smooth"
    });
  }, [activeGroupKey, selectedDateKey, selectedCalendarQuestionId]);

  function moveMonth(offset) {
    setVisibleMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)
    );
  }

  function selectToday() {
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    selectDate(todayKey);
  }

  function selectDate(dateKey) {
    const matchingEvent = findQuestionEvent(
      eventsByDate[dateKey] || [],
      selectedCalendarQuestionId
    );

    setSelectedDateKey(dateKey);

    if (matchingEvent) {
      const groupId = getQuestionGroupId(matchingEvent.question);
      setActiveGroupKey(groupId ? groupRowKey(matchingEvent.kind, groupId) : null);
      return;
    }

    setSelectedCalendarQuestionId(null);
    setActiveGroupKey(null);
  }

  function selectQuestionCard(questionId) {
    setSelectedCalendarQuestionId((currentQuestionId) =>
      currentQuestionId === questionId ? null : questionId
    );
    setActiveGroupKey(null);
  }

  function openGroupRow(row) {
    setActiveGroupKey(row.key);
    setSelectedCalendarQuestionId(row.events[0]?.question.id ?? null);
  }

  function renderDisplayRow(row) {
    if (row.type === "question") {
      return (
        <EventCard
          key={row.key}
          cardRef={
            selectedCalendarQuestionId === row.event.question.id
              ? highlightedQuestionRef
              : null
          }
          event={row.event}
          isSelected={selectedCalendarQuestionId === row.event.question.id}
          onOpenQuestion={onOpenQuestion}
          onSelectQuestion={selectQuestionCard}
          todayKey={todayKey}
        />
      );
    }

    const selectedInside = row.events.some(
      (event) => selectedCalendarQuestionId === event.question.id
    );
    const isSelected = activeGroupKey === row.key || selectedInside;

    return (
      <GroupEventCard
        key={row.key}
        cardRef={isSelected ? highlightedQuestionRef : null}
        isSelected={isSelected}
        onOpenGroup={openGroupRow}
        row={row}
        todayKey={todayKey}
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "#eee",
        padding: "30px 24px 70px",
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          maxWidth: activeGroupRow ? "1480px" : "1240px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "22px"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "20px"
          }}
        >
          <div>
            <div
              style={{
                color: "#666",
                fontSize: "12px",
                letterSpacing: "0.08em",
                fontWeight: "700",
                marginBottom: "8px"
              }}
            >
              REVIEW CALENDAR
            </div>

            <h1
              style={{
                margin: 0,
                fontSize: "38px",
                lineHeight: 1,
                marginBottom: "12px",
                color: "#eee",
                fontWeight: "800"
              }}
            >
              Calendrier
            </h1>
          </div>

          <ReturnToMenuButton
            onClick={() => setMode("menu")}
            style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              color: "#bbb",
              padding: "10px 14px",
              borderRadius: "10px",
              cursor: "pointer",
              fontSize: "14px"
            }}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "12px"
          }}
        >
          {[
            ["En retard", overdueCount, "#ff9c9c", "#3a1d1d"],
            ["Nouvelles", newQuestions.length, "#b69cff", "#1d1827"],
            ["Aujourd'hui", todayCount, "#ffcc7a", "#3d2b14"],
            ["À venir", upcomingCount, "#7ee2a8", "#163524"]
          ].map(([label, value, color, background]) => (
            <div
              key={label}
              style={{
                background,
                border: `1px solid ${color}33`,
                borderRadius: "14px",
                padding: "14px 16px",
                textAlign: "left"
              }}
            >
              <div
                style={{
                  color,
                  fontSize: "11px",
                  fontWeight: "800",
                  letterSpacing: "0.06em",
                  marginBottom: "6px",
                  textTransform: "uppercase"
                }}
              >
                {label}
              </div>
              <div
                style={{
                  color: "#eee",
                  fontSize: "24px",
                  fontWeight: "800",
                  lineHeight: 1
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: activeGroupRow
              ? "minmax(0, 1fr) minmax(520px, 0.72fr)"
              : "minmax(0, 1fr) 420px",
            gap: "18px",
            alignItems: "start"
          }}
        >
          <div
            ref={calendarCardRef}
            style={{
              background: "#181818",
              border: "1px solid #262626",
              borderRadius: "16px",
              overflow: "hidden"
            }}
          >
            <div
              style={{
                padding: "16px",
                borderBottom: "1px solid #262626",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px"
              }}
            >
              <button
                onClick={() => moveMonth(-1)}
                style={navButtonStyle}
                title="Mois précédent"
              >
                ←
              </button>

              <div
                style={{
                  fontSize: "18px",
                  fontWeight: "800",
                  textTransform: "capitalize"
                }}
              >
                {monthFormatter.format(visibleMonth)}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "8px"
                }}
              >
                <button onClick={selectToday} style={smallButtonStyle}>
                  Aujourd'hui
                </button>
                <button
                  onClick={() => moveMonth(1)}
                  style={navButtonStyle}
                  title="Mois suivant"
                >
                  →
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                borderBottom: "1px solid #262626"
              }}
            >
              {monthDays.slice(0, 7).map((date) => (
                <div
                  key={weekdayFormatter.format(date)}
                  style={{
                    padding: "10px 12px",
                    color: "#777",
                    fontSize: "11px",
                    fontWeight: "800",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    textAlign: "left"
                  }}
                >
                  {weekdayFormatter.format(date)}
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))"
              }}
            >
              {monthDays.map((date) => {
                const dateKey = toDateKey(date);
                const dayEvents = eventsByDate[dateKey] || [];
                const historyEventsForDay = dayEvents.filter(
                  (event) => event.kind === "history"
                );
                const scheduledEventsForDay = dayEvents.filter(
                  (event) => event.kind === "scheduled"
                );
                const historyCount = historyEventsForDay.length;
                const scheduledCount = scheduledEventsForDay.length;
                const scheduledTypeSummaries = buildTypeSummaries(scheduledEventsForDay);
                const historyTypeSummaries = buildTypeSummaries(historyEventsForDay);
                const displayedTypeSummaries = scheduledCount > 0
                  ? scheduledTypeSummaries
                  : historyTypeSummaries;
                const rankedTypeSummaries = [...displayedTypeSummaries]
                  .sort(compareTypeSummariesBySize);
                const showHistoryMarker = scheduledCount > 0 && historyCount > 0;
                const maxVisibleTypeBars = showHistoryMarker
                  ? maxCalendarCellTypeBars - 1
                  : maxCalendarCellTypeBars;
                const visibleTypeSummaries = rankedTypeSummaries
                  .slice(0, maxVisibleTypeBars);
                const hiddenTypeCount = rankedTypeSummaries
                  .slice(maxVisibleTypeBars)
                  .reduce((total, summary) => total + summary.count, 0);
                const summaryLabel = barSummaryLabel(visibleTypeSummaries);
                const mediaCount = dayEvents.filter((event) =>
                  Boolean(resolveMediaUrl(event.question.media))
                ).length;
                const fullSummaryLabel = [
                  summaryLabel,
                  mediaCount > 0
                    ? `${mediaCount} image${mediaCount > 1 ? "s" : ""}`
                    : ""
                ].filter(Boolean).join("\n");
                const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
                const isToday = dateKey === todayKey;
                const isSelected = dateKey === selectedDateKey;
                const isPast = dateKey < todayKey;
                const hasEvents = dayEvents.length > 0;
                const containsSelectedQuestion = Boolean(
                  findQuestionEvent(dayEvents, selectedCalendarQuestionId)
                );
                const selectedQuestionHint = containsSelectedQuestion
                  ? "Contient la question sélectionnée"
                  : "";
                const cellBackground = isToday
                  ? isSelected
                    ? "#332512"
                    : "#241d12"
                  : isSelected
                    ? "#252525"
                    : isPast
                      ? "#151515"
                      : "#181818";
                const highlightedCellBackground = containsSelectedQuestion
                  ? `linear-gradient(rgba(126, 226, 168, 0.12), rgba(126, 226, 168, 0.12)), ${cellBackground}`
                  : cellBackground;
                const cellBoxShadow = isToday
                  ? isSelected
                    ? "inset 0 0 0 2px #ffcc7a, 0 0 0 1px rgba(255, 204, 122, 0.24)"
                    : "inset 0 0 0 1px rgba(255, 204, 122, 0.72), 0 0 18px rgba(255, 204, 122, 0.08)"
                  : isSelected
                    ? "inset 0 0 0 1px #3a3a3a"
                    : "none";
                const highlightedCellBoxShadow = [
                  containsSelectedQuestion
                    ? "inset 0 0 0 3px rgba(126, 226, 168, 0.9), 0 0 0 1px rgba(126, 226, 168, 0.16)"
                    : "",
                  cellBoxShadow === "none" ? "" : cellBoxShadow
                ].filter(Boolean).join(", ") || "none";
                const cellTitle = [
                  selectedQuestionHint,
                  fullSummaryLabel
                ].filter(Boolean).join("\n");
                const cellAriaDetails = [
                  fullSummaryLabel,
                  selectedQuestionHint
                ].filter(Boolean).join(". ");

                return (
                  <button
                    key={dateKey}
                    onClick={() => selectDate(dateKey)}
                    title={cellTitle || undefined}
                    aria-label={`${date.getDate()} ${monthFormatter.format(date)}${cellAriaDetails ? `. ${cellAriaDetails}` : ""}`}
                    style={{
                      minHeight: "96px",
                      padding: "10px",
                      border: "none",
                      borderRight: "1px solid #242424",
                      borderBottom: "1px solid #242424",
                      background: highlightedCellBackground,
                      color: isCurrentMonth
                        ? isPast
                          ? "#aaa"
                          : "#eee"
                        : "#555",
                      cursor: "pointer",
                      textAlign: "left",
                      boxShadow: highlightedCellBoxShadow,
                      transition: "background 0.12s ease, box-shadow 0.12s ease"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "6px",
                        marginBottom: "10px"
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: isToday ? "800" : "700",
                          color: isToday ? "#ffcc7a" : undefined
                        }}
                      >
                        {date.getDate()}
                      </span>

                      {hasEvents && (
                        <span
                          style={{
                            minWidth: "22px",
                            height: "22px",
                            borderRadius: "999px",
                            background: scheduledCount > 0
                              ? isPast
                                ? "#3a1d1d"
                                : "#2b2047"
                              : "#252525",
                            color: scheduledCount > 0
                              ? isPast
                                ? "#ff9c9c"
                                : "#b69cff"
                              : "#8f9aa3",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            fontWeight: "800"
                          }}
                        >
                          {scheduledCount > 0 ? scheduledCount : historyCount}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "5px"
                      }}
                    >
                      {visibleTypeSummaries.map(({ type, count, ratio }) => {
                        const typeStyle = getQuestionTypeChipStyle(type);

                        return (
                          <div
                            key={type}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "5px",
                              opacity: isCurrentMonth ? 1 : 0.42
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                height: "6px",
                                borderRadius: "999px",
                                background: "#242424",
                                overflow: "hidden",
                                position: "relative"
                              }}
                            >
                              <span
                                style={{
                                  display: "block",
                                  width: `${Math.max(8, Math.round(ratio * 100))}%`,
                                  height: "100%",
                                  borderRadius: "999px",
                                  background: typeStyle.color,
                                  opacity: isCurrentMonth ? 0.86 : 0.55
                                }}
                              />
                            </span>

                            <span
                              style={{
                                color: typeStyle.color,
                                fontSize: "10px",
                                fontWeight: "800",
                                lineHeight: 1,
                                minWidth: "16px",
                                textAlign: "right"
                              }}
                            >
                              {count}
                            </span>
                          </div>
                        );
                      })}

                      {hiddenTypeCount > 0 && (
                        <div
                          style={{
                            color: isCurrentMonth ? "#666" : "#4f4f4f",
                            fontSize: "10px",
                            fontWeight: "700",
                            lineHeight: 1
                          }}
                        >
                          +{hiddenTypeCount}
                        </div>
                      )}

                      {showHistoryMarker && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                            marginTop: scheduledCount > 0 ? "2px" : 0,
                            color: isCurrentMonth ? "#737b83" : "#4f565c",
                            fontSize: "10px",
                            fontWeight: "700",
                            lineHeight: 1,
                            opacity: scheduledCount > 0 ? 0.72 : 0.9
                          }}
                        >
                          <span
                            style={{
                              width: "18px",
                              height: "4px",
                              borderRadius: "999px",
                              background: "#8f9aa3",
                              opacity: isCurrentMonth ? 0.36 : 0.18
                            }}
                          />
                          <span>
                            {historyCount} revu{historyCount > 1 ? "s" : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                borderTop: "1px solid #262626",
                display: "flex",
                flexWrap: "wrap",
                gap: "10px 14px",
                padding: "10px 12px"
              }}
            >
              {calendarLegendTypes.map((type) => {
                const typeStyle = getQuestionTypeChipStyle(type);

                return (
                  <div
                    key={type}
                    style={{
                      alignItems: "center",
                      color: "#8f8f8f",
                      display: "inline-flex",
                      fontSize: "11px",
                      fontWeight: "700",
                      gap: "6px",
                      lineHeight: 1
                    }}
                  >
                    <span
                      style={{
                        background: typeStyle.color,
                        borderRadius: "999px",
                        height: "6px",
                        width: "22px"
                      }}
                    />
                    <span>{calendarTypeLabel(type)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            style={{
              background: "#181818",
              border: "1px solid #262626",
              borderRadius: "16px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              height: calendarCardHeight ? `${calendarCardHeight}px` : undefined,
              maxHeight: calendarCardHeight ? `${calendarCardHeight}px` : undefined,
              minHeight: 0,
              overflow: "hidden",
              position: "sticky",
              top: "24px"
            }}
          >
            <div
              style={{
                padding: "16px",
                borderBottom: "1px solid #262626",
                textAlign: "left"
              }}
            >
              {activeGroupRow ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "14px"
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: "#7ee2a8",
                        fontSize: "11px",
                        fontWeight: "800",
                        letterSpacing: "0.06em",
                        marginBottom: "8px",
                        textTransform: "uppercase"
                      }}
                    >
                      Récap groupe
                    </div>

                    <div
                      style={{
                        fontSize: "22px",
                        fontWeight: "800",
                        lineHeight: 1.15,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {activeGroupRow.group?.name || `Groupe #${activeGroupRow.groupId}`}
                    </div>

                    {activeGroupTags.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "5px",
                          marginTop: "8px"
                        }}
                      >
                        {activeGroupTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            title={tag}
                            style={{
                              background: "#242424",
                              borderRadius: "999px",
                              color: "#999",
                              fontSize: "10px",
                              fontWeight: "700",
                              maxWidth: "92px",
                              overflow: "hidden",
                              padding: "2px 7px",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}
                          >
                            #{tag}
                          </span>
                        ))}
                        {activeGroupTags.length > 3 && (
                          <span
                            style={{
                              color: "#666",
                              fontSize: "10px",
                              fontWeight: "700"
                            }}
                          >
                            +{activeGroupTags.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    <div
                      style={{
                        color: "#777",
                        fontSize: "13px",
                        marginTop: "8px"
                      }}
                    >
                      {detailDateFormatter.format(selectedDate)} · {activeGroupRow.events.length} réponse{activeGroupRow.events.length > 1 ? "s" : ""}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveGroupKey(null);
                    }}
                    style={backButtonStyle}
                  >
                    Retour à la liste
                  </button>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      color: selectedDateKey < todayKey ? "#8f9aa3" : "#777",
                      fontSize: "11px",
                      fontWeight: "800",
                      letterSpacing: "0.06em",
                      marginBottom: "8px",
                      textTransform: "uppercase"
                    }}
                  >
                    {selectedPanelLabel}
                  </div>

                  <div
                    style={{
                      fontSize: "22px",
                      fontWeight: "800",
                      lineHeight: 1.15,
                      textTransform: "capitalize"
                    }}
                  >
                    {detailDateFormatter.format(selectedDate)}
                  </div>

                  <div
                    style={{
                      color: "#777",
                      fontSize: "13px",
                      marginTop: "8px"
                    }}
                  >
                    {selectedHistoryCount > 0 && (
                      <>{selectedHistoryCount} revue{selectedHistoryCount > 1 ? "s" : ""}</>
                    )}
                    {selectedHistoryCount > 0 && selectedScheduledCount > 0 && " · "}
                    {selectedScheduledCount > 0 && (
                      <>{selectedScheduledCount} échéance{selectedScheduledCount > 1 ? "s" : ""}</>
                    )}
                    {selectedEvents.length === 0 && "Aucune activité"}
                  </div>

                  {selectedEvents.length > 1 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginTop: "12px"
                      }}
                    >
                      <span
                        style={{
                          color: "#666",
                          fontSize: "11px",
                          fontWeight: "800",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase"
                        }}
                      >
                        Trier
                      </span>
                      <select
                        value={sortMode}
                        onChange={(event) => setSortMode(event.target.value)}
                        style={{
                          flex: 1,
                          background: "#111",
                          border: "1px solid #2f2f2f",
                          borderRadius: "10px",
                          color: "#ccc",
                          cursor: "pointer",
                          fontSize: "12px",
                          outline: "none",
                          padding: "8px 10px"
                        }}
                      >
                        <option value="type">Type / groupe</option>
                        <option value="title">Titre</option>
                        <option value="quality">Résultat</option>
                        <option value="id">ID</option>
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>

            {activeGroupRow ? (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "hidden"
                }}
              >
                <CalendarGroupRecap
                  expanded
                  focusedQuestionId={selectedCalendarQuestionId}
                  onFocusQuestion={setSelectedCalendarQuestionId}
                  onOpenQuestion={onOpenQuestion}
                  row={activeGroupRow}
                  showHeader={false}
                  todayKey={todayKey}
                />
              </div>
            ) : (
              <div
                className="app-scrollbar"
                ref={detailListRef}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
                  scrollbarGutter: "stable",
                  padding: "10px"
                }}
              >
                {selectedEvents.length === 0 ? (
                  <div
                    style={{
                      padding: "40px 18px",
                      color: "#777",
                      textAlign: "center",
                      fontSize: "14px",
                      lineHeight: 1.5
                    }}
                  >
                    Rien dans l'historique ou les échéances pour cette journée.
                  </div>
                ) : (
                  <>
                    <SectionHeader
                      count={selectedScheduledEvents.length}
                      label="À revoir"
                    />

                    {selectedScheduledRows.map(renderDisplayRow)}

                    <SectionHeader
                      count={selectedHistoryEvents.length}
                      label="Historique"
                    />

                    {selectedHistoryRows.map(renderDisplayRow)}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {nextScheduledEvent && (
          <div
            style={{
              color: "#666",
              fontSize: "12px",
              textAlign: "left"
            }}
          >
            Prochaine échéance :{" "}
            {shortDateFormatter.format(parseDateKey(nextScheduledEvent.dateKey))}
          </div>
        )}
      </div>
    </div>
  );
}

const navButtonStyle = {
  width: "36px",
  height: "36px",
  borderRadius: "10px",
  border: "1px solid #2f2f2f",
  background: "#1d1d1d",
  color: "#aaa",
  cursor: "pointer",
  fontSize: "16px"
};

const smallButtonStyle = {
  height: "36px",
  borderRadius: "10px",
  border: "1px solid #2f2f2f",
  background: "#1d1d1d",
  color: "#aaa",
  cursor: "pointer",
  fontSize: "13px",
  padding: "0 12px"
};

const cardFooterStyle = {
  alignItems: "center",
  display: "flex",
  gap: "8px",
  justifyContent: "space-between",
  marginTop: "10px"
};

const cardHintStyle = {
  color: "#666",
  fontSize: "11px"
};

const cardMetaGridStyle = {
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  marginTop: "10px"
};

const cardMetaBlockStyle = {
  background: "#171717",
  border: "1px solid #2b2b2b",
  borderRadius: "8px",
  minWidth: 0,
  padding: "7px 8px"
};

const cardMetaLabelStyle = {
  color: "#777",
  display: "block",
  fontSize: "10px",
  fontWeight: "800",
  letterSpacing: "0.05em",
  marginBottom: "3px",
  textTransform: "uppercase"
};

const cardMetaValueStyle = {
  color: "#ddd",
  display: "block",
  fontSize: "12px",
  fontWeight: "700",
  lineHeight: 1.25,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const cardActionButtonStyle = {
  background: "#202020",
  border: "1px solid #363636",
  borderRadius: "8px",
  color: "#ddd",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: "800",
  padding: "6px 10px"
};

const tagOverflowStyle = {
  color: "#666",
  fontSize: "10px",
  fontWeight: "700",
  padding: "2px 0"
};

const groupSummaryStyle = {
  color: "#888",
  fontSize: "12px",
  lineHeight: 1.35,
  marginTop: "6px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const backButtonStyle = {
  background: "#202020",
  border: "1px solid #363636",
  borderRadius: "10px",
  color: "#ddd",
  cursor: "pointer",
  flexShrink: 0,
  fontSize: "13px",
  fontWeight: "700",
  padding: "9px 12px"
};
