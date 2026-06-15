import { useEffect, useMemo, useState } from "react";
import ReviewQuestionRenderer from "../../review/components/ReviewQuestionRenderer";
import TrainingTimerPanel from "../../review/components/TrainingTimerPanel";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import { useTrainingSession } from "../hooks/useTrainingSession";
import {
  formatDuration,
  formatPercent,
  formatRecordPercent
} from "../trainingRecordUtils";
import {
  defaultMapMode,
  MAP_MODES,
  mapModeDetails,
  mapModeLabels
} from "../../review/mapModes";
import {
  defaultImageMode,
  IMAGE_MODES,
  imageModeDetails,
  imageModeLabels
} from "../../review/imageModes";
import "./TrainingSession.css";


const panelStyle = {
  background: "#181818",
  border: "1px solid #262626",
  borderRadius: "8px",
  boxSizing: "border-box"
};

const buttonStyle = {
  background: "#232323",
  border: "1px solid #333",
  borderRadius: "8px",
  color: "#eee",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "700",
  padding: "11px 14px"
};

const primaryButtonStyle = {
  ...buttonStyle,
  background: "#233228",
  border: "1px solid #385544",
  color: "#d7f5df"
};

const disabledButtonStyle = {
  ...buttonStyle,
  color: "#777",
  cursor: "not-allowed",
  opacity: 0.55
};

const completionMetricStyle = {
  background: "#141414",
  border: "1px solid #282828",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "14px"
};

const completionMetricLabelStyle = {
  color: "#777",
  fontSize: "11px",
  fontWeight: "800",
  textTransform: "uppercase"
};

const recordBadgeStyle = {
  background: "#233228",
  border: "1px solid #385544",
  borderRadius: "999px",
  color: "#d7f5df",
  fontSize: "13px",
  fontWeight: "800",
  padding: "8px 12px"
};


function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}


function modeConfigForGroup(group) {
  if (group?.type_group === "map") {
    return {
      defaultMode: defaultMapMode,
      details: mapModeDetails,
      labels: mapModeLabels,
      modes: MAP_MODES
    };
  }

  if (group?.type_group === "image") {
    return {
      defaultMode: defaultImageMode,
      details: imageModeDetails,
      labels: imageModeLabels,
      modes: IMAGE_MODES
    };
  }

  return null;
}


function recordForMode(group, mode) {
  const config = modeConfigForGroup(group);

  return group?.training_records?.[mode] || (
    mode === config?.defaultMode ? group?.training_record : null
  );
}


function isVisualQuestion(question) {
  return ["image", "map", "timeline"].includes(question?.type_q);
}


function modeGlyph(mode) {
  if (mode === "type_all") return "Aa";
  if (mode === "click_prompt") return ">";
  if (mode === "type_prompt") return "T";
  if (mode === "multiple_choice") return "4";
  if (mode === "multiple_choice_label") return "A4";
  if (mode === "multiple_choice_image") return "I4";

  return "?";
}


function questionCountLabel(count) {
  const value = Number(count) || 0;

  return `${value} question${value > 1 ? "s" : ""}`;
}


function recordTimeLabel(record) {
  return record?.best_time_ms ? formatDuration(record.best_time_ms) : "—";
}


function recordPercentValue(record) {
  const percent = Number(record?.best_found_percent);

  if (!Number.isFinite(percent)) return null;

  return Math.min(Math.max(percent, 0), 100);
}


function groupTotalPercent(group) {
  const config = modeConfigForGroup(group);

  if (!config) {
    return recordPercentValue(group?.training_record);
  }

  if (config.modes.length === 0) return null;

  const total = config.modes.reduce((sum, mode) => (
    sum + (recordPercentValue(recordForMode(group, mode)) || 0)
  ), 0);

  return total / config.modes.length;
}


function formatTotalPercent(percent) {
  return Number.isFinite(percent) ? `${Math.round(percent)}%` : "—";
}


