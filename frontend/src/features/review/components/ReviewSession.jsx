import ReviewQuestionRenderer from "./ReviewQuestionRenderer";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import "./ReviewSession.css";

function isVisualQuestion(question) {
  return ["image", "map", "timeline"].includes(question?.type_q);
}

function visualSessionName(question) {
  return question?.name || question?.question || question?.media || "Session visuelle";
}

function reviewItemCount(question) {
  return Array.isArray(question?.items) ? question.items.length : 1;
}

function reviewedQuestionsLabel(count) {
  return count === 1 ? "1 question revue" : `${count} questions revues`;
}

function ReviewOutcomePanel({
  variant,
  reviewedCount,
  canReturnToLastQuestion,
  returnToLastQuestion,
  canStartBonusReview,
  startBonusReview,
  bonusReviewLoading,
  bonusReviewMessage,
  bonusReviewStatus,
  bonusStatusLoading
}) {
  const isFinished = variant === "finished";
  const titleId = `review-outcome-title-${variant}`;
  const bonusState = bonusStatusLoading
    ? "loading"
    : bonusReviewStatus?.state || "unknown";
  const bonusStatusLabel = bonusStatusLoading
    ? "Analyse"
    : canStartBonusReview
      ? "Bonus disponible"
      : bonusState === "full"
        ? "Planning plein"
        : bonusState === "no_new"
          ? "Aucun bonus"
          : "Repos";
  const showBonusMessage = bonusStatusLoading || Boolean(bonusReviewMessage);

  return (
    <section
      aria-labelledby={titleId}
      className={`review-outcome review-outcome-${variant}`}
      data-review-outcome={variant}
    >
      <div className="review-outcome-main">
        <div className="review-outcome-kicker">
          {isFinished ? "Journée bouclée" : "Planning à jour"}
        </div>

        <h2 className="review-outcome-title" id={titleId}>
          {isFinished ? "Session terminée" : "Aucune question pour aujourd’hui"}
        </h2>

        <p className="review-outcome-copy">
          {isFinished
            ? "Toutes les questions ont été révisées."
            : "Rien n’est dû pour le moment. La révision du jour est propre et tu peux garder ton rythme."}
        </p>

        <div className="review-outcome-metrics" aria-label="Résumé de la session">
          <div className="review-outcome-metric">
            <span>{isFinished ? reviewedQuestionsLabel(reviewedCount) : "0 question à revoir"}</span>
            <strong>{isFinished ? "Révision" : "Aujourd’hui"}</strong>
          </div>
          <div className="review-outcome-metric">
            <span>{bonusStatusLabel}</span>
            <strong>Suite</strong>
          </div>
        </div>

        {showBonusMessage && (
          <p
            aria-live="polite"
            className={`review-outcome-bonus review-outcome-bonus-${bonusState}`}
          >
            {bonusStatusLoading
              ? "Analyse du planning bonus..."
              : bonusReviewMessage}
          </p>
        )}

        {(canReturnToLastQuestion || canStartBonusReview) && (
          <div className="review-outcome-actions">
            {canReturnToLastQuestion && (
              <button
                className="review-outcome-button review-outcome-button-secondary"
                type="button"
                onClick={returnToLastQuestion}
              >
                Modifier la dernière réponse
              </button>
            )}

            {canStartBonusReview && (
              <button
                className="review-outcome-button review-outcome-button-primary"
                type="button"
                onClick={startBonusReview}
                disabled={bonusReviewLoading}
              >
                {bonusReviewLoading
                  ? "Chargement des bonus..."
                  : "Faire des questions bonus"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="review-outcome-visual" aria-hidden="true">
        <div className="review-outcome-symbol">
          {isFinished ? <span className="review-outcome-check" /> : "0"}
        </div>
        <div className="review-outcome-lanes">
          <span className="review-outcome-lane review-outcome-lane-violet" />
          <span className="review-outcome-lane review-outcome-lane-amber" />
          <span className="review-outcome-lane review-outcome-lane-green" />
          <span className="review-outcome-lane review-outcome-lane-blue" />
        </div>
      </div>
    </section>
  );
}

function BonusReviewQueueControls({
  canSkipCurrentQuestion,
  skipCurrentQuestion,
  canReturnToLastSkippedQuestion,
  returnToLastSkippedQuestion,
  skippedQuestionCount = 0
}) {
  if (!canSkipCurrentQuestion && !canReturnToLastSkippedQuestion) {
    return null;
  }

  return (
    <div className="bonus-review-controls" aria-label="Navigation des bonus">
      {canSkipCurrentQuestion && (
        <button
          type="button"
          className="bonus-review-control bonus-review-control-set-aside"
          onClick={skipCurrentQuestion}
          title="Mettre cette question de côté sans la noter"
          aria-label="Mettre cette question de côté sans la noter"
        >
          <span className="bonus-review-control-icon" aria-hidden="true">↷</span>
          <span>Mettre de côté</span>
        </button>
      )}

      {canReturnToLastSkippedQuestion && (
        <button
          type="button"
          className="bonus-review-control bonus-review-control-return"
          onClick={returnToLastSkippedQuestion}
          title="Reprendre la dernière question mise de côté"
          aria-label="Reprendre la dernière question mise de côté"
        >
          <span className="bonus-review-control-icon" aria-hidden="true">↩</span>
          <span>Reprendre</span>
          {skippedQuestionCount > 0 && (
            <span className="bonus-review-control-count" aria-label={`${skippedQuestionCount} en attente`}>
              {skippedQuestionCount}
            </span>
          )}
        </button>
      )}
    </div>
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
  canReturnToLastQuestion,
  returnToLastQuestion,
  canSkipCurrentQuestion,
  skipCurrentQuestion,
  canReturnToLastSkippedQuestion,
  returnToLastSkippedQuestion,
  skippedQuestionCount,
  canStartBonusReview,
  startBonusReview,
  bonusReviewMessage,
  bonusReviewStatus,
  bonusReviewLoading,
  bonusStatusLoading,
  reviewLoading,
  reviewError,
  submitMapAnswer,
  submitImageAnswer,
  submitTimelineAnswer
}) {
  const currentQuestion = questions[currentIndex];
  const reviewedCount = questions.reduce(
    (total, question) => total + reviewItemCount(question),
    0
  );
  const hasActiveQuestion = Boolean(
    !reviewLoading &&
    !reviewError &&
    currentQuestion &&
    currentIndex < questions.length
  );
  const useCompactVisualLayout = hasActiveQuestion && isVisualQuestion(currentQuestion);

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
              <BonusReviewQueueControls
                canSkipCurrentQuestion={canSkipCurrentQuestion}
                skipCurrentQuestion={skipCurrentQuestion}
                canReturnToLastSkippedQuestion={canReturnToLastSkippedQuestion}
                returnToLastSkippedQuestion={returnToLastSkippedQuestion}
                skippedQuestionCount={skippedQuestionCount}
              />

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
                Révision
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
                {visualSessionName(currentQuestion)}
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
                Question {currentIndex + 1} / {questions.length}
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
              submitMapAnswer={submitMapAnswer}
              submitImageAnswer={submitImageAnswer}
              submitTimelineAnswer={submitTimelineAnswer}
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
        minHeight: "100vh",
        background: "#111",
        color: "#eee",
        padding: "30px 24px 80px"
      }}
    >

      <div
        style={{
          maxWidth: "1050px",
          margin: "0 auto"
        }}
      >

        {/* HEADER */}
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
              {questions.length} questions disponibles
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

        {/* EMPTY */}
        {!reviewLoading && !reviewError && questions.length === 0 && (
          <ReviewOutcomePanel
            variant="empty"
            reviewedCount={0}
            canReturnToLastQuestion={false}
            returnToLastQuestion={returnToLastQuestion}
            canStartBonusReview={canStartBonusReview}
            startBonusReview={startBonusReview}
            bonusReviewLoading={bonusReviewLoading}
            bonusReviewMessage={bonusReviewMessage}
            bonusReviewStatus={bonusReviewStatus}
            bonusStatusLoading={bonusStatusLoading}
          />
        )}

        {/* FINISHED */}
        {!reviewLoading &&
          !reviewError &&
          currentIndex >= questions.length &&
          questions.length > 0 && (
          <ReviewOutcomePanel
            variant="finished"
            reviewedCount={reviewedCount}
            canReturnToLastQuestion={canReturnToLastQuestion}
            returnToLastQuestion={returnToLastQuestion}
            canStartBonusReview={canStartBonusReview}
            startBonusReview={startBonusReview}
            bonusReviewLoading={bonusReviewLoading}
            bonusReviewMessage={bonusReviewMessage}
            bonusReviewStatus={bonusReviewStatus}
            bonusStatusLoading={bonusStatusLoading}
          />
        )}

        {/* QUESTION */}
        {!reviewLoading &&
          !reviewError &&
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
                  Question {currentIndex + 1} / {questions.length}
                </div>

                <BonusReviewQueueControls
                  canSkipCurrentQuestion={canSkipCurrentQuestion}
                  skipCurrentQuestion={skipCurrentQuestion}
                  canReturnToLastSkippedQuestion={canReturnToLastSkippedQuestion}
                  returnToLastSkippedQuestion={returnToLastSkippedQuestion}
                  skippedQuestionCount={skippedQuestionCount}
                />

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
              submitMapAnswer={submitMapAnswer}
              submitImageAnswer={submitImageAnswer}
              submitTimelineAnswer={submitTimelineAnswer}
            />

          </>
        )}

      </div>

    </div>
  );
}
