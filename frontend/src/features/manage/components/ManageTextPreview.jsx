import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const LONG_TEXT_LENGTH = 48;
const CLOSE_DELAY_MS = 140;
const VIEWPORT_GUTTER = 12;
const MIN_PREVIEW_HEIGHT = 160;

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
  const availableWidth = viewportWidth - VIEWPORT_GUTTER * 2;
  const width = Math.min(rect.width, availableWidth);
  const left = clamp(rect.left, VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER);
  const belowHeight = viewportHeight - rect.bottom - VIEWPORT_GUTTER - 6;
  const aboveHeight = rect.top - VIEWPORT_GUTTER - 6;
  const placeAbove = belowHeight < MIN_PREVIEW_HEIGHT && aboveHeight > belowHeight;
  const availableHeight = Math.max(80, placeAbove ? aboveHeight : belowHeight);
  const maxHeight = Math.min(420, availableHeight);
  const top = placeAbove
    ? null
    : clamp(rect.bottom + 6, VIEWPORT_GUTTER, viewportHeight - maxHeight - VIEWPORT_GUTTER);
  const bottom = placeAbove
    ? clamp(
      viewportHeight - rect.top + 6,
      VIEWPORT_GUTTER,
      viewportHeight - maxHeight - VIEWPORT_GUTTER
    )
    : null;

  return {
    left,
    top,
    bottom,
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

export function useManageTextPreview(items) {
  const closeTimerRef = useRef(null);
  const previewId = useId();
  const [anchorElement, setAnchorElement] = useState(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const previewItems = (items || []).map(normalizeItem).filter(Boolean);
  const contentKey = previewItems
    .map((item) => `${item.label}:${item.value}`)
    .join("\u0000");
  const hasLongValue = previewItems.some((item) => hasLongText(item.value));
  const enabled = hasLongValue || hasOverflow;

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
        onPointerEnter={clearCloseTimer}
        onPointerLeave={scheduleClose}
        style={{
          position: "fixed",
          left: `${position.left}px`,
          top: position.top === null ? undefined : `${position.top}px`,
          bottom: position.bottom === null ? undefined : `${position.bottom}px`,
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
                  {item.value}
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
