import { useMemo, useState } from "react";
import ReviewQuestionRenderer from "../../review/components/ReviewQuestionRenderer";
import { useTrainingSession } from "../hooks/useTrainingSession";


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


function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}


function ScopeSelector({
  scopes,
  scopesError,
  scopesLoading,
  startScope,
  loadScopes,
  setMode
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

  return (
    <div style={{ ...panelStyle, padding: "24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "16px",
          marginBottom: "22px",
          alignItems: "flex-start"
        }}
      >
        <div>
          <div
            style={{
              color: "#777",
              fontSize: "12px",
              fontWeight: "800",
              marginBottom: "8px",
              textTransform: "uppercase"
            }}
          >
            Training
          </div>
          <h1
            style={{
              color: "#f3f3f3",
              fontSize: "34px",
              lineHeight: 1.1,
              margin: 0
            }}
          >
            Entrainement
          </h1>
        </div>

        <button type="button" onClick={() => setMode("menu")} style={buttonStyle}>
          Retour menu
        </button>
      </div>

      {scopesLoading && (
        <div style={{ color: "#777", padding: "34px 0" }}>
          Chargement des choix...
        </div>
      )}

      {!scopesLoading && scopesError && (
        <div
          style={{
            border: "1px solid #3a1d1d",
            borderRadius: "8px",
            color: "#ff9c9c",
            padding: "18px"
          }}
        >
          <div style={{ marginBottom: "12px" }}>{scopesError}</div>
          <button type="button" onClick={loadScopes} style={buttonStyle}>
            Recharger
          </button>
        </div>
      )}

      {!scopesLoading && !scopesError && (
        <>
          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "auto auto minmax(0, 1fr)",
              marginBottom: "18px"
            }}
          >
            <button
              type="button"
              onClick={() => setScopeType("group")}
              style={scopeType === "group" ? primaryButtonStyle : buttonStyle}
            >
              Groupes
            </button>
            <button
              type="button"
              onClick={() => setScopeType("tag")}
              style={scopeType === "tag" ? primaryButtonStyle : buttonStyle}
            >
              Tags
            </button>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Recherche..."
              style={{
                background: "#101010",
                border: "1px solid #2f2f2f",
                borderRadius: "8px",
                boxSizing: "border-box",
                color: "#eee",
                fontSize: "14px",
                outline: "none",
                padding: "11px 12px",
                width: "100%"
              }}
            />
          </div>

          {activeRows.length === 0 ? (
            <div style={{ color: "#777", padding: "34px 0" }}>
              Aucun choix disponible.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: "10px",
                gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))"
              }}
            >
              {scopeType === "group" && groups.map(group => (
                <button
                  type="button"
                  key={group.id}
                  onClick={() => startScope({
                    type: "group",
                    id: group.id,
                    name: group.name,
                    type_group: group.type_group
                  })}
                  style={{
                    ...buttonStyle,
                    alignItems: "flex-start",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    minHeight: "104px",
                    textAlign: "left"
                  }}
                >
                  <span style={{ color: "#ffcc7a", fontSize: "12px", textTransform: "uppercase" }}>
                    {group.type_group}
                  </span>
                  <span style={{ fontSize: "18px" }}>{group.name}</span>
                  <span style={{ color: "#999", fontSize: "13px" }}>
                    {group.question_count || 0} question{group.question_count > 1 ? "s" : ""}
                  </span>
                </button>
              ))}

              {scopeType === "tag" && tags.map(tag => (
                <button
                  type="button"
                  key={tag.name}
                  onClick={() => startScope({
                    type: "tag",
                    name: tag.name
                  })}
                  style={{
                    ...buttonStyle,
                    alignItems: "flex-start",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    minHeight: "92px",
                    textAlign: "left"
                  }}
                >
                  <span style={{ color: "#b69cff", fontSize: "18px" }}>
                    #{tag.name}
                  </span>
                  <span style={{ color: "#999", fontSize: "13px" }}>
                    {tag.count || 0} question{tag.count > 1 ? "s" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


export default function TrainingSession({ setMode }) {
  const session = useTrainingSession(true);
  const currentQuestion = session.questions[session.currentIndex];

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
            setMode={setMode}
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
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={session.returnToScopeSelector}
                  style={buttonStyle}
                >
                  Changer
                </button>
                <button
                  type="button"
                  onClick={() => setMode("menu")}
                  style={buttonStyle}
                >
                  Retour menu
                </button>
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
                  Entrainement termine
                </div>
                <div style={{ color: "#888", marginBottom: "26px" }}>
                  {session.failedCount} item{session.failedCount > 1 ? "s" : ""} a revoir.
                </div>

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
                    Retour
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
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
