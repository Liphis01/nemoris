import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import TagPicker from "../../../shared/TagPicker";
import {
  getMediaKind,
  normalizeMediaPool,
  resolveMediaUrl
} from "../../../shared/media";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import { letterboxPatternBg } from "../../../shared/styles";

const DEFAULT_MEDIA_LABELS = {
  import: "Importer une image",
  replace: "Remplacer l'image",
  hint: "Glisser-déposer ou coller",
  dragging: "Déposer l'image",
  typeError: "Seules les images sont acceptées."
};

// A pasted image carries whatever resolution the source put on the clipboard:
// copying from a web page yields the variant that page loaded (often a
// thumbnail), and a screenshot yields screen pixels. Nothing downstream
// degrades the file, so the only fix is to flag it while the user can still
// re-copy the original instead of discovering the blur weeks later in review.
const LOW_RES_PASTE_MIN_WIDTH = 400;

function readImageSize(file) {
  return new Promise((resolve) => {
    // SVG is vector, so its intrinsic width says nothing about render quality.
    if (
      !file ||
      !file.type?.startsWith("image/") ||
      file.type === "image/svg+xml" ||
      typeof URL?.createObjectURL !== "function"
    ) {
      resolve(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const probe = new Image();

    function finish(size) {
      URL.revokeObjectURL(objectUrl);
      resolve(size);
    }

    probe.onload = () => finish({ height: probe.naturalHeight, width: probe.naturalWidth });
    probe.onerror = () => finish(null);
    probe.src = objectUrl;
  });
}

async function lowResPasteNotice(file) {
  const size = await readImageSize(file);

  if (!size?.width || size.width >= LOW_RES_PASTE_MIN_WIDTH) return "";

  return `Image de petite taille (${size.width} × ${size.height} px). ` +
    "Pour la pleine résolution, copie l'adresse de l'image (clic droit → " +
    "« Copier l'adresse de l'image ») et colle-la ici.";
}

function LowResNotice({ notice }) {
  if (!notice) return null;

  return (
    <div
      style={{
        color: "#e9be74",
        fontSize: "12px",
        lineHeight: 1.45,
        marginTop: "9px"
      }}
    >
      {notice}
    </div>
  );
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
    <div className="app-scrollbar" style={panelStyle}>
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
            border: "1px solid rgba(255, 255, 255, 0.12)",
            boxSizing: "border-box",
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
  const [lowResNotice, setLowResNotice] = useState("");
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

  async function uploadFile(file, { fromPaste = false } = {}) {
    if (!file || !onUploadFile) return;

    if (file.type && !fileMatchesAccept(file)) {
      setError(text.typeError);
      return;
    }

    setError("");
    setLowResNotice("");
    setIsUploading(true);

    try {
      const result = await onUploadFile(file);
      const nextMedia = result?.media || result?.url;

      if (nextMedia) {
        onMediaChange?.(nextMedia);
      }

      // Deliberately not awaited: the probe must never hold up the busy state.
      if (fromPaste && nextMedia) {
        lowResPasteNotice(file).then(setLowResNotice);
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
      uploadFile(pastedFile, { fromPaste: true });
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
      // Pasting the address is the full-resolution path the notice asks for.
      setLowResNotice("");
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
    setLowResNotice("");

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

      <LowResNotice notice={lowResNotice} />
    </div>
  );
}

function MediaPoolThumbnail({ media, size = 72 }) {
  const src = resolveMediaUrl(media);
  const kind = getMediaKind(media);

  const shared = {
    border: "1px solid rgba(255, 255, 255, 0.12)",
    boxSizing: "border-box",
    maxHeight: "100%",
    maxWidth: "100%",
    objectFit: "contain"
  };

  return (
    <div
      style={{
        alignItems: "center",
        background: "#101010",
        display: "flex",
        height: `${size}px`,
        justifyContent: "center",
        overflow: "hidden",
        width: `${size}px`
      }}
    >
      {kind === "audio" ? (
        <span aria-hidden="true" style={{ fontSize: "22px" }}>🎧</span>
      ) : kind === "video" ? (
        <video src={src} muted playsInline preload="metadata" style={shared} />
      ) : (
        <img src={src} alt="" loading="lazy" decoding="async" style={shared} />
      )}
    </div>
  );
}

// Multi-image field: a compact cover + "+N" trigger that opens a modal to add,
// remove, reorder, and choose the cover. One image is picked at ask time so the
// picture cannot be rote-memorised. Emits an ordered, de-duplicated string[].
export function MediaPoolField({
  pool = [],
  onPoolChange,
  onUploadFile,
  onImportMediaUrl,
  accept = "image/*",
  labels,
  compact = false,
  size = 72
}) {
  const images = normalizeMediaPool(pool);
  const cover = images[0] || "";
  const extraCount = Math.max(0, images.length - 1);

  const fileInputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [lowResNotice, setLowResNotice] = useState("");
  const [previewMedia, setPreviewMedia] = useState(null);

  const text = { ...DEFAULT_MEDIA_LABELS, ...labels };
  const busy = isUploading || isImportingUrl;
  const acceptedTypePrefixes = accept
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\*$/, ""));

  function fileMatchesAccept(file) {
    if (!file?.type) return true;

    return acceptedTypePrefixes.some((prefix) =>
      prefix.endsWith("/") ? file.type.startsWith(prefix) : file.type === prefix
    );
  }

  function commitPool(next) {
    onPoolChange?.(normalizeMediaPool(next));
  }

  function addMedia(media) {
    const value = String(media || "").trim();

    if (!value || images.includes(value)) return;

    commitPool([...images, value]);
  }

  async function uploadFiles(fileList, { fromPaste = false } = {}) {
    const files = Array.from(fileList || []).filter(fileMatchesAccept);

    if (files.length === 0 || !onUploadFile) return;

    setError("");
    setLowResNotice("");
    setIsUploading(true);

    try {
      const added = [];

      for (const file of files) {
        const result = await onUploadFile(file);
        const media = result?.media || result?.url;

        if (media) added.push(media);
      }

      if (added.length) commitPool([...images, ...added]);

      // Deliberately not awaited: the probes must never hold up the busy state.
      if (fromPaste && added.length) {
        Promise.all(files.map(lowResPasteNotice))
          .then((notices) => setLowResNotice(notices.find(Boolean) || ""));
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

  async function importUrl() {
    const url = urlInput.trim();

    if (!url) return;

    setError("");

    if (!onImportMediaUrl) {
      addMedia(url);
      setUrlInput("");
      return;
    }

    setIsImportingUrl(true);

    try {
      const result = await onImportMediaUrl(url);

      addMedia(result?.media || result?.url || url);
      setUrlInput("");
    } catch (importError) {
      setError(importError.message || "Import URL impossible.");
    } finally {
      setIsImportingUrl(false);
    }
  }

  function removeAt(index) {
    commitPool(images.filter((_, position) => position !== index));
  }

  function makeCover(index) {
    if (index <= 0) return;

    const next = [...images];
    const [picked] = next.splice(index, 1);

    commitPool([picked, ...next]);
  }

  function move(index, delta) {
    const target = index + delta;

    if (target < 0 || target >= images.length) return;

    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    commitPool(next);
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    uploadFiles(event.dataTransfer?.files);
  }

  function handlePaste(event) {
    // The popover is a portal: React bubbles its events through the component
    // tree (not the DOM tree), so without this a paste here would also reach
    // MediaGroupEditor's own paste handler and spawn a whole new row.
    event.stopPropagation();

    const files = Array.from(event.clipboardData?.files || []).filter(fileMatchesAccept);

    if (files.length) {
      event.preventDefault();
      uploadFiles(files, { fromPaste: true });
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
      event.preventDefault();
      // Pasting the address is the full-resolution path the notice asks for.
      setLowResNotice("");
      addMedia(pastedText);
    }
  }

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;

      if (previewMedia) {
        setPreviewMedia(null);
        return;
      }

      setOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, previewMedia]);

  useEffect(() => {
    if (!open) setPreviewMedia(null);
  }, [open]);

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
    opacity: !onUploadFile || busy ? 0.6 : 1,
    padding: "9px 14px",
    whiteSpace: "nowrap"
  };
  const coverBadgeStyle = {
    background: "rgba(15, 15, 15, 0.86)",
    border: "1px solid #3a3a3a",
    borderRadius: "999px",
    bottom: "4px",
    color: "#f0c36a",
    fontSize: "11px",
    fontWeight: 700,
    padding: "2px 7px",
    pointerEvents: "none",
    position: "absolute",
    right: "4px"
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
      style={compact ? {
        border: isDragging
          ? "1px dashed rgba(126, 226, 168, 0.75)"
          : "1px solid transparent",
        borderRadius: "10px",
        display: "inline-block",
        lineHeight: 0
      } : {
        border: isDragging
          ? "1px dashed rgba(126, 226, 168, 0.75)"
          : cover
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
        multiple
        onChange={(event) => uploadFiles(event.target.files)}
        style={{ display: "none" }}
      />

      {compact ? (
        cover ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Gérer les images"
            style={{
              background: "#101010",
              border: "1px solid #2f2f2f",
              borderRadius: "8px",
              cursor: "pointer",
              display: "block",
              overflow: "hidden",
              padding: 0,
              position: "relative"
            }}
          >
            <MediaPoolThumbnail media={cover} size={size} />
            {extraCount > 0 && <span style={coverBadgeStyle}>+{extraCount}</span>}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!onUploadFile && !onImportMediaUrl}
            aria-label="Ajouter des images"
            style={{
              alignItems: "center",
              background: "#181818",
              border: "1px dashed #3a3a3a",
              borderRadius: "8px",
              color: "#888",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              fontSize: "11px",
              gap: "3px",
              height: `${size}px`,
              justifyContent: "center",
              lineHeight: 1.1,
              width: `${size}px`
            }}
          >
            <span aria-hidden="true" style={{ fontSize: "18px" }}>＋</span>
            {isUploading ? "Import…" : "média"}
          </button>
        )
      ) : cover ? (
        <div
          style={{
            alignItems: "center",
            display: "grid",
            gap: "14px",
            gridTemplateColumns: "auto minmax(0, 1fr)"
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Gérer les images"
            style={{
              background: "#101010",
              border: "1px solid #2f2f2f",
              borderRadius: "8px",
              cursor: "pointer",
              overflow: "hidden",
              padding: 0,
              position: "relative"
            }}
          >
            <MediaPoolThumbnail media={cover} size={78} />
            {extraCount > 0 && <span style={coverBadgeStyle}>+{extraCount}</span>}
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
            <div style={{ color: "#aaa", fontSize: "12px" }}>
              {images.length} image{images.length > 1 ? "s" : ""}
              {extraCount > 0 ? " — une au hasard à la révision" : ""}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button type="button" onClick={() => setOpen(true)} style={compactPrimaryStyle}>
                Gérer les images
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!onUploadFile || busy}
                style={ghostButtonStyle}
              >
                {isUploading ? "Import..." : "＋ Ajouter"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!onUploadFile || busy}
            style={compactPrimaryStyle}
          >
            {isUploading ? "Import..." : `＋ ${text.import}`}
          </button>
          <button type="button" onClick={() => setOpen(true)} style={ghostButtonStyle}>
            Ajouter par URL
          </button>
          <span style={{ color: isDragging ? "#7ee2a8" : "#666", fontSize: "12px" }}>
            {isDragging ? text.dragging : text.hint}
          </span>
        </div>
      )}

      {error && (
        <div style={{ color: "#ff9c9c", fontSize: "12px", marginTop: "9px" }}>
          {error}
        </div>
      )}

      <LowResNotice notice={lowResNotice} />

      {open && createPortal(
        <>
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.82)",
            display: "flex",
            inset: "var(--shell-top, 0px) 0 0 0",
            justifyContent: "center",
            padding: "28px",
            position: "fixed",
            zIndex: 1200
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDrop={handleDrop}
            onPaste={handlePaste}
            style={{
              background: "#161616",
              border: "1px solid #333",
              borderRadius: "14px",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              maxHeight: "82vh",
              padding: "20px",
              width: "min(88vw, 640px)"
            }}
          >
            <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
              <div style={{ color: "#eee", fontSize: "16px", fontWeight: 800 }}>
                Médias ({images.length})
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                style={{
                  background: "#1f1f1f",
                  border: "1px solid #3a3a3a",
                  borderRadius: "999px",
                  color: "#ddd",
                  cursor: "pointer",
                  fontSize: "18px",
                  height: "32px",
                  lineHeight: 1,
                  width: "32px"
                }}
              >
                ×
              </button>
            </div>

            <div
              className="app-scrollbar"
              style={{
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                overflowY: "auto",
                paddingRight: "4px"
              }}
            >
              {images.map((media, index) => (
                <div
                  key={`${media}-${index}`}
                  style={{
                    border: index === 0 ? "1px solid #6f5520" : "1px solid #2a2a2a",
                    borderRadius: "10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    padding: "8px"
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setPreviewMedia(media)}
                    aria-label="Agrandir l'image"
                    style={{
                      alignItems: "center",
                      background: "transparent",
                      border: "none",
                      cursor: "zoom-in",
                      display: "flex",
                      justifyContent: "center",
                      padding: 0
                    }}
                  >
                    <MediaPoolThumbnail media={media} size={110} />
                  </button>

                  {index === 0 ? (
                    <div style={{ color: "#f0c36a", fontSize: "11px", fontWeight: 700, textAlign: "center" }}>
                      ★ Couverture
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => makeCover(index)}
                      style={{ ...ghostButtonStyle, fontSize: "12px", justifyContent: "center", padding: "6px 8px" }}
                    >
                      ★ Couverture
                    </button>
                  )}

                  <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Déplacer avant"
                      style={{ ...ghostButtonStyle, opacity: index === 0 ? 0.4 : 1, padding: "6px 10px" }}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === images.length - 1}
                      aria-label="Déplacer après"
                      style={{ ...ghostButtonStyle, opacity: index === images.length - 1 ? 0.4 : 1, padding: "6px 10px" }}
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAt(index)}
                      style={{ ...dangerButtonStyle, padding: "6px 10px" }}
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!onUploadFile && !onImportMediaUrl}
                aria-label="Importer une image"
                style={{
                  alignItems: "center",
                  background: "#141414",
                  border: "1px dashed #3a3a3a",
                  borderRadius: "10px",
                  color: "#888",
                  cursor: !onUploadFile && !onImportMediaUrl ? "default" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  justifyContent: "center",
                  minHeight: "110px",
                  padding: "8px"
                }}
              >
                <span aria-hidden="true" style={{ fontSize: "22px" }}>＋</span>
                <span style={{ fontSize: "12px", lineHeight: 1.3, textAlign: "center" }}>
                  Coller (Ctrl+V)
                </span>
              </button>
            </div>

            <div style={{ borderTop: "1px solid #2a2a2a", display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "14px" }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!onUploadFile || busy}
                style={compactPrimaryStyle}
              >
                {isUploading ? "Import..." : "＋ Importer"}
              </button>
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    importUrl();
                  }
                }}
                placeholder="https://... ou /static/fichier"
                style={{ ...inputStyle, flex: "1 1 200px", marginBottom: 0, minWidth: "160px" }}
              />
              <button
                type="button"
                onClick={importUrl}
                disabled={!urlInput.trim() || busy}
                style={{ ...buttonStyle, opacity: !urlInput.trim() || busy ? 0.6 : 1, whiteSpace: "nowrap" }}
              >
                {isImportingUrl ? "Import URL..." : "Importer l'URL"}
              </button>
            </div>

            {error && (
              <div style={{ color: "#ff9c9c", fontSize: "12px" }}>
                {error}
              </div>
            )}
          </div>
        </div>

        {previewMedia && (
          <div
            role="presentation"
            onClick={() => setPreviewMedia(null)}
            style={{
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.82)",
              display: "flex",
              inset: 0,
              justifyContent: "center",
              padding: "28px",
              position: "fixed",
              zIndex: 1300
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                alignItems: "center",
                background: "#111",
                border: "1px solid #333",
                borderRadius: "12px",
                boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
                boxSizing: "border-box",
                display: "flex",
                justifyContent: "center",
                maxHeight: "86vh",
                overflow: "hidden",
                padding: "14px",
                position: "relative",
                width: "min(82vw, 900px)"
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewMedia(null)}
                aria-label="Fermer l'image agrandie"
                style={{
                  alignItems: "center",
                  background: "#1f1f1f",
                  border: "1px solid #3a3a3a",
                  borderRadius: "999px",
                  color: "#ddd",
                  cursor: "pointer",
                  display: "flex",
                  fontSize: "20px",
                  height: "34px",
                  justifyContent: "center",
                  lineHeight: 1,
                  position: "absolute",
                  right: "12px",
                  top: "12px",
                  width: "34px",
                  zIndex: 1
                }}
              >
                ×
              </button>

              {getMediaKind(previewMedia) === "audio" ? (
                <audio
                  src={resolveMediaUrl(previewMedia)}
                  controls
                  autoPlay
                  style={{
                    background: "#0d0d0d",
                    borderRadius: "8px",
                    display: "block",
                    width: "100%"
                  }}
                />
              ) : getMediaKind(previewMedia) === "video" ? (
                <video
                  src={resolveMediaUrl(previewMedia)}
                  controls
                  style={{
                    background: letterboxPatternBg,
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "8px",
                    boxSizing: "border-box",
                    display: "block",
                    maxHeight: "min(62vh, 560px)",
                    objectFit: "contain",
                    width: "100%"
                  }}
                />
              ) : (
                <img
                  src={resolveMediaUrl(previewMedia)}
                  alt=""
                  style={{
                    background: letterboxPatternBg,
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "8px",
                    boxSizing: "border-box",
                    display: "block",
                    maxHeight: "min(62vh, 560px)",
                    objectFit: "contain",
                    width: "100%"
                  }}
                />
              )}
            </div>
          </div>
        )}
        </>,
        document.body
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
  // Props are unchanged so the five editors that mount this need no edits; the
  // browsing, drilling and creating all live in TagPicker.
  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: compact ? "6px" : "8px", ...labelOverrideStyle }}>
        Tags
      </div>

      <TagPicker
        tags={tags}
        value={tagInput}
        onChange={onTagInputChange}
        onAdd={(tag) => onAddTag?.(tag)}
        onRemove={(tag) => onRemoveTag?.(tag)}
        extraKeys={availableTags}
        chipStyle={chipStyle}
        compact={compact}
        inputStyle={{ ...inputStyle, ...inputOverrideStyle }}
      />
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
