import { useEffect, useState } from "react";
import {
  EditorSection,
  ImageMediaField,
  MediaPoolField,
  QuestionEditorActions,
  QuestionEditorShell,
  TagEditor
} from "./QuestionEditorPrimitives";
import { inputStyle } from "./QuestionEditorStyles";
import { normalizeMediaPool } from "../../../shared/media";

const MEDIA_LABELS = {
  import: "Ajouter un média",
  replace: "Remplacer le média",
  hint: "image, audio ou vidéo — glisser-déposer ou coller",
  dragging: "Déposer le média",
  typeError: "Seuls les fichiers image, audio et vidéo sont acceptés."
};

const sectionTextareaStyle = {
  ...inputStyle,
  resize: "vertical",
  lineHeight: 1.45
};

function normalizeDraft(draft) {
  return {
    question: "",
    answer: "",
    media: "",
    answer_media: "",
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
  onImportMediaUrl,
  onUploadAnswerFile,
  onImportAnswerMediaUrl,
  onRemoveAnswerMedia,
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

  // The question can carry several images; `media` mirrors the cover and the
  // full list lives in data.media_pool (stored only when there are >= 2).
  const questionMediaPool = normalizeMediaPool(
    textDraft.data?.media_pool?.length
      ? textDraft.data.media_pool
      : textDraft.media
        ? [textDraft.media]
        : []
  );

  function setQuestionMediaPool(pool) {
    const cleaned = normalizeMediaPool(pool);
    const nextData = { ...(textDraft.data || {}) };

    if (cleaned.length >= 2) {
      nextData.media_pool = cleaned;
    } else {
      delete nextData.media_pool;
    }

    commit({
      ...textDraft,
      media: cleaned[0] || "",
      data: nextData
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
      <EditorSection title="Question" accent="#8fc7ff">
        <textarea
          aria-label="Question"
          className="app-scrollbar"
          rows={3}
          value={textDraft.question || ""}
          onChange={(event) => setField("question", event.target.value)}
          style={{ ...sectionTextareaStyle, minHeight: "94px" }}
        />

        <MediaPoolField
          pool={questionMediaPool}
          onPoolChange={setQuestionMediaPool}
          onUploadFile={onUploadFile}
          onImportMediaUrl={onImportMediaUrl}
          accept="image/*,audio/*,video/*"
          labels={MEDIA_LABELS}
        />
      </EditorSection>

      <EditorSection title="Réponse" accent="#7ee2a8">
        <textarea
          aria-label="Réponse"
          className="app-scrollbar"
          rows={5}
          value={textDraft.answer || ""}
          onChange={(event) => setField("answer", event.target.value)}
          style={{ ...sectionTextareaStyle, minHeight: "140px" }}
        />

        <ImageMediaField
          media={textDraft.answer_media}
          onMediaChange={(media) => setField("answer_media", media)}
          onUploadFile={onUploadAnswerFile}
          onImportMediaUrl={onImportAnswerMediaUrl}
          onRemoveMedia={onRemoveAnswerMedia}
          accept="image/*,audio/*,video/*"
          labels={MEDIA_LABELS}
        />
      </EditorSection>

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
