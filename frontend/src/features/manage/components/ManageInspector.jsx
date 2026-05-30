import { useCallback, useEffect, useState } from "react";
import MapEditor from "../../map/components/MapEditor";
import {
  createDefaultTimeline,
  formatTimelineAnswer,
  normalizeTimeline
} from "../../timeline/timelineUtils";
import TimelineQuestionEditor from "../../timeline/components/TimelineQuestionEditor";
import TextQuestionEditor from "./TextQuestionEditor";

const panelStyle = {
  padding: "28px",
  overflow: "overlay",
  background: "#141414",
  height: "100%"
};

const labelStyle = {
  display: "block",
  marginBottom: "8px",
  color: "#bbb",
  fontSize: "14px"
};

const inputStyle = {
  width: "100%",
  marginBottom: "18px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid #2a2a2a",
  background: "#121212",
  color: "#eee",
  boxSizing: "border-box"
};

const buttonStyle = {
  padding: "12px 16px",
  borderRadius: "10px",
  border: "none",
  cursor: "pointer",
  background: "#2a2a2a",
  color: "#eee",
  marginRight: "12px"
};

const calendarButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  borderRadius: "999px",
  border: "1px solid #24583a",
  background: "#151c18",
  color: "#7ee2a8",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: "700",
  lineHeight: 1,
  whiteSpace: "nowrap"
};

function timelineDraftPatch(draft) {
  const timeline = normalizeTimeline(draft?.data?.timeline || createDefaultTimeline());

  return {
    ...draft,
    answer: formatTimelineAnswer(timeline),
    data: {
      ...(draft?.data || {}),
      timeline
    },
    group_id: null
  };
}

function formatReviewDate(value) {
  // Dates arrive as YYYY-MM-DD from the backend. Build a local Date from parts
  // to avoid timezone shifts around midnight.
  if (!value) return "";

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;

  const reviewDate = new Date(Number(year), Number(month) - 1, Number(day));
  const today = new Date();
  const todayKey = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const tomorrowKey = new Date(todayKey);
  tomorrowKey.setDate(todayKey.getDate() + 1);

  if (reviewDate.getTime() === todayKey.getTime()) return "Aujourd'hui";
  if (reviewDate.getTime() === tomorrowKey.getTime()) return "Demain";

  return `${day}-${month}-${year}`;
}

function hasStartedProgress(question) {
  // New questions are due immediately, but showing a calendar jump before the
  // first review is noisy. Only expose it after progress has started.
  const history = question?.progress?.history || [];
  return (question?.progress?.reps || 0) > 0 || history.length > 0;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }

  const serialized = JSON.stringify(value);
  return serialized === undefined ? "undefined" : serialized;
}

function buildQuestionSavePayload(source) {
  const type_q = source?.type_q || "text";
  const tags = Array.isArray(source?.tags) ? source.tags : [];
  const pendingTag = (source?._pendingTagInput || "").trim();

  return {
    question: source?.question || "",
    answer: source?.answer || "",
    media: source?.media || null,
    type_q,
    tags: pendingTag && !tags.includes(pendingTag)
      ? [...tags, pendingTag]
      : tags,
    data: type_q === "timeline" ? source?.data || {} : {}
  };
}

