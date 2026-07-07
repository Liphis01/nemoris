import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createQuestion as createQuestionRequest,
  deleteQuestion as deleteQuestionRequest,
  importMediaUrl,
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
import {
  importImageGroupMediaUrl as importImageGroupMediaUrlRequest,
  uploadImageGroupMedia as uploadImageGroupMediaRequest
} from "../../../api/imageGroups";
import { filterAndSortGroups } from "../utils/groupFilters";
import { filterAndSortQuestions } from "../utils/questionFilters";


function createInitialQuestionDraft(type_q = "text") {
  // Default new questions are text items. Map zones are normally created from
  // the map editor because they need a data.code value from the SVG.
  return {
    question: "",
    answer: "",
    tags: [],
    type_q,
    media: null,
    data: {}
  };
}

function draftTagsWithPendingTag(draft) {
  const tags = Array.isArray(draft?.tags) ? draft.tags : [];
  const pendingTag = (draft?._pendingTagInput || "").trim();

  if (!pendingTag || tags.includes(pendingTag)) {
    return tags;
  }

  return [...tags, pendingTag];
}

function questionMutationPayload(draft) {
  const { _pendingTagInput, ...payload } = draft || {};

  return {
    ...payload,
    tags: draftTagsWithPendingTag(draft)
  };
}

function createInitialGroupDraft(type_group = "") {
  return {
    name: "",
    type_group,
    media: "",
    data: {}
  };
}

const initialGroupDraft = createInitialGroupDraft();

const defaultSortOrders = {
  id: "asc",
  title: "asc",
  group: "asc",
  next_review: "asc",
  reps: "asc",
  name: "asc",
  type: "asc",
  question_count: "asc",
  media: "asc"
};


function getItemGroupId(item) {
  return item?.group_id ?? item?.group?.id ?? null;
}


