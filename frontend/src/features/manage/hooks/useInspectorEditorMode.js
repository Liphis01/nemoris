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

function emptyGroupDraft(type_group = "", mediaKind = null) {
  return {
    name: "",
    type_group,
    media: "",
    data: mediaKind ? { mediaKind } : {}
  };
}

export default function useInspectorEditorMode({
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

  const selectQuestionCreationType = useCallback((type_q, mediaKind = null) => {
    if (type_q === "map" || type_q === "media") {
      setViewMode?.("groups");

      if (startCreateGroup) {
        startCreateGroup(type_q, mediaKind);
        return;
      }

      setIsCreatingQuestion(false);
      setIsCreatingGroup(true);
      setGroupDraft(emptyGroupDraft(type_q, mediaKind));
      setSelectedItem(null);
      return;
    }

    setQuestionDraft((prev) => (
      prepareQuestionDraftForType(prev, type_q)
    ));
  }, [
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

  const selectGroupCreationType = useCallback((type_group, mediaKind = null) => {
    setGroupDraft(emptyGroupDraft(type_group, mediaKind));
  }, [setGroupDraft]);

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
