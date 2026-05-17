import { useRef, useEffect, useState, useCallback } from "react";
import { getReview, sendAnswer } from "./api/api";
import { apiUrl } from "./api/config";
import Menu from "./components/Menu";
import Quiz from "./components/Quiz";
import Manage from "./components/manage/Manage";
import ReviewCalendar from "./components/ReviewCalendar";

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
  const current = questions[currentIndex];

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
    overflow: "auto",
    boxSizing: "border-box"
  };

  const handleTextAnswer = useCallback((quality) => {
    if (!current) return;

    sendAnswer(current.question_id, quality);

    if (quality === 0) {
      setQuestions(prev => [...prev, current]);
    }

    setShowAnswer(false);
    setCurrentIndex(prev => prev + 1);
  }, [current]);

  // à déplacer dans quiz à l'occasion
  useEffect(() => {
    function handleKeyDown(e) {
      if (mode !== "quiz") return;

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
  }, [mode, showAnswer, handleTextAnswer]);

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
    if (mode === "manage" || mode === "calendar") {
      loadAllQuestions();
      if (mode === "manage") {
        loadAllGroups();
      }
    }
  }, [mode]);

  useEffect(() => {
    document.body.style.overflow =
      mode === "manage" ? "hidden" : "auto";
  }, [mode]);

  function handleMapComplete(failedQuestionIds = []) {
    if (current && failedQuestionIds.length > 0) {
      const failedItems = (current.items || []).filter(item =>
        failedQuestionIds.includes(item.question_id)
      );

      if (failedItems.length > 0) {
        setQuestions(prev => [
          ...prev,
          {
            ...current,
            items: failedItems
          }
        ]);
      }
    }

    setCurrentIndex(prev => prev + 1);
  }

  async function loadAllQuestions() {
    const res = await fetch(apiUrl("/questions"));
    const data = await res.json();
    setAllQuestions(data);
    return data;
  }

  async function loadAllGroups() {
    const res = await fetch(apiUrl("/groups"));
    const data = await res.json();
    setAllGroups(data);
    return data;
  }

  function getNextReview(question) {
    return question.progress?.next_review || question.next_review || null;
  }

  async function reloadAllData() {
    const [groups, questions] = await Promise.all([
      loadAllGroups(),
      loadAllQuestions()
    ]);

    return { groups, questions };
  }

  async function updateQuestion(id, updatedFields) {
    await fetch(apiUrl(`/questions/${id}`), {
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
    await fetch(apiUrl(`/questions/${id}`), {
      method: "DELETE",
    });

    const deletedQuestion = allQuestions.find((q) => q.id === id);

    setAllQuestions((prev) => prev.filter((q) => q.id !== id));

    if (deletedQuestion?.group?.id) {
      setAllGroups((prev) =>
        prev.map((g) =>
          g.id === deletedQuestion.group.id
            ? { ...g, question_count: Math.max(0, (g.question_count || 0) - 1) }
            : g
        )
      );
    }
  }

  async function deleteGroup(id) {
    const res = await fetch(apiUrl(`/groups/${id}`), {
      method: "DELETE",
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      alert(payload?.detail || "Impossible de supprimer le groupe.");
      return;
    }

    setAllGroups(prev => prev.filter((g) => g.id !== id));
  }

  async function createQuestion() {
    if (!newRow.question) {
      alert("Champs manquants");
      return;
    }

    console.log(newRow);

    const res = await fetch(apiUrl("/questions"),
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

    return created;
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

    const res = await fetch(apiUrl("/groups"), {
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
    setAllGroups(prev => [...prev, createdGroup]);
    setNewGroup({
      name: "",
      type_group: "map",
      media: "",
      data: {}
    });
    setIsCreatingGroup(false);

    return createdGroup;
  }

  async function handleUpload(e, q) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(apiUrl("/upload"), {
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
    await fetch(apiUrl(`/questions/${id}/image`), {
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

      next_review: zones
        .map(getNextReview)
        .filter(Boolean)
        .sort()[0] || null,
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
        const nextReview = getNextReview(q);

        if (!nextReview) {
          matchesDue = true;
        } else {
          const today = new Date();
          const reviewDate = new Date(nextReview);
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
          valA = getNextReview(a) ? new Date(getNextReview(a)) : new Date(0);
          valB = getNextReview(b) ? new Date(getNextReview(b)) : new Date(0);
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

      {mode === "calendar" && (
        <ReviewCalendar
          setMode={setMode}
          questions={allQuestions}
        />
      )}
    </div>
  )
}

export default App;
