import { useState } from "react";
import {
  formatTimelineAnswer,
  normalizeTimeline
} from "../timelineUtils";
import TimelineQuickDateInput from "./TimelineQuickDateInput";

const panelStyle = {
  padding: "28px",
  overflow: "overlay",
  background: "#141414",
  height: "100%",
  boxSizing: "border-box"
};

const labelStyle = {
  color: "#bbb",
  fontSize: "14px"
};

const inputStyle = {
  width: "100%",
  background: "#121212",
  border: "1px solid #2a2a2a",
  borderRadius: "10px",
  color: "#eee",
  outline: "none",
  padding: "12px 14px",
  boxSizing: "border-box"
};

const buttonStyle = {
  background: "#2a2a2a",
  border: "none",
  borderRadius: "10px",
  color: "#eee",
  cursor: "pointer",
  padding: "12px 16px"
};

function buildTimelineDraft(draft, timeline) {
  const normalized = normalizeTimeline(timeline);

  return {
    ...draft,
    answer: formatTimelineAnswer(normalized),
    type_q: "timeline",
    group_id: null,
    data: {
      ...(draft?.data || {}),
      timeline: normalized
    }
  };
}

function normalizeDraft(draft) {
  return buildTimelineDraft(
    draft || {},
    draft?.data?.timeline
  );
}

export default function TimelineQuestionEditor({
  draft,
  heading,
  meta,
  onChange,
  onSubmit,
  submitLabel = "Save",
  onCancel,
  onDelete,
  onUploadFile,
  saveStatus,
  headerAction
}) {
  const [tagInput, setTagInput] = useState("");
  const timelineDraft = normalizeDraft(draft);

  function commit(nextDraft) {
    onChange?.(normalizeDraft(nextDraft));
  }

  function commitTimeline(nextTimeline) {
    commit(buildTimelineDraft(timelineDraft, nextTimeline));
  }

  function setQuestion(question) {
    commit({
      ...timelineDraft,
      question
    });
  }

  function setMedia(media) {
    commit({
      ...timelineDraft,
      media
    });
  }

  function addTag() {
    const value = tagInput.trim();
    if (!value || (timelineDraft.tags || []).includes(value)) return;

    commit({
      ...timelineDraft,
      tags: [...(timelineDraft.tags || []), value]
    });
    setTagInput("");
  }

  function removeTag(tag) {
    commit({
      ...timelineDraft,
      tags: (timelineDraft.tags || []).filter(item => item !== tag)
    });
  }

  return (
    <div style={panelStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "16px",
          marginBottom: "20px"
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: "#888",
              marginBottom: meta ? "8px" : 0
            }}
          >
            {heading}
          </div>
          {meta && (
            <div style={labelStyle}>
              {meta}
            </div>
          )}
        </div>

        {headerAction}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "14px"
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          <span style={labelStyle}>Prompt</span>
          <textarea
            rows={3}
            value={timelineDraft.question || ""}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What happened?"
            style={{
              ...inputStyle,
              minHeight: "94px",
              resize: "vertical",
              lineHeight: 1.45
            }}
          />
        </label>

        <TimelineQuickDateInput onApply={commitTimeline} />

        <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          <span style={labelStyle}>Generated answer</span>
          <input
            readOnly
            value={timelineDraft.answer || ""}
            style={{
              ...inputStyle,
              color: "#c4b5fd"
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          <span style={labelStyle}>Media / URL</span>
          <input
            value={timelineDraft.media || ""}
            onChange={(event) => setMedia(event.target.value)}
            placeholder="http://..."
            style={inputStyle}
          />
        </label>

        {onUploadFile && (
          <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
            <span style={labelStyle}>Import image</span>
            <input
              type="file"
              accept="image/*"
              onChange={onUploadFile}
              style={{ color: "#ddd" }}
            />
          </label>
        )}

        {(timelineDraft.media || "").trim() && (
          <img
            src={timelineDraft.media}
            alt="preview"
            style={{
              width: "100%",
              borderRadius: "8px",
              border: "1px solid #282828"
            }}
          />
        )}

        <div>
          <div style={{ ...labelStyle, marginBottom: "8px" }}>
            Tags
          </div>
          {(timelineDraft.tags || []).length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                marginBottom: "10px"
              }}
            >
              {(timelineDraft.tags || []).map(tag => (
                <span
                  key={tag}
                  style={{
                    alignItems: "center",
                    background: "#212121",
                    borderRadius: "999px",
                    color: "#ccc",
                    display: "inline-flex",
                    gap: "8px",
                    padding: "6px 9px"
                  }}
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#888",
                      cursor: "pointer",
                      padding: 0
                    }}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: "8px"
            }}
          >
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder="Add tag"
              style={inputStyle}
            />
            <button type="button" onClick={addTag} style={buttonStyle}>
              Add
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
            paddingBottom: "20px"
          }}
        >
          <button
            type="button"
            onClick={onSubmit}
            style={{
              ...buttonStyle,
              background: "#2b2047",
              border: "1px solid #5f4b8f",
              color: "#d8ccff"
            }}
          >
            {submitLabel}
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                ...buttonStyle,
                background: "#641c1c",
                border: "1px solid #7b2929"
              }}
            >
              Cancel
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              style={{
                ...buttonStyle,
                background: "#641c1c",
                border: "1px solid #7b2929"
              }}
            >
              Delete
            </button>
          )}

          {saveStatus && (
            <span
              style={{
                color: "#8f8",
                fontSize: "14px",
                fontWeight: "700"
              }}
            >
              {saveStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
