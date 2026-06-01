import { useRef, useState } from "react";
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
import { resolveMediaUrl } from "../../../shared/media";
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
        onChange={(event) => onUploadFile(event.target.files?.[0])}
        style={{ color: "#ddd" }}
      />
    </QuestionEditorField>
  );
}

export function MediaPreview({ media }) {
  const src = resolveMediaUrl(media);

  if (!src) return null;

  return (
    <div
      style={{
        alignItems: "center",
        background: "#101010",
        border: "1px solid #2f2f2f",
        borderRadius: "8px",
        display: "flex",
        height: "78px",
        justifyContent: "center",
        overflow: "hidden",
        width: "108px"
      }}
    >
      <img
        src={src}
        alt="preview"
        style={{
          maxHeight: "100%",
          maxWidth: "100%",
          objectFit: "contain"
        }}
      />
    </div>
  );
}

export function ImageMediaField({
  media,
  onMediaChange,
  onUploadFile,
  onRemoveMedia
}) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const mediaValue = media || "";
  const hasMedia = Boolean(String(mediaValue).trim());

  async function uploadFile(file) {
    if (!file || !onUploadFile) return;

    if (file.type && !file.type.startsWith("image/")) {
      setError("Seules les images sont acceptées.");
      return;
    }

    setError("");
    setIsUploading(true);

    try {
      const result = await onUploadFile(file);
      const nextMedia = result?.media || result?.url;

      if (nextMedia) {
        onMediaChange?.(nextMedia);
      }
    } catch (uploadError) {
      setError(uploadError.message || "Import impossible.");
    } finally {
      setIsUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function firstImageFile(fileList) {
    return Array.from(fileList || []).find((file) =>
      !file.type || file.type.startsWith("image/")
    );
  }

  function handleFileInputChange(event) {
    uploadFile(firstImageFile(event.target.files));
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    uploadFile(firstImageFile(event.dataTransfer?.files));
  }

  function handlePaste(event) {
    const pastedImage = firstImageFile(event.clipboardData?.files);

    if (pastedImage) {
      event.preventDefault();
      uploadFile(pastedImage);
      return;
    }

    const pastedText = event.clipboardData?.getData("text/plain")?.trim();

    if (
      pastedText &&
      (
        /^(https?:)?\/\//.test(pastedText) ||
        pastedText.startsWith("/static/") ||
        pastedText.startsWith("data:image/")
      )
    ) {
      onMediaChange?.(pastedText);
    }
  }

  async function removeMedia() {
    setError("");

    try {
      if (onRemoveMedia && hasMedia) {
        await onRemoveMedia();
      } else {
        onMediaChange?.("");
      }
    } catch (removeError) {
      setError(removeError.message || "Suppression impossible.");
    }
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsDragging(false);
        }
      }}
      onDrop={handleDrop}
      onPaste={handlePaste}
      style={{
        border: isDragging
          ? "1px solid rgba(126, 226, 168, 0.75)"
          : "1px solid #2a2a2a",
        borderRadius: "10px",
        background: isDragging ? "#17231b" : "#121212",
        padding: "12px",
        transition: "background 0.14s ease, border 0.14s ease"
      }}
    >
      <div
        style={{
          alignItems: "start",
          display: "grid",
          gap: "12px",
          gridTemplateColumns: hasMedia
            ? "108px minmax(0, 1fr)"
            : "minmax(0, 1fr)"
        }}
      >
        {hasMedia && <MediaPreview media={mediaValue} />}

        <div style={{ minWidth: 0 }}>
          <QuestionEditorField label="Image / URL">
            <input
              value={mediaValue}
              onChange={(event) => onMediaChange?.(event.target.value)}
              placeholder="https://... ou /static/image.jpg"
              style={{
                ...inputStyle,
                marginBottom: 0
              }}
            />
          </QuestionEditorField>

          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginTop: "10px"
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInputChange}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!onUploadFile || isUploading}
              style={{
                ...primaryButtonStyle,
                opacity: !onUploadFile || isUploading ? 0.6 : 1,
                padding: "10px 14px",
                whiteSpace: "nowrap"
              }}
            >
              {isUploading
                ? "Import..."
                : hasMedia
                  ? "Remplacer l'image"
                  : "Importer une image"}
            </button>
            {hasMedia && (
              <button
                type="button"
                onClick={removeMedia}
                style={{
                  ...dangerButtonStyle,
                  padding: "10px 14px",
                  whiteSpace: "nowrap"
                }}
              >
                Retirer
              </button>
            )}
            <span
              style={{
                color: isDragging ? "#7ee2a8" : "#777",
                fontSize: "12px"
              }}
            >
              {isDragging ? "Déposer l'image" : "Glisser-déposer ou coller"}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            color: "#ff9c9c",
            fontSize: "12px",
            marginTop: "9px"
          }}
        >
          {error}
        </div>
      )}
    </div>
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
