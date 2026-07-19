import { useCallback, useEffect, useMemo, useState } from "react";
import { getStats } from "../../../api/stats";
import { updateQuestion } from "../../../api/questions";
import {
  getQuestionTypeChipStyle,
  questionTypeChipStyles
} from "../../../shared/questionTypes";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";

const typeOrder = ["text", "map", "timeline", "media", "sequence"];

const compactDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short"
});

const reviewDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const shellStyle = {
  minHeight: "calc(100vh - var(--shell-top, 0px))",
  background: "#111",
  color: "#eee",
  padding: "30px 24px 70px",
  boxSizing: "border-box"
};

const panelStyle = {
  background: "#171717",
  border: "1px solid #292929",
  borderRadius: "14px",
  boxSizing: "border-box",
  minWidth: 0,
  padding: "18px",
  width: "100%"
};

const statCardStyle = {
  ...panelStyle,
  minHeight: "92px",
  textAlign: "left"
};

function typeLabel(type) {
  return questionTypeChipStyles[type]?.label || String(type || "UNKNOWN").toUpperCase();
}

function sortTypes(types) {
  return [...types].sort((left, right) => {
    const leftRank = typeOrder.indexOf(left);
    const rightRank = typeOrder.indexOf(right);

    if (leftRank !== -1 || rightRank !== -1) {
      if (leftRank === -1) return 1;
      if (rightRank === -1) return -1;
      return leftRank - rightRank;
    }

    return left.localeCompare(right);
  });
}

function parseDate(value) {
  if (!value) return null;

  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3])
    );
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLoadDate(value) {
  const date = parseDate(value);
  return date ? compactDateFormatter.format(date) : "—";
}

function formatReviewDate(value) {
  const date = parseDate(value);
  return date ? reviewDateFormatter.format(date) : "Non planifié";
}

function formatRetention(value) {
  return value === null || value === undefined ? "—" : `${value}%`;
}

function questionTitle(question) {
  if (question.type_q === "map") {
    return question.answer || question.question || "Zone sans titre";
  }

  if (question.type_q === "media") {
    return question.answer || question.question || "Média sans titre";
  }

  return question.question || "Question sans titre";
}

function questionSubtitle(question) {
  if (question.group?.name) {
    return question.type_q === "map" || question.type_q === "media"
      ? question.group.name
      : `${question.group.name} · ${question.answer || "Réponse vide"}`;
  }

  return question.answer || "Réponse vide";
}

function mergedFavoriteData(question, nextFavorite) {
  const data = { ...(question.data || {}) };

  if (nextFavorite) {
    data.favorite = true;
  } else {
    delete data.favorite;
  }

  return data;
}

function TypeChip({ type }) {
  const typeStyle = getQuestionTypeChipStyle(type);

  return (
    <span
      style={{
        background: typeStyle.background,
        borderRadius: "999px",
        color: typeStyle.color,
        flexShrink: 0,
        fontSize: "10px",
        fontWeight: "800",
        letterSpacing: "0.04em",
        lineHeight: 1,
        padding: "4px 7px"
      }}
    >
      {typeLabel(type)}
    </span>
  );
}

function SectionHeader({ label, title, action }) {
  return (
    <div
      style={{
        alignItems: "flex-start",
        display: "flex",
        gap: "14px",
        justifyContent: "space-between",
        marginBottom: "14px"
      }}
    >
      <div>
        <div
          style={{
            color: "#777",
            fontSize: "11px",
            fontWeight: "800",
            letterSpacing: "0.08em",
            marginBottom: "6px",
            textTransform: "uppercase"
          }}
        >
          {label}
        </div>
        <h2
          style={{
            color: "#eee",
            fontSize: "20px",
            lineHeight: 1.1,
            margin: 0
          }}
        >
          {title}
        </h2>
      </div>

      {action}
    </div>
  );
}

