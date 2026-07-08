import { useCallback, useMemo } from "react";
import {
  hasQuestionEditorAdapter,
  prepareQuestionDraftForType
} from "../components/questionEditorAdapters";

function emptyQuestionDraft() {
  return {
    question: "",
    answer: "",
    tags: [],
    type_q: "text",
    media: null,
    data: {}
  };
}

function emptyGroupDraft(type_group = "") {
  return {
    name: "",
    type_group,
    media: "",
    data: {}
  };
}

function mediaGroupOverrides() {
  return {
    type_group: "media",
    name: "Nouveau groupe média",
    media: null,
    data: {}
  };
}

export default function useInspectorEditorMode({
  createGroup,
  createQuestion,
  isCreatingGroup,
  isCreatingQuestion,
  questionDraft,
  selectedItem,
  setGroupDraft,
  setIsCreatingGroup,
  setIsCreatingQuestion,
  setQuestionDraft,
  setSelectedItem,
  setViewMode,
  startCreateGroup
}) {
  const mode = useMemo(() => {
    if (isCreatingGroup) return "createGroup";
    if (isCreatingQuestion) return "createQuestion";
    if (selectedItem) return "edit";

    return "empty";
  }, [isCreatingGroup, isCreatingQuestion, selectedItem]);

  const selectQuestionCreationType = useCallback((type_q) => {
    if (type_q === "media") {
      // Media groups skip the intermediate creation form: create the group
      // directly (with a default name) and open its editor.
      setViewMode?.("groups");
      setIsCreatingQuestion(false);
      createGroup?.(mediaGroupOverrides());
      return;
    }

    if (type_q === "map") {
      setViewMode?.("groups");

      if (startCreateGroup) {
        startCreateGroup(type_q);
        return;
      }

      setIsCreatingQuestion(false);
      setIsCreatingGroup(true);
      setGroupDraft(emptyGroupDraft(type_q));
      setSelectedItem(null);
      return;
    }

    setQuestionDraft((prev) => (
      prepareQuestionDraftForType(prev, type_q)
    ));
  }, [
    createGroup,
    setIsCreatingGroup,
    setIsCreatingQuestion,
    setGroupDraft,
    setQuestionDraft,
    setSelectedItem,
    setViewMode,
    startCreateGroup
  ]);

  const cancelCreateQuestion = useCallback(() => {
    setIsCreatingQuestion(false);
    setQuestionDraft(emptyQuestionDraft());
  }, [setIsCreatingQuestion, setQuestionDraft]);

  const selectGroupCreationType = useCallback((type_group) => {
    if (type_group === "media") {
      // Skip the intermediate creation form and open the editor directly.
      setIsCreatingGroup(false);
      createGroup?.(mediaGroupOverrides());
      return;
    }

    setGroupDraft(emptyGroupDraft(type_group));
  }, [createGroup, setGroupDraft, setIsCreatingGroup]);

  const createCurrentQuestion = useCallback(async (submittedDraft) => {
    await createQuestion(submittedDraft || questionDraft);
    setIsCreatingQuestion(false);
  }, [createQuestion, questionDraft, setIsCreatingQuestion]);

  const cancelCreateGroup = useCallback(() => {
    setIsCreatingGroup(false);
    setGroupDraft(emptyGroupDraft());
  }, [setGroupDraft, setIsCreatingGroup]);

  return {
    canRenderQuestionEditor: hasQuestionEditorAdapter(questionDraft?.type_q),
    cancelCreateGroup,
    cancelCreateQuestion,
    createCurrentQuestion,
    mode,
    selectGroupCreationType,
    selectQuestionCreationType
  };
}
