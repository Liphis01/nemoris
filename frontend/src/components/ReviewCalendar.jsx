import { useEffect, useMemo, useRef, useState } from "react";

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

const typeColors = {
  text: ["#163b63", "#5eb6ff"],
  map: ["#3d2b14", "#ffcc7a"],
  image: ["#163524", "#7ee2a8"],
  audio: ["#3a1d2d", "#ff9ccc"]
};

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

function getNextReview(question) {
  return question.progress?.next_review || question.next_review || null;
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
  return question.answer || "Question";
}

function dueTitle(question) {
  if (question.type_q === "map") {
    return question.answer || question.question || "Zone sans titre";
  }

  return question.question || "Question sans titre";
}

function typeBadgeStyle(type) {
  const [background, color] = typeColors[type] || ["#2a2a2a", "#aaa"];

  return {
    background,
    color,
    borderRadius: "999px",
    padding: "3px 8px",
    fontSize: "10px",
    fontWeight: "800",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    flexShrink: 0
  };
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
  const highlightedQuestionRef = useRef(null);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [selectedQuestionId, setSelectedQuestionId] = useState(null);

  const scheduledQuestions = useMemo(
    () =>
      questions
        .map((question) => ({
          ...question,
          dueKey: getNextReview(question)
        }))
        .filter((question) => question.dueKey)
        .sort((a, b) => a.dueKey.localeCompare(b.dueKey)),
    [questions]
  );

  const dueByDate = useMemo(() => {
    const result = {};

    for (const question of scheduledQuestions) {
      if (!result[question.dueKey]) result[question.dueKey] = [];
      result[question.dueKey].push(question);
    }

    return result;
  }, [scheduledQuestions]);

  const monthDays = useMemo(
    () => buildCalendarDays(visibleMonth),
    [visibleMonth]
  );

  const selectedDate = parseDateKey(selectedDateKey) || today;
  const selectedQuestions = dueByDate[selectedDateKey] || [];
  const overdueCount = scheduledQuestions.filter(
    (question) => question.dueKey < todayKey
  ).length;
  const todayCount = (dueByDate[todayKey] || []).length;
  const upcomingCount = scheduledQuestions.filter(
    (question) => question.dueKey > todayKey
  ).length;

  useEffect(() => {
    if (!openQuestionId) return;

    const question = scheduledQuestions.find(
      (item) => item.id === openQuestionId
    );

    if (!question?.dueKey) return;

    const dueDate = parseDateKey(question.dueKey);
    if (!dueDate) return;

    setVisibleMonth(new Date(dueDate.getFullYear(), dueDate.getMonth(), 1));
    setSelectedDateKey(question.dueKey);
    setSelectedQuestionId(question.id);
    clearOpenQuestionId?.();
  }, [clearOpenQuestionId, openQuestionId, scheduledQuestions]);

  useEffect(() => {
    if (!selectedQuestionId) return;

    highlightedQuestionRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  }, [selectedDateKey, selectedQuestionId]);

  function moveMonth(offset) {
    setVisibleMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)
    );
  }

  function selectToday() {
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDateKey(todayKey);
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
          maxWidth: "1180px",
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

            <div
              style={{
                color: "#777",
                fontSize: "14px"
              }}
            >
              {scheduledQuestions.length} questions planifiées
            </div>
          </div>

          <button
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
          >
            ← Retour
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "12px"
          }}
        >
          {[
            ["En retard", overdueCount, "#ff9c9c", "#3a1d1d"],
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
            gridTemplateColumns: "minmax(0, 1fr) 360px",
            gap: "18px",
            alignItems: "start"
          }}
        >
          <div
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
                const dayQuestions = dueByDate[dateKey] || [];
                const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
                const isToday = dateKey === todayKey;
                const isSelected = dateKey === selectedDateKey;
                const isPast = dateKey < todayKey;

                return (
                  <button
                    key={dateKey}
                    onClick={() => setSelectedDateKey(dateKey)}
                    style={{
                      minHeight: "96px",
                      padding: "10px",
                      border: "none",
                      borderRight: "1px solid #242424",
                      borderBottom: "1px solid #242424",
                      background: isSelected
                        ? "#252525"
                        : isToday
                          ? "#1f1b14"
                          : "#181818",
                      color: isCurrentMonth ? "#eee" : "#555",
                      cursor: "pointer",
                      textAlign: "left",
                      boxShadow: isSelected ? "inset 0 0 0 1px #3a3a3a" : "none",
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

                      {dayQuestions.length > 0 && (
                        <span
                          style={{
                            minWidth: "22px",
                            height: "22px",
                            borderRadius: "999px",
                            background: isPast ? "#3a1d1d" : "#2b2047",
                            color: isPast ? "#ff9c9c" : "#b69cff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            fontWeight: "800"
                          }}
                        >
                          {dayQuestions.length}
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
                      {dayQuestions.slice(0, 3).map((question) => (
                        <div
                          key={question.id}
                          style={{
                            height: "6px",
                            borderRadius: "999px",
                            background:
                              typeColors[question.type_q]?.[1] || "#777",
                            opacity: isCurrentMonth ? 0.8 : 0.35
                          }}
                        />
                      ))}

                      {dayQuestions.length > 3 && (
                        <div
                          style={{
                            color: "#666",
                            fontSize: "10px",
                            fontWeight: "700"
                          }}
                        >
                          +{dayQuestions.length - 3}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              background: "#181818",
              border: "1px solid #262626",
              borderRadius: "16px",
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
              <div
                style={{
                  color: selectedDateKey < todayKey ? "#ff9c9c" : "#777",
                  fontSize: "11px",
                  fontWeight: "800",
                  letterSpacing: "0.06em",
                  marginBottom: "8px",
                  textTransform: "uppercase"
                }}
              >
                {selectedDateKey < todayKey ? "En retard" : "Détails"}
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
                {selectedQuestions.length} question
                {selectedQuestions.length > 1 ? "s" : ""} due
              </div>
            </div>

            <div
              style={{
                maxHeight: "620px",
                overflow: "auto",
                padding: "10px"
              }}
            >
              {selectedQuestions.length === 0 ? (
                <div
                  style={{
                    padding: "40px 18px",
                    color: "#777",
                    textAlign: "center",
                    fontSize: "14px",
                    lineHeight: 1.5
                  }}
                >
                  Rien de prévu pour cette journée.
                </div>
              ) : (
                selectedQuestions.map((question) => {
                  const isSelectedQuestion = selectedQuestionId === question.id;

                  return (
                    <button
                      type="button"
                      key={question.id}
                      ref={isSelectedQuestion ? highlightedQuestionRef : null}
                      onClick={() => onOpenQuestion?.(question)}
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "12px",
                        border: isSelectedQuestion
                          ? "1px solid rgba(126, 226, 168, 0.85)"
                          : "1px solid #262626",
                        background: isSelectedQuestion
                          ? "rgba(22, 53, 36, 0.72)"
                          : "#151515",
                        color: "inherit",
                        boxShadow: isSelectedQuestion
                          ? "0 0 0 4px rgba(126, 226, 168, 0.1), 0 0 24px rgba(126, 226, 168, 0.14)"
                          : "none",
                        marginBottom: "8px",
                        textAlign: "left",
                        cursor: "pointer",
                        font: "inherit",
                        transition: "border 0.16s ease, background 0.16s ease, box-shadow 0.16s ease"
                      }}
                      title="Ouvrir dans Manage"
                    >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        minWidth: 0,
                        marginBottom: "8px"
                      }}
                    >
                      <span style={typeBadgeStyle(question.type_q)}>
                        {question.type_q || "text"}
                      </span>

                      <span
                        style={{
                          color: "#666",
                          fontSize: "11px",
                          flexShrink: 0
                        }}
                      >
                        #{question.id}
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
                        {dueLabel(question)}
                      </span>
                    </div>

                    <div
                      style={{
                        color: "#eee",
                        fontSize: "14px",
                        fontWeight: "700",
                        lineHeight: 1.35,
                        marginBottom: "8px"
                      }}
                    >
                      {dueTitle(question)}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "5px"
                      }}
                    >
                      {(question.tags || []).slice(0, 4).map((tag) => (
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
                    </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {scheduledQuestions.length > 0 && (
          <div
            style={{
              color: "#666",
              fontSize: "12px",
              textAlign: "left"
            }}
          >
            Prochaine échéance :{" "}
            {shortDateFormatter.format(parseDateKey(scheduledQuestions[0].dueKey))}
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
