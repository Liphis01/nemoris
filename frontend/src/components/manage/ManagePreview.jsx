import { useEffect, useState } from "react";
import MapEditor from "../MapEditor";
import SvgMap from "../SvgMap";

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

export default function ManagePreview({
  allGroups,
  setAllGroups,
  selectedQuestion,
  updateQuestion,
  updateQuestionInState,
  setSelectedQuestion,
  deleteQuestion,
  handleUpload,
  isCreating,
  setIsCreating,
  isCreatingGroup,
  setIsCreatingGroup,
  newRow,
  setNewRow,
  newGroup,
  setNewGroup,
  createQuestion,
  createGroup,
  reloadAllData,
  editing,
  setEditing
}) {
  const [draft, setDraft] = useState(null);
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    if (!selectedQuestion) {
      setDraft(null);
      setTagInput("");
      setSaveStatus(null);
      return;
    }
    
    setDraft({
      question: selectedQuestion.question || "",
      answer: selectedQuestion.answer || "",
      media: selectedQuestion.media || "",
      type_q: selectedQuestion.type_q || "text",
      tags: selectedQuestion.tags || []
    });
    setTagInput("");
    setSaveStatus(null);
  }, [selectedQuestion]);

  if (isCreatingGroup) {
    return (
      <div style={panelStyle}>
        <div style={{ marginBottom: "22px", color: "#888" }}>
          Nouveau groupe
        </div>

        <label style={labelStyle}>Nom du groupe</label>
        <input
          style={inputStyle}
          value={newGroup.name}
          onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
          placeholder="Ex : Carte Europe"
        />

        <label style={labelStyle}>Type de groupe</label>
        <select
          style={inputStyle}
          value={newGroup.type_group}
          onChange={(e) => setNewGroup({ ...newGroup, type_group: e.target.value })}
        >
          <option value="map">map</option>
        </select>

        <label style={labelStyle}>Media / URL (optionnel)</label>
        <input
          style={inputStyle}
          value={newGroup.media}
          onChange={(e) => setNewGroup({ ...newGroup, media: e.target.value })}
        />

        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
          <button type="button" onClick={createGroup} style={buttonStyle}>
            Créer le groupe
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCreatingGroup(false);
              setNewGroup({ name: "", type_group: "map", media: "", data: {} });
            }}
            style={{ ...buttonStyle, background: "#641c1c" }}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  if (isCreating) {
    return (
      <div style={panelStyle}>
        <div style={{ marginBottom: "22px", color: "#888" }}>
          Nouvelle question
        </div>

        <label style={labelStyle}>Question</label>
        <input
          style={inputStyle}
          value={newRow.question}
          onChange={(e) => setNewRow({ ...newRow, question: e.target.value })}
        />

        <label style={labelStyle}>Réponse</label>
        <textarea
          rows={5}
          style={{ ...inputStyle, resize: "vertical", minHeight: "140px" }}
          value={newRow.answer}
          onChange={(e) => setNewRow({ ...newRow, answer: e.target.value })}
        />

        <label style={labelStyle}>Type de question</label>
        <select
          style={inputStyle}
          value={newRow.type_q}
          onChange={(e) => setNewRow({ ...newRow, type_q: e.target.value })}
        >
          <option value="text">text</option>
          <option value="image">image</option>
          <option value="map">map</option>
        </select>

        <label style={labelStyle}>Media / URL</label>
        <input
          style={inputStyle}
          value={newRow.media || ""}
          placeholder="http://..."
          onChange={(e) => setNewRow({ ...newRow, media: e.target.value })}
        />

        <div style={{ marginBottom: "18px" }}>
          <label style={labelStyle}>Importer une image</label>
          <input type="file" accept="image/*" onChange={(e) => handleUpload(e, { id: "new" })} style={{ color: "#eee" }} />
        </div>

        <label style={labelStyle}>Tags</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
          {newRow.tags.map((tag) => (
            <div key={tag} style={tagStyle}>
              {tag}
              <button
                type="button"
                onClick={() => setNewRow({ ...newRow, tags: newRow.tags.filter((t) => t !== tag) })}
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
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setNewRow({ ...newRow, tags: [...newRow.tags, tagInput.trim()] }), setTagInput(""))}
            placeholder="Ajouter un tag"
            style={inputStyle}
          />
          <button type="button" onClick={() => { setNewRow({ ...newRow, tags: [...newRow.tags, tagInput.trim()] }); setTagInput(""); }} style={buttonStyle}>
            Ajouter
          </button>
        </div>

        {newRow.media && (
          <div style={{ marginBottom: "24px" }}>
            <div style={{ marginBottom: "10px", color: "#bbb" }}>Aperçu media</div>
            <img
              src={newRow.media}
              alt="preview"
              style={{ width: "100%", borderRadius: "12px", border: "1px solid #222" }}
            />
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <button type="button" onClick={async () => { await createQuestion(); setIsCreating(false); }} style={buttonStyle}>
            Créer
          </button>
          <button type="button" onClick={() => { setIsCreating(false); setNewRow({ question: "", answer: "", tags: [], type_q: "text", media: null }); }} style={{ ...buttonStyle, background: "#641c1c" }}>
            Annuler
          </button>
        </div>
      </div>
    );
  }

  if (!selectedQuestion) {
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

  const isMapQuestion = selectedQuestion.type_q === "map";
  const isMapGroup = selectedQuestion.type_group === "map";

  if (isMapQuestion || isMapGroup) {
    const groupe = isMapQuestion ? selectedQuestion.group : selectedQuestion;
    const group = allGroups.find((g) => g.id === groupe.id);

    return (
      <div
        style={{
          height: "100%",
          overflow: "hidden"
        }}
      >
        <MapEditor
          group={group}
          onSave={async (delta) => {
            if (typeof delta === "number") {
              setAllGroups(prev =>
                prev.map(g =>
                  g.id === group.id
                    ? { ...g, question_count: Math.max(0, (g.question_count || 0) + delta) }
                    : g
                )
              );
            } else {
              await reloadAllData();
            }
          }}
          onClose={() => { }}
          selectedZone={editing}
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

    const payload = {
      question: draft.question,
      answer: draft.answer,
      media: draft.media || null,
      type_q: draft.type_q,
      tags: draft.tags
    };

    setSaveStatus("Enregistrement...");

    await updateQuestion(selectedQuestion.id, payload);

    const updatedQuestion = {
      ...selectedQuestion,
      ...payload
    };

    updateQuestionInState(updatedQuestion);
    setSelectedQuestion(updatedQuestion);
    setSaveStatus("Enregistré ✔");
  }

  async function handleUploadFile(e) {
    if (!handleUpload) return;
    const updatedQuestion = await handleUpload(e, selectedQuestion);
    if (updatedQuestion) {
      setSelectedQuestion(updatedQuestion);
      setDraft((prev) => ({ ...prev, media: updatedQuestion.media, type_q: updatedQuestion.type_q }));
    }
  }

  async function handleDelete() {
    if (!window.confirm("Supprimer cette question de la base ?")) return;
    await deleteQuestion(selectedQuestion.id);
    setSelectedQuestion(null);
  }

  return (
    <div style={panelStyle}>
      <div style={{ marginBottom: "22px", color: "#888" }}>
        Question #{selectedQuestion.id}
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
        <div style={{ padding: "8px 12px", borderRadius: "999px", background: "#222", color: "#ccc", fontSize: "13px" }}>
          {selectedQuestion.type_q || "text"}
        </div>
        {selectedQuestion.next_review && (
          <div style={{ padding: "8px 12px", borderRadius: "999px", background: "#222", color: "#ccc", fontSize: "13px" }}>
            Review {selectedQuestion.next_review}
          </div>
        )}
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
        <option value="image">image</option>
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
