import { useEffect } from "react";
import { createPortal } from "react-dom";

const previewShortcutKeys = new Set(["Enter", "0", "1", "2", "3"]);

// Full-screen lightbox for a zoomed image. Shared by every question type that
// lets the user click a thumbnail to see the image at full size.
export function MediaZoomOverlay({ src, alt, onClose }) {
    useEffect(() => {
        function handleKeyDown(event) {
            const isInsideOverlay = Boolean(
                event.target?.closest?.("[data-media-zoom-overlay]")
            );

            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }

            if (!isInsideOverlay && previewShortcutKeys.has(event.key)) {
                event.preventDefault();
                event.stopPropagation();
            }
        }

        window.addEventListener("keydown", handleKeyDown, true);

        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [onClose]);

    if (typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <div
            role="presentation"
            onClick={onClose}
            style={{
                alignItems: "center",
                background: "rgba(0, 0, 0, 0.82)",
                display: "flex",
                inset: "var(--shell-top, 0px) 0 0 0",
                justifyContent: "center",
                padding: "28px",
                position: "fixed",
                zIndex: 1000
            }}
        >
            <div
                aria-label="Image agrandie"
                aria-modal="true"
                data-media-zoom-overlay
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                role="dialog"
                style={{
                    background: "#111",
                    border: "1px solid #333",
                    borderRadius: "12px",
                    boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
                    boxSizing: "border-box",
                    maxHeight: "86vh",
                    overflow: "hidden",
                    padding: "14px",
                    position: "relative",
                    width: "min(82vw, 900px)"
                }}
            >
                <button
                    type="button"
                    onClick={onClose}
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

                <img
                    src={src}
                    alt={alt}
                    style={{
                        background: "#0d0d0d",
                        borderRadius: "8px",
                        display: "block",
                        height: "68vh",
                        maxHeight: "620px",
                        objectFit: "contain",
                        width: "100%"
                    }}
                />
            </div>
        </div>,
        document.body
    );
}

// Clickable thumbnail that opens a MediaZoomOverlay. `boxed` frames the image
// in the same thumbnail box other question types use for the question prompt;
// the unboxed form is used for inline reveals (e.g. an answer image).
export function ZoomableImageThumb({
    src,
    alt,
    ariaLabel,
    boxed = true,
    onOpen,
    style
}) {
    if (boxed) {
        return (
            <button
                type="button"
                aria-label={ariaLabel || `Agrandir ${alt}`}
                onClick={onOpen}
                onKeyDown={(event) => event.stopPropagation()}
                style={{
                    alignItems: "center",
                    background: "#101010",
                    border: "1px solid #262626",
                    borderRadius: "12px",
                    cursor: "zoom-in",
                    display: "inline-flex",
                    height: "154px",
                    justifyContent: "center",
                    maxWidth: "260px",
                    overflow: "hidden",
                    padding: "10px",
                    width: "100%",
                    ...style
                }}
            >
                <img
                    src={src}
                    alt={alt}
                    style={{
                        borderRadius: "8px",
                        display: "block",
                        maxHeight: "132px",
                        maxWidth: "100%",
                        objectFit: "contain"
                    }}
                />
            </button>
        );
    }

    return (
        <button
            type="button"
            aria-label={ariaLabel || `Agrandir ${alt}`}
            onClick={onOpen}
            onKeyDown={(event) => event.stopPropagation()}
            style={{
                background: "none",
                border: "none",
                cursor: "zoom-in",
                display: "inline-block",
                padding: 0,
                ...style
            }}
        >
            <img
                src={src}
                alt={alt}
                style={{
                    borderRadius: "8px",
                    display: "block",
                    maxHeight: "180px",
                    maxWidth: "100%",
                    objectFit: "contain"
                }}
            />
        </button>
    );
}
