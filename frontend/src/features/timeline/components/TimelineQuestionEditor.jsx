import { useEffect, useState } from "react";
import {
  EditorSection,
  ImageMediaField,
  QuestionEditorActions,
  QuestionEditorShell,
  TagEditor
} from "../../manage/components/QuestionEditorPrimitives";
import { inputStyle } from "../../manage/components/QuestionEditorStyles";
import {
  formatTimelineAnswer,
  formatTypedDate,
  normalizeTimeline,
  parseTimelineInput
} from "../timelineUtils";
import TimelineMiniPreview from "./TimelineMiniPreview";

function pad2(value) {
  return String(value).padStart(2, "0");
}

// The date as the author types it: magnitude + precision + interval, but never
// the era (the toggle owns that). "1789", "07/1789", "14/07/1789", "1914 - 1918".
function formatDateInput(timeline) {
  const one = (date) => {
    const year = Math.abs(date.year);

    if (date.precision === "year") return String(year);
    if (date.precision === "month") return `${pad2(date.month)}/${year}`;

    return `${pad2(date.day)}/${pad2(date.month)}/${year}`;
  };

  if (timeline.kind === "interval" && timeline.end) {
    return `${one(timeline.start)} - ${one(timeline.end)}`;
  }

  return one(timeline.start);
}

// Force every year's sign to match the chosen era. The text field carries only
// magnitude, so this is what makes a date BC or AD.
function applyEra(timeline, era) {
  const sign = era === "bc" ? -1 : 1;
  const withSign = (date) => ({ ...date, year: sign * Math.abs(date.year) });

  return normalizeTimeline({
    kind: timeline.kind,
    start: withSign(timeline.start),
    ...(timeline.kind === "interval"
      ? { end: withSign(timeline.end || timeline.start) }
      : {})
  });
}

function eraOf(timeline) {
  return timeline.start.year < 0 ? "bc" : "ac";
}

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
  return buildTimelineDraft(draft || {}, draft?.data?.timeline);
}

function EraToggle({ era, onToggle }) {
  const isBc = era === "bc";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Basculer l'ère (apr. / av. J.-C.)"
      title="Basculer entre apr. J.-C. et av. J.-C."
      style={{
        alignItems: "center",
        background: isBc ? "rgba(240, 195, 106, 0.12)" : "#101010",
        border: `1px solid ${isBc ? "rgba(240, 195, 106, 0.55)" : "#2a2a2a"}`,
        borderRadius: "10px",
        color: isBc ? "#f0c36a" : "#9a9aa6",
        cursor: "pointer",
        display: "inline-flex",
        fontSize: "13px",
        fontWeight: 800,
        gap: "8px",
        justifyContent: "center",
        padding: "0 14px",
        transition: "background 0.16s ease, border-color 0.16s ease, color 0.16s ease",
        whiteSpace: "nowrap"
      }}
    >
      <span>{isBc ? "av. J.-C." : "apr. J.-C."}</span>
      <span aria-hidden="true" style={{ opacity: 0.65 }}>⇄</span>
    </button>
  );
}

