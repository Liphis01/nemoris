import { useRef, useEffect, useState } from "react";
import { getReview, sendAnswer } from "./api/api";
import Menu from "./components/Menu";
import Quiz from "./components/Quiz";
import Manage from "./components/manage/Manage";

function App() {
  const [questions, setQuestions] = useState([]); // questions de la review
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [limit, setLimit] = useState(200);
  const [mode, setMode] = useState("menu");
  const [allQuestions, setAllQuestions] = useState([]); // toutes les questions de la database
  const [search, setSearch] = useState("");
  const [filterTheme, setFilterTheme] = useState("");
  const [filterDue, setFilterDue] = useState(false);
  const [sortField, setSortField] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc"); // asc / desc
  const questionInputRef = useRef(null);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [tagInput, setTagInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [viewMode, setViewMode] = useState("questions"); // "questions" or "groups"
  const [allGroups, setAllGroups] = useState([]);

  const [newRow, setNewRow] = useState({
    question: "",
    answer: "",
    tags: [],
    type_q: "text",
    media: null,
  });

  const [newGroup, setNewGroup] = useState({
    name: "",
    type_group: "map",
    media: "",
    data: {}
  });

  const appStyle = {
    background: "#121212",
    color: "#e5e5e5",
    minHeight: "100%",
    height: "100%",
    padding: "24px",
    fontFamily: "Arial, sans-serif",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxSizing: "border-box"
  };

  // à déplacer dans quiz à l'occasion
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
        if (e.key === "1") handleTextAnswer(0);
        if (e.key === "2") handleTextAnswer(1);
        if (e.key === "3") handleTextAnswer(2);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showAnswer, currentIndex]);

  useEffect(() => {
    if (mode !== "quiz") return;

    const selectedTags = tagInput
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);

    // const selectedCollection = null;

    getReview(selectedTags, limit).then((data) => {
      setQuestions(data);
      setCurrentIndex(0);
      setShowAnswer(false);
    });

  }, [mode, tagInput, limit]);

  // useEffect(() => {
  //   if (mode !== "quiz") return;

  //   setQuestions((prev) =>
  //     [...prev].sort(() => Math.random() - 0.5)
  //   );
  // }, [mode]);


  useEffect(() => {
    if (mode === "manage") {
      loadAllQuestions();
      loadAllGroups();
    }
  }, [mode]);

  useEffect(() => {
    document.body.style.overflow =
      mode === "manage" ? "hidden" : "auto";
  }, [mode]);

  const current = questions[currentIndex];

  function handleTextAnswer(quality) {
    sendAnswer(current.question_id, quality);

    setShowAnswer(false);
    setCurrentIndex(prev => prev + 1);
  }

  function handleMapComplete() {
    setCurrentIndex(prev => prev + 1);
  }

  async function loadAllQuestions() {
    const res = await fetch("http://localhost:8000/questions");
    const data = await res.json();
    setAllQuestions(data);
  }

  async function loadAllGroups() {
    const res = await fetch("http://localhost:8000/groups");
    const data = await res.json();
    setAllGroups(data);
  }

  async function reloadAllData() {
    await loadAllGroups();
    await loadAllQuestions();
  }

  async function updateQuestion(id, updatedFields) {
    await fetch(`http://localhost:8000/questions/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedFields),
    });

    updateQuestionInState({
      id,
      ...updatedFields
    });
  }

  async function deleteQuestion(id) {
    await fetch(`http://localhost:8000/questions/${id}`, {
      method: "DELETE",
    });

    setAllQuestions(allQuestions.filter((q) => q.id !== id));
  }

  async function deleteGroup(id) {
    const res = await fetch(`http://localhost:8000/groups/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      alert(payload?.detail || "Impossible de supprimer le groupe.");
      return;
    }

    setAllGroups(allGroups.filter((g) => g.id !== id));
  }

  async function createQuestion() {
    if (!newRow.question) {
      alert("Champs manquants");
      return;
    }

    console.log(newRow);

    const res = await fetch("http://localhost:8000/questions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newRow),
      });

    const created = await res.json();

    setAllQuestions(prev => [...prev, created]);

    setNewRow({
      question: "",
      answer: "",
      tags: [],
      type_q: "text",
      media: null,
    });

    setTimeout(() => {
      questionInputRef.current?.focus();
    }, 0);
  }

  function startCreateGroup() {
    setIsCreatingGroup(true);
    setIsCreating(false);
    setSelectedQuestion(null);
  }

  async function createGroup() {
    if (!newGroup.name) {
      alert("Le nom du groupe est requis.");
      return;
    }

    const payload = {
      type_group: newGroup.type_group,
      name: newGroup.name,
      media: newGroup.media || null,
      data: newGroup.data
    };

    const res = await fetch("http://localhost:8000/groups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      alert("Erreur lors de la création du groupe.");
      return;
    }

    const createdGroup = await res.json();
    alert(`Groupe créé : ${createdGroup.name} (#${createdGroup.id})`);
    setNewGroup({
      name: "",
      type_group: "map",
      media: "",
      data: {}
    });
    setIsCreatingGroup(false);
  }

  async function handleUpload(e, q) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("http://127.0.0.1:8000/upload", {
      method: "POST",
      body: formData
    });

    const data = await res.json();

    if (q.id === "new") {
      // Pour la création
      setNewRow(prev => ({ ...prev, media: data.url, type_q: "image" }));
      return;
    }

    await updateQuestion(q.id, {
      media: data.url,
      type_q: "image"
    });

    const updatedQuestion = {
      ...q,
      media: data.url,
      type_q: "image"
    };

    // 🔥 sync local
    updateQuestionInState(updatedQuestion);
    return updatedQuestion;
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

  function updateQuestionInState(updated) {
    setAllQuestions(prev =>
      prev.map(q =>
        q.id === updated.id ? updated : q
      )
    );
  }

  async function deleteImage(id) {
    await fetch(`http://127.0.0.1:8000/questions/${id}/image`, {
      method: "DELETE"
    });

    setAllQuestions(prev =>
      prev.map(q =>
        q.id === id
          ? { ...q, media: null, type_q: "text" }
          : q
      )
    );
  }

  // 🔥 Regroupement des maps pour l'affichage Manage
  const groupedQuestions = (() => {
    const normal = [];
    const mapGroups = {};

    for (const q of allQuestions) {
      if (q.type_q === "map" && q.map_svg) {
        if (!mapGroups[q.map_svg]) {
          mapGroups[q.map_svg] = [];
        }
        mapGroups[q.map_svg].push(q);
      } else {
        normal.push(q);
      }
    }

    const maps = Object.entries(mapGroups).map(([svg, zones]) => ({
      id: "map-" + svg,
      type_q: "map_group",
      media: svg,
      zones,

      question: "",
      answer: "",
      tags: [],

      next_review: zones.some(z => z.next_review),
    }));

    return [...normal, ...maps];
  })();

  const filteredQuestions =
    groupedQuestions.filter((q) => {
      const matchesSearch =
        (q.question || "").toLowerCase().includes(search.toLowerCase()) ||
        (q.answer || "").toLowerCase().includes(search.toLowerCase());

      const matchesTags = filterTheme === "" ||
        (q.tags || []).some(tag =>
          tag.toLowerCase().includes(filterTheme.toLowerCase())
        );

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

      return matchesSearch && matchesTags && matchesDue;
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
          handleTextAnswer={handleTextAnswer}
          handleMapComplete={handleMapComplete}
          tagInput={tagInput}
          setTagInput={setTagInput}
          limit={limit}
          setLimit={setLimit}
        />
      )}

      {mode === "manage" && (
        <Manage
          setMode={setMode}
          allQuestions={allQuestions}
          allGroups={allGroups}
          setAllGroups={setAllGroups}
          filteredQuestions={filteredQuestions}
          questionInputRef={questionInputRef}
          setAllQuestions={setAllQuestions}
          updateQuestion={updateQuestion}
          deleteQuestion={deleteQuestion}
          deleteGroup={deleteGroup}
          newRow={newRow}
          setNewRow={setNewRow}
          createQuestion={createQuestion}
          handleUpload={handleUpload}
          deleteImage={deleteImage}
          reloadAllData={reloadAllData}
          search={search}
          setSearch={setSearch}
          filterTheme={filterTheme}
          setFilterTheme={setFilterTheme}
          filterDue={filterDue}
          setFilterDue={setFilterDue}
          handleSort={handleSort}
          sortField={sortField}
          sortOrder={sortOrder}
          selectedQuestion={selectedQuestion}
          setSelectedQuestion={setSelectedQuestion}
          updateQuestionInState={updateQuestionInState}
          isCreating={isCreating}
          setIsCreating={setIsCreating}
          isCreatingGroup={isCreatingGroup}
          setIsCreatingGroup={setIsCreatingGroup}
          newGroup={newGroup}
          setNewGroup={setNewGroup}
          startCreateGroup={startCreateGroup}
          createGroup={createGroup}
          deleteGroup={deleteGroup}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />
      )}
    </div>
  )
}

export default App;