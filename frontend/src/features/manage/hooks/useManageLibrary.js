import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createQuestion as createQuestionRequest,
  deleteQuestion as deleteQuestionRequest,
  listQuestions,
  removeQuestionMedia as removeQuestionMediaRequest,
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
  // Default new questions are text items. Map zones are normally created from
  // the map editor because they need a data.code value from the SVG.
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

const defaultSortOrders = {
  id: "asc",
  title: "asc",
  group: "asc",
  next_review: "asc",
  reps: "asc"
};


export function useManageLibrary(mode) {
  // This hook is the Manage data store: it owns loaded questions/groups, local
  // filters, creation drafts, and cache patches after mutations.
  const [allQuestions, setAllQuestions] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [sortField, setSortField] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc");
  const [selectedItem, setSelectedItem] = useState(null);
  const [isCreatingQuestion, setIsCreatingQuestion] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [viewMode, setViewMode] = useState("questions");
  const [questionDraft, setQuestionDraft] = useState(initialQuestionDraft);
  const [groupDraft, setGroupDraft] = useState(initialGroupDraft);
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
    // Used after cross-cutting edits when both group counts and question rows
    // may have changed.
    const [groups, questions] = await Promise.all([
      loadAllGroups(),
      loadAllQuestions()
    ]);

    return { groups, questions };
  }, [loadAllGroups, loadAllQuestions]);

  useEffect(() => {
    if (mode === "manage" || mode === "calendar") {
      // Calendar only needs questions; Manage also needs group metadata for the
      // browser/sidebar and map editor entry points.
      loadAllQuestions().catch(console.error);

      if (mode === "manage") {
        loadAllGroups().catch(console.error);
      }
    }
  }, [loadAllGroups, loadAllQuestions, mode]);

  function resetQuestionDraft() {
    setQuestionDraft(initialQuestionDraft);
  }

  function resetGroupDraft() {
    setGroupDraft(initialGroupDraft);
  }

  function resetManageFilters() {
    setSearch("");
    setTagFilter("");
    setDueOnly(false);
  }

  async function updateQuestion(id, updatedFields) {
    await updateQuestionRequest(id, updatedFields);

    // Optimistic local patch keeps spreadsheet interactions quick. For fields
    // that require server-calculated shape, callers can reload or patch richer
    // data afterward.
    patchQuestionInCache({
      id,
      ...updatedFields
    });
  }

  async function deleteQuestion(id) {
    await deleteQuestionRequest(id);

    const deletedQuestion = allQuestions.find(question => question.id === id);

    setAllQuestions(prev => prev.filter(question => question.id !== id));

    if (deletedQuestion?.group?.id) {
      // Group counts are denormalized in the frontend list response, so adjust
      // them locally after deleting a grouped question.
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
    if (!questionDraft.question) {
      alert("Champs manquants");
      return;
    }

    const created = await createQuestionRequest(questionDraft);

    setAllQuestions(prev => [...prev, created]);
    resetQuestionDraft();

    window.setTimeout(() => {
      questionInputRef.current?.focus();
    }, 0);

    return created;
  }

  function startCreateGroup() {
    setIsCreatingGroup(true);
    setIsCreatingQuestion(false);
    setSelectedItem(null);
  }

  async function createGroup() {
    if (!groupDraft.name) {
      alert("Le nom du groupe est requis.");
      return;
    }

    const createdGroup = await createGroupRequest({
      type_group: groupDraft.type_group,
      name: groupDraft.name,
      media: groupDraft.media || null,
      data: groupDraft.data
    });

    setAllGroups(prev => [...prev, createdGroup]);
    resetGroupDraft();
    setIsCreatingGroup(false);

    return createdGroup;
  }

  async function uploadQuestionMedia(event, question) {
    const file = event.target.files[0];
    if (!file) return;

    // New-question uploads update the draft. Existing-question uploads persist
    // immediately and then patch the local cache.
    const data = await uploadMedia(file);

    if (question.id === "new") {
      setQuestionDraft(prev => ({ ...prev, media: data.url }));
      return;
    }

    await updateQuestion(question.id, {
      media: data.url
    });

    const updatedQuestion = {
      ...question,
      media: data.url
    };

    patchQuestionInCache(updatedQuestion);
    return updatedQuestion;
  }

  function handleSort(field) {
    // Clicking the current column toggles direction; clicking a new column
    // starts with ascending order.
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  function selectSortField(field) {
    setSortField(field);
    setSortOrder(defaultSortOrders[field] || "asc");
  }

  function toggleSortOrder() {
    setSortOrder(current => current === "asc" ? "desc" : "asc");
  }

  function patchQuestionInCache(updated) {
    // Small cache patches avoid a full list reload after simple edits and map
    // zone saves.
    setAllQuestions(prev =>
      prev.map(question =>
        question.id === updated.id
          ? { ...question, ...updated }
          : question
      )
    );
  }

  async function removeQuestionMedia(id) {
    await removeQuestionMediaRequest(id);

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
        tagFilter,
        dueOnly,
        sortField,
        sortOrder
      }),
    [
      allQuestions,
      dueOnly,
      tagFilter,
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
    removeQuestionMedia,
    deleteQuestion,
    dueOnly,
    filteredQuestions,
    tagFilter,
    handleSort,
    uploadQuestionMedia,
    isCreatingQuestion,
    isCreatingGroup,
    loadAllGroups,
    loadAllQuestions,
    groupDraft,
    questionDraft,
    questionInputRef,
    reloadAllData,
    resetGroupDraft,
    resetManageFilters,
    resetQuestionDraft,
    search,
    selectedItem,
    selectSortField,
    setAllGroups,
    setAllQuestions,
    setDueOnly,
    setTagFilter,
    setIsCreatingQuestion,
    setIsCreatingGroup,
    setGroupDraft,
    setQuestionDraft,
    setSearch,
    setSelectedItem,
    setViewMode,
    sortField,
    sortOrder,
    startCreateGroup,
    toggleSortOrder,
    updateQuestion,
    patchQuestionInCache,
    viewMode
  };
}