export default function TimelineQuestionEditor({
  draft,
  heading,
  meta,
  onChange,
  onSubmit,
  submitLabel = "Enregistrer",
  onCancel,
  onDelete,
  onUploadFile,
  onImportMediaUrl,
  onRemoveMedia,
  saveStatus,
  hasUnsavedChanges,
  isSubmitDisabled,
  headerAction,
  availableTags = []
}) {
  const [tagInput, setTagInput] = useState("");
  const timelineDraft = normalizeDraft(draft);
  const timeline = timelineDraft.data.timeline;
  const era = eraOf(timeline);

  const [dateText, setDateText] = useState(() => formatDateInput(timeline));
  const [dateError, setDateError] = useState("");

  useEffect(() => {
    setTagInput(timelineDraft._pendingTagInput || "");
  }, [timelineDraft._pendingTagInput]);

  // Re-seed the date field only when the editor moves to a different question,
  // never on every keystroke (that would fight the user's typing).
  useEffect(() => {
    setDateText(formatDateInput(normalizeDraft(draft).data.timeline));
    setDateError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  function commit(nextDraft) {
    onChange?.(normalizeDraft(nextDraft));
  }

  function commitTimeline(nextTimeline) {
    commit(buildTimelineDraft(timelineDraft, nextTimeline));
  }

  function handleDateChange(value) {
    const next = formatTypedDate(value);

    setDateText(next);

    const parsed = parseTimelineInput(next);

    if (!parsed.timeline) return; // wait until it parses; surface errors on blur

    setDateError("");
    // An explicit BC in the text wins; otherwise the current toggle decides.
    const nextEra = parsed.timeline.start.year < 0 ? "bc" : era;
    commitTimeline(applyEra(parsed.timeline, nextEra));
  }

  function handleDateBlur() {
    if (!dateText.trim()) return;

    if (!parseTimelineInput(dateText).timeline) {
      setDateError("Format de date invalide");
      return;
    }

    // Canonicalise: a date typed without separators ("14071789") settles back to
    // the readable "14/07/1789" once the field loses focus.
    setDateText(formatDateInput(timeline));
  }

  function toggleEra() {
    setDateError("");
    commitTimeline(applyEra(timeline, era === "bc" ? "ac" : "bc"));
  }

  function setQuestion(question) {
    commit({ ...timelineDraft, question });
  }

  function setMedia(media) {
    commit({ ...timelineDraft, media });
  }

  function addTag(selectedTag) {
    const value = String(selectedTag ?? tagInput).trim();
    if (!value || (timelineDraft.tags || []).includes(value)) return;

    commit({
      ...timelineDraft,
      tags: [...(timelineDraft.tags || []), value],
      _pendingTagInput: ""
    });
    setTagInput("");
  }

  function removeTag(tag) {
    commit({
      ...timelineDraft,
      tags: (timelineDraft.tags || []).filter(item => item !== tag)
    });
  }

  function setPendingTagInput(value) {
    setTagInput(value);
    commit({ ...timelineDraft, _pendingTagInput: value });
  }

  function submitWithPendingTag() {
    onSubmit?.(timelineDraft);
  }

  return (
    <QuestionEditorShell heading={heading} meta={meta} headerAction={headerAction}>
      <EditorSection title="Question" accent="#8fc7ff">
        <textarea
          aria-label="Question"
          className="app-scrollbar"
          rows={3}
          value={timelineDraft.question || ""}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Que s'est-il passé ?"
          style={{
            ...inputStyle,
            minHeight: "94px",
            resize: "vertical",
            lineHeight: 1.45
          }}
        />

        <ImageMediaField
          media={timelineDraft.media}
          onMediaChange={setMedia}
          onUploadFile={onUploadFile}
          onImportMediaUrl={onImportMediaUrl}
          onRemoveMedia={onRemoveMedia}
        />
      </EditorSection>

      <EditorSection title="Date" accent="#c4b5fd">
        <div
          style={{
            alignItems: "stretch",
            display: "grid",
            gap: "8px",
            gridTemplateColumns: "minmax(0, 1fr) auto"
          }}
        >
          <input
            aria-label="Date"
            value={dateText}
            onChange={(event) => handleDateChange(event.target.value)}
            onBlur={handleDateBlur}
            placeholder="1789 · 07/1789 · 14/07/1789 · 1914-1918"
            style={{
              ...inputStyle,
              fontSize: "15px",
              border: dateError ? "1px solid #7f2d35" : inputStyle.border
            }}
          />
          <EraToggle era={era} onToggle={toggleEra} />
        </div>

        {dateError && (
          <div style={{ color: "#ff9aa5", fontSize: "12px", fontWeight: 700 }}>
            {dateError}
          </div>
        )}

        <TimelineMiniPreview timeline={timeline} />
      </EditorSection>

      <TagEditor
        tags={timelineDraft.tags || []}
        tagInput={tagInput}
        availableTags={availableTags}
        onTagInputChange={setPendingTagInput}
        onAddTag={addTag}
        onRemoveTag={removeTag}
      />

      <QuestionEditorActions
        submitLabel={submitLabel}
        onSubmit={submitWithPendingTag}
        onCancel={onCancel}
        onDelete={onDelete}
        saveStatus={saveStatus}
        hasUnsavedChanges={hasUnsavedChanges}
        isSubmitDisabled={isSubmitDisabled}
      />
    </QuestionEditorShell>
  );
}
