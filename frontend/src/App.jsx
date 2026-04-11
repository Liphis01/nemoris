import { useEffect, useState } from "react";
import { getReview, sendAnswer } from "./api/api";
import Menu from "./components/Menu";
import Quiz from "./components/Quiz";
import Manage from "./components/Manage";

function App() {
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [theme, setTheme] = useState("global");
  const [limit, setLimit] = useState(50);
  const [mode, setMode] = useState("menu");
  const [allQuestions, setAllQuestions] = useState([]);
  const [search, setSearch] = useState("");
  const [filterTheme, setFilterTheme] = useState("");
  const [filterDue, setFilterDue] = useState(false);
  const [sortField, setSortField] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc"); // asc / desc


  const [newRow, setNewRow] = useState({
    question: "",
    answer: "",
    theme: "",
  });

  const appStyle = {
    background: "#121212",
    color: "#e5e5e5",
    minHeight: "100vh",
    padding: "40px",
    fontFamily: "Arial, sans-serif"
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
    if (mode !== "quiz") return;

    getReview(theme, limit).then((data) => {
      setQuestions(data);
      setCurrentIndex(0);
      setShowAnswer(false);
    });
  }, [mode, theme, limit]);

  useEffect(() => {
    if (mode !== "quiz") return;

    setQuestions((prev) =>
      [...prev].sort(() => Math.random() - 0.5)
    );
  }, [mode]);


  useEffect(() => {
    if (mode === "manage") {
      loadAllQuestions();
    }
  }, [mode]);

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


  const filteredQuestions =
    allQuestions.filter((q) => {
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
      {mode === "menu" && (
        <Menu setMode={setMode} />
      )}

      {mode === "quiz" && (
        <Quiz
          setMode={setMode}
          questions={questions}
          currentIndex={currentIndex}
          showAnswer={showAnswer}
          setShowAnswer={setShowAnswer}
          handleAnswer={handleAnswer}
          theme={theme}
          setTheme={setTheme}
          limit={limit}
          setLimit={setLimit}
        />
      )}

      {mode === "manage" && (
        <Manage
          setMode={setMode}
          allQuestions={allQuestions}
          filteredQuestions={filteredQuestions}
          setAllQuestions={setAllQuestions}
          updateQuestion={updateQuestion}
          deleteQuestion={deleteQuestion}
          newRow={newRow}
          setNewRow={setNewRow}
          createQuestion={createQuestion}
          search={search}
          setSearch={setSearch}
          filterTheme={filterTheme}
          setFilterTheme={setFilterTheme}
          filterDue={filterDue}
          setFilterDue={setFilterDue}
          handleSort={handleSort}
          sortField={sortField}
          sortOrder={sortOrder}
        />
      )}
    </div>
  )
}

export default App;