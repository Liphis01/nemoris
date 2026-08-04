import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getMediaKind, resolveMediaUrl } from "../../../shared/media";
import RichText from "../../../shared/RichText";

const LONG_TEXT_LENGTH = 48;
const CLOSE_DELAY_MS = 140;
const VIEWPORT_GUTTER = 12;
const MIN_PREVIEW_HEIGHT = 160;
const PREVIEW_GAP = 8;

function normalizeItem(item) {
  const value = item?.value === null || item?.value === undefined
    ? ""
    : String(item.value).trim();

  if (!value) return null;

  return {
    label: item.label || "",
    value,
    tone: item.tone || "#8ab4f8"
  };
}

function hasLongText(value) {
  return value.length > LONG_TEXT_LENGTH || value.includes("\n");
}

function clamp(value, min, max) {
  if (max < min) return min;

  return Math.min(Math.max(value, min), max);
}

function getPreviewPosition(anchor) {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const rightRoom = viewportWidth - rect.right - PREVIEW_GAP - VIEWPORT_GUTTER;
  const leftRoom = rect.left - PREVIEW_GAP - VIEWPORT_GUTTER;
  const side = rightRoom >= 260 || rightRoom >= leftRoom ? "right" : "left";
  const availableWidth = Math.max(220, side === "right" ? rightRoom : leftRoom);
  const preferredWidth = Math.min(460, Math.max(320, rect.width));
  const width = Math.min(preferredWidth, availableWidth);
  const left = side === "right"
    ? clamp(rect.right + PREVIEW_GAP, VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER)
    : clamp(rect.left - width - PREVIEW_GAP, VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER);
  const top = clamp(rect.top, VIEWPORT_GUTTER, viewportHeight - MIN_PREVIEW_HEIGHT - VIEWPORT_GUTTER);
  const maxHeight = Math.min(420, Math.max(80, viewportHeight - top - VIEWPORT_GUTTER));

  return {
    left,
    top,
    width,
    maxHeight
  };
}

function elementHasOverflow(element) {
  return (
    element.scrollWidth > element.clientWidth + 1 ||
    element.scrollHeight > element.clientHeight + 1
  );
}

function anchorHasPreviewOverflow(anchor) {
  const targets = anchor.querySelectorAll("[data-manage-preview-text]");

  return Array.from(targets).some(elementHasOverflow);
}

export function useManageTextPreview(items, options = {}) {
  const closeTimerRef = useRef(null);
  const previewId = useId();
  const [anchorElement, setAnchorElement] = useState(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const previewItems = (items || []).map(normalizeItem).filter(Boolean);
  const mediaSrc = resolveMediaUrl(options.media);
  const contentKey = previewItems
    .map((item) => `${item.label}:${item.value}`)
    .concat(mediaSrc ? [`media:${mediaSrc}`] : [])
    .join("\u0000");
  const hasLongValue = previewItems.some((item) => hasLongText(item.value));
  const enabled = Boolean(mediaSrc) || hasLongValue || hasOverflow;

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function showPreview() {
    if (!enabled || !anchorElement) return;

    clearCloseTimer();
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();

    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    if (!anchorElement) {
      setOpen(false);
      return undefined;
    }

    function updatePosition() {
      setPosition(getPreviewPosition(anchorElement));
    }

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorElement, open]);

  useLayoutEffect(() => {
    if (!anchorElement) {
      setHasOverflow(false);
      return undefined;
    }

    function updateOverflow() {
      const nextHasOverflow = anchorHasPreviewOverflow(anchorElement);
      setHasOverflow((current) =>
        current === nextHasOverflow ? current : nextHasOverflow
      );
    }

    updateOverflow();
    window.addEventListener("resize", updateOverflow);

    const resizeObserver = "ResizeObserver" in window
      ? new window.ResizeObserver(updateOverflow)
      : null;

    if (resizeObserver) {
      resizeObserver.observe(anchorElement);
    }

    return () => {
      window.removeEventListener("resize", updateOverflow);
      resizeObserver?.disconnect();
    };
  }, [anchorElement, contentKey]);

  useEffect(() => {
    if (!enabled && open) {
      setOpen(false);
    }
  }, [enabled, open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const triggerProps = enabled
    ? {
      onPointerEnter: showPreview,
      onPointerLeave: scheduleClose,
      onFocus: showPreview,
      onBlur: scheduleClose,
      "aria-describedby": open ? previewId : undefined
    }
    : {};

  const preview = enabled && open && position && typeof document !== "undefined"
    ? createPortal(
      <div
        id={previewId}
        role="tooltip"
        className="app-scrollbar"
        style={{
          position: "fixed",
          left: `${position.left}px`,
          top: `${position.top}px`,
          width: `${position.width}px`,
          maxHeight: `${position.maxHeight}px`,
          overflowY: "auto",
          zIndex: 1000,
          padding: "11px 12px",
          borderRadius: "10px",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          background: "rgba(22, 22, 22, 0.98)",
          boxShadow: "0 18px 42px rgba(0, 0, 0, 0.45)",
          color: "#ededed",
          textAlign: "left",
          pointerEvents: "auto",
          animation: "fadeIn 0.12s ease",
          boxSizing: "border-box"
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}
        >
          {mediaSrc && getMediaKind(options.media) === "audio" && (
            <audio
              src={mediaSrc}
              controls
              style={{ width: "100%" }}
            />
          )}
          {mediaSrc && getMediaKind(options.media) === "video" && (
            <video
              src={mediaSrc}
              controls
              style={{
                width: "100%",
                maxHeight: "190px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "#0f0f0f"
              }}
            />
          )}
          {mediaSrc && getMediaKind(options.media) === "image" && (
            <img
              src={mediaSrc}
              alt=""
              style={{
                width: "100%",
                maxHeight: "190px",
                objectFit: "contain",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                boxSizing: "border-box",
                background: "#0f0f0f"
              }}
            />
          )}
          {previewItems.map((item, index) => (
            <div
              key={`${item.label || "text"}-${index}`}
              style={{
                display: "grid",
                gridTemplateColumns: "3px minmax(0, 1fr)",
                gap: "9px",
                paddingTop: index === 0 ? 0 : "10px",
                borderTop: index === 0 ? "none" : "1px solid rgba(255, 255, 255, 0.08)"
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: "3px",
                  borderRadius: "999px",
                  background: item.tone,
                  opacity: 0.85
                }}
              />
              <span style={{ minWidth: 0 }}>
                {item.label && (
                  <span
                    style={{
                      display: "block",
                      marginBottom: "4px",
                      color: "#8a8a8a",
                      fontSize: "10px",
                      fontWeight: 800,
                      letterSpacing: 0,
                      textTransform: "uppercase",
                      lineHeight: 1.2
                    }}
                  >
                    {item.label}
                  </span>
                )}
                <span
                  style={{
                    display: "block",
                    color: "#f0f0f0",
                    fontSize: "13px",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere"
                  }}
                >
                  <RichText>{item.value}</RichText>
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>,
      document.body
    )
    : null;

  return {
    setAnchorElement,
    triggerProps,
    preview
  };
}
