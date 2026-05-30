import { useEffect, useState } from "react";
import {
  ImageImportField,
  MediaPreview,
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
  saveStatus,
  headerAction
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

  function addTag() {
    const value = tagInput.trim();
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

      <QuestionEditorField label="Media / URL">
        <input
          value={textDraft.media || ""}
          onChange={(event) => setField("media", event.target.value)}
          placeholder="http://..."
          style={inputStyle}
        />
      </QuestionEditorField>

      <ImageImportField onUploadFile={onUploadFile} />
      <MediaPreview media={textDraft.media} />

      <TagEditor
        tags={textDraft.tags || []}
        tagInput={tagInput}
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
      />
    </QuestionEditorShell>
  );
}
