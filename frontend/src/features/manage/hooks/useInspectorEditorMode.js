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

function defaultMediaGroupName(mediaKind) {
  if (mediaKind === "audio") return "Nouveau groupe audio";
  if (mediaKind === "video") return "Nouveau groupe vidéo";
  return "Nouveau groupe d'images";
}

function mediaGroupOverrides(mediaKind) {
  return {
    type_group: "media",
    name: defaultMediaGroupName(mediaKind),
    media: null,
    data: mediaKind ? { mediaKind } : {}
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

  const selectQuestionCreationType = useCallback((type_q, mediaKind = null) => {
    if (type_q === "media") {
      // Media groups skip the intermediate creation form: create the group
      // directly (with a default name) and open its editor.
      setViewMode?.("groups");
      setIsCreatingQuestion(false);
      createGroup?.(mediaGroupOverrides(mediaKind));
      return;
    }

    if (type_q === "map") {
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

  const selectGroupCreationType = useCallback((type_group, mediaKind = null) => {
    if (type_group === "media") {
      // Skip the intermediate creation form and open the editor directly.
      setIsCreatingGroup(false);
      createGroup?.(mediaGroupOverrides(mediaKind));
      return;
    }

    setGroupDraft(emptyGroupDraft(type_group, mediaKind));
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
