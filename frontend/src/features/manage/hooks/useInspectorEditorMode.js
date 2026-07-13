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

// Group types whose editor opens immediately, with no intermediate creation
// form (nothing to upload first). The group itself is NOT persisted here -- see
// PENDING_GROUP_EDITORS in ManageInspector: it is created at the first save that
// has something worth saving, so a mis-click leaves no empty group behind.
export const DIRECT_GROUP_TYPES = ["text", "media", "sequence"];

export const DEFAULT_GROUP_NAMES = {
  text: "Nouveau groupe texte",
  media: "Nouveau groupe média",
  sequence: "Nouvelle liste"
};

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
  setQuestionDraft
}) {
  const mode = useMemo(() => {
    if (isCreatingGroup) return "createGroup";
    if (isCreatingQuestion) return "createQuestion";
    if (selectedItem) return "edit";

    return "empty";
  }, [isCreatingGroup, isCreatingQuestion, selectedItem]);

  // Only standalone question types reach this now: every grouped type is created
  // from "Nouveau groupe" via selectGroupCreationType.
  const selectQuestionCreationType = useCallback((type_q) => {
    setQuestionDraft((prev) => (
      prepareQuestionDraftForType(prev, type_q)
    ));
  }, [setQuestionDraft]);

  const cancelCreateQuestion = useCallback(() => {
    setIsCreatingQuestion(false);
    setQuestionDraft(emptyQuestionDraft());
  }, [setIsCreatingQuestion, setQuestionDraft]);

  // Every type just records its choice in the draft. Map then shows its creation
  // form; the direct types open their editor on an unsaved group.
  const selectGroupCreationType = useCallback((type_group) => {
    setGroupDraft(emptyGroupDraft(type_group));
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
