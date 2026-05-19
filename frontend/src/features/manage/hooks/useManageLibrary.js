import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createQuestion as createQuestionRequest,
  deleteQuestion as deleteQuestionRequest,
  deleteQuestionImage,
  listQuestions,
  updateQuestion as updateQuestionRequest,
  uploadMedia
} from "../../../api/questions";
import {
  createGroup as createGroupRequest,
  deleteGroup as deleteGroupRequest,
  listGroups
} from "../../../api/groups";
import { filterAndSortQuestions } from "../utils/questionFilters";


const initialQuestionDraft = {
  question: "",
  answer: "",
  tags: [],
  type_q: "text",
  media: null
};

const initialGroupDraft = {
  name: "",
  type_group: "map",
  media: "",
  data: {}
};


export function useManageLibrary(mode) {
  const [allQuestions, setAllQuestions] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [filterTheme, setFilterTheme] = useState("");
  const [filterDue, setFilterDue] = useState(false);
  const [sortField, setSortField] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc");
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [viewMode, setViewMode] = useState("questions");
  const [newRow, setNewRow] = useState(initialQuestionDraft);
  const [newGroup, setNewGroup] = useState(initialGroupDraft);
  const questionInputRef = useRef(null);

  const loadAllQuestions = useCallback(async () => {
    const data = await listQuestions();
    setAllQuestions(data);
    return data;
  }, []);

  const loadAllGroups = useCallback(async () => {
    const data = await listGroups();
    setAllGroups(data);
    return data;
  }, []);

  const reloadAllData = useCallback(async () => {
    const [groups, questions] = await Promise.all([
      loadAllGroups(),
      loadAllQuestions()
    ]);

    return { groups, questions };
  }, [loadAllGroups, loadAllQuestions]);

  useEffect(() => {
    if (mode === "manage" || mode === "calendar") {
      loadAllQuestions().catch(console.error);

      if (mode === "manage") {
        loadAllGroups().catch(console.error);
      }
    }
  }, [loadAllGroups, loadAllQuestions, mode]);

  function resetQuestionDraft() {
    setNewRow(initialQuestionDraft);
  }

  function resetGroupDraft() {
    setNewGroup(initialGroupDraft);
  }

  function resetManageFilters() {
    setSearch("");
    setFilterTheme("");
    setFilterDue(false);
  }

  async function updateQuestion(id, updatedFields) {
    await updateQuestionRequest(id, updatedFields);

    updateQuestionInState({
      id,
      ...updatedFields
    });
  }

  async function deleteQuestion(id) {
    await deleteQuestionRequest(id);

    const deletedQuestion = allQuestions.find(question => question.id === id);

    setAllQuestions(prev => prev.filter(question => question.id !== id));

    if (deletedQuestion?.group?.id) {
      setAllGroups(prev =>
        prev
          .map(group =>
            group.id === deletedQuestion.group.id
              ? {
                ...group,
                question_count: Math.max(0, (group.question_count || 0) - 1)
              }
              : group
          )
          .filter(group => group.question_count !== 0)
      );
    }
  }

  async function deleteGroup(id) {
    try {
      await deleteGroupRequest(id);
      setAllGroups(prev => prev.filter(group => group.id !== id));
    } catch (error) {
      alert(error.message || "Impossible de supprimer le groupe.");
    }
  }

  async function createQuestion() {
    if (!newRow.question) {
      alert("Champs manquants");
      return;
    }

    const created = await createQuestionRequest(newRow);

    setAllQuestions(prev => [...prev, created]);
    resetQuestionDraft();

    window.setTimeout(() => {
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

    const createdGroup = await createGroupRequest({
      type_group: newGroup.type_group,
      name: newGroup.name,
      media: newGroup.media || null,
      data: newGroup.data
    });

    setAllGroups(prev => [...prev, createdGroup]);
    resetGroupDraft();
    setIsCreatingGroup(false);

    return createdGroup;
  }

  async function handleUpload(event, question) {
    const file = event.target.files[0];
    if (!file) return;

    const data = await uploadMedia(file);

    if (question.id === "new") {
      setNewRow(prev => ({ ...prev, media: data.url }));
      return;
    }

    await updateQuestion(question.id, {
      media: data.url
    });

    const updatedQuestion = {
      ...question,
      media: data.url
    };

    updateQuestionInState(updatedQuestion);
    return updatedQuestion;
  }

  function handleSort(field) {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  function updateQuestionInState(updated) {
    setAllQuestions(prev =>
      prev.map(question =>
        question.id === updated.id
          ? { ...question, ...updated }
          : question
      )
    );
  }

  async function deleteImage(id) {
    await deleteQuestionImage(id);

    setAllQuestions(prev =>
      prev.map(question =>
        question.id === id
          ? { ...question, media: null, type_q: "text" }
          : question
      )
    );
  }

  const filteredQuestions = useMemo(
    () =>
      filterAndSortQuestions({
        questions: allQuestions,
        search,
        filterTheme,
        filterDue,
        sortField,
        sortOrder
      }),
    [
      allQuestions,
      filterDue,
      filterTheme,
      search,
      sortField,
      sortOrder
    ]
  );

  return {
    allGroups,
    allQuestions,
    createGroup,
    createQuestion,
    deleteGroup,
    deleteImage,
    deleteQuestion,
    filterDue,
    filteredQuestions,
    filterTheme,
    handleSort,
    handleUpload,
    isCreating,
    isCreatingGroup,
    loadAllGroups,
    loadAllQuestions,
    newGroup,
    newRow,
    questionInputRef,
    reloadAllData,
    resetGroupDraft,
    resetManageFilters,
    resetQuestionDraft,
    search,
    selectedQuestion,
    setAllGroups,
    setAllQuestions,
    setFilterDue,
    setFilterTheme,
    setIsCreating,
    setIsCreatingGroup,
    setNewGroup,
    setNewRow,
    setSearch,
    setSelectedQuestion,
    setViewMode,
    sortField,
    sortOrder,
    startCreateGroup,
    updateQuestion,
    updateQuestionInState,
    viewMode
  };
}
