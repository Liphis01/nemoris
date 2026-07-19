import { useRef, useState } from "react";
import {
  buttonStyle,
  cancelButtonStyle,
  dangerButtonStyle,
  disabledCancelButtonStyle,
  disabledSaveButtonStyle,
  inputStyle,
  labelStyle,
  panelStyle,
  pendingSaveDotStyle,
  pendingSaveButtonStyle,
  primaryButtonStyle
} from "./QuestionEditorStyles";
import AutocompleteInput from "../../../shared/AutocompleteInput";
import { getMediaKind, resolveMediaUrl } from "../../../shared/media";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";

const DEFAULT_MEDIA_LABELS = {
  import: "Importer une image",
  replace: "Remplacer l'image",
  hint: "Glisser-déposer ou coller",
  dragging: "Déposer l'image",
  typeError: "Seules les images sont acceptées."
};

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
          gap: "18px",
          textAlign: "left"
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Accent-bordered grouping card. Extracted from TextQuestionEditor so the
// timeline editor can share the exact same section look.
export function EditorSection({ title, accent, children }) {
  return (
    <section
      style={{
        background: "#171717",
        border: "1px solid #262626",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "18px 20px"
      }}
    >
      <div
        style={{
          color: accent,
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase"
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

export function QuestionEditorField({ label, children, compact = false }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: compact ? "4px" : "7px" }}>
      <span style={compact ? { ...labelStyle, fontSize: "12px" } : labelStyle}>
        {label}
      </span>
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

  const kind = getMediaKind(media);

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
      {kind === "audio" ? (
        <audio
          src={src}
          controls
          style={{ maxWidth: "100%" }}
        />
      ) : kind === "video" ? (
        <video
          src={src}
          controls
          style={{
            maxHeight: "100%",
            maxWidth: "100%"
          }}
        />
      ) : (
        <img
          src={src}
          alt="preview"
          style={{
            maxHeight: "100%",
            maxWidth: "100%",
            objectFit: "contain"
          }}
        />
      )}
    </div>
  );
}

export function ImageMediaField({
  media,
  onMediaChange,
  onUploadFile,
  onImportMediaUrl,
  onRemoveMedia,
  accept = "image/*",
  labels
}) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [error, setError] = useState("");
  const mediaValue = media || "";
  const hasMedia = Boolean(String(mediaValue).trim());
  const canImportUrl = Boolean(onImportMediaUrl) &&
    /^https?:\/\//i.test(String(mediaValue).trim());
  const isBusy = isUploading || isImportingUrl;
  const text = { ...DEFAULT_MEDIA_LABELS, ...labels };
  const acceptedTypePrefixes = accept
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\*$/, ""));

  function fileMatchesAccept(file) {
    // Files with an unknown type are allowed, matching the historical behaviour.
    if (!file?.type) return true;

    return acceptedTypePrefixes.some((prefix) =>
      prefix.endsWith("/") ? file.type.startsWith(prefix) : file.type === prefix
    );
  }

  async function uploadFile(file) {
    if (!file || !onUploadFile) return;

    if (file.type && !fileMatchesAccept(file)) {
      setError(text.typeError);
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

  function firstAcceptedFile(fileList) {
    return Array.from(fileList || []).find(fileMatchesAccept);
  }

  function handleFileInputChange(event) {
    uploadFile(firstAcceptedFile(event.target.files));
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    uploadFile(firstAcceptedFile(event.dataTransfer?.files));
  }

  function handlePaste(event) {
    const pastedFile = firstAcceptedFile(event.clipboardData?.files);

    if (pastedFile) {
      event.preventDefault();
      uploadFile(pastedFile);
      return;
    }

    const pastedText = event.clipboardData?.getData("text/plain")?.trim();

    if (
      pastedText &&
      (
        /^(https?:)?\/\//.test(pastedText) ||
        pastedText.startsWith("/static/") ||
        pastedText.startsWith("data:")
      )
    ) {
      onMediaChange?.(pastedText);
    }
  }

  async function importCurrentUrl() {
    const url = String(mediaValue).trim();

    if (!url || !onImportMediaUrl) return;

    setError("");
    setIsImportingUrl(true);

    try {
      const result = await onImportMediaUrl(url);
      const nextMedia = result?.media || result?.url;

      if (nextMedia) {
        onMediaChange?.(nextMedia);
      }
    } catch (importError) {
      setError(importError.message || "Import URL impossible.");
    } finally {
      setIsImportingUrl(false);
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

  const ghostButtonStyle = {
    ...buttonStyle,
    background: "transparent",
    border: "1px solid #333",
    color: "#aaa",
    fontSize: "13px",
    padding: "9px 12px",
    whiteSpace: "nowrap"
  };

  const compactPrimaryStyle = {
    ...primaryButtonStyle,
    opacity: !onUploadFile || isBusy ? 0.6 : 1,
    padding: "9px 14px",
    whiteSpace: "nowrap"
  };

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
          ? "1px dashed rgba(126, 226, 168, 0.75)"
          : hasMedia
            ? "1px solid #2a2a2a"
            : "1px dashed #333",
        borderRadius: "10px",
        background: isDragging ? "#17231b" : "#121212",
        padding: "12px",
        transition: "background 0.14s ease, border 0.14s ease"
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileInputChange}
        style={{ display: "none" }}
      />

      {hasMedia ? (
        <div
          style={{
            alignItems: "center",
            display: "grid",
            gap: "14px",
            gridTemplateColumns: "108px minmax(0, 1fr)"
          }}
        >
          <MediaPreview media={mediaValue} />

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
            <div
              style={{
                color: "#888",
                fontSize: "12px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
              title={mediaValue}
            >
              {mediaValue}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!onUploadFile || isBusy}
                style={compactPrimaryStyle}
              >
                {isUploading ? "Import..." : text.replace}
              </button>
              <button
                type="button"
                onClick={removeMedia}
                style={{ ...dangerButtonStyle, padding: "9px 14px", whiteSpace: "nowrap" }}
              >
                Retirer
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: "10px"
          }}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!onUploadFile || isBusy}
            style={compactPrimaryStyle}
          >
            {isUploading ? "Import..." : `＋ ${text.import}`}
          </button>

          {onImportMediaUrl && (
            <button
              type="button"
              onClick={() => setShowUrl((value) => !value)}
              style={ghostButtonStyle}
            >
              Ajouter par URL
            </button>
          )}

          <span style={{ color: isDragging ? "#7ee2a8" : "#666", fontSize: "12px" }}>
            {isDragging ? text.dragging : text.hint}
          </span>
        </div>
      )}

      {(showUrl && !hasMedia) && (
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "8px",
            marginTop: "10px"
          }}
        >
          <input
            value={mediaValue}
            onChange={(event) => onMediaChange?.(event.target.value)}
            placeholder="https://... ou /static/fichier"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
          {canImportUrl && (
            <button
              type="button"
              onClick={importCurrentUrl}
              disabled={isBusy}
              style={{ ...buttonStyle, opacity: isBusy ? 0.6 : 1, padding: "12px 14px", whiteSpace: "nowrap" }}
            >
              {isImportingUrl ? "Import..." : "Importer"}
            </button>
          )}
        </div>
      )}

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
  onRemoveTag,
  chipStyle,
  compact = false,
  inputOverrideStyle,
  labelOverrideStyle
}) {
  const currentTagKeys = new Set(tags.map(tagKey));
  const suggestedTags = availableTags.filter(tag =>
    !currentTagKeys.has(tagKey(tag))
  );

  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: compact ? "6px" : "8px", ...labelOverrideStyle }}>
        Tags
      </div>
      {tags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: compact ? "6px" : "8px",
            marginBottom: compact ? "7px" : "10px"
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
                padding: compact ? "4px 8px" : "6px 9px",
                ...chipStyle
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
          gap: compact ? "6px" : "8px"
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
          style={{ ...inputStyle, ...inputOverrideStyle }}
        />
        <button
          type="button"
          onClick={() => onAddTag?.()}
          style={compact ? { ...buttonStyle, padding: "8px 12px" } : buttonStyle}
        >
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

  const isCancelDisabled = !hasUnsavedChanges && isSubmitDisabled;
  const cancelStyle = isCancelDisabled
    ? disabledCancelButtonStyle
    : cancelButtonStyle;

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
        <button
          type="button"
          disabled={isCancelDisabled}
          onClick={onCancel}
          title={isCancelDisabled ? "Aucune modification à annuler" : undefined}
          style={cancelStyle}
        >
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