function payloadsMatch(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function ReviewCalendarAction({ compact = false, nextReview, onOpen }) {
  if (!nextReview) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        ...calendarButtonStyle,
        ...(compact
          ? {
            alignItems: "flex-start",
            flexDirection: "column",
            gap: "3px",
            padding: "7px 10px",
            borderRadius: "10px"
          }
          : {})
      }}
      title="Voir cette question dans le calendrier"
    >
      <span
        style={{
          color: "#8a8a8a",
          fontSize: compact ? "10px" : undefined,
          letterSpacing: compact ? "0.04em" : undefined,
          textTransform: compact ? "uppercase" : undefined
        }}
      >
        Révision
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px"
        }}
      >
        {formatReviewDate(nextReview)}
        <span aria-hidden="true">→</span>
      </span>
    </button>
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
  deleteQuestion,
  uploadQuestionMedia,
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
  setHighlightedQuestionIds,
  onOpenInCalendar,
  registerPendingSaveHandler,
  requestManageTransition
}) {
  // Inspector has three modes: create group, create question, or edit selected
  // item. Map groups/zones delegate their detailed editing to MapEditor.
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
    
    setDraft({
      question: selectedItem.question || "",
      answer: selectedItem.answer || "",
      media: selectedItem.media || "",
      type_q: selectedItem.type_q || "text",
      tags: selectedItem.tags || [],
      data: selectedItem.data || {}
    });
    setSaveStatus(null);
  }, [selectedItem]);

  function updateQuestionDraftType(type_q) {
    setQuestionDraft((prev) => {
      const next = { ...prev, type_q };

      if (type_q === "timeline") {
        return timelineDraftPatch(next);
      }

      return {
        ...next,
        data: type_q === "text" ? {} : next.data
      };
    });
  }

  const saveQuestionDraft = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!draft || !selectedItem?.id || !selectedItem.type_q || selectedItem.type_q === "map") {
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
    if (!registerPendingSaveHandler) {
      return undefined;
    }

    if (
      isCreatingQuestion ||
      isCreatingGroup ||
      !selectedItem?.id ||
      !selectedItem.type_q ||
      selectedItem.type_q === "map"
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

  function cancelCreateQuestion() {
    setIsCreatingQuestion(false);
    setQuestionDraft({
      question: "",
      answer: "",
      tags: [],
      type_q: "text",
      media: null,
      data: {}
    });
  }

  async function handleCreateQuestion(submittedDraft) {
    await createQuestion(submittedDraft || questionDraft);
    setIsCreatingQuestion(false);
  }

  if (isCreatingGroup) {
    return (
      <div style={panelStyle}>
        <div style={{ marginBottom: "22px", color: "#888" }}>
          Nouveau groupe
        </div>

        <label style={labelStyle}>Nom du groupe</label>
        <input
          style={inputStyle}
          value={groupDraft.name}
          onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
          placeholder="Ex : Carte Europe"
        />

        <label style={labelStyle}>Type de groupe</label>
        <select
          style={inputStyle}
          value={groupDraft.type_group}
          onChange={(e) => setGroupDraft({ ...groupDraft, type_group: e.target.value })}
        >
          <option value="map">map</option>
        </select>

        <label style={labelStyle}>Media / URL (optionnel)</label>
        <input
          style={inputStyle}
          value={groupDraft.media}
          onChange={(e) => setGroupDraft({ ...groupDraft, media: e.target.value })}
        />

        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
          <button type="button" onClick={createGroup} style={buttonStyle}>
            Créer le groupe
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCreatingGroup(false);
              setGroupDraft({ name: "", type_group: "map", media: "", data: {} });
            }}
            style={{ ...buttonStyle, background: "#641c1c" }}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  if (isCreatingQuestion) {
    const createEditorProps = {
      draft: questionDraft,
      heading: "Nouvelle question",
      meta: questionDraft.type_q || "text",
      onChange: setQuestionDraft,
      onSubmit: handleCreateQuestion,
      submitLabel: "Créer",
      onCancel: cancelCreateQuestion,
      onUploadFile: (event) => uploadQuestionMedia(event, { id: "new" }),
      showTypeSelector: true,
      onTypeChange: updateQuestionDraftType
    };

    if (questionDraft.type_q === "timeline") {
      return (
        <TimelineQuestionEditor {...createEditorProps} />
      );
    }

    return (
      <TextQuestionEditor {...createEditorProps} />
    );
  }

  if (!selectedItem) {
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
  const selectedNextReview = hasStartedProgress(selectedItem)
    ? selectedItem.progress?.next_review || selectedItem.next_review
    : null;

  function openSelectedInCalendar() {
    if (!selectedNextReview) return;

    if (requestManageTransition) {
      requestManageTransition(() => onOpenInCalendar?.(selectedItem));
      return;
    }

    onOpenInCalendar?.(selectedItem);
  }

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

  async function handleSave() {
    try {
      await saveQuestionDraft({ force: true });
    } catch (error) {
      console.error(error);
      setSaveStatus("Enregistrement impossible");
    }
  }

  async function handleUploadFile(e) {
    if (!uploadQuestionMedia) return;
    const updatedQuestion = await uploadQuestionMedia(e, selectedItem);
    if (updatedQuestion) {
      setSelectedItem(updatedQuestion);
      setDraft((prev) => ({ ...prev, media: updatedQuestion.media, type_q: updatedQuestion.type_q }));
    }
  }

  async function handleDelete() {
    if (!window.confirm("Supprimer cette question de la base ?")) return;
    await deleteQuestion(selectedItem.id);
    setSelectedItem(null);
  }

  const editorDraft = draft || {
    question: selectedItem.question || "",
    answer: selectedItem.answer || "",
    media: selectedItem.media || "",
    type_q: selectedItem.type_q || "text",
    tags: selectedItem.tags || [],
    data: selectedItem.data || {}
  };
  const editType = editorDraft.type_q || "text";
  const editEditorProps = {
    draft: editorDraft,
    heading: `Question #${selectedItem.id}`,
    meta: editType,
    onChange: setDraft,
    onSubmit: handleSave,
    submitLabel: "Enregistrer",
    onDelete: handleDelete,
    onUploadFile: handleUploadFile,
    saveStatus,
    headerAction: (
      <ReviewCalendarAction
        nextReview={selectedNextReview}
        onOpen={openSelectedInCalendar}
      />
    )
  };

  if (editType === "timeline") {
    return (
      <TimelineQuestionEditor {...editEditorProps} />
    );
  }

  return (
    <TextQuestionEditor {...editEditorProps} />
  );
}
