import { useEffect, useState } from "react";
import MapEditor from "../../map/components/MapEditor";
import CreateMapGroupEditor from "./CreateMapGroupEditor";
import GroupCreationTypeChooser from "./GroupCreationTypeChooser";
import MediaGroupEditor from "./MediaGroupEditor";
import TextGroupEditor from "./TextGroupEditor";
import ClozeGroupEditor from "./ClozeGroupEditor";
import GridGroupEditor from "./GridGroupEditor";
import SetGroupEditor from "./SetGroupEditor";
import SequenceGroupEditor from "./SequenceGroupEditor";
import PlaylistBuilder from "./PlaylistBuilder";
import QuestionCreationTypeChooser from "./QuestionCreationTypeChooser";
import ReviewCalendarAction from "./ReviewCalendarAction";
import { getQuestionEditorAdapter } from "./questionEditorAdapters";
import useInspectorAutosave from "../hooks/useInspectorAutosave";
import useInspectorEditorMode, {
  DEFAULT_GROUP_NAMES,
  DIRECT_GROUP_TYPES
} from "../hooks/useInspectorEditorMode";
import useInspectorPreviewState from "../hooks/useInspectorPreviewState";
import {
  getGroupPackPublication,
  previewGroupPackChanges,
  publishGroupPackChanges
} from "../../../api/packs";

// The grouped types whose editor opens on a group that does not exist yet.
const PENDING_GROUP_EDITORS = {
  text: TextGroupEditor,
  cloze: ClozeGroupEditor,
  grid: GridGroupEditor,
  set: SetGroupEditor,
  media: MediaGroupEditor,
  sequence: SequenceGroupEditor
};

const publishButtonStyle = {
  background: "#1f2a22",
  border: "1px solid #2f5f3d",
  borderRadius: "8px",
  color: "#a7f3c1",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 800,
  lineHeight: 1,
  padding: "8px 11px",
  whiteSpace: "nowrap"
};

const publishButtonDisabledStyle = {
  ...publishButtonStyle,
  cursor: "default",
  opacity: 0.55
};

function diffCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function formatPublishSummary(preview) {
  const added = diffCount(preview?.questions?.added);
  const edited = diffCount(preview?.questions?.edited);
  const removed = diffCount(preview?.questions?.removed);
  const groupChanges =
    diffCount(preview?.groups?.added) +
    diffCount(preview?.groups?.edited) +
    diffCount(preview?.groups?.removed);
  const metadata = diffCount(preview?.metadata_changed);

  return [
    "Publier les changements de ce pack ?",
    "",
    `${added} question${added > 1 ? "s" : ""} ajoutée${added > 1 ? "s" : ""}`,
    `${edited} question${edited > 1 ? "s" : ""} modifiée${edited > 1 ? "s" : ""}`,
    `${removed} question${removed > 1 ? "s" : ""} retirée${removed > 1 ? "s" : ""}`,
    `${groupChanges} groupe${groupChanges > 1 ? "s" : ""} modifié${groupChanges > 1 ? "s" : ""}`,
    `${metadata} métadonnée${metadata > 1 ? "s" : ""} modifiée${metadata > 1 ? "s" : ""}`
  ].join("\n");
}

