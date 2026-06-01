import MapEditor from "../../map/components/MapEditor";
import CreateMapGroupEditor from "./CreateMapGroupEditor";
import ImageGroupEditor from "./ImageGroupEditor";
import QuestionCreationTypeChooser from "./QuestionCreationTypeChooser";
import ReviewCalendarAction from "./ReviewCalendarAction";
import { getQuestionEditorAdapter } from "./questionEditorAdapters";
import useInspectorAutosave from "../hooks/useInspectorAutosave";
import useInspectorEditorMode from "../hooks/useInspectorEditorMode";
import useInspectorPreviewState from "../hooks/useInspectorPreviewState";

export default function ManageInspector({
  allGroups,
  setAllGroups,
  setAllQuestions,
  selectedItem,
  updateQuestion,
  patchQuestionInCache,
  setSelectedItem,
  setEditingZone,
  uploadQuestionMedia,
  uploadImageGroupMedia,
  isCreatingQuestion,
  setIsCreatingQuestion,
  isCreatingGroup,
  setIsCreatingGroup,
  questionDraft,
  setQuestionDraft,
  groupDraft,
  setGroupDraft,
  createQuestion,
  createGroup,
  editingZone,
  setViewMode,
  startCreateGroup,
  setHighlightedQuestionIds,
  onOpenInCalendar,
  registerPendingSaveHandler,
  requestManageTransition,
  availableTags = []
}) {
  const {
    canRenderQuestionEditor,
    cancelCreateGroup,
    cancelCreateQuestion,
    createCurrentQuestion,
    mode,
    selectQuestionCreationType
  } = useInspectorEditorMode({
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
  });

  const {
    draft,
    hasUnsavedChanges,
    removeMedia,
    resetDraft,
    saveDraft,
    saveStatus,
    setDraft
  } = useInspectorAutosave({
    isCreatingGroup,
    isCreatingQuestion,
    patchQuestionInCache,
    registerPendingSaveHandler,
    selectedItem,
    setSelectedItem,
    updateQuestion
  });

  const {
    openSelectedInCalendar,
    selectedNextReview
  } = useInspectorPreviewState({
    onOpenInCalendar,
    requestManageTransition,
    selectedItem,
    setEditingZone,
    setSelectedItem
  });

  if (mode === "createGroup") {
    return (
      <CreateMapGroupEditor
        groupDraft={groupDraft}
        onCancel={cancelCreateGroup}
        onCreate={createGroup}
        setGroupDraft={setGroupDraft}
      />
    );
  }

  if (mode === "createQuestion") {
    if (!canRenderQuestionEditor) {
      return (
        <QuestionCreationTypeChooser
          onSelect={selectQuestionCreationType}
          onCancel={cancelCreateQuestion}
        />
      );
    }

    const { Editor: CreateQuestionEditor } = getQuestionEditorAdapter(
      questionDraft.type_q
    );
    const createEditorProps = {
      draft: questionDraft,
      heading: "Nouvelle question",
      meta: questionDraft.type_q,
      onChange: setQuestionDraft,
      onSubmit: createCurrentQuestion,
      submitLabel: "Créer",
      onCancel: cancelCreateQuestion,
      onUploadFile: (file) => uploadQuestionMedia(file, { id: "new" }),
      onRemoveMedia: () => setQuestionDraft(prev => ({ ...prev, media: "" })),
      availableTags
    };

    return (
      <CreateQuestionEditor {...createEditorProps} />
    );
  }

  if (mode === "empty") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#777",
          fontSize: "18px"
        }}
      >
        Sélectionner une question ou un groupe
      </div>
    );
  }

  const selectedIsMapZone = selectedItem.type_q === "map";
  const isMapGroup = selectedItem.type_group === "map";
  const selectedIsImageItem = selectedItem.type_q === "image" && (
    selectedItem.group_id ||
    selectedItem.group?.id
  );
  const isImageGroup = selectedItem.type_group === "image";

  if (selectedIsMapZone || isMapGroup) {
    // Selecting either a map group or one of its zones opens the full map editor
    // for that group. A selected zone is passed through as the focused edit row.
    const groupe = selectedIsMapZone ? selectedItem.group : selectedItem;
    const group = allGroups.find((g) => g.id === groupe.id);

    if (!group) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#777",
            fontSize: "18px"
          }}
        >
          Sélectionner une question ou un groupe
        </div>
      );
    }

    return (
      <div
        style={{
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <MapEditor
          group={group}
          availableTags={availableTags}
          onSave={async (delta, saveContext) => {
            // Map saves can change group metadata, create zones, and update
            // existing zone labels/aliases. Patch each affected local cache.
            const savedGroup = saveContext?.group;
            const savedZones = saveContext?.zones || [];

            if (savedGroup) {
              setAllGroups(prev =>
                prev.map(g =>
                  g.id === savedGroup.id
                    ? { ...g, ...savedGroup }
                    : g
                )
              );
            } else if (typeof delta === "number") {
              setAllGroups(prev =>
                prev.map(g =>
                  g.id === group.id
                    ? { ...g, question_count: Math.max(0, (g.question_count || 0) + delta) }
                    : g
                )
              );
            }

            if (savedZones.length > 0) {
              setAllQuestions?.(prev => {
                const existingIds = new Set(prev.map(question => question.id));
                const patched = prev.map(question => {
                  const savedZone = savedZones.find(zone => zone.id === question.id);
                  return savedZone || question;
                });
                const created = savedZones.filter(zone => !existingIds.has(zone.id));

                return [...patched, ...created];
              });
            }

            const selectedZoneCode = saveContext?.selectedZoneCode;
            const createdQuestionIds = saveContext?.createdQuestionIds || [];
            const updatedQuestionIds = saveContext?.updatedQuestionIds || [];
            const highlightedIds = createdQuestionIds.length > 0
              ? createdQuestionIds
              : updatedQuestionIds;

            if (highlightedIds.length > 0) {
              setHighlightedQuestionIds?.(highlightedIds);
            }

            if (selectedZoneCode) {
              // After saving an edited zone, jump back to the saved question row
              // so the user sees the persisted item in the browser.
              const savedZone = savedZones.find((question) =>
                question.type_q === "map" &&
                question.group?.id === group.id &&
                (question.data?.code || question.code) === selectedZoneCode
              );

              if (savedZone) {
                setViewMode?.("questions");
                setSelectedItem(savedZone);
                setEditingZone?.(savedZone);
              }
            }
          }}
          onClose={() => { }}
          registerPendingSaveHandler={registerPendingSaveHandler}
          selectedZone={editingZone}
          headerAction={
            selectedIsMapZone ? (
              <ReviewCalendarAction
                compact
                nextReview={selectedNextReview}
                onOpen={openSelectedInCalendar}
              />
            ) : null
          }
        />
      </div>
    );
  }

  if (selectedIsImageItem || isImageGroup) {
    const groupId = selectedIsImageItem
      ? selectedItem.group?.id ?? selectedItem.group_id
      : selectedItem.id;
    const group = allGroups.find((g) => g.id === groupId);

    if (!group) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#777",
            fontSize: "18px"
          }}
        >
          Sélectionner une question ou un groupe
        </div>
      );
    }

    return (
      <div
        style={{
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <ImageGroupEditor
          group={group}
          selectedItem={selectedIsImageItem ? selectedItem : null}
          availableTags={availableTags}
          onUploadFile={(file) => uploadImageGroupMedia(group.id, file)}
          onSave={async (saveResult) => {
            const savedGroup = saveResult?.group;
            const savedItems = saveResult?.items || [];
            const deletedIds = saveResult?.deletedQuestionIds || [];

            if (savedGroup) {
              setAllGroups(prev =>
                prev.map(g =>
                  g.id === savedGroup.id
                    ? { ...g, ...savedGroup }
                    : g
                )
              );
            }

            setAllQuestions?.(prev => {
              const deletedIdSet = new Set(deletedIds);
              const existingIds = new Set(prev.map(question => question.id));
              const patched = prev
                .filter(question => !deletedIdSet.has(question.id))
                .map(question => {
                  const savedItem = savedItems.find(item => item.id === question.id);
                  return savedItem || question;
                });
              const created = savedItems.filter(item => !existingIds.has(item.id));

              return [...patched, ...created];
            });

            const highlightedIds = (saveResult?.createdQuestionIds || []).length > 0
              ? saveResult.createdQuestionIds
              : saveResult?.updatedQuestionIds || [];

            if (highlightedIds.length > 0) {
              setHighlightedQuestionIds?.(highlightedIds);
            }

            if (selectedIsImageItem) {
              const savedSelectedItem = savedItems.find(item => item.id === selectedItem.id);

              if (savedSelectedItem) {
                setSelectedItem(savedSelectedItem);
              }
            } else if (savedGroup) {
              setSelectedItem(savedGroup);
            }
          }}
          registerPendingSaveHandler={registerPendingSaveHandler}
          headerAction={
            selectedIsImageItem ? (
              <ReviewCalendarAction
                compact
                nextReview={selectedNextReview}
                onOpen={openSelectedInCalendar}
              />
            ) : null
          }
        />
      </div>
    );
  }

  async function handleUploadFile(file) {
    if (!uploadQuestionMedia) return;

    return uploadQuestionMedia(file, selectedItem);
  }

  const editorDraft = draft;
  const editType = editorDraft.type_q || "text";
  const { Editor: EditQuestionEditor } = getQuestionEditorAdapter(editType);
  const editEditorProps = {
    draft: editorDraft,
    heading: `Question #${selectedItem.id}`,
    meta: editType,
    onChange: setDraft,
    onSubmit: saveDraft,
    submitLabel: "Enregistrer",
    onCancel: resetDraft,
    onUploadFile: handleUploadFile,
    onRemoveMedia: removeMedia,
    saveStatus,
    hasUnsavedChanges,
    isSubmitDisabled: !hasUnsavedChanges,
    availableTags,
    headerAction: (
      <ReviewCalendarAction
        nextReview={selectedNextReview}
        onOpen={openSelectedInCalendar}
      />
    )
  };

  return (
    <EditQuestionEditor {...editEditorProps} />
  );
}