function percentBarWidth(percent) {
  return Number.isFinite(percent)
    ? `${Math.min(Math.max(percent, 0), 100)}%`
    : "0%";
}


function groupAccent(group) {
  if (group?.type_group === "map") return "map";
  if (group?.type_group === "image") return "image";

  return "neutral";
}


function RecordMetric({ label, value }) {
  return (
    <div className="training-record-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


function TrainingScoreMeter({ percent }) {
  return (
    <span
      className="training-total-score"
      aria-label={`Score total ${formatTotalPercent(percent)}`}
    >
      <strong>{formatTotalPercent(percent)}</strong>
      <span className="training-total-score-label">total</span>
      <span className="training-total-score-bar" aria-hidden="true">
        <span style={{ width: percentBarWidth(percent) }} />
      </span>
    </span>
  );
}


function GroupTile({ group, onSelect, selected }) {
  const config = modeConfigForGroup(group);
  const totalPercent = groupTotalPercent(group);
  const accent = groupAccent(group);

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Sélectionner ${group.name}`}
      className={`training-scope-tile training-scope-tile-${accent}${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="training-scope-tile-main">
        <span className={`training-scope-badge training-scope-badge-${accent}`}>
          {group.type_group || "groupe"}
        </span>
        <strong>{group.name}</strong>
        <span>
          {questionCountLabel(group.question_count)}
          {config ? ` · ${config.modes.length} modes` : ""}
        </span>
      </span>

      <TrainingScoreMeter percent={totalPercent} />
    </button>
  );
}


function TagTile({ tag, startScope }) {
  return (
    <button
      type="button"
      aria-label={`Démarrer le tag ${tag.name}`}
      className="training-scope-tile training-tag-tile"
      onClick={() => startScope({
        type: "tag",
        name: tag.name
      })}
    >
      <span className="training-scope-tile-main">
        <span className="training-scope-badge training-scope-badge-tag">
          tag
        </span>
        <strong>#{tag.name}</strong>
        <span>{questionCountLabel(tag.count)}</span>
      </span>

      <span className="training-scope-score">
        <strong>→</strong>
        <span>démarrer</span>
      </span>
    </button>
  );
}


function ModeAction({ config, group, mode, startScope }) {
  const record = recordForMode(group, mode);
  const complete = record?.best_found_percent >= 100;

  return (
    <button
      type="button"
      className={`training-mode-action${complete ? " is-complete" : ""}`}
      onClick={() => startScope({
        ...group,
        type: "group"
      }, mode)}
      aria-label={`Démarrer ${config.labels[mode]} pour ${group.name}`}
    >
      <span className="training-mode-glyph" aria-hidden="true">
        {modeGlyph(mode)}
      </span>

      <span className="training-mode-copy">
        <strong>{config.labels[mode]}</strong>
        <span>{config.details[mode]}</span>
      </span>

      <span className="training-mode-record">
        <strong>{formatRecordPercent(record)}</strong>
        <span>{recordTimeLabel(record)}</span>
      </span>
    </button>
  );
}


function GroupDetailPanel({ group, startScope }) {
  if (!group) {
    return (
      <aside className="training-detail-panel training-detail-empty" aria-label="Détails du groupe">
        Sélectionne un groupe.
      </aside>
    );
  }

  const config = modeConfigForGroup(group);
  const totalPercent = groupTotalPercent(group);
  const accent = groupAccent(group);

  return (
    <aside
      className={`training-detail-panel training-detail-panel-${accent}`}
      aria-label="Détails du groupe"
    >
      <div className="training-detail-head">
        <span className={`training-scope-badge training-scope-badge-${accent}`}>
          {group.type_group || "groupe"}
        </span>
        <h2>{group.name}</h2>
        <p>{questionCountLabel(group.question_count)}</p>
      </div>

      <div
        className="training-detail-metrics training-detail-metrics-single"
        aria-label="Score du groupe"
      >
        <RecordMetric label="Score total" value={formatTotalPercent(totalPercent)} />
      </div>

      {config ? (
        <>
          <div className="training-detail-section-title">
            Modes d'entrainement
          </div>
          <div className="training-mode-list">
            {config.modes.map(mode => (
              <ModeAction
                config={config}
                group={group}
                key={mode}
                mode={mode}
                startScope={startScope}
              />
            ))}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="training-start-button"
          onClick={() => startScope({
            ...group,
            type: "group"
          })}
        >
          <strong>Démarrer ce groupe</strong>
          <span>{questionCountLabel(group.question_count)}</span>
        </button>
      )}
    </aside>
  );
}


function ScopeSelector({
  scopes,
  scopesError,
  scopesLoading,
  startScope,
  loadScopes,
  selectedGroupId,
  setMode,
  setSelectedGroupId
}) {
  const [scopeType, setScopeType] = useState("group");
  const [search, setSearch] = useState("");
  const normalizedSearch = normalizeText(search);
  const groups = useMemo(
    () => (scopes.groups || []).filter(group =>
      normalizeText(`${group.name} ${group.type_group}`).includes(normalizedSearch)
    ),
    [normalizedSearch, scopes.groups]
  );
  const tags = useMemo(
    () => (scopes.tags || []).filter(tag =>
      normalizeText(tag.name).includes(normalizedSearch)
    ),
    [normalizedSearch, scopes.tags]
  );
  const activeRows = scopeType === "group" ? groups : tags;
  const selectedGroup = useMemo(
    () => groups.find(group => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  useEffect(() => {
    if (scopeType !== "group") {
      return;
    }

    setSelectedGroupId(currentId => {
      if (groups.length === 0) return null;

      if (groups.some(group => group.id === currentId)) {
        return currentId;
      }

      return groups[0].id;
    });
  }, [groups, scopeType, setSelectedGroupId]);

  return (
    <div className="training-selector-panel">
      <div className="training-selector-header">
        <div className="training-selector-title">
          <div className="training-selector-overline">Training</div>
          <h1>
            Entrainement
          </h1>
        </div>

        <ReturnToMenuButton
          onClick={() => setMode("menu")}
          className="training-selector-back"
        />
      </div>

      {scopesLoading && (
        <div className="training-selector-state">
          Chargement des choix...
        </div>
      )}

      {!scopesLoading && scopesError && (
        <div className="training-selector-error" role="alert">
          <div>{scopesError}</div>
          <button type="button" onClick={loadScopes} className="training-secondary-button">
            Recharger
          </button>
        </div>
      )}

      {!scopesLoading && !scopesError && (
        <>
          <div className="training-selector-controls">
            <div className="training-segmented" aria-label="Type de scope">
              <button
                type="button"
                aria-pressed={scopeType === "group"}
                onClick={() => setScopeType("group")}
                className={scopeType === "group" ? "is-active" : ""}
              >
                Groupes
              </button>
              <button
                type="button"
                aria-pressed={scopeType === "tag"}
                onClick={() => setScopeType("tag")}
                className={scopeType === "tag" ? "is-active" : ""}
              >
                Tags
              </button>
            </div>
            <input
              aria-label="Rechercher un entrainement"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Recherche..."
              className="training-search-input"
            />
          </div>

          {activeRows.length === 0 ? (
            <div className="training-selector-state">
              Aucun choix disponible.
            </div>
          ) : (
            <div className={`training-selector-body training-selector-body-${scopeType}`}>
              {scopeType === "group" ? (
                <>
                  <section className="training-list-column" aria-label="Liste des groupes">
                    <div className="training-scope-grid" aria-label="Groupes d'entrainement">
                      {groups.map(group => (
                        <GroupTile
                          group={group}
                          key={group.id}
                          onSelect={() => setSelectedGroupId(group.id)}
                          selected={selectedGroupId === group.id}
                        />
                      ))}
                    </div>
                  </section>

                  <div className="training-detail-column">
                    <GroupDetailPanel
                      group={selectedGroup}
                      startScope={startScope}
                    />
                  </div>
                </>
              ) : (
                <div className="training-scope-grid" aria-label="Tags d'entrainement">
                  {tags.map(tag => (
                    <TagTile
                      key={tag.name}
                      startScope={startScope}
                      tag={tag}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}


export default function TrainingSession({ setMode }) {
  const session = useTrainingSession(true);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const currentQuestion = session.questions[session.currentIndex];
  const activeGroupMode = (
    session.activeScope?.groupMode ||
    session.activeScope?.mapMode ||
    session.activeScope?.imageMode
  );
  const activeModeConfig = modeConfigForGroup(session.activeScope);
  const activeRecord = activeGroupMode
    ? recordForMode(session.activeScope, activeGroupMode)
    : session.activeScope?.training_record || null;
  const displayedRecord = session.recordResult?.training_record || activeRecord;
  const completedPercent = formatPercent(
    session.attemptFoundCount,
    session.allQuestionIds.length
  );
  const hasActiveQuestion = Boolean(
    session.activeScope &&
    !session.trainingLoading &&
    !session.trainingError &&
    !session.isComplete &&
    currentQuestion &&
    session.currentIndex < session.questions.length
  );
  const useCompactVisualLayout = hasActiveQuestion && isVisualQuestion(currentQuestion);
  const compactTrainingElapsedMs = session.activeScope?.type === "group"
    ? session.completedRunElapsedMs
    : null;

  if (useCompactVisualLayout) {
    return (
      <div
        data-visual-session-shell
        style={{
          background: "#111",
          boxSizing: "border-box",
          color: "#eee",
          display: "flex",
          flexDirection: "column",
          height: "calc(100dvh - 48px)",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            margin: "0 auto",
            maxWidth: "1280px",
            minHeight: 0,
            width: "100%"
          }}
        >
          <div
            data-visual-session-bar
            style={{
              alignItems: "center",
              background: "#181818",
              border: "1px solid #262626",
              borderRadius: "14px",
              boxSizing: "border-box",
              display: "grid",
              flexShrink: 0,
              gap: "12px",
              gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 520px) minmax(0, 1fr)",
              marginBottom: "10px",
              minHeight: "72px",
              padding: "10px 14px"
            }}
          >
            <div
              data-visual-session-actions
              style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                justifyContent: "flex-start",
                minWidth: 0
              }}
            >
              <ReturnToMenuButton
                onClick={session.returnToScopeSelector}
                style={{
                  ...buttonStyle,
                  borderRadius: "9px",
                  fontSize: "13px",
                  padding: "8px 11px"
                }}
              />
            </div>

            <div
              data-visual-session-status
              style={{
                alignItems: "center",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                justifyContent: "center",
                minWidth: 0,
                textAlign: "center"
              }}
            >
              <div
                style={{
                  color: "#f0c36a",
                  fontSize: "11px",
                  fontWeight: 900,
                  textTransform: "uppercase"
                }}
              >
                Training
              </div>
              <strong
                data-visual-session-title
                style={{
                  color: "#f3f3f3",
                  display: "block",
                  fontSize: "17px",
                  fontWeight: 900,
                  lineHeight: 1.1,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {session.labelForActiveScope}
              </strong>
              <div
                style={{
                  alignItems: "center",
                  color: "#888",
                  display: "flex",
                  flexWrap: "wrap",
                  fontSize: "12px",
                  fontWeight: 800,
                  gap: "6px 8px",
                  justifyContent: "center",
                  lineHeight: 1.2
                }}
              >
                <span>
                  Question {session.currentIndex + 1} / {session.questions.length}
                </span>
                {(currentQuestion.tags || []).map(tag => (
                  <span
                    key={tag}
                    style={{
                      background: "#2b2047",
                      borderRadius: "999px",
                      color: "#b69cff",
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "3px 8px"
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <div
              data-visual-session-secondary
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "flex-end",
                minWidth: 0
              }}
            >
              {compactTrainingElapsedMs !== null ? (
                <TrainingTimerPanel
                  elapsedMs={compactTrainingElapsedMs}
                  bestTimeMs={displayedRecord?.best_time_ms}
                  variant="prominent"
                />
              ) : (
                <div
                  style={{
                    background: "#141414",
                    border: "1px solid #282828",
                    borderRadius: "10px",
                    color: "#9a9a9a",
                    fontSize: "12px",
                    fontWeight: 800,
                    padding: "8px 10px",
                    textTransform: "uppercase"
                  }}
                >
                  En cours
                </div>
              )}
            </div>
          </div>

          <div
            data-visual-renderer
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden"
            }}
          >
            <ReviewQuestionRenderer
              q={currentQuestion}
              currentIndex={session.currentIndex}
              showAnswer={session.showAnswer}
              setShowAnswer={session.setShowAnswer}
              handleTextAnswer={session.handleTextAnswer}
              currentTextQuality={null}
              selectedTextQuality={null}
              handleMapComplete={session.handleMapComplete}
              handleImageComplete={session.handleImageComplete}
              handleTimelineComplete={session.handleTimelineComplete}
              submitMapAnswer={session.submitMapTrainingAnswer}
              submitImageAnswer={session.submitImageTrainingAnswer}
              submitTimelineAnswer={session.submitTimelineTrainingAnswer}
              trainingMode
              trainingElapsedMs={null}
              trainingBestTimeMs={null}
              compactVisualLayout
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#111",
        color: "#eee",
        minHeight: "100vh",
        padding: "30px 24px 80px"
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: "1050px" }}>
        {!session.activeScope && (
          <ScopeSelector
            scopes={session.scopes}
            scopesError={session.scopesError}
            scopesLoading={session.scopesLoading}
            startScope={session.startScope}
            loadScopes={session.loadScopes}
            selectedGroupId={selectedGroupId}
            setMode={setMode}
            setSelectedGroupId={setSelectedGroupId}
          />
        )}

        {session.activeScope && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "20px",
                marginBottom: "24px"
              }}
            >
              <div>
                <div
                  style={{
                    color: "#666",
                    fontSize: "12px",
                    fontWeight: "800",
                    marginBottom: "8px",
                    textTransform: "uppercase"
                  }}
                >
                  Training session
                </div>
                <h1
                  style={{
                    fontSize: "36px",
                    lineHeight: 1,
                    margin: "0 0 10px"
                  }}
                >
                  {session.labelForActiveScope}
                </h1>
                <div style={{ color: "#777", fontSize: "14px" }}>
                  {session.allQuestionIds.length} items dans ce scope
                  {activeGroupMode && activeModeConfig
                    ? ` · ${activeModeConfig.labels[activeGroupMode]}`
                    : ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <ReturnToMenuButton
                  onClick={session.returnToScopeSelector}
                  style={buttonStyle}
                />
              </div>
            </div>

            {session.trainingLoading && (
              <div style={{ ...panelStyle, color: "#777", padding: "60px", textAlign: "center" }}>
                Preparation de l'entrainement...
              </div>
            )}

            {!session.trainingLoading && session.trainingError && (
              <div style={{ ...panelStyle, borderColor: "#3a1d1d", color: "#ff9c9c", padding: "60px", textAlign: "center" }}>
                {session.trainingError}
              </div>
            )}

            {!session.trainingLoading &&
              !session.trainingError &&
              session.questions.length === 0 && (
              <div style={{ ...panelStyle, color: "#777", padding: "60px", textAlign: "center" }}>
                Aucun item dans ce scope.
              </div>
            )}

            {session.isComplete && (
              <div style={{ ...panelStyle, padding: "54px", textAlign: "center" }}>
                <div
                  style={{
                    color: "#f3f3f3",
                    fontSize: "28px",
                    fontWeight: "800",
                    marginBottom: "10px"
                  }}
                >
                  Entraînement terminé
                </div>
                <div style={{ color: "#888", marginBottom: "26px" }}>
                  {session.failedCount} item{session.failedCount > 1 ? "s" : ""} a revoir.
                </div>

                {session.recordEligible && (
                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                      margin: "0 auto 22px",
                      maxWidth: "620px"
                    }}
                  >
                    <div style={completionMetricStyle}>
                      <span style={completionMetricLabelStyle}>Score</span>
                      <strong>{completedPercent}</strong>
                    </div>
                    <div style={completionMetricStyle}>
                      <span style={completionMetricLabelStyle}>Trouvés</span>
                      <strong>
                        {session.attemptFoundCount} / {session.allQuestionIds.length}
                      </strong>
                    </div>
                    <div style={completionMetricStyle}>
                      <span style={completionMetricLabelStyle}>Temps</span>
                      <strong>{formatDuration(session.completedRunElapsedMs)}</strong>
                    </div>
                  </div>
                )}

                {session.recordSaveStatus === "saving" && (
                  <div style={{ color: "#888", marginBottom: "18px" }}>
                    Enregistrement du record...
                  </div>
                )}

                {session.recordSaveStatus === "error" && (
                  <div style={{ color: "#ff9c9c", marginBottom: "18px" }}>
                    {session.recordSaveError}
                  </div>
                )}

                {session.recordResult && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      justifyContent: "center",
                      marginBottom: "18px"
                    }}
                  >
                    {session.recordResult.is_new_best_percent && (
                      <span style={recordBadgeStyle}>
                        Nouveau meilleur score
                      </span>
                    )}
                    {session.recordResult.is_new_best_time && (
                      <span style={recordBadgeStyle}>
                        Nouveau record de temps
                      </span>
                    )}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "10px",
                    justifyContent: "center"
                  }}
                >
                  <button
                    type="button"
                    onClick={session.restartFullScope}
                    style={primaryButtonStyle}
                  >
                    Recommencer
                  </button>
                  <button
                    type="button"
                    disabled={session.failedCount === 0}
                    onClick={session.retryFailedItems}
                    style={session.failedCount === 0
                      ? disabledButtonStyle
                      : buttonStyle}
                  >
                    Revoir les erreurs
                  </button>
                  <button
                    type="button"
                    onClick={session.returnToScopeSelector}
                    style={buttonStyle}
                  >
                    ← Retour
                  </button>
                </div>
              </div>
            )}

            {!session.trainingLoading &&
              !session.trainingError &&
              currentQuestion &&
              session.currentIndex < session.questions.length && (
              <>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "16px",
                    marginBottom: "18px"
                  }}
                >
                  <div style={{ color: "#888", fontSize: "14px" }}>
                    Question {session.currentIndex + 1} / {session.questions.length}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      flexWrap: "wrap",
                      justifyContent: "flex-end"
                    }}
                  >
                    {(currentQuestion.tags || []).map(tag => (
                      <div
                        key={tag}
                        style={{
                          background: "#2b2047",
                          borderRadius: "999px",
                          color: "#b69cff",
                          fontSize: "11px",
                          fontWeight: "600",
                          padding: "4px 10px"
                        }}
                      >
                        #{tag}
                      </div>
                    ))}
                  </div>
                </div>

                <ReviewQuestionRenderer
                  q={currentQuestion}
                  currentIndex={session.currentIndex}
                  showAnswer={session.showAnswer}
                  setShowAnswer={session.setShowAnswer}
                  handleTextAnswer={session.handleTextAnswer}
                  currentTextQuality={null}
                  selectedTextQuality={null}
                  handleMapComplete={session.handleMapComplete}
                  handleImageComplete={session.handleImageComplete}
                  handleTimelineComplete={session.handleTimelineComplete}
                  submitMapAnswer={session.submitMapTrainingAnswer}
                  submitImageAnswer={session.submitImageTrainingAnswer}
                  submitTimelineAnswer={session.submitTimelineTrainingAnswer}
                  trainingMode
                  trainingElapsedMs={session.recordEligible ? session.completedRunElapsedMs : null}
                  trainingBestTimeMs={session.recordEligible ? displayedRecord?.best_time_ms : null}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
