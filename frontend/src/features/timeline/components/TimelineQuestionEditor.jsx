import { useState } from "react";
import {
  coerceTimelinePrecision,
  formatTimelineAnswer,
  getFinestPrecision,
  lowerOrdinal,
  normalizeTimeline,
  timelinePrecisions
} from "../timelineUtils";
import TimelineBoundaryInput from "./TimelineBoundaryInput";
import TimelineMiniPreview from "./TimelineMiniPreview";
import TimelineQuickDateInput from "./TimelineQuickDateInput";

const panelStyle = {
  padding: "28px",
  overflow: "overlay",
  background: "#141414",
  height: "100%",
  boxSizing: "border-box"
};

const labelStyle = {
  color: "#8a8a8a",
  fontSize: "10px",
  fontWeight: "800",
  letterSpacing: "0.06em",
  textTransform: "uppercase"
};

const inputStyle = {
  width: "100%",
  background: "#101010",
  border: "1px solid #2a2a2a",
  borderRadius: "8px",
  color: "#eee",
  fontSize: "14px",
  outline: "none",
  padding: "11px 12px",
  boxSizing: "border-box"
};

const buttonStyle = {
  background: "#2a2a2a",
  border: "1px solid #333",
  borderRadius: "8px",
  color: "#eee",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: "800",
  padding: "11px 14px"
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

function getDraftTimeline(draft) {
  return normalizeTimeline(draft?.data?.timeline);
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const timelineDraft = normalizeDraft(draft);
  const timeline = getDraftTimeline(timelineDraft);
  const precision = getFinestPrecision(timeline.start, timeline.end);

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

  function setKind(kind) {
    if (kind === "interval") {
      commitTimeline({
        ...timeline,
        kind,
        end: timeline.end || timeline.start
      });
      return;
    }

    commitTimeline({
      kind: "point",
      start: timeline.start
    });
  }

  function setPrecision(nextPrecision) {
    commitTimeline({
      ...timeline,
      start: coerceTimelinePrecision(timeline.start, nextPrecision),
      end: timeline.kind === "interval"
        ? coerceTimelinePrecision(timeline.end || timeline.start, nextPrecision)
        : undefined
    });
  }

  function setBoundary(field, date) {
    const nextTimeline = {
      ...timeline,
      [field]: date
    };

    if (
      nextTimeline.kind === "interval" &&
      nextTimeline.end &&
      lowerOrdinal(nextTimeline.end) < lowerOrdinal(nextTimeline.start)
    ) {
      if (field === "start") {
        nextTimeline.end = date;
      } else {
        nextTimeline.start = date;
      }
    }

    commitTimeline(nextTimeline);
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
              color: "#8a8a8a",
              fontSize: "12px",
              fontWeight: "800",
              letterSpacing: "0.08em",
              marginBottom: "8px",
              textTransform: "uppercase"
            }}
          >
            {meta || "Timeline question"}
          </div>
          <div
            style={{
              color: "#eee",
              fontSize: "26px",
              fontWeight: "900",
              lineHeight: 1.1
            }}
          >
            {heading}
          </div>
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
              lineHeight: 1.45,
              fontSize: "16px",
              fontWeight: "700"
            }}
          />
        </label>

        <TimelineQuickDateInput onApply={commitTimeline} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px"
          }}
        >
          <div
            style={{
              border: "1px solid #282828",
              borderRadius: "10px",
              background: "#131313",
              padding: "12px"
            }}
          >
            <div style={{ ...labelStyle, marginBottom: "8px" }}>
              Shape
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {[
                ["point", "Date"],
                ["interval", "Period"]
              ].map(([kind, label]) => {
                const active = timeline.kind === kind;

                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setKind(kind)}
                    style={{
                      ...buttonStyle,
                      flex: 1,
                      background: active ? "#2b2047" : "#181818",
                      border: active ? "1px solid #6f56a8" : "1px solid #2d2d2d",
                      color: active ? "#d8ccff" : "#999"
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              border: "1px solid #282828",
              borderRadius: "10px",
              background: "#131313",
              padding: "12px"
            }}
          >
            <div style={{ ...labelStyle, marginBottom: "8px" }}>
              Precision
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {timelinePrecisions.map(item => {
                const active = precision === item;

                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPrecision(item)}
                    style={{
                      ...buttonStyle,
                      flex: 1,
                      background: active ? "#1f3340" : "#181818",
                      border: active ? "1px solid #41708b" : "1px solid #2d2d2d",
                      color: active ? "#9bdcff" : "#999",
                      paddingLeft: "8px",
                      paddingRight: "8px"
                    }}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: timeline.kind === "interval"
              ? "1fr 1fr"
              : "1fr",
            gap: "12px"
          }}
        >
          <TimelineBoundaryInput
            label={timeline.kind === "interval" ? "Start" : "Date"}
            value={timeline.start}
            precision={precision}
            onChange={(date) => setBoundary("start", date)}
          />

          {timeline.kind === "interval" && (
            <TimelineBoundaryInput
              label="End"
              value={timeline.end || timeline.start}
              precision={precision}
              onChange={(date) => setBoundary("end", date)}
            />
          )}
        </div>

        <TimelineMiniPreview timeline={timeline} />

        <div
          style={{
            border: "1px solid #282828",
            borderRadius: "10px",
            background: "#131313",
            overflow: "hidden"
          }}
        >
          <button
            type="button"
            onClick={() => setDetailsOpen(current => !current)}
            style={{
              alignItems: "center",
              background: "transparent",
              border: "none",
              color: "#ddd",
              cursor: "pointer",
              display: "flex",
              fontSize: "13px",
              fontWeight: "800",
              justifyContent: "space-between",
              padding: "12px",
              width: "100%"
            }}
          >
            <span>Details</span>
            <span
              aria-hidden="true"
              style={{
                color: "#777",
                transform: detailsOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.14s ease"
              }}
            >
              ▸
            </span>
          </button>

          {detailsOpen && (
            <div
              style={{
                borderTop: "1px solid #282828",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "12px"
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                <span style={labelStyle}>Generated answer</span>
                <input
                  readOnly
                  value={timelineDraft.answer || ""}
                  style={{
                    ...inputStyle,
                    color: "#c4b5fd",
                    fontWeight: "800"
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
                    style={{ color: "#ddd", fontSize: "13px" }}
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
                          fontSize: "12px",
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
            </div>
          )}
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
