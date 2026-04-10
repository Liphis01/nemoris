import { useEffect, useState } from "react";
import { getReview, sendAnswer } from "./api/api";

function App() {
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [theme, setTheme] = useState("global");
  const [limit, setLimit] = useState(50);
  const [mode, setMode] = useState("menu");
  const [allQuestions, setAllQuestions] = useState([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [newTheme, setNewTheme] = useState("");

  useEffect(() => {
    function handleKeyDown(e) {
      // voir réponse
      if (e.key === "Enter") {
        if (!showAnswer) {
          setShowAnswer(true);
        }
        return;
      }

      // répondre uniquement si réponse affichée
      if (showAnswer) {
        if (e.key === "1") handleAnswer(0);
        if (e.key === "2") handleAnswer(1);
        if (e.key === "3") handleAnswer(2);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showAnswer, currentIndex]);

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

  async function createQuestion() {
    await fetch("http://localhost:8000/questions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: newQuestion,
        answer: newAnswer,
        theme: newTheme,
      }),
    });

    setNewQuestion("");
    setNewAnswer("");
    setNewTheme("");

    alert("Question ajoutée !");
  }

  async function loadAllQuestions() {
    const res = await fetch("http://localhost:8000/questions");
    const data = await res.json();
    setAllQuestions(data);
  }

  async function updateQuestion(q) {
    await fetch(`http://localhost:8000/questions/${q.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: q.question,
        answer: q.answer,
        theme: q.theme,
      }),
    });
  }

  async function deleteQuestion(id) {
    await fetch(`http://localhost:8000/questions/${id}`, {
      method: "DELETE",
    });

    setAllQuestions(allQuestions.filter((q) => q.id !== id));
  }

  if (currentIndex >= questions.length) {
    return <div>Session terminée 🎉</div>;
  }

  if (mode === "menu") {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Quiz App</h1>

        <div style={{ marginTop: "20px" }}>
          <button onClick={() => setMode("review")}>
            Réviser
          </button>
        </div>

        <div style={{ marginTop: "10px" }}>
          <button onClick={() => setMode("manage")}>
            Gérer la base de données
          </button>
        </div>
      </div>
    );
  }

  if (mode === "manage") {
    return (
      <div style={{ padding: "40px" }}>
        <button onClick={() => setMode("menu")}>⬅ Retour</button>

        <h2>Base de données</h2>

        <button onClick={loadAllQuestions}>
          Charger les questions
        </button>

        <table border="1" cellPadding="5" style={{ marginTop: "20px" }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Question</th>
              <th>Réponse</th>
              <th>Thème</th>
              <th>Next review</th>
            </tr>
          </thead>

          <tbody>
            {allQuestions.map((q, index) => (
              <tr key={q.id}>
                <td>{q.id}</td>

                <td>
                  <input
                    value={q.question}
                    onChange={(e) => {
                      const updated = [...allQuestions];
                      updated[index].question = e.target.value;
                      setAllQuestions(updated);
                    }}
                    onBlur={() => updateQuestion(q)}
                  />
                </td>

                <td>
                  <input
                    value={q.answer}
                    onChange={(e) => {
                      const updated = [...allQuestions];
                      updated[index].answer = e.target.value;
                      setAllQuestions(updated);
                    }}
                    onBlur={() => updateQuestion(q)}
                  />
                </td>

                <td>
                  <input
                    value={q.theme}
                    onChange={(e) => {
                      const updated = [...allQuestions];
                      updated[index].theme = e.target.value;
                      setAllQuestions(updated);
                    }}
                    onBlur={() => updateQuestion(q)}
                  />
                </td>

                <td>{q.next_review || "-"}</td>

                <td>
                  <button onClick={() => deleteQuestion(q.id)}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (mode === "add") {
    return (
      <div style={{ padding: "40px", maxWidth: "600px", margin: "auto" }}>
        <button onClick={() => setMode("menu")}>
          ⬅ Retour
        </button>

        <h2>Ajouter une question</h2>

        <div>
          <input
            placeholder="Question"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            style={{ width: "100%", marginBottom: "10px" }}
          />

          <input
            placeholder="Réponse"
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            style={{ width: "100%", marginBottom: "10px" }}
          />

          <input
            placeholder="Thème"
            value={newTheme}
            onChange={(e) => setNewTheme(e.target.value)}
            style={{ width: "100%", marginBottom: "10px" }}
          />

          <button onClick={createQuestion}>
            Ajouter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "40px", fontSize: "20px", maxWidth: "600px", margin: "auto" }}>
      <button onClick={() => setMode("menu")}>
        ⬅ Retour
      </button>
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