function SummaryCards({ counts }) {
  const cards = [
    ["À revoir", counts?.due_total || 0, "#ffcc7a", "#3d2b14"],
    ["En retard", counts?.overdue || 0, "#ff9c9c", "#3a1d1d"],
    ["Aujourd'hui", counts?.due_today || 0, "#8fc7ff", "#14283d"],
    ["Nouvelles", counts?.new || 0, "#c4b5fd", "#241c3d"]
  ];

  return (
    <div
      style={{
        display: "grid",
        gap: "12px",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        minWidth: 0,
        width: "100%"
      }}
    >
      {cards.map(([label, value, color, background]) => (
        <div
          key={label}
          style={{
            ...statCardStyle,
            background,
            border: `1px solid ${color}33`
          }}
        >
          <div
            style={{
              color,
              fontSize: "11px",
              fontWeight: "800",
              letterSpacing: "0.06em",
              marginBottom: "10px",
              textTransform: "uppercase"
            }}
          >
            {label}
          </div>
          <div
            style={{
              color: "#eee",
              fontSize: "32px",
              fontWeight: "850",
              lineHeight: 1
            }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadChart({ loadByType = [] }) {
  const maxTotal = Math.max(1, ...loadByType.map(day => day.total || 0));
  const legendTypes = sortTypes(
    new Set(loadByType.flatMap(day => Object.keys(day.types || {})))
  );

  return (
    <div style={panelStyle}>
      <SectionHeader
        label="Charge"
        title="30 prochains jours"
        action={(
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              justifyContent: "flex-end"
            }}
          >
            {legendTypes.map((type) => (
              <TypeChip key={type} type={type} />
            ))}
          </div>
        )}
      />

      <div
        style={{
          alignItems: "end",
          display: "grid",
          gap: "5px",
          gridTemplateColumns: `repeat(${Math.max(loadByType.length, 1)}, minmax(5px, 1fr))`,
          minHeight: "130px",
          paddingTop: "10px"
        }}
      >
        {loadByType.map((day, index) => (
          <div
            key={day.date}
            title={`${formatLoadDate(day.date)} · ${day.total || 0} review`}
            style={{
              alignItems: "center",
              display: "flex",
              flexDirection: "column",
              gap: "7px",
              minWidth: 0
            }}
          >
            <div
              style={{
                alignItems: "stretch",
                background: "#222",
                border: "1px solid #303030",
                borderRadius: "999px",
                display: "flex",
                flexDirection: "column-reverse",
                height: "92px",
                justifyContent: "flex-start",
                overflow: "hidden",
                width: "100%"
              }}
            >
              {sortTypes(Object.keys(day.types || {})).map((type) => {
                const count = day.types[type] || 0;
                const height = count > 0 ? Math.max(6, (count / maxTotal) * 92) : 0;
                const typeStyle = getQuestionTypeChipStyle(type);

                return (
                  <div
                    key={type}
                    style={{
                      background: typeStyle.color,
                      flex: `0 0 ${height}px`,
                      opacity: count > 0 ? 0.95 : 0
                    }}
                  />
                );
              })}
            </div>

            <div
              style={{
                color: index % 5 === 0 ? "#8a8a8a" : "#555",
                fontSize: "10px",
                lineHeight: 1,
                minHeight: "10px",
                whiteSpace: "nowrap"
              }}
            >
              {index % 5 === 0 ? formatLoadDate(day.date) : day.total || ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RetentionTable({ retentionByType = {} }) {
  const types = sortTypes(new Set(Object.keys(retentionByType)));

  return (
    <div style={panelStyle}>
      <SectionHeader label="Rétention" title="90 derniers jours" />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px"
        }}
      >
        {types.map((type) => {
          const stats = retentionByType[type] || {};
          const typeStyle = getQuestionTypeChipStyle(type);

          return (
            <div
              key={type}
              style={{
                alignItems: "center",
                background: "#131313",
                border: "1px solid #292929",
                borderRadius: "12px",
                boxSizing: "border-box",
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "92px minmax(0, 1fr) repeat(3, 68px)",
                padding: "12px"
              }}
            >
              <TypeChip type={type} />

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    color: typeStyle.color,
                    fontSize: "22px",
                    fontWeight: "850",
                    lineHeight: 1
                  }}
                >
                  {formatRetention(stats.retention)}
                </div>
                <div
                  style={{
                    color: "#777",
                    fontSize: "12px",
                    marginTop: "5px"
                  }}
                >
                  {stats.reviews || 0} review{stats.reviews > 1 ? "s" : ""}
                </div>
              </div>

              {[
                ["Dur", stats.hard || 0, "#ffcc7a"],
                ["Faux", stats.failed || 0, "#ff9c9c"],
                ["OK", stats.success || 0, "#7ee2a8"]
              ].map(([label, value, color]) => (
                <div key={label} style={{ textAlign: "right" }}>
                  <div
                    style={{
                      color,
                      fontSize: "16px",
                      fontWeight: "800"
                    }}
                  >
                    {value}
                  </div>
                  <div
                    style={{
                      color: "#666",
                      fontSize: "10px",
                      fontWeight: "800",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase"
                    }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FavoriteButton({
  disabled,
  favorite,
  onClick
}) {
  return (
    <button
      type="button"
      aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
      title={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
      disabled={disabled}
      onClick={onClick}
      style={{
        alignItems: "center",
        background: favorite ? "#3d3215" : "#1a1a1a",
        border: favorite
          ? "1px solid rgba(255, 204, 122, 0.45)"
          : "1px solid #303030",
        borderRadius: "999px",
        color: favorite ? "#ffcc7a" : "#777",
        cursor: disabled ? "wait" : "pointer",
        display: "inline-flex",
        flexShrink: 0,
        fontSize: "18px",
        height: "32px",
        justifyContent: "center",
        lineHeight: 1,
        opacity: disabled ? 0.65 : 1,
        padding: 0,
        width: "32px"
      }}
    >
      {favorite ? "★" : "☆"}
    </button>
  );
}

function QuestionRow({
  question,
  onOpenQuestion,
  onToggleFavorite,
  savingFavorite
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ouvrir ${questionTitle(question)}`}
      onClick={() => onOpenQuestion?.(question.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenQuestion?.(question.id);
        }
      }}
      style={{
        alignItems: "center",
        background: "#131313",
        border: "1px solid #292929",
        borderRadius: "12px",
        boxSizing: "border-box",
        color: "inherit",
        cursor: "pointer",
        display: "grid",
        gap: "12px",
        gridTemplateColumns: "minmax(0, 1fr) 84px 74px 92px 34px",
        padding: "12px",
        textAlign: "left",
        minWidth: 0,
        width: "100%"
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "8px",
            marginBottom: "6px",
            minWidth: 0
          }}
        >
          <TypeChip type={question.type_q} />
          <div
            style={{
              color: "#eee",
              fontSize: "14px",
              fontWeight: "750",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {questionTitle(question)}
          </div>
        </div>

        <div
          style={{
            color: "#888",
            fontSize: "12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {questionSubtitle(question)}
        </div>
      </div>

      <Metric label="Rétention" value={formatRetention(question.retention)} />
      <Metric label="Reviews" value={question.reviews || 0} />
      <Metric label="Révision" value={formatReviewDate(question.next_review)} compact />

      <FavoriteButton
        disabled={savingFavorite}
        favorite={question.favorite}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite?.(question);
        }}
      />
    </div>
  );
}

function Metric({ label, value, compact = false }) {
  return (
    <div style={{ minWidth: 0, textAlign: "right" }}>
      <div
        style={{
          color: "#e7e7e7",
          fontSize: compact ? "12px" : "16px",
          fontWeight: "800",
          lineHeight: 1.1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {value}
      </div>
      <div
        style={{
          color: "#666",
          fontSize: "10px",
          fontWeight: "800",
          letterSpacing: "0.04em",
          marginTop: "5px",
          textTransform: "uppercase"
        }}
      >
        {label}
      </div>
    </div>
  );
}

function QuestionList({
  emptyLabel = "Aucune donnée",
  questions = [],
  savingFavoriteIds,
  title,
  label,
  onOpenQuestion,
  onToggleFavorite
}) {
  return (
    <div style={panelStyle}>
      <SectionHeader label={label} title={title} />

      {questions.length === 0 ? (
        <div
          style={{
            alignItems: "center",
            border: "1px dashed #303030",
            borderRadius: "12px",
            color: "#777",
            display: "flex",
            fontSize: "14px",
            justifyContent: "center",
            minHeight: "82px"
          }}
        >
          {emptyLabel}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            minWidth: 0
          }}
        >
          {questions.map((question) => (
            <QuestionRow
              key={question.id}
              question={question}
              onOpenQuestion={onOpenQuestion}
              onToggleFavorite={onToggleFavorite}
              savingFavorite={savingFavoriteIds.has(question.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Stats({
  setMode,
  onOpenQuestion
}) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [savingFavoriteIds, setSavingFavoriteIds] = useState(() => new Set());

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      setStats(await getStats());
    } catch (loadError) {
      console.error(loadError);
      setError(loadError.message || "Statistiques indisponibles.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const totalQuestions = stats?.counts?.total || 0;
  const typeTotals = useMemo(() => (
    sortTypes(new Set(Object.keys(stats?.counts?.by_type || {})))
      .map((type) => ({
        type,
        total: stats?.counts?.by_type?.[type]?.total || 0
      }))
  ), [stats]);

  async function toggleFavorite(question) {
    const nextFavorite = !question.favorite;
    const data = mergedFavoriteData(question, nextFavorite);

    setSavingFavoriteIds((current) => {
      const next = new Set(current);
      next.add(question.id);
      return next;
    });

    try {
      await updateQuestion(question.id, { data });
      await loadStats();
    } catch (favoriteError) {
      console.error(favoriteError);
      setError(favoriteError.message || "Favori impossible à modifier.");
    } finally {
      setSavingFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(question.id);
        return next;
      });
    }
  }

  return (
    <div style={shellStyle}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "22px",
          margin: "0 auto",
          maxWidth: "1380px"
        }}
      >
        <div
          style={{
            alignItems: "flex-start",
            display: "flex",
            gap: "20px",
            justifyContent: "space-between"
          }}
        >
          <div>
            <div
              style={{
                color: "#666",
                fontSize: "12px",
                fontWeight: "800",
                letterSpacing: "0.08em",
                marginBottom: "8px"
              }}
            >
              STATS
            </div>
            <h1
              style={{
                color: "#eee",
                fontSize: "38px",
                lineHeight: 1,
                margin: "0 0 12px",
                fontWeight: "850"
              }}
            >
              Statistiques
            </h1>
            <div
              style={{
                color: "#888",
                display: "flex",
                flexWrap: "wrap",
                fontSize: "14px",
                gap: "10px"
              }}
            >
              <span>{totalQuestions} question{totalQuestions > 1 ? "s" : ""}</span>
              {typeTotals.map(({ type, total }) => (
                <span key={type}>· {typeLabel(type)} {total}</span>
              ))}
            </div>
          </div>

          <ReturnToMenuButton
            onClick={() => setMode("menu")}
            style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: "10px",
              color: "#bbb",
              cursor: "pointer",
              fontSize: "14px",
              padding: "10px 14px"
            }}
          />
        </div>

        {error && (
          <div
            style={{
              background: "#2b1717",
              border: "1px solid rgba(255, 156, 156, 0.28)",
              borderRadius: "12px",
              color: "#ffb3b3",
              padding: "12px 14px"
            }}
          >
            {error}
          </div>
        )}

        {isLoading && !stats ? (
          <div
            style={{
              ...panelStyle,
              alignItems: "center",
              color: "#888",
              display: "flex",
              justifyContent: "center",
              minHeight: "180px"
            }}
          >
            Chargement des statistiques...
          </div>
        ) : stats && (
          <>
            <SummaryCards counts={stats.counts} />

            <div
              style={{
                display: "grid",
                gap: "16px",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))"
              }}
            >
              <LoadChart loadByType={stats.load_by_type || []} />
              <RetentionTable retentionByType={stats.retention_by_type || {}} />
            </div>

            <div
              style={{
                display: "grid",
                gap: "16px",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 520px), 1fr))"
              }}
            >
              <QuestionList
                label="Difficulté"
                title="Questions difficiles"
                questions={stats.hard_questions || []}
                savingFavoriteIds={savingFavoriteIds}
                onOpenQuestion={onOpenQuestion}
                onToggleFavorite={toggleFavorite}
              />
              <QuestionList
                emptyLabel="Aucun favori"
                label="Favoris"
                title="Questions favorites"
                questions={stats.favorite_questions || []}
                savingFavoriteIds={savingFavoriteIds}
                onOpenQuestion={onOpenQuestion}
                onToggleFavorite={toggleFavorite}
              />
              <QuestionList
                emptyLabel="Pas encore de faiblesse map"
                label="Maps"
                title="Points faibles maps"
                questions={stats.weak_spots?.map || []}
                savingFavoriteIds={savingFavoriteIds}
                onOpenQuestion={onOpenQuestion}
                onToggleFavorite={toggleFavorite}
              />
              <QuestionList
                emptyLabel="Pas encore de faiblesse timeline"
                label="Timeline"
                title="Points faibles timeline"
                questions={stats.weak_spots?.timeline || []}
                savingFavoriteIds={savingFavoriteIds}
                onOpenQuestion={onOpenQuestion}
                onToggleFavorite={toggleFavorite}
              />
              <QuestionList
                emptyLabel="Pas encore de faiblesse image"
                label="Images"
                title="Points faibles images"
                questions={stats.weak_spots?.image || []}
                savingFavoriteIds={savingFavoriteIds}
                onOpenQuestion={onOpenQuestion}
                onToggleFavorite={toggleFavorite}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
