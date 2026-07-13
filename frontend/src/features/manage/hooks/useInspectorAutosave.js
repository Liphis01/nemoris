import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildQuestionDraft,
  buildQuestionSavePayload,
  payloadsMatch
} from "../utils/questionDrafts";

function canAutosaveSelectedQuestion(selectedItem) {
  const groupedImage = selectedItem?.type_q === "media" && (
    selectedItem.group_id ||
    selectedItem.group?.id
  );
  // A sequence item's rank lives in `data`, which the autosave payload carries.
  // Letting the generic autosave fire would clobber data.position from a stale
  // draft, silently reordering the list behind the group editor's back.
  const sequenceItem = selectedItem?.type_q === "sequence";

  return Boolean(
    selectedItem?.id &&
    selectedItem.type_q &&
    selectedItem.type_q !== "map" &&
    !groupedImage &&
    !sequenceItem
  );
}

export default function useInspectorAutosave({
  isCreatingGroup,
  isCreatingQuestion,
  patchQuestionInCache,
  registerPendingSaveHandler,
  selectedItem,
  setSelectedItem,
  updateQuestion
}) {
  const [draft, setDraft] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    // Copy selected item into a local draft so typing does not mutate list cache
    // until the user saves.
    if (!selectedItem) {
      setDraft(null);
      setSaveStatus(null);
      return;
    }

    setDraft(buildQuestionDraft(selectedItem));
    setSaveStatus(null);
  }, [selectedItem]);

  const editorDraft = useMemo(() => {
    if (!selectedItem) return draft;

    return draft || buildQuestionDraft(selectedItem);
  }, [draft, selectedItem]);

  const hasUnsavedChanges = useMemo(() => {
    if (!editorDraft || !canAutosaveSelectedQuestion(selectedItem)) {
      return false;
    }

    return !payloadsMatch(
      buildQuestionSavePayload(editorDraft),
      buildQuestionSavePayload(selectedItem)
    );
  }, [editorDraft, selectedItem]);

  const saveQuestionDraft = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!draft || !canAutosaveSelectedQuestion(selectedItem)) {
      return { saved: false };
    }

    const payload = buildQuestionSavePayload(draft);
    const currentPayload = buildQuestionSavePayload(selectedItem);

    if (!force && payloadsMatch(payload, currentPayload)) {
      return { saved: false };
    }

    if (!silent) {
      setSaveStatus("Enregistrement...");
    }

    await updateQuestion(selectedItem.id, payload);

    const updatedQuestion = {
      ...selectedItem,
      ...payload
    };

    patchQuestionInCache(updatedQuestion);
    setSelectedItem(updatedQuestion);

    if (!silent) {
      setSaveStatus("Enregistré ✔");
    }

    return {
      saved: true,
      question: updatedQuestion
    };
  }, [draft, patchQuestionInCache, selectedItem, setSelectedItem, updateQuestion]);

  const saveSelectedQuestionIfDirty = useCallback(() => (
    saveQuestionDraft({ silent: true })
  ), [saveQuestionDraft]);

  useEffect(() => {
    if (
      !registerPendingSaveHandler ||
      isCreatingQuestion ||
      isCreatingGroup ||
      !canAutosaveSelectedQuestion(selectedItem)
    ) {
      return undefined;
    }

    return registerPendingSaveHandler(saveSelectedQuestionIfDirty);
  }, [
    isCreatingGroup,
    isCreatingQuestion,
    registerPendingSaveHandler,
    saveSelectedQuestionIfDirty,
    selectedItem
  ]);

  const saveDraft = useCallback(async () => {
    try {
      await saveQuestionDraft({ force: true });
    } catch (error) {
      console.error(error);
      setSaveStatus("Enregistrement impossible");
    }
  }, [saveQuestionDraft]);

  const resetDraft = useCallback(() => {
    setDraft(buildQuestionDraft(selectedItem));
    setSaveStatus(null);
  }, [selectedItem]);

  const removeMedia = useCallback(() => {
    setDraft((prev) => ({ ...prev, media: "" }));
  }, []);

  const removeAnswerMedia = useCallback(() => {
    setDraft((prev) => ({ ...prev, answer_media: "" }));
  }, []);

  return {
    draft: editorDraft,
    hasUnsavedChanges,
    removeMedia,
    removeAnswerMedia,
    resetDraft,
    saveDraft,
    saveStatus,
    setDraft
  };
}
