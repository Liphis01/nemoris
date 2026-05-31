import { useEffect, useState } from "react";
import {
  ImageMediaField,
  QuestionEditorActions,
  QuestionEditorField,
  QuestionEditorShell,
  TagEditor
} from "./QuestionEditorPrimitives";
import { inputStyle } from "./QuestionEditorStyles";

function normalizeDraft(draft) {
  return {
    question: "",
    answer: "",
    media: "",
    type_q: "text",
    tags: [],
    data: {},
    ...(draft || {})
  };
}

export default function TextQuestionEditor({
  draft,
  heading,
  meta,
  onChange,
  onSubmit,
  submitLabel = "Enregistrer",
  onCancel,
  onDelete,
  onUploadFile,
  onRemoveMedia,
  saveStatus,
  hasUnsavedChanges,
  isSubmitDisabled,
  headerAction,
  availableTags = []
}) {
  const [tagInput, setTagInput] = useState("");
  const textDraft = normalizeDraft(draft);

  useEffect(() => {
    setTagInput(textDraft._pendingTagInput || "");
  }, [textDraft._pendingTagInput]);

  function commit(nextDraft) {
    onChange?.(normalizeDraft(nextDraft));
  }

  function setField(field, value) {
    commit({
      ...textDraft,
      [field]: value
    });
  }

  function addTag(selectedTag) {
    const value = String(selectedTag ?? tagInput).trim();
    if (!value || (textDraft.tags || []).includes(value)) return;

    commit({
      ...textDraft,
      tags: [...(textDraft.tags || []), value],
      _pendingTagInput: ""
    });
    setTagInput("");
  }

  function removeTag(tag) {
    commit({
      ...textDraft,
      tags: (textDraft.tags || []).filter(item => item !== tag)
    });
  }

  function setPendingTagInput(value) {
    setTagInput(value);
    commit({
      ...textDraft,
      _pendingTagInput: value
    });
  }

  function submitWithPendingTag() {
    onSubmit?.(textDraft);
  }

  return (
    <QuestionEditorShell heading={heading} meta={meta} headerAction={headerAction}>
      <QuestionEditorField label="Question">
        <textarea
          rows={3}
          value={textDraft.question || ""}
          onChange={(event) => setField("question", event.target.value)}
          style={{
            ...inputStyle,
            minHeight: "94px",
            resize: "vertical",
            lineHeight: 1.45
          }}
        />
      </QuestionEditorField>

      <QuestionEditorField label="Réponse">
        <textarea
          rows={5}
          value={textDraft.answer || ""}
          onChange={(event) => setField("answer", event.target.value)}
          style={{
            ...inputStyle,
            minHeight: "140px",
            resize: "vertical",
            lineHeight: 1.45
          }}
        />
      </QuestionEditorField>

      <ImageMediaField
        media={textDraft.media}
        onMediaChange={(media) => setField("media", media)}
        onUploadFile={onUploadFile}
        onRemoveMedia={onRemoveMedia}
      />

      <TagEditor
        tags={textDraft.tags || []}
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
