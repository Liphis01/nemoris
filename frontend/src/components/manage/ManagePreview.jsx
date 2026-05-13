import { useEffect, useState } from "react";
import MapEditor from "../MapEditor";
import SvgMap from "../SvgMap";

const panelStyle = {
  padding: "28px",
  overflow: "auto",
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
  selectedQuestion,
  updateQuestion,
  updateQuestionInState,
  setSelectedQuestion,
  deleteQuestion,
  handleUpload
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
        Sélectionner une question
      </div>
    );
  }

  if (selectedQuestion.type_q === "map_group") {
    return (
      <div
        style={{
          height: "100%",
          overflow: "auto"
        }}
      >
        <MapEditor
          q={{
            type_q: "map",
            svg: selectedQuestion.media,
            media: selectedQuestion.media
          }}
          embedded
          updateQuestion={updateQuestion}
          updateQuestionInState={updateQuestionInState}
        />
      </div>
    );
  }

  if (selectedQuestion.type_q === "map") {
    console.log("c'est une question map");
    return (
      <div style={panelStyle}>
        <div style={{ marginBottom: "22px", color: "#888" }}>
          Question #{selectedQuestion.id} - Carte
        </div>

        <div style={{ marginBottom: "24px" }}>
          <div style={{ marginBottom: "10px", color: "#bbb" }}>Carte interactive</div>
          <SvgMap
            svgPath={`/maps/${selectedQuestion.media}`}
            found={[]} // ou les zones trouvées si applicable
            selected={selectedQuestion.code} // si une zone est sélectionnée
            onSelect={() => {}} // pas d'action en preview
          />
        </div>

        <div style={{ marginTop: "20px" }}>
          <div style={{ marginBottom: "10px", color: "#bbb" }}>Zone: {selectedQuestion.code}</div>
          <div style={{ color: "#eee" }}>
            <strong>Question:</strong> {selectedQuestion.question}
          </div>
          <div style={{ color: "#ccc", marginTop: "10px" }}>
            <strong>Réponse:</strong> {selectedQuestion.answer}
          </div>
        </div>
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

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
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