function PackPublishHeaderAction({ group, requestManageTransition }) {
  const [publicationState, setPublicationState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const groupId = group?.id || null;

  useEffect(() => {
    if (!groupId) {
      setPublicationState(null);
      return undefined;
    }

    let cancelled = false;
    setMessage("");
    setError("");

    getGroupPackPublication(groupId)
      .then((result) => {
        if (!cancelled) {
          setPublicationState(result);
        }
      })
      .catch((loadError) => {
        console.error(loadError);
        if (!cancelled) {
          setPublicationState(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (!publicationState?.can_publish_changes) {
    return null;
  }

  async function publishChanges() {
    if (!groupId || busy) return;

    const runAfterPendingSave = requestManageTransition || ((action) => action());

    await runAfterPendingSave(async () => {
      setBusy(true);
      setMessage("");
      setError("");

      try {
        const preview = await previewGroupPackChanges(groupId);

        if (preview?.unchanged) {
          setMessage("Aucun changement");
          return;
        }

        if (!window.confirm(formatPublishSummary(preview))) {
          return;
        }

        const result = await publishGroupPackChanges(groupId);
        setPublicationState(previous => ({
          ...(previous || {}),
          status: result.publication?.publication_status || "published",
          publication: result.publication,
          can_publish_changes: true
        }));
        setMessage("Publié");
      } catch (publishError) {
        console.error(publishError);
        setError(publishError.message || "Publication impossible");
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <span
      style={{
        alignItems: "center",
        display: "inline-flex",
        gap: "7px",
        minWidth: 0
      }}
    >
      <button
        type="button"
        disabled={busy}
        onClick={publishChanges}
        style={busy ? publishButtonDisabledStyle : publishButtonStyle}
      >
        {busy ? "Publication..." : "Publier les changements"}
      </button>
      {(message || error) && (
        <span
          role={error ? "alert" : "status"}
          style={{
            color: error ? "#f2b8b8" : "#9ccfa9",
            fontSize: "12px",
            fontWeight: 700,
            whiteSpace: "nowrap"
          }}
        >
          {error || message}
        </span>
      )}
    </span>
  );
}

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
  uploadMediaGroupMedia,
  importMediaGroupMediaUrl,
  uploadMedia,
  importMediaUrl,
  isCreatingPlaylist,
  setIsCreatingPlaylist,
  loadAllPlaylists,
  deletePlaylist,
  isCreatingQuestion,
  setIsCreatingQuestion,
  isCreatingGroup,
  setIsCreatingGroup,
  questionDraft,
  setQuestionDraft,
  groupDraft,
  setGroupDraft,
  createQuestion,
  createGroupSilently,
  editingZone,
  setViewMode,
  setHighlightedQuestionIds,
  importQuestionMediaUrl,
  onOpenInCalendar,
  registerPendingSaveHandler,
  requestManageTransition,
  requestQuestionScroll,
  onOpenMapImport,
  availableTags = []
}) {
  const {
    canRenderQuestionEditor,
    cancelCreateGroup,
    cancelCreateQuestion,
    createCurrentQuestion,
    mode,
    selectGroupCreationType,
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
    setQuestionDraft
  });

  const {
    draft,
    hasUnsavedChanges,
    removeMedia,
    removeAnswerMedia,
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

  function renderGroupHeaderAction(group, calendarAction = null) {
    return (
      <>
        {calendarAction}
        <PackPublishHeaderAction
          group={group}
          requestManageTransition={requestManageTransition}
        />
      </>
    );
  }

  // Shared by the "edit an existing group" and "create a group" paths: a save
  // reconciles the group and question caches the same way either time.
  function buildGroupSaveHandler({ selectedGroupItem = null, finishCreate = false }) {
    return async (saveResult) => {
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

      if (selectedGroupItem) {
        const savedSelectedItem = savedItems.find(
          item => item.id === selectedGroupItem.id
        );

        if (savedSelectedItem) {
          setSelectedItem(savedSelectedItem);
        }
      } else if (savedGroup) {
        setSelectedItem(savedGroup);
      }

      if (finishCreate && savedGroup) {
        // The group now exists, so leave creation mode and let the normal edit
        // branch take over on the next render.
        setIsCreatingGroup(false);
        setGroupDraft({ name: "", type_group: "", media: "", data: {} });
      }
    };
  }

  // Playlists have their own editor and share none of the group/question
  // draft machinery, so they branch before any of it.
  if (isCreatingPlaylist || selectedItem?.isPlaylist) {
    const editing = selectedItem?.isPlaylist ? selectedItem : null;

    return (
      <PlaylistBuilder
        key={editing?.id || "new-playlist"}
        playlist={editing}
        groups={allGroups}
        availableTags={availableTags}
        onSaved={async (saved) => {
          await loadAllPlaylists?.();
          setIsCreatingPlaylist?.(false);
          setSelectedItem?.({ ...saved, isPlaylist: true });
        }}
        onCancel={() => {
          setIsCreatingPlaylist?.(false);
          setSelectedItem?.(null);
        }}
        onDelete={async (target) => {
          await deletePlaylist?.(target.id);
          setSelectedItem?.(null);
        }}
      />
    );
  }

  if (mode === "createGroup") {
    if (!groupDraft.type_group) {
      return (
        <GroupCreationTypeChooser
          onSelect={selectGroupCreationType}
          onCancel={cancelCreateGroup}
        />
      );
    }

    if (DIRECT_GROUP_TYPES.includes(groupDraft.type_group)) {
      const PendingGroupEditor = PENDING_GROUP_EDITORS[groupDraft.type_group];
      // The editor opens on a group with no id: nothing exists server-side yet.
      // It calls ensureGroupId at its first save, and only a named or non-empty
      // group is worth a row -- so backing out of a mis-click leaves nothing.
      const pendingGroup = {
        id: null,
        type_group: groupDraft.type_group,
        name: "",
        media: null,
        tags: [],
        data: {}
      };

      return (
        <div
          style={{
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column"
          }}
        >
          <PendingGroupEditor
            group={pendingGroup}
            selectedItem={null}
            availableTags={availableTags}
            // The group doesn't exist server-side yet, so media can't be scoped
            // to a group id: fall back to the generic upload endpoints (same
            // ones "new" questions use) and let the save flow adopt the files.
            onUploadFile={groupDraft.type_group === "media" ? uploadMedia : undefined}
            onImportMediaUrl={groupDraft.type_group === "media" ? importMediaUrl : undefined}
            ensurePersistedGroup={async ({ name, itemCount }) => {
              const trimmedName = String(name || "").trim();

              // Nothing named and nothing in it: not worth a row.
              if (!trimmedName && itemCount === 0) {
                return null;
              }

              return await createGroupSilently?.({
                type_group: groupDraft.type_group,
                name:
                  trimmedName ||
                  DEFAULT_GROUP_NAMES[groupDraft.type_group] ||
                  "Nouveau groupe",
                media: null,
                data: {}
              }) ?? null;
            }}
            onSave={buildGroupSaveHandler({ finishCreate: true })}
            registerPendingSaveHandler={registerPendingSaveHandler}
            headerAction={null}
            updateQuestion={updateQuestion}
          />
        </div>
      );
    }

    return (
      <CreateMapGroupEditor
        groupDraft={groupDraft}
        onCancel={cancelCreateGroup}
        onAnalyzed={(draft, name) => {
          onOpenMapImport?.("result", draft, name);
        }}
        onOpenRepair={(draft, name) => {
          onOpenMapImport?.("repair", draft, name);
        }}
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
      onImportMediaUrl: importQuestionMediaUrl
        ? (url) => importQuestionMediaUrl(url, { id: "new" })
        : undefined,
      onRemoveMedia: () => setQuestionDraft(prev => ({ ...prev, media: "" })),
      onUploadAnswerFile: (file) =>
        uploadQuestionMedia(file, { id: "new" }, "answer_media"),
      onImportAnswerMediaUrl: importQuestionMediaUrl
        ? (url) => importQuestionMediaUrl(url, { id: "new" }, "answer_media")
        : undefined,
      onRemoveAnswerMedia: () =>
        setQuestionDraft(prev => ({ ...prev, answer_media: "" })),
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
        Sélectionner une question, un groupe ou une playlist
      </div>
    );
  }

  const selectedIsMapZone = selectedItem.type_q === "map";
  const isMapGroup = selectedItem.type_group === "map";
  const selectedIsImageItem = selectedItem.type_q === "media" && (
    selectedItem.group_id ||
    selectedItem.group?.id
  );
  const isImageGroup = selectedItem.type_group === "media";
  const selectedIsTextItem = selectedItem.type_q === "text" && (
    selectedItem.group_id ||
    selectedItem.group?.id
  );
  const isTextGroup = selectedItem.type_group === "text";
  const selectedIsSequenceItem = selectedItem.type_q === "sequence" && (
    selectedItem.group_id ||
    selectedItem.group?.id
  );
  const isSequenceGroup = selectedItem.type_group === "sequence";
  const selectedIsClozeItem = selectedItem.type_q === "cloze" && (
    selectedItem.group_id || selectedItem.group?.id
  );
  const isClozeGroup = selectedItem.type_group === "cloze";
  const selectedIsGridItem = selectedItem.type_q === "grid" && (selectedItem.group_id || selectedItem.group?.id);
  const isGridGroup = selectedItem.type_group === "grid";
  const selectedIsSetItem = selectedItem.type_q === "set" && (selectedItem.group_id || selectedItem.group?.id);
  const isSetGroup = selectedItem.type_group === "set";

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
          Sélectionner une question, un groupe ou une playlist
        </div>
      );
    }

    return (
      <div
        style={{
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <MapEditor
          group={group}
          availableTags={availableTags}
          onZoneSelect={(zone) => requestQuestionScroll?.(zone.id)}
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
          headerAction={renderGroupHeaderAction(
            group,
            selectedIsMapZone ? (
              <ReviewCalendarAction
                compact
                nextReview={selectedNextReview}
                onOpen={openSelectedInCalendar}
              />
            ) : null
          )}
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
          Sélectionner une question, un groupe ou une playlist
        </div>
      );
    }

    return (
      <div
        style={{
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <MediaGroupEditor
          group={group}
          selectedItem={selectedIsImageItem ? selectedItem : null}
          availableTags={availableTags}
          onUploadFile={(file) => uploadMediaGroupMedia(group.id, file)}
          onImportMediaUrl={importMediaGroupMediaUrl
            ? (url) => importMediaGroupMediaUrl(group.id, url)
            : undefined}
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
          updateQuestion={updateQuestion}
          headerAction={renderGroupHeaderAction(
            group,
            selectedIsImageItem ? (
              <ReviewCalendarAction
                compact
                nextReview={selectedNextReview}
                onOpen={openSelectedInCalendar}
              />
            ) : null
          )}
        />
      </div>
    );
  }

  if (
    selectedIsTextItem ||
    isTextGroup ||
    selectedIsClozeItem ||
    isClozeGroup ||
    selectedIsGridItem ||
    isGridGroup ||
    selectedIsSetItem ||
    isSetGroup ||
    selectedIsSequenceItem ||
    isSequenceGroup
  ) {
    // Text groups and sequences are both "a group of rows" in manage: only the
    // editor differs, so the group lookup and the save/cache reconciliation
    // below are shared.
    const isSequence = selectedIsSequenceItem || isSequenceGroup;
    const isCloze = selectedIsClozeItem || isClozeGroup;
    const isGrid = selectedIsGridItem || isGridGroup;
    const isSet = selectedIsSetItem || isSetGroup;
    const GroupEditor = isSequence ? SequenceGroupEditor : isCloze ? ClozeGroupEditor : isGrid ? GridGroupEditor : isSet ? SetGroupEditor : TextGroupEditor;
    const selectedIsGroupItem = isSequence
      ? selectedIsSequenceItem
      : isCloze ? selectedIsClozeItem : isGrid ? selectedIsGridItem : isSet ? selectedIsSetItem : selectedIsTextItem;
    const groupId = selectedIsGroupItem
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
          Sélectionner une question, un groupe ou une playlist
        </div>
      );
    }

    return (
      <div
        style={{
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <GroupEditor
          group={group}
          selectedItem={selectedIsGroupItem ? selectedItem : null}
          availableTags={availableTags}
          onSave={buildGroupSaveHandler({
            selectedGroupItem: selectedIsGroupItem ? selectedItem : null
          })}
          registerPendingSaveHandler={registerPendingSaveHandler}
          updateQuestion={updateQuestion}
          headerAction={renderGroupHeaderAction(
            group,
            selectedIsGroupItem ? (
              <ReviewCalendarAction
                compact
                nextReview={selectedNextReview}
                onOpen={openSelectedInCalendar}
              />
            ) : null
          )}
        />
      </div>
    );
  }

  async function handleUploadFile(file) {
    if (!uploadQuestionMedia) return;

    return uploadQuestionMedia(file, selectedItem);
  }

  async function handleImportMediaUrl(url) {
    if (!importQuestionMediaUrl) return;

    return importQuestionMediaUrl(url, selectedItem);
  }

  async function handleUploadAnswerFile(file) {
    if (!uploadQuestionMedia) return;

    return uploadQuestionMedia(file, selectedItem, "answer_media");
  }

  async function handleImportAnswerMediaUrl(url) {
    if (!importQuestionMediaUrl) return;

    return importQuestionMediaUrl(url, selectedItem, "answer_media");
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
    onImportMediaUrl: importQuestionMediaUrl ? handleImportMediaUrl : undefined,
    onRemoveMedia: removeMedia,
    onUploadAnswerFile: handleUploadAnswerFile,
    onImportAnswerMediaUrl: importQuestionMediaUrl ? handleImportAnswerMediaUrl : undefined,
    onRemoveAnswerMedia: removeAnswerMedia,
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
