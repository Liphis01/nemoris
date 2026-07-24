import { useEffect, useRef, useState } from "react";
import ReviewQuestionRenderer from "./ReviewQuestionRenderer";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import { isRelearningQuestion } from "../relearningGrades";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import "./ReviewSession.css";

// A group with more than one available question opens the count slider; a single
// question (loose or a group of one) has nothing to choose and starts on click.
const DEFAULT_BONUS_COUNT = 20;

function isVisualQuestion(question) {
  return (
    ["media", "map", "timeline"].includes(question?.type_q) ||
    (question?.type_q === "text" && Array.isArray(question?.items)) ||
    (question?.type_q === "sequence" && Array.isArray(question?.items))
  );
}

function RelearningBadge({ compact = false }) {
  return (
    <div
      data-relearning-badge
      title="Question ratée : elle revient jusqu'à ce qu'elle soit sue. Les essais suivants ne comptent pas comme de nouveaux oublis."
      style={{
        alignItems: "center",
        background: "#3a2413",
        border: "1px solid #6b4a21",
        borderRadius: "999px",
        color: "#f0a868",
        display: "inline-flex",
        fontSize: compact ? "11px" : "12px",
        fontWeight: 800,
        gap: "6px",
        letterSpacing: "0.04em",
        padding: compact ? "3px 9px" : "5px 11px",
        textTransform: "uppercase",
        whiteSpace: "nowrap"
      }}
    >
      <span aria-hidden="true">↻</span>
      Réapprentissage
    </div>
  );
}

// Shows how many failed questions are still waiting to be relearned, kept apart
// from the "Question X / Y" total so re-queued retries never inflate Y.
function RelearningCountChip({ count, compact = false }) {
  return (
    <div
      data-relearning-count
      title="Questions ratées à revoir avant la fin de la session. Elles ne sont pas comptées dans le total."
      style={{
        alignItems: "center",
        background: "#241a10",
        border: "1px solid #4a3418",
        borderRadius: "999px",
        color: "#e0a05c",
        display: "inline-flex",
        fontSize: compact ? "11px" : "12px",
        fontWeight: 800,
        gap: "5px",
        padding: compact ? "3px 9px" : "4px 10px",
        whiteSpace: "nowrap"
      }}
    >
      <span aria-hidden="true">↻</span>
      {compact ? count : `${count} à revoir`}
    </div>
  );
}

function bonusQuestionsLabel(count) {
  return count === 1 ? "1 question bonus" : `${count} questions bonus`;
}

function chunkEntries(entries, size) {
  const rows = [];

  for (let i = 0; i < entries.length; i += size) {
    rows.push(entries.slice(i, i + size));
  }

  return rows;
}

