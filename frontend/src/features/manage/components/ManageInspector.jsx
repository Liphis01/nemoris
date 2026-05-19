import { useEffect, useState } from "react";
import MapEditor from "../../map/components/MapEditor";

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

const tagStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 10px",
  borderRadius: "999px",
  background: "#212121",
  color: "#ccc",
  marginBottom: "8px"
};

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
        Review
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
  onOpenInCalendar
}) {
  // Inspector has three modes: create group, create question, or edit selected
  // item. Map groups/zones delegate their detailed editing to MapEditor.
  const [draft, setDraft] = useState(null);
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    // Copy selected item into a local draft so typing does not mutate list cache
    // until the user saves.
    if (!selectedItem) {
      setDraft(null);
      setTagInput("");
      setSaveStatus(null);
      return;
    }
    
    setDraft({
      question: selectedItem.question || "",
      answer: selectedItem.answer || "",
      media: selectedItem.media || "",
      type_q: selectedItem.type_q || "text",
      tags: selectedItem.tags || []
    });
    setTagInput("");
    setSaveStatus(null);
  }, [selectedItem]);

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
    return (
      <div style={panelStyle}>
        <div style={{ marginBottom: "22px", color: "#888" }}>
          Nouvelle question
        </div>

        <label style={labelStyle}>Question</label>
        <input
          style={inputStyle}
          value={questionDraft.question}
          onChange={(e) => setQuestionDraft({ ...questionDraft, question: e.target.value })}
        />

        <label style={labelStyle}>Réponse</label>
        <textarea
          rows={5}
          style={{ ...inputStyle, resize: "vertical", minHeight: "140px" }}
          value={questionDraft.answer}
          onChange={(e) => setQuestionDraft({ ...questionDraft, answer: e.target.value })}
        />

        <label style={labelStyle}>Type de question</label>
        <select
          style={inputStyle}
          value={questionDraft.type_q}
          onChange={(e) => setQuestionDraft({ ...questionDraft, type_q: e.target.value })}
        >
          <option value="text">text</option>
          <option value="map">map</option>
        </select>

        <label style={labelStyle}>Media / URL</label>
        <input
          style={inputStyle}
          value={questionDraft.media || ""}
          placeholder="http://..."
          onChange={(e) => setQuestionDraft({ ...questionDraft, media: e.target.value })}
        />

        <div style={{ marginBottom: "18px" }}>
          <label style={labelStyle}>Importer une image</label>
          <input type="file" accept="image/*" onChange={(e) => uploadQuestionMedia(e, { id: "new" })} style={{ color: "#eee" }} />
        </div>

        <label style={labelStyle}>Tags</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
          {questionDraft.tags.map((tag) => (
            <div key={tag} style={tagStyle}>
              {tag}
              <button
                type="button"
                onClick={() => setQuestionDraft({ ...questionDraft, tags: questionDraft.tags.filter((t) => t !== tag) })}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#888",
                  cursor: "pointer",
                  padding: 0
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: "20px", alignItems: "center" }}>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setQuestionDraft({ ...questionDraft, tags: [...questionDraft.tags, tagInput.trim()] }), setTagInput(""))}
            placeholder="Ajouter un tag"
            style={inputStyle}
          />
          <button type="button" onClick={() => { setQuestionDraft({ ...questionDraft, tags: [...questionDraft.tags, tagInput.trim()] }); setTagInput(""); }} style={buttonStyle}>
            Ajouter
          </button>
        </div>

        {questionDraft.media && (
          <div style={{ marginBottom: "24px" }}>
            <div style={{ marginBottom: "10px", color: "#bbb" }}>Aperçu media</div>
            <img
              src={questionDraft.media}
              alt="preview"
              style={{ width: "100%", borderRadius: "12px", border: "1px solid #222" }}
            />
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <button type="button" onClick={async () => { await createQuestion(); setIsCreatingQuestion(false); }} style={buttonStyle}>
            Créer
          </button>
          <button type="button" onClick={() => { setIsCreatingQuestion(false); setQuestionDraft({ question: "", answer: "", tags: [], type_q: "text", media: null }); }} style={{ ...buttonStyle, background: "#641c1c" }}>
            Annuler
          </button>
        </div>
      </div>
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

  
  function setField(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function addTag() {
    const value = tagInput.trim();
    if (!value || draft.tags.includes(value)) return;
    setDraft((prev) => ({ ...prev, tags: [...prev.tags, value] }));
    setTagInput("");
  }

  function removeTag(tag) {
    setDraft((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));
  }

  async function handleSave() {
    if (!draft) return;

    // Only editable scalar fields are sent here. Map-specific fields are saved
    // through MapEditor so data.code stays tied to the SVG zone.
    const payload = {
      question: draft.question,
      answer: draft.answer,
      media: draft.media || null,
      type_q: draft.type_q,
      tags: draft.tags
    };

    setSaveStatus("Enregistrement...");

    await updateQuestion(selectedItem.id, payload);

    const updatedQuestion = {
      ...selectedItem,
      ...payload
    };

    patchQuestionInCache(updatedQuestion);
    setSelectedItem(updatedQuestion);
    setSaveStatus("Enregistré ✔");
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

  return (
    <div style={panelStyle}>
      <div style={{ marginBottom: "22px", color: "#888" }}>
        Question #{selectedItem.id}
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "18px" }}>
        <div style={{ padding: "8px 12px", borderRadius: "999px", background: "#222", color: "#ccc", fontSize: "13px" }}>
          {selectedItem.type_q || "text"}
        </div>

        <ReviewCalendarAction
          nextReview={selectedNextReview}
          onOpen={openSelectedInCalendar}
        />
      </div>

      <label style={labelStyle}>Question</label>
      <input
        style={inputStyle}
        value={draft?.question || ""}
        onChange={(e) => setField("question", e.target.value)}
      />

      <label style={labelStyle}>Réponse</label>
      <textarea
        rows={5}
        style={{ ...inputStyle, resize: "vertical", minHeight: "140px" }}
        value={draft?.answer || ""}
        onChange={(e) => setField("answer", e.target.value)}
      />

      <label style={labelStyle}>Type de question</label>
      <select
        style={inputStyle}
        value={draft?.type_q || "text"}
        onChange={(e) => setField("type_q", e.target.value)}
      >
        <option value="text">text</option>
        <option value="map">map</option>
      </select>

      <label style={labelStyle}>Media / URL</label>
      <input
        style={inputStyle}
        value={draft?.media || ""}
        placeholder="http://..."
        onChange={(e) => setField("media", e.target.value)}
      />

      <div style={{ marginBottom: "18px" }}>
        <label style={labelStyle}>Importer une image</label>
        <input type="file" accept="image/*" onChange={handleUploadFile} style={{ color: "#eee" }} />
      </div>

      <label style={labelStyle}>Tags</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
        {draft?.tags?.map((tag) => (
          <div key={tag} style={tagStyle}>
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              style={{
                border: "none",
                background: "transparent",
                color: "#888",
                cursor: "pointer",
                padding: 0
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", alignItems: "center" }}>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
          placeholder="Ajouter un tag"
          style={inputStyle}
        />
        <button type="button" onClick={addTag} style={buttonStyle}>
          Ajouter
        </button>
      </div>

      {draft?.media && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{ marginBottom: "10px", color: "#bbb" }}>Aperçu media</div>
          <img
            src={draft.media}
            alt="preview"
            style={{ width: "100%", borderRadius: "12px", border: "1px solid #222" }}
          />
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", paddingBottom: "30px" }}>
        <button type="button" onClick={handleSave} style={buttonStyle}>
          Enregistrer
        </button>
        <button type="button" onClick={handleDelete} style={{ ...buttonStyle, background: "#641c1c" }}>
          Supprimer
        </button>
        {saveStatus && (
          <span style={{ color: "#8f8", fontSize: "14px" }}>{saveStatus}</span>
        )}
      </div>
    </div>
  );
}
