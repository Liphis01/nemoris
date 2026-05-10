import { useState, useEffect } from "react";
import { fadeInStyle, buttonBase } from "../styles";
import QuestionRenderer from "./QuestionRenderer";

const secondaryButtonStyle = {
  background: "#2a2a2a",
  color: "#eee",
  border: "1px solid #333",
  padding: "8px 14px",
  borderRadius: "6px",
  cursor: "pointer"
};

export default function Quiz({
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
  setLimit
}) {

  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState("");

  // 🔥 load collections
  useEffect(() => {
    fetch("http://localhost:8000/collections")
      .then(res => res.json())
      .then(setCollections);
  }, []);

  return (
    <div style={{ maxWidth: "800px", margin: "auto" }}>

      {/* 🔙 Retour */}
      <button
        onClick={() => setMode("menu")}
        style={{ ...buttonBase, ...secondaryButtonStyle }}
      >
        ⬅ Retour
      </button>

      {/* 🔽 FILTRES */}
      <div
        style={{
          marginTop: "20px",
          marginBottom: "30px",
          display: "flex",
          gap: "15px",
          flexWrap: "wrap",
          justifyContent: "center"
        }}
      >

        {/* TAGS */}
        <div>
          <label style={{ color: "#aaa" }}>Tags</label>
          <input
            placeholder="ex: geo, asie"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
          />
        </div>

        {/* COLLECTION */}
        <div>
          <label style={{ color: "#aaa" }}>Collection</label>
          <select
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
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
        <div>
          <label style={{ color: "#aaa" }}>Questions</label>
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{
              width: "70px",
              padding: "6px",
              borderRadius: "6px",
              background: "#1e1e1e",
              color: "#eee",
              border: "1px solid #333"
            }}
          />
        </div>
      </div>

      {/* 🔽 AUCUNE QUESTION */}
      {questions.length === 0 && (
        <div style={{ color: "#888" }}>
          Aucune question pour aujourd’hui 🎉
        </div>
      )}

      {/* 🔽 FIN */}
      {currentIndex >= questions.length && questions.length > 0 && (
        <div style={{ color: "#888" }}>
          Session terminée 🎉
        </div>
      )}

      {/* 🔽 QUESTION */}
      {questions.length > 0 && currentIndex < questions.length && (
        <>
          <div style={{ marginBottom: "15px", color: "#888" }}>
            Question {currentIndex + 1} / {questions.length}
          </div>

          {/* 🔥 TAGS affichés */}
          <div style={{ marginBottom: "10px", color: "#aaa" }}>
            {(questions[currentIndex].tags || []).join(", ")}
          </div>

          <QuestionRenderer
            q={questions[currentIndex]}
            currentIndex={currentIndex}
            showAnswer={showAnswer}
            setShowAnswer={setShowAnswer}
            handleTextAnswer={handleTextAnswer}
            handleMapComplete={handleMapComplete}
          />
        </>
      )}

    </div>
  );
}