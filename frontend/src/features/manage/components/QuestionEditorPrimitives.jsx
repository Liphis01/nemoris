import {
  buttonStyle,
  dangerButtonStyle,
  disabledSaveButtonStyle,
  inputStyle,
  labelStyle,
  panelStyle,
  pendingSaveDotStyle,
  pendingSaveButtonStyle,
  primaryButtonStyle
} from "./QuestionEditorStyles";
import AutocompleteInput from "../../../shared/AutocompleteInput";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";

function tagKey(tag) {
  return String(tag || "").trim().toLowerCase();
}

function QuestionTypeChip({ type }) {
  const typeStyle = getQuestionTypeChipStyle(type);

  return (
    <div
      style={{
        alignSelf: "flex-start",
        background: typeStyle.background,
        borderRadius: "999px",
        color: typeStyle.color,
        fontSize: "10px",
        fontWeight: "700",
        lineHeight: 1,
        padding: "4px 7px"
      }}
    >
      {typeStyle.label}
    </div>
  );
}

export function QuestionEditorShell({
  heading,
  meta,
  headerAction,
  children
}) {
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
            <QuestionTypeChip type={meta} />
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
        {children}
      </div>
    </div>
  );
}

export function QuestionEditorField({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

export function ImageImportField({ onUploadFile }) {
  if (!onUploadFile) return null;

  return (
    <QuestionEditorField label="Importer une image">
      <input
        type="file"
        accept="image/*"
        onChange={onUploadFile}
        style={{ color: "#ddd" }}
      />
    </QuestionEditorField>
  );
}

export function MediaPreview({ media }) {
  const src = (media || "").trim();

  if (!src) return null;

  return (
    <img
      src={src}
      alt="preview"
      style={{
        width: "100%",
        borderRadius: "8px",
        border: "1px solid #282828"
      }}
    />
  );
}

export function TagEditor({
  tags = [],
  tagInput,
  availableTags = [],
  onTagInputChange,
  onAddTag,
  onRemoveTag
}) {
  const currentTagKeys = new Set(tags.map(tagKey));
  const suggestedTags = availableTags.filter(tag =>
    !currentTagKeys.has(tagKey(tag))
  );

  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: "8px" }}>
        Tags
      </div>
      {tags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "10px"
          }}
        >
          {tags.map(tag => (
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
                aria-label={`Retirer le tag ${tag}`}
                onClick={() => onRemoveTag?.(tag)}
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
        <AutocompleteInput
          value={tagInput}
          onChange={(event) => onTagInputChange?.(event.target.value)}
          onSuggestionSelect={(tag) => onAddTag?.(tag)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddTag?.();
            }
          }}
          placeholder="Ajouter un tag"
          suggestions={suggestedTags}
          style={inputStyle}
        />
        <button type="button" onClick={() => onAddTag?.()} style={buttonStyle}>
          Ajouter
        </button>
      </div>
    </div>
  );
}

export function QuestionEditorActions({
  submitLabel = "Enregistrer",
  onSubmit,
  onCancel,
  onDelete,
  saveStatus,
  hasUnsavedChanges = false,
  isSubmitDisabled = false
}) {
  const submitStyle = isSubmitDisabled
    ? disabledSaveButtonStyle
    : hasUnsavedChanges
      ? pendingSaveButtonStyle
      : primaryButtonStyle;
  const showPendingDot = hasUnsavedChanges && !isSubmitDisabled;

  return (
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
        disabled={isSubmitDisabled}
        onClick={onSubmit}
        title={isSubmitDisabled ? "Aucune modification à enregistrer" : undefined}
        style={submitStyle}
      >
        {showPendingDot && (
          <span aria-hidden="true" style={pendingSaveDotStyle} />
        )}
        {submitLabel}
      </button>

      {onCancel && (
        <button type="button" onClick={onCancel} style={dangerButtonStyle}>
          Annuler
        </button>
      )}

      {onDelete && (
        <button type="button" onClick={onDelete} style={dangerButtonStyle}>
          Supprimer
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
  );
}