function BonusReviewMenu({
  entries,
  loading,
  selectBonusItem,
  itemLoading,
  setMode,
  canReturnToLastQuestion,
  returnToLastQuestion
}) {
  const allDone = !loading && entries.length === 0;
  const [openKey, setOpenKey] = useState(null);
  const [counts, setCounts] = useState({});
  const [rowSize, setRowSize] = useState(1);
  const listRef = useRef(null);

  // The grid is auto-fill (see .bonus-menu-list), so its column count depends
  // on the panel's width rather than any fixed number. Reading it back from
  // the resolved computed style — instead of guessing a constant — lets the
  // open card's picker break onto a full-width row right after the row it
  // belongs to, however many cards actually share that row.
  useEffect(() => {
    const node = listRef.current;
    if (!node) return undefined;

    function syncRowSize() {
      const columns = getComputedStyle(node)
        .gridTemplateColumns
        .split(" ")
        .filter(Boolean).length;

      setRowSize(prev => (columns > 0 && columns !== prev ? columns : prev));
    }

    syncRowSize();

    const observer = new ResizeObserver(syncRowSize);
    observer.observe(node);

    return () => observer.disconnect();
  }, [loading, allDone]);

  const bonusCountFor = (entry) =>
    counts[entry.key] ?? Math.min(DEFAULT_BONUS_COUNT, entry.itemCount);

  const toggleEntry = (entry) => {
    // Nothing to choose for a single question — start it straight away. A
    // multi-question group opens (or closes) its count slider instead.
    if (entry.itemCount <= 1) {
      selectBonusItem(entry);
      return;
    }

    setOpenKey(prev => (prev === entry.key ? null : entry.key));
  };

  const setBonusCount = (entry, value) => {
    const clamped = Math.max(1, Math.min(entry.itemCount, Number(value) || 1));
    setCounts(prev => ({ ...prev, [entry.key]: clamped }));
  };

  return (
    <section className="bonus-menu" aria-label="Questions bonus">
      <div className="bonus-menu-head">
        <div>
          <div className="bonus-menu-kicker">Questions bonus</div>
          <h2 className="bonus-menu-title">
            {loading
              ? "Recherche de questions bonus"
              : allDone
                ? "Bonus terminés"
                : "Choisis une question à réviser"}
          </h2>
          <p className="bonus-menu-copy">
            {loading
              ? "Un instant, on regarde ce qu'il reste à faire."
              : allDone
                ? "Tu as fait toutes les questions bonus disponibles."
                : "Sélectionne la question ou le groupe que tu veux faire. Tu reviens ici après chaque item."}
          </p>
        </div>

        <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "8px" }}>
          {canReturnToLastQuestion && (
            <button
              type="button"
              onClick={returnToLastQuestion}
              style={{
                background: "#1a1a1a",
                border: "1px solid #2a2a2a",
                borderRadius: "10px",
                color: "#bbb",
                cursor: "pointer",
                fontSize: "14px",
                padding: "10px 14px"
              }}
            >
              Modifier la dernière réponse
            </button>
          )}

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
      </div>

      {loading ? (
        <p className="bonus-menu-loading">Chargement...</p>
      ) : allDone ? (
        <div className="bonus-menu-empty">
          <button
            type="button"
            className="review-outcome-button review-outcome-button-primary"
            onClick={() => setMode("menu")}
          >
            Retour au menu
          </button>
        </div>
      ) : (
        <ul className="bonus-menu-list app-scrollbar" ref={listRef}>
          {chunkEntries(entries, rowSize).flatMap(row => {
            const cards = row.map(entry => {
              const expandable = entry.itemCount > 1;
              const isOpen = expandable && openKey === entry.key;
              const typeStyle = getQuestionTypeChipStyle(entry.typeQ);

              return (
                <li
                  key={entry.key}
                  className={`bonus-menu-card${isOpen ? " bonus-menu-card-open" : ""}`}
                >
                  <button
                    type="button"
                    className="bonus-menu-row"
                    onClick={() => toggleEntry(entry)}
                    disabled={itemLoading}
                    aria-busy={itemLoading}
                    aria-expanded={expandable ? isOpen : undefined}
                    style={{
                      "--bonus-type-bg": typeStyle.background,
                      "--bonus-type-color": typeStyle.color
                    }}
                  >
                    <span className="bonus-menu-row-top">
                      <span className="bonus-menu-row-type">
                        {entry.typeLabel}
                      </span>
                      {entry.isContainer && (
                        <span className="bonus-menu-row-count">
                          {entry.itemCount}
                        </span>
                      )}
                    </span>

                    <span className="bonus-menu-row-label">
                      {entry.label}
                    </span>

                    <span className="bonus-menu-row-foot">
                      <span className="bonus-menu-row-tags">
                        {(entry.tags || []).slice(0, 3).map(tag => (
                          <span key={tag} className="bonus-menu-row-tag">#{tag}</span>
                        ))}
                      </span>
                      <span className="bonus-menu-row-arrow" aria-hidden="true">
                        {itemLoading ? "…" : expandable ? (isOpen ? "▾" : "▸") : "→"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            });

            // The open card (if any) in this row gets its picker rendered as a
            // full-width row right after it, instead of the card itself going
            // full-width in place -- that would force grid auto-placement to
            // bump every other card in the row down (see ReviewSession.css).
            const openEntry = row.find(
              entry => entry.itemCount > 1 && entry.key === openKey
            );

            if (!openEntry) {
              return cards;
            }

            const count = bonusCountFor(openEntry);
            // WebKit can't paint a range's filled portion on its own, so drive it
            // from the value as a percentage (Firefox uses ::-moz-range-progress).
            const fillPercent = ((count - 1) / (openEntry.itemCount - 1)) * 100;

            return [
              ...cards,
              <li key={`${openEntry.key}-picker`} className="bonus-menu-picker-row">
                <div className="bonus-menu-picker">
                  <div className="bonus-menu-picker-count">
                    <strong>{bonusQuestionsLabel(count)}</strong>
                    <span className="bonus-menu-picker-total">
                      sur {openEntry.itemCount} disponibles
                    </span>
                  </div>
                  <input
                    type="range"
                    className="bonus-menu-picker-slider"
                    style={{ "--bonus-fill": `${fillPercent}%` }}
                    min={1}
                    max={openEntry.itemCount}
                    value={count}
                    onChange={event => setBonusCount(openEntry, event.target.value)}
                    aria-label={`Nombre de questions bonus pour ${openEntry.label}`}
                  />
                  <button
                    type="button"
                    className="review-outcome-button review-outcome-button-primary"
                    onClick={() => selectBonusItem(openEntry, count)}
                    disabled={itemLoading}
                    aria-busy={itemLoading}
                  >
                    {itemLoading ? "Chargement…" : "Commencer →"}
                  </button>
                </div>
              </li>
            ];
          })}
        </ul>
      )}
    </section>
  );
}

