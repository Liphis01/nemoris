import { useEffect, useState } from "react";
import { getReview, sendAnswer } from "./api/api";
import { useRef } from "react";

function App() {
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [theme, setTheme] = useState("global");
  const [limit, setLimit] = useState(50);
  const [mode, setMode] = useState("menu");
  const [allQuestions, setAllQuestions] = useState([]);
  const questionInputRef = useRef(null);
  const [search, setSearch] = useState("");
  const [filterTheme, setFilterTheme] = useState("");
  const [filterDue, setFilterDue] = useState(false);
  const [newRow, setNewRow] = useState({
    question: "",
    answer: "",
    theme: "",
  });

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

    async function createQuestion() {
    if (!newRow.question || !newRow.answer || !newRow.theme) {
      alert("Remplis tous les champs");
      return;
    }

    const res = await fetch("http://localhost:8000/questions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newRow),
    });

    const created = await res.json();

    setAllQuestions([...allQuestions, created]);

    setNewRow({
      question: "",
      answer: "",
      theme: "",
    });

    setTimeout(() => {
      questionInputRef.current?.focus();
    }, 0);
  }

  function handleNewRowKeyDown(e) {
  if (e.key === "Enter") {
    e.preventDefault(); // évite comportements bizarres
    createQuestion();
  }
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
    const filteredQuestions = allQuestions.filter((q) => {
      // recherche texte
      const matchesSearch =
        q.question.toLowerCase().includes(search.toLowerCase()) ||
        q.answer.toLowerCase().includes(search.toLowerCase());

      // filtre thème
      const matchesTheme = q.theme
        .toLowerCase()
        .includes(filterTheme.toLowerCase());

      // filtre date
      let matchesDue = true;
      if (filterDue) {
        if (!q.next_review) {
          matchesDue = true;
        } else {
          const today = new Date();
          const reviewDate = new Date(q.next_review);
          matchesDue = reviewDate <= today;
        }
      }

      return matchesSearch && matchesTheme && matchesDue;
    });
    return (
      <div style={{ padding: "40px" }}>
        <button onClick={() => setMode("menu")}>⬅ Retour</button>

        <h2>Base de données</h2>

        <button onClick={loadAllQuestions}>
          Charger les questions
        </button>

        <div style={{ marginBottom: "20px" }}>
          <input
            placeholder="Recherche..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginRight: "10px" }}
          />

          <input
            placeholder="Filtrer par thème"
            value={filterTheme}
            onChange={(e) => setFilterTheme(e.target.value)}
            style={{ marginRight: "10px" }}
          />

          <label>
            <input
              type="checkbox"
              checked={filterDue}
              onChange={(e) => setFilterDue(e.target.checked)}
            />
            À réviser
          </label>
        </div>
        <p>{filteredQuestions.length} résultats</p>

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
            <tr>
              <td>new</td>

              <td>
                <input
                  ref={questionInputRef}
                  autoFocus
                  value={newRow.question}
                  onChange={(e) =>
                    setNewRow({ ...newRow, question: e.target.value })
                  }
                  onKeyDown={handleNewRowKeyDown}
                  placeholder="Question"
                />
              </td>

              <td>
                <input
                  value={newRow.answer}
                  onChange={(e) =>
                    setNewRow({ ...newRow, answer: e.target.value })
                  }
                  onKeyDown={handleNewRowKeyDown}
                  placeholder="Réponse"
                />
              </td>

              <td>
                <input
                  value={newRow.theme}
                  onChange={(e) =>
                    setNewRow({ ...newRow, theme: e.target.value })
                  }
                  onKeyDown={handleNewRowKeyDown}
                  placeholder="Thème"
                />
              </td>

              <td>-</td>

              <td>
                <button onClick={createQuestion}>
                  ➕
                </button>
              </td>
            </tr>
            {filteredQuestions.map((q, index) => (
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