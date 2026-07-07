import { useEffect, useState } from "react";
import {
  ImageMediaField,
  QuestionEditorActions,
  QuestionEditorField,
  QuestionEditorShell,
  TagEditor
} from "../../manage/components/QuestionEditorPrimitives";
import { inputStyle } from "../../manage/components/QuestionEditorStyles";
import {
  formatTimelineAnswer,
  normalizeTimeline
} from "../timelineUtils";
import TimelineQuickDateInput from "./TimelineQuickDateInput";

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

  useEffect(() => {
    setTagInput(timelineDraft._pendingTagInput || "");
  }, [timelineDraft._pendingTagInput]);

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
    commit({
      ...timelineDraft,
      _pendingTagInput: value
    });
  }

  function submitWithPendingTag() {
    onSubmit?.(timelineDraft);
  }

  return (
    <QuestionEditorShell heading={heading} meta={meta} headerAction={headerAction}>
      <QuestionEditorField label="Question">
        <textarea
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
      </QuestionEditorField>

      <TimelineQuickDateInput onApply={commitTimeline} />

      <QuestionEditorField label="Réponse générée">
        <input
          readOnly
          value={timelineDraft.answer || ""}
          style={{
            ...inputStyle,
            color: "#c4b5fd"
          }}
        />
      </QuestionEditorField>

      <ImageMediaField
        media={timelineDraft.media}
        onMediaChange={setMedia}
        onUploadFile={onUploadFile}
        onImportMediaUrl={onImportMediaUrl}
        onRemoveMedia={onRemoveMedia}
      />

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
