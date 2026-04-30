import { useState } from "react";

const overlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000
};

const modalStyle = {
  width: "400px",
  background: "#1e1e1e",
  padding: "20px",
  borderRadius: "10px"
};

export default function TagEditor({
  q,
  onClose,
  updateQuestion,
  updateQuestionInState
}) {
  const [tags, setTags] = useState(q.tags || []);
  const [input, setInput] = useState("");

  function addTag() {
    const value = input.trim();
    if (!value) return;
    if (tags.includes(value)) return;

    setTags([...tags, value]);
    setInput("");
  }

  function removeTag(tag) {
    setTags(tags.filter(t => t !== tag));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }

  async function handleClose() {
    const updated = {
      ...q,
      tags
    };

    await updateQuestion(q.id, { tags });

    updateQuestionInState(updated);

    onClose();
  }

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>

        <h3>Tags</h3>

        {/* TAGS */}
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          marginBottom: "10px"
        }}>
          {tags.map((tag) => (
            <div
              key={tag}
              style={{
                background: "#333",
                padding: "5px 8px",
                borderRadius: "6px",
                display: "flex",
                gap: "6px"
              }}
            >
              <span>{tag}</span>
              <span
                onClick={() => removeTag(tag)}
                style={{ cursor: "pointer", color: "#aaa" }}
              >
                ✕
              </span>
            </div>
          ))}
        </div>

        {/* INPUT */}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ajouter un tag"
          style={{ width: "100%" }}
        />

      </div>
    </div>
  );
}