export default function ReviewSession({
  setMode,
  questions,
  currentIndex,
  showAnswer,
  setShowAnswer,
  handleTextAnswer,
  currentTextQuality,
  selectedTextQuality,
  handleMapComplete,
  handleImageComplete,
  handleTimelineComplete,
  handleSequenceComplete,
  canReturnToLastQuestion,
  returnToLastQuestion,
  bonusReviewActive,
  bonusReviewLoading,
  bonusItemLoading,
  bonusStatusLoading,
  bonusMenuOpen,
  bonusMenuEntries,
  selectBonusItem,
  returnToBonusMenu,
  skipToBonusMenu,
  reviewLoading,
  reviewError,
  submitMapAnswer,
  submitMediaAnswer,
  submitTextAnswer,
  submitTimelineAnswer,
  submitSequenceAnswer,
  graduateGroupedAnswer
}) {
  const currentQuestion = questions[currentIndex];
  const hasActiveQuestion = Boolean(
    !reviewLoading &&
    !reviewError &&
    !bonusMenuOpen &&
    currentQuestion &&
    currentIndex < questions.length
  );
  const useCompactVisualLayout = hasActiveQuestion && isVisualQuestion(currentQuestion);
  const showReturnToBonusMenu = bonusReviewActive && !bonusMenuOpen;
  const headerSubtitle = `${questions.length} questions disponibles`;
  const relearning = hasActiveQuestion && isRelearningQuestion(currentQuestion);
  // Failing a question appends a retry to `questions`, so its length grows as
  // the session goes. The counter denominator stays the number of distinct
  // questions the session started with, and the relearning retries are surfaced
  // separately instead of inflating the total.
  const baseQuestionTotal = questions.reduce(
    (total, question) => total + (isRelearningQuestion(question) ? 0 : 1),
    0
  );
  const questionsReachedThroughCurrent = questions
    .slice(0, currentIndex + 1)
    .reduce(
      (total, question) => total + (isRelearningQuestion(question) ? 0 : 1),
      0
    );
  // On a relearning pass every base question has already been reached, so the
  // counter rests at the total rather than counting past it.
  const questionNumber = relearning
    ? baseQuestionTotal
    : questionsReachedThroughCurrent;
  // Failed questions still queued behind the current one. The current card, if
  // it is itself a retry, is left out: the RÉAPPRENTISSAGE badge already marks
  // it, so the count reads as "still waiting" rather than double-marking it.
  const relearningRemaining = questions.reduce(
    (total, question, index) =>
      total + (isRelearningQuestion(question) && index > currentIndex ? 1 : 0),
    0
  );
  const showRelearningCount = hasActiveQuestion && relearningRemaining > 0;
  // True once the current question and everything still queued behind it are
  // relearning retries: the day's fresh queue is exhausted, so there's nothing
  // left to skip by jumping to bonus early.
  const onlyRelearningLeft = hasActiveQuestion &&
    questions.slice(currentIndex).every(isRelearningQuestion);
  // Only offered during the original review: once bonus is already active this
  // would just duplicate the existing "← Menu bonus" action.
  const showSkipToBonusMenu = onlyRelearningLeft && !bonusReviewActive;

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
          height: "100%",
          minWidth: 0,
          overflow: "hidden",
          width: "100%"
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
              padding: "10px 14px",
              position: "relative"
            }}
          >
            <div
              data-visual-session-actions
              style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                gridColumn: "1",
                justifyContent: "flex-start",
                minWidth: 0
              }}
            >
              {showReturnToBonusMenu && (
                <button
                  type="button"
                  onClick={returnToBonusMenu}
                  title="Revenir au menu des questions bonus"
                  style={{
                    background: "#1f1f1f",
                    border: "1px solid #333",
                    borderRadius: "9px",
                    color: "#ccc",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 700,
                    padding: "7px 10px"
                  }}
                >
                  ← Menu bonus
                </button>
              )}

              {showSkipToBonusMenu && (
                <button
                  type="button"
                  onClick={skipToBonusMenu}
                  title="Passer directement aux questions bonus"
                  style={{
                    background: "#1f1f1f",
                    border: "1px solid #333",
                    borderRadius: "9px",
                    color: "#ccc",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 700,
                    padding: "7px 10px"
                  }}
                >
                  Questions bonus →
                </button>
              )}

              {canReturnToLastQuestion && (
                <button
                  type="button"
                  onClick={returnToLastQuestion}
                  style={{
                    background: "#1f1f1f",
                    border: "1px solid #333",
                    borderRadius: "9px",
                    color: "#ccc",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 700,
                    padding: "7px 10px"
                  }}
                >
                  ← Réponse précédente
                </button>
              )}

              <ReturnToMenuButton
                onClick={() => setMode("menu")}
                style={{
                  background: "#1a1a1a",
                  border: "1px solid #2a2a2a",
                  borderRadius: "9px",
                  color: "#bbb",
                  cursor: "pointer",
                  fontSize: "13px",
                  padding: "8px 11px"
                }}
              />
            </div>

            <div
              data-visual-session-status
              style={{
                alignItems: "center",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                justifyContent: "center",
                left: "50%",
                maxWidth: "min(520px, calc(100% - 320px))",
                minWidth: 0,
                pointerEvents: "none",
                position: "absolute",
                textAlign: "center",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: "100%"
              }}
            >
              {relearning ? (
                <RelearningBadge compact />
              ) : (
                <div
                  style={{
                    color: "#f0c36a",
                    fontSize: "11px",
                    fontWeight: 900,
                    textTransform: "uppercase"
                  }}
                >
                  {bonusReviewActive ? "Bonus" : "Révision"}
                </div>
              )}
              <div
                style={{
                  color: "#888",
                  fontSize: "12px",
                  fontWeight: 800,
                  lineHeight: 1.2
                }}
              >
                Question {questionNumber} / {baseQuestionTotal}
              </div>
              {showRelearningCount && (
                <RelearningCountChip count={relearningRemaining} compact />
              )}
              {(currentQuestion.tags || []).length > 0 && (
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px 8px",
                    justifyContent: "center",
                    lineHeight: 1.2
                  }}
                >
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
              )}
            </div>

            <div
              data-visual-session-secondary
              style={{
                alignItems: "center",
                display: "flex",
                gridColumn: "3",
                justifyContent: "flex-end",
                minWidth: 0
              }}
            >
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
              currentIndex={currentIndex}
              showAnswer={showAnswer}
              setShowAnswer={setShowAnswer}
              handleTextAnswer={handleTextAnswer}
              currentTextQuality={currentTextQuality}
              selectedTextQuality={selectedTextQuality}
              handleMapComplete={handleMapComplete}
              handleImageComplete={handleImageComplete}
              handleTimelineComplete={handleTimelineComplete}
              handleSequenceComplete={handleSequenceComplete}
              submitMapAnswer={submitMapAnswer}
              submitMediaAnswer={submitMediaAnswer}
              submitTextAnswer={submitTextAnswer}
              submitTimelineAnswer={submitTimelineAnswer}
              submitSequenceAnswer={submitSequenceAnswer}
              graduateGroupedAnswer={graduateGroupedAnswer}
              allowPartialSubmit={bonusReviewActive}
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
        boxSizing: "border-box",
        color: "#eee",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        width: "100%"
      }}
    >

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: "1050px",
          margin: "0 auto",
          height: "100%",
          minHeight: 0,
          overflow: "hidden"
        }}
      >

        {/* HEADER — hidden while the bonus menu owns the screen */}
        {!bonusMenuOpen && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "28px",
              gap: "20px"
            }}
          >

            <div>

              <div
                style={{
                  color: "#666",
                  fontSize: "12px",
                  letterSpacing: "0.08em",
                  marginBottom: "8px"
                }}
              >
                REVIEW SESSION
              </div>

              <h1
                style={{
                  margin: 0,
                  fontSize: "38px",
                  lineHeight: 1,
                  marginBottom: "12px"
                }}
              >
                Révision
              </h1>

              <div
                style={{
                  color: "#777",
                  fontSize: "14px"
                }}
              >
                {headerSubtitle}
              </div>

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
        )}

        {/* LOADING */}
        {reviewLoading && (
          <div
            style={{
              background: "#181818",
              border: "1px solid #262626",
              borderRadius: "18px",
              padding: "60px",
              textAlign: "center",
              color: "#777"
            }}
          >
            Préparation de la session...
          </div>
        )}

        {/* ERROR */}
        {!reviewLoading && reviewError && (
          <div
            style={{
              background: "#181818",
              border: "1px solid #3a1d1d",
              borderRadius: "18px",
              padding: "60px",
              textAlign: "center",
              color: "#ff9c9c"
            }}
          >
            {reviewError}
          </div>
        )}

        {/* BONUS MENU — the only screen once the queue ends, whether nothing
            was due today or everything just got answered. It owns its own
            loading state, so there's no separate "session over" step first. */}
        {!reviewLoading && !reviewError && bonusMenuOpen && (
          <BonusReviewMenu
            entries={bonusMenuEntries}
            loading={bonusStatusLoading || bonusReviewLoading}
            selectBonusItem={selectBonusItem}
            itemLoading={bonusItemLoading}
            setMode={setMode}
            canReturnToLastQuestion={canReturnToLastQuestion}
            returnToLastQuestion={returnToLastQuestion}
          />
        )}

        {/* QUESTION */}
        {!reviewLoading &&
          !reviewError &&
          !bonusMenuOpen &&
          currentQuestion &&
          currentIndex < questions.length && (
          <>

            {/* TOP BAR */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "18px"
              }}
            >

              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap"
                }}
              >
                <div
                  style={{
                    color: "#888",
                    fontSize: "14px"
                  }}
                >
                  Question {questionNumber} / {baseQuestionTotal}
                </div>

                {showRelearningCount && (
                  <RelearningCountChip count={relearningRemaining} />
                )}

                {relearning && <RelearningBadge />}

                {showReturnToBonusMenu && (
                  <button
                    type="button"
                    onClick={returnToBonusMenu}
                    title="Revenir au menu des questions bonus"
                    style={{
                      background: "#1f1f1f",
                      border: "1px solid #333",
                      color: "#ccc",
                      padding: "7px 10px",
                      borderRadius: "10px",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: "650"
                    }}
                  >
                    ← Menu bonus
                  </button>
                )}

                {showSkipToBonusMenu && (
                  <button
                    type="button"
                    onClick={skipToBonusMenu}
                    title="Passer directement aux questions bonus"
                    style={{
                      background: "#1f1f1f",
                      border: "1px solid #333",
                      color: "#ccc",
                      padding: "7px 10px",
                      borderRadius: "10px",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: "650"
                    }}
                  >
                    Questions bonus →
                  </button>
                )}

                {canReturnToLastQuestion && (
                  <button
                    type="button"
                    onClick={returnToLastQuestion}
                    style={{
                      background: "#1f1f1f",
                      border: "1px solid #333",
                      color: "#ccc",
                      padding: "7px 10px",
                      borderRadius: "10px",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: "650"
                    }}
                  >
                    ← Réponse précédente
                  </button>
                )}
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
                      color: "#b69cff",
                      padding: "4px 10px",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: "600"
                    }}
                  >
                    #{tag}
                  </div>
                ))}
              </div>

            </div>

            <ReviewQuestionRenderer
              q={currentQuestion}
              currentIndex={currentIndex}
              showAnswer={showAnswer}
              setShowAnswer={setShowAnswer}
              handleTextAnswer={handleTextAnswer}
              currentTextQuality={currentTextQuality}
              selectedTextQuality={selectedTextQuality}
              handleMapComplete={handleMapComplete}
              handleImageComplete={handleImageComplete}
              handleTimelineComplete={handleTimelineComplete}
              handleSequenceComplete={handleSequenceComplete}
              submitMapAnswer={submitMapAnswer}
              submitMediaAnswer={submitMediaAnswer}
              submitTextAnswer={submitTextAnswer}
              submitTimelineAnswer={submitTimelineAnswer}
              submitSequenceAnswer={submitSequenceAnswer}
              graduateGroupedAnswer={graduateGroupedAnswer}
              allowPartialSubmit={bonusReviewActive}
            />

          </>
        )}

      </div>

    </div>
  );
}
