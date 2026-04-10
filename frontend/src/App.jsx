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
  const [sortField, setSortField] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc"); // asc / desc
  const mainButtonStyle = {
    background: "#1f1f1f",
    color: "#eee",
    border: "1px solid #333",
    padding: "15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "16px"
  };
  const appStyle = {
    background: "#121212",
    color: "#e5e5e5",
    minHeight: "100vh",
    padding: "40px",
    fontFamily: "Arial, sans-serif"
  };
  const [newRow, setNewRow] = useState({
    question: "",
    answer: "",
    theme: "",
  });
  const secondaryButtonStyle = {
    background: "#2a2a2a",
    color: "#eee",
    border: "1px solid #333",
    padding: "8px 14px",
    borderRadius: "6px",
    cursor: "pointer"
  };

  const successButton = {
    background: "#3fb950",
    color: "white",
    border: "none",
    padding: "10px 16px",
    borderRadius: "6px",
    cursor: "pointer"
  };

  const dangerButton = {
    background: "#ff4d4f",
    color: "white",
    border: "none",
    padding: "10px 16px",
    borderRadius: "6px",
    cursor: "pointer"
  };

  const secondaryButton = {
    background: "#444",
    color: "white",
    border: "none",
    padding: "10px 16px",
    borderRadius: "6px",
    cursor: "pointer"
  };

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

  useEffect(() => {
    if (mode === "manage") {
      loadAllQuestions();
    }
  }, [mode]);

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

  function handleSort(field) {
    if (sortField === field) {
      // même colonne → inverser
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      // nouvelle colonne → tri asc
      setSortField(field);
      setSortOrder("asc");
    }
  }


  if (mode === "menu") {
    return (
      <div style={{ maxWidth: "600px", margin: "auto", textAlign: "center" }}>
        <h1 style={{ marginBottom: "40px" }}>
          Quiz App
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          <button
            onClick={() => setMode("quiz")}
            style={mainButtonStyle}
          >
            ▶ Faire les questions
          </button>

          <button
            onClick={() => setMode("manage")}
            style={mainButtonStyle}
          >
            🗂 Gérer la base de données
          </button>
        </div>
      </div>
    );
  }

  if (mode === "manage") {
    const filteredQuestions = allQuestions
      .filter((q) => {
        const matchesSearch =
          q.question.toLowerCase().includes(search.toLowerCase()) ||
          q.answer.toLowerCase().includes(search.toLowerCase());

        const matchesTheme = q.theme
          .toLowerCase()
          .includes(filterTheme.toLowerCase());

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
      })
      .slice() // clone pour éviter mutation
      .sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];

        // gérer les dates
        if (sortField === "next_review") {
          valA = valA ? new Date(valA) : new Date(0);
          valB = valB ? new Date(valB) : new Date(0);
        }

        // gérer texte
        if (typeof valA === "string") {
          valA = valA.toLowerCase();
          valB = valB.toLowerCase();
        }

        if (valA < valB) return sortOrder === "asc" ? -1 : 1;
        if (valA > valB) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    

    return (
      <div style={appStyle}>
        <button
          onClick={() => setMode("menu")}
          style={{
            marginBottom: "20px",
            background: "#2a2a2a",
            color: "#eee",
            border: "1px solid #333",
            padding: "8px 14px",
            borderRadius: "6px",
            cursor: "pointer"
          }}
        >
          ⬅ Retour
        </button>

        <h2 style={{ marginBottom: "20px" }}>
          Gestion des questions
        </h2>

        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "15px",
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          <input
            placeholder="Recherche..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "8px",
              borderRadius: "6px",
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "#eee"
            }}        
          />

          <input
            placeholder="Filtrer par thème"
            value={filterTheme}
            onChange={(e) => setFilterTheme(e.target.value)}
            style={{
              padding: "8px",
              borderRadius: "6px",
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "#eee"
            }}           
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
        <div style={{ marginBottom: "10px", color: "#888" }}>
          {filteredQuestions.length} résultats
        </div>
        

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            backgroundColor: "#1e1e1e",
            borderRadius: "8px",
            overflow: "hidden"
          }}
        >
          <thead style={{ backgroundColor: "#2a2a2a" }}>
            <tr
              style={{ borderBottom: "1px solid #2a2a2a" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#2a2a2a"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <th style={{
                padding: "12px",
                borderBottom: "1px solid #333",
                cursor: "pointer",
                textAlign: "left",
                color: "#aaa"
              }}    
              onClick={() => handleSort("id")}>
                ID {sortField === "id" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
              </th>
              <th style={{
                padding: "12px",
                borderBottom: "1px solid #333",
                cursor: "pointer",
                textAlign: "left",
                color: "#aaa"
              }} 
              onClick={() => handleSort("question")}>
                Question {sortField === "question" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
              </th>

              <th style={{
                padding: "12px",
                borderBottom: "1px solid #333",
                cursor: "pointer",
                textAlign: "left",
                color: "#aaa"
              }}        
              onClick={() => handleSort("answer")}>
                Réponse {sortField === "answer" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
              </th>

              <th style={{
                padding: "12px",
                borderBottom: "1px solid #333",
                cursor: "pointer",
                textAlign: "left",
                color: "#aaa"
              }}         
              onClick={() => handleSort("theme")}>
                Thème {sortField === "theme" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
              </th>

              <th style={{
                padding: "12px",
                borderBottom: "1px solid #333",
                cursor: "pointer",
                textAlign: "left",
                color: "#aaa"
              }}       
              onClick={() => handleSort("next_review")}>
                Review {sortField === "next_review" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
              </th>

              <th></th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>new</td>

              <td>
                <input
                  style={{
                    width: "100%",
                    padding: "6px",
                    borderRadius: "4px",
                    border: "1px solid #333",
                    background: "#1a1a1a",
                    color: "#eee",
                    boxSizing: "border-box"
                  }}
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
                  style={{
                    width: "100%",
                    padding: "6px",
                    borderRadius: "4px",
                    border: "1px solid #333",
                    background: "#1a1a1a",
                    color: "#eee",
                    boxSizing: "border-box"
                  }}
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
                  style={{
                    width: "100%",
                    padding: "6px",
                    borderRadius: "4px",
                    border: "1px solid #333",
                    background: "#1a1a1a",
                    color: "#eee",
                    boxSizing: "border-box"
                  }}
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
                <button
                  onClick={createQuestion}
                  style={{
                    background: "#3a7afe",
                    color: "white",
                    border: "none",
                    padding: "6px 10px",
                    borderRadius: "5px",
                    cursor: "pointer"
                  }}
                >
                  ➕
                </button>
              </td>
            </tr>
            {filteredQuestions.map((q, index) => (
              <tr key={q.id}>
                <td>{q.id}</td>

                <td>
                  <input
                    style={{
                      width: "100%",
                      padding: "6px",
                      borderRadius: "4px",
                      border: "1px solid #333",
                      background: "#1a1a1a",
                      color: "#eee",
                      boxSizing: "border-box"
                    }}
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
                    style={{
                      width: "100%",
                      padding: "6px",
                      borderRadius: "4px",
                      border: "1px solid #333",
                      background: "#1a1a1a",
                      color: "#eee",
                      boxSizing: "border-box"
                    }}
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
                    style={{
                      width: "100%",
                      padding: "6px",
                      borderRadius: "4px",
                      border: "1px solid #333",
                      background: "#1a1a1a",
                      color: "#eee",
                      boxSizing: "border-box"
                    }}
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
                  <button
                    onClick={() => deleteQuestion(q.id)}
                    style={{
                      background: "#ff4d4f",
                      color: "white",
                      border: "none",
                      padding: "5px 8px",
                      borderRadius: "5px",
                      cursor: "pointer"
                    }}
                  >
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

  if (mode === "quiz") {
    return (
      <div style={{ maxWidth: "800px", margin: "auto" }}>

        {/* 🔙 Retour */}
        <button
          onClick={() => setMode("menu")}
          style={secondaryButtonStyle}
        >
          ⬅ Retour
        </button>

        {/* 🔽 Filtres */}
        <div
          style={{
            marginTop: "20px",
            marginBottom: "30px",
            display: "flex",
            gap: "15px",
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          <div>
            <label style={{ marginRight: "8px", color: "#aaa" }}>
              Thème
            </label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              style={{
                padding: "6px",
                borderRadius: "6px",
                background: "#1e1e1e",
                color: "#eee",
                border: "1px solid #333"
              }}
            >
              <option value="global">Global</option>
              <option value="géographie">Géographie</option>
              <option value="histoire">Histoire</option>
              <option value="littérature">Littérature</option>
            </select>
          </div>

          <div>
            <label style={{ marginRight: "8px", color: "#aaa" }}>
              Questions
            </label>
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

        {/* 🔽 Aucun résultat */}
        {questions.length === 0 && (
          <div style={{ color: "#888" }}>
            Aucune question pour aujourd’hui 🎉
          </div>
        )}

        {/* 🔽 Session terminée */}
        {currentIndex >= questions.length && questions.length > 0 && (
          <div style={{ color: "#888" }}>
            Session terminée 🎉
          </div>
        )}

        {/* 🔽 Question */}
        {questions.length > 0 && currentIndex < questions.length && (
          <>
            <div style={{ marginBottom: "15px", color: "#888" }}>
              Question {currentIndex + 1} / {questions.length}
            </div>

            <div style={{ marginBottom: "20px", color: "#aaa" }}>
              {questions[currentIndex].theme}
            </div>

            {/* 🧠 Carte */}
            <div
              style={{
                background: "#1e1e1e",
                padding: "30px",
                borderRadius: "10px",
                marginBottom: "20px"
              }}
            >
              <div style={{ marginBottom: "10px", color: "#888" }}>
                Question
              </div>

              <div
                style={{
                  fontSize: "22px",
                  fontWeight: "bold"
                }}
              >
                {questions[currentIndex].question}
              </div>

              {!showAnswer && (
                <div style={{ marginTop: "25px" }}>
                  <button
                    onClick={() => setShowAnswer(true)}
                    style={mainButtonStyle}
                  >
                    Voir la réponse
                  </button>
                </div>
              )}

              {showAnswer && (
                <div style={{ marginTop: "25px" }}>
                  <div style={{ color: "#888", marginBottom: "5px" }}>
                    Réponse
                  </div>

                  <div style={{ color: "#ccc", marginBottom: "20px" }}>
                    {questions[currentIndex].answer}
                  </div>

                  {/* 🔘 Boutons réponse */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: "15px"
                    }}
                  >
                    <button
                      style={dangerButton}
                      onClick={() => handleAnswer(0)}
                    >
                      ❌ Faux
                    </button>

                    <button
                      style={secondaryButton}
                      onClick={() => handleAnswer(1)}
                    >
                      😐 Dur
                    </button>

                    <button
                      style={successButton}
                      onClick={() => handleAnswer(2)}
                    >
                      ✅ Facile
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }
}

export default App;