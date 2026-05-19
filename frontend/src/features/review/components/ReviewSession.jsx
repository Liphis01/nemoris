import ReviewQuestionRenderer from "./ReviewQuestionRenderer";

const inputStyle = {
  background: "#151515",
  border: "1px solid #2a2a2a",
  color: "#eee",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "14px",
  outline: "none"
};

export default function ReviewSession({
  setMode,
  questions,
  currentIndex,
  showAnswer,
  setShowAnswer,
  handleTextAnswer,
  handleMapComplete,
  tagInput,
  setTagInput,
  limit,
  setLimit,
  collections,
  selectedCollection,
  setSelectedCollection
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

        {/* FILTER BAR */}
        <div
          style={{
            background: "#181818",
            border: "1px solid #262626",
            borderRadius: "16px",
            padding: "18px",
            marginBottom: "26px",
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
            alignItems: "flex-end"
          }}
        >

          {/* TAGS */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              minWidth: "240px",
              flex: 1
            }}
          >
            <div
              style={{
                color: "#777",
                fontSize: "12px",
                fontWeight: "600"
              }}
            >
              TAGS
            </div>

            <input
              placeholder="geo, asie..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* COLLECTION */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              minWidth: "200px"
            }}
          >
            <div
              style={{
                color: "#777",
                fontSize: "12px",
                fontWeight: "600"
              }}
            >
              COLLECTION
            </div>

            <select
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              style={inputStyle}
            >
              <option value="">Toutes</option>

              {collections.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* LIMIT */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              width: "110px"
            }}
          >
            <div
              style={{
                color: "#777",
                fontSize: "12px",
                fontWeight: "600"
              }}
            >
              LIMIT
            </div>

            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={inputStyle}
            />
          </div>

        </div>

        {/* EMPTY */}
        {questions.length === 0 && (
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
            🎉 Aucune question pour aujourd’hui
          </div>
        )}

        {/* FINISHED */}
        {currentIndex >= questions.length && questions.length > 0 && (
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

          </div>
        )}

        {/* QUESTION */}
        {currentQuestion && currentIndex < questions.length && (
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
                  color: "#888",
                  fontSize: "14px"
                }}
              >
                Question {currentIndex + 1} / {questions.length}
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
              handleMapComplete={handleMapComplete}
            />

          </>
        )}

      </div>

    </div>
  );
}