export function useManageLibrary(mode) {
  // This hook is the Manage data store: it owns loaded questions/groups, local
  // filters, creation drafts, and cache patches after mutations.
  const [allQuestions, setAllQuestions] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [questionTypeFilter, setQuestionTypeFilter] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [sortField, setSortField] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc");
  const [groupSearch, setGroupSearch] = useState("");
  const [groupTypeFilter, setGroupTypeFilter] = useState("");
  const [groupHasMediaOnly, setGroupHasMediaOnly] = useState(false);
  const [groupSortField, setGroupSortField] = useState("id");
  const [groupSortOrder, setGroupSortOrder] = useState("asc");
  const [selectedItem, setSelectedItem] = useState(null);
  const [isCreatingQuestion, setIsCreatingQuestion] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [viewMode, setViewMode] = useState("questions");
  const [questionDraft, setQuestionDraft] = useState(() => createInitialQuestionDraft());
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
    setQuestionDraft(createInitialQuestionDraft());
  }

  function resetGroupDraft() {
    setGroupDraft(createInitialGroupDraft());
  }

  function resetManageFilters() {
    setSearch("");
    setTagFilter("");
    setQuestionTypeFilter("");
    setDueOnly(false);
    setSortField("id");
    setSortOrder("asc");
    setGroupSearch("");
    setGroupTypeFilter("");
    setGroupHasMediaOnly(false);
    setGroupSortField("id");
    setGroupSortOrder("asc");
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

    setSelectedItem(prev =>
      prev && !prev.type_group && prev.id === id ? null : prev
    );

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
      setAllQuestions(prev =>
        prev.filter(question => getItemGroupId(question) !== id)
      );
      setSelectedItem(prev => {
        if (!prev) return prev;
        if (prev.type_group && prev.id === id) return null;
        return getItemGroupId(prev) === id ? null : prev;
      });
    } catch (error) {
      alert(error.message || "Impossible de supprimer le groupe.");
    }
  }

  async function createQuestion(draftOverride) {
    const payload = questionMutationPayload(draftOverride || questionDraft);

    if (!payload.question) {
      alert("Champs manquants");
      return;
    }

    const created = await createQuestionRequest(payload);

    setAllQuestions(prev => [...prev, created]);
    resetQuestionDraft();

    window.setTimeout(() => {
      questionInputRef.current?.focus();
    }, 0);

    return created;
  }

  function startCreateQuestion() {
    setQuestionDraft(createInitialQuestionDraft(""));
    setIsCreatingQuestion(true);
    setIsCreatingGroup(false);
    setSelectedItem(null);
  }

  function startCreateGroup(type_group = "") {
    setGroupDraft(createInitialGroupDraft(type_group));
    setIsCreatingGroup(true);
    setIsCreatingQuestion(false);
    setSelectedItem(null);
  }

  async function createGroup() {
    if (!groupDraft.type_group) {
      alert("Le type de groupe est requis.");
      return;
    }

    if (!groupDraft.name) {
      alert("Le nom du groupe est requis.");
      return;
    }

    if (groupDraft.type_group === "map" && !groupDraft.media) {
      alert("Le fichier SVG de la carte est requis.");
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

  async function uploadQuestionMedia(file, question, field = "media") {
    if (!file) return;

    // Uploads only create the static asset. The question.media value is saved
    // through the normal editor save flow so dirty-state/autosave stays intact.
    // `field` targets either the question media or the answer media draft slot.
    const data = await uploadMedia(file);

    if (question?.id === "new") {
      setQuestionDraft(prev => ({ ...prev, [field]: data.url }));
    }

    return data;
  }

  async function importQuestionMediaUrl(url, question, field = "media") {
    if (!url) return;

    const data = await importMediaUrl(url);

    if (question?.id === "new") {
      setQuestionDraft(prev => ({ ...prev, [field]: data.url }));
    }

    return data;
  }

  async function uploadImageGroupMedia(groupId, file) {
    if (!file || !groupId) return;

    return uploadImageGroupMediaRequest(groupId, file);
  }

  async function importImageGroupMediaUrl(groupId, url) {
    if (!url || !groupId) return;

    return importImageGroupMediaUrlRequest(groupId, url);
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

  function selectGroupSortField(field) {
    setGroupSortField(field);
    setGroupSortOrder(defaultSortOrders[field] || "asc");
  }

  function toggleGroupSortOrder() {
    setGroupSortOrder(current => current === "asc" ? "desc" : "asc");
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
    const currentQuestion = allQuestions.find(question => question.id === id);
    const updatedQuestion = currentQuestion
      ? { ...currentQuestion, media: null }
      : null;

    setAllQuestions(prev =>
      prev.map(question =>
        question.id === id
          ? { ...question, media: null }
          : question
      )
    );

    return updatedQuestion;
  }

  const filteredQuestions = useMemo(
    () =>
      filterAndSortQuestions({
        questions: allQuestions,
        search,
        tagFilter,
        questionTypeFilter,
        dueOnly,
        sortField,
        sortOrder
      }),
    [
      allQuestions,
      dueOnly,
      questionTypeFilter,
      tagFilter,
      search,
      sortField,
      sortOrder
    ]
  );

  const filteredGroups = useMemo(
    () =>
      filterAndSortGroups({
        groups: allGroups,
        groupSearch,
        groupTypeFilter,
        groupHasMediaOnly,
        groupSortField,
        groupSortOrder
      }),
    [
      allGroups,
      groupHasMediaOnly,
      groupSearch,
      groupSortField,
      groupSortOrder,
      groupTypeFilter
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
    filteredGroups,
    filteredQuestions,
    groupHasMediaOnly,
    groupSearch,
    groupSortField,
    groupSortOrder,
    groupTypeFilter,
    tagFilter,
    handleSort,
    importQuestionMediaUrl,
    importImageGroupMediaUrl,
    uploadQuestionMedia,
    uploadImageGroupMedia,
    isCreatingQuestion,
    isCreatingGroup,
    loadAllGroups,
    loadAllQuestions,
    groupDraft,
    questionDraft,
    questionInputRef,
    questionTypeFilter,
    reloadAllData,
    resetGroupDraft,
    resetManageFilters,
    resetQuestionDraft,
    search,
    selectedItem,
    selectGroupSortField,
    selectSortField,
    setAllGroups,
    setAllQuestions,
    setDueOnly,
    setGroupHasMediaOnly,
    setGroupSearch,
    setGroupTypeFilter,
    setTagFilter,
    setIsCreatingQuestion,
    setIsCreatingGroup,
    setGroupDraft,
    setQuestionDraft,
    setQuestionTypeFilter,
    setSearch,
    setSelectedItem,
    setViewMode,
    sortField,
    sortOrder,
    startCreateQuestion,
    startCreateGroup,
    toggleGroupSortOrder,
    toggleSortOrder,
    updateQuestion,
    patchQuestionInCache,
    viewMode
  };
}
