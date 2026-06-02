import ReviewQuestionRenderer from "./ReviewQuestionRenderer";

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
  canStartBonusReview,
  startBonusReview,
  bonusReviewLoading,
  dailyGroveCompletion,
  dailyGroveCompletionError,
  dailyGroveCompletionLoading,
  reviewLoading,
  reviewError
}) {
  const currentQuestion = questions[currentIndex];

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
            <div>🎉 Aucune question pour aujourd’hui</div>

            {canStartBonusReview && (
              <button
                type="button"
                onClick={startBonusReview}
                disabled={bonusReviewLoading}
                style={{
                  background: bonusReviewLoading ? "#202020" : "#233228",
                  border: "1px solid #385544",
                  color: bonusReviewLoading ? "#888" : "#d7f5df",
                  display: "inline-flex",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  cursor: bonusReviewLoading ? "default" : "pointer",
                  fontWeight: "650",
                  fontSize: "14px",
                  marginTop: "22px"
                }}
              >
                {bonusReviewLoading
                  ? "Chargement des bonus..."
                  : "Faire des questions bonus"}
              </button>
            )}
          </div>
        )}

        {/* FINISHED */}
        {!reviewLoading &&
          !reviewError &&
          currentIndex >= questions.length &&
          questions.length > 0 && (
          <div
            style={{
              background: "#181818",
              border: "1px solid #262626",
              borderRadius: "18px",
              padding: "60px",
              textAlign: "center"
            }}
          >

            <div
              style={{
                fontSize: "42px",
                marginBottom: "16px"
              }}
            >
              🎉
            </div>

            <div
              style={{
                fontSize: "28px",
                fontWeight: "700",
                marginBottom: "10px"
              }}
            >
              Session terminée
            </div>

            <div
              style={{
                color: "#777"
              }}
            >
              Toutes les questions ont été révisées.
            </div>

            <div
              style={{
                background: "#171d19",
                border: "1px solid rgba(126, 226, 168, 0.2)",
                borderRadius: "12px",
                color: "#cfe9d8",
                margin: "24px auto 0",
                maxWidth: "420px",
                padding: "14px 16px",
                textAlign: "left"
              }}
            >
              <div
                style={{
                  color: "#7ee2a8",
                  fontSize: "11px",
                  fontWeight: "800",
                  letterSpacing: "0.06em",
                  marginBottom: "6px",
                  textTransform: "uppercase"
                }}
              >
                Bosquet Nemoris
              </div>

              <div
                style={{
                  color: "#e8f6ed",
                  fontSize: "16px",
                  fontWeight: "750",
                  lineHeight: 1.35
                }}
              >
                {!dailyGroveCompletionLoading &&
                  !dailyGroveCompletionError &&
                  !dailyGroveCompletion &&
                  "Validation du jour..."}
                {dailyGroveCompletionLoading && "Arrosage du bosquet..."}
                {!dailyGroveCompletionLoading &&
                  dailyGroveCompletionError &&
                  "Synchronisation du bosquet impossible"}
                {!dailyGroveCompletionLoading &&
                  !dailyGroveCompletionError &&
                  dailyGroveCompletion?.today_complete &&
                  `Série de ${dailyGroveCompletion.current_streak} jour${dailyGroveCompletion.current_streak > 1 ? "s" : ""}`}
                {!dailyGroveCompletionLoading &&
                  !dailyGroveCompletionError &&
                  dailyGroveCompletion &&
                  !dailyGroveCompletion.today_complete &&
                  `${dailyGroveCompletion.due_count || 0} révision${dailyGroveCompletion.due_count > 1 ? "s" : ""} encore due${dailyGroveCompletion.due_count > 1 ? "s" : ""}`}
              </div>

              {!dailyGroveCompletionLoading &&
                !dailyGroveCompletionError &&
                dailyGroveCompletion?.milestone_reached && (
                <div
                  style={{
                    background: "rgba(255, 204, 122, 0.1)",
                    border: "1px solid rgba(255, 204, 122, 0.2)",
                    borderRadius: "8px",
                    color: "#ffcc7a",
                    fontSize: "13px",
                    fontWeight: "800",
                    marginTop: "10px",
                    padding: "8px 10px"
                  }}
                >
                  Floraison des {dailyGroveCompletion.milestone_reached} jours
                </div>
              )}

              {dailyGroveCompletionError && (
                <div
                  style={{
                    color: "#ffb3b3",
                    fontSize: "13px",
                    lineHeight: 1.4,
                    marginTop: "8px"
                  }}
                >
                  {dailyGroveCompletionError}
                </div>
              )}
            </div>

            {canReturnToLastQuestion && (
              <button
                type="button"
                onClick={returnToLastQuestion}
                style={{
                  background: "#232323",
                  border: "1px solid #333",
                  color: "#eee",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  cursor: "pointer",
                  fontWeight: "650",
                  fontSize: "14px",
                  marginTop: "24px"
                }}
              >
                Modifier la dernière réponse
              </button>
            )}

            {canStartBonusReview && (
              <button
                type="button"
                onClick={startBonusReview}
                disabled={bonusReviewLoading}
                style={{
                  background: bonusReviewLoading ? "#202020" : "#233228",
                  border: "1px solid #385544",
                  color: bonusReviewLoading ? "#888" : "#d7f5df",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  cursor: bonusReviewLoading ? "default" : "pointer",
                  fontWeight: "650",
                  fontSize: "14px",
                  marginTop: "14px",
                  marginLeft: canReturnToLastQuestion ? "10px" : 0
                }}
              >
                {bonusReviewLoading
                  ? "Chargement des bonus..."
                  : "Faire des questions bonus"}
              </button>
            )}

          </div>
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
            />

          </>
        )}

      </div>

    </div>
  );
}
