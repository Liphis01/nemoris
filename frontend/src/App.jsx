import { useEffect, useState } from "react";
import { getReview, sendAnswer } from "./api/api";

function App() {
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [theme, setTheme] = useState("global");
  const [limit, setLimit] = useState(20);

  useEffect(() => {
    getReview(theme, limit).then((data) => {
      const shuffled = data.sort(() => Math.random() - 0.5);
      setQuestions(shuffled);
      setCurrentIndex(0);
    });
  }, [theme, limit]);

  if (questions.length === 0) {
    return <div>Chargement...</div>;
  }

  const current = questions[currentIndex];

  function handleAnswer(quality) {
    sendAnswer(current.question_id, quality);

    setShowAnswer(false);
    setCurrentIndex(currentIndex + 1);
  }

  if (currentIndex >= questions.length) {
    return <div>Session terminée 🎉</div>;
  }

  return (
    <div style={{ padding: "40px", fontSize: "20px", maxWidth: "600px", margin: "auto" }}>

      {/* 🔽 Sélection thème + limite */}
      <div style={{ marginBottom: "20px" }}>
        <label>Thème : </label>
        <select value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="global">Global</option>
          <option value="géographie">Géographie</option>
          <option value="histoire">Histoire</option>
          <option value="littérature">Littérature</option>
        </select>

        <label style={{ marginLeft: "20px" }}>Questions : </label>
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={{ width: "60px" }}
        />
      </div>

      {/* 🔽 Cas : pas de questions */}
      {questions.length === 0 && (
        <div>Aucune question pour aujourd’hui 🎉</div>
      )}

      {/* 🔽 Cas : session terminée */}
      {currentIndex >= questions.length && questions.length > 0 && (
        <div>Session terminée 🎉</div>
      )}

      {/* 🔽 Cas : question en cours */}
      {questions.length > 0 && currentIndex < questions.length && (
        <>
          <p>
            Question {currentIndex + 1} / {questions.length}
          </p>

          <p style={{ color: "gray" }}>
            Thème : {questions[currentIndex].theme}
          </p>

          <div>
            <strong>Question :</strong>
            <p style={{ fontSize: "24px", fontWeight: "bold" }}>
              {questions[currentIndex].question}
            </p>
          </div>

          {!showAnswer && (
            <button onClick={() => setShowAnswer(true)}>
              Voir la réponse
            </button>
          )}

          {showAnswer && (
            <div>
              <p>
                <strong>Réponse :</strong> {questions[currentIndex].answer}
              </p>

              <div style={{ 
                marginTop: "20px", 
                display: "flex", 
                gap: "10px",
                justifyContent: "center"
              }}>
                <button onClick={() => handleAnswer(0)}>❌ Faux</button>
                <button onClick={() => handleAnswer(1)}>😐 Dur</button>
                <button onClick={() => handleAnswer(2)}>✅ Facile</button>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}

export default App;