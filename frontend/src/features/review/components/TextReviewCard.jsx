import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fadeInStyle } from "../../../shared/styles";
import RichText from "../../../shared/RichText";
import {
    getMediaKind,
    mediaPoolFrom,
    pickReviewMedia,
    resolveMediaUrl
} from "../../../shared/media";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import {
    GOT_IT_QUALITY,
    STILL_LEARNING_QUALITY,
    isRelearningQuestion
} from "../relearningGrades";

const answerButtonStyle = {
    flex: 1,
    border: "1px solid transparent",
    borderRadius: "12px",
    padding: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, color 0.14s ease, opacity 0.14s ease, transform 0.14s ease",
    fontSize: "15px",
    transform: "scale(1)"
};

const answerOptions = [
    {
        value: 0,
        label: "0 · ❌ Faux",
        background: "#3a1f24",
        selectedBackground: "#6a2732",
        color: "#ff9aa5",
        selectedColor: "#ffe2e5"
    },
    {
        value: 1,
        label: "1 · 😐 Dur",
        background: "#35311f",
        selectedBackground: "#665224",
        color: "#ffd36b",
        selectedColor: "#fff1c7"
    },
    {
        value: 2,
        label: "2 · 🙂 Bon",
        background: "#1f2f3a",
        selectedBackground: "#25567d",
        color: "#8fc7ff",
        selectedColor: "#e1f0ff"
    },
    {
        value: 3,
        label: "3 · ✅ Facile",
        background: "#1d3a2b",
        selectedBackground: "#256844",
        color: "#7ee2a8",
        selectedColor: "#ddffeb"
    }
];

// On a relearning retry the four grades collapse to a binary choice. Encore
// keeps the card in the session loop; Acquis graduates it. Same button shape as
// answerOptions so getAnswerButtonStyle can render both.
const relearningOptions = [
    {
        value: STILL_LEARNING_QUALITY,
        label: "0 · ❌ Encore",
        background: "#3a1f24",
        selectedBackground: "#6a2732",
        color: "#ff9aa5",
        selectedColor: "#ffe2e5"
    },
    {
        value: GOT_IT_QUALITY,
        label: "1 · ✅ Acquis",
        background: "#1d3a2b",
        selectedBackground: "#256844",
        color: "#7ee2a8",
        selectedColor: "#ddffeb"
    }
];

const previewShortcutKeys = new Set(["Enter", "0", "1", "2", "3"]);

function getAnswerButtonStyle(option, displayQuality, isAnswering) {
    const isSelected = displayQuality === option.value;

    return {
        ...answerButtonStyle,
        background: isSelected ? option.selectedBackground : option.background,
        borderColor: isSelected ? option.color : "transparent",
        boxShadow: isSelected
            ? `0 0 0 3px ${option.color}22, 0 12px 28px ${option.color}20`
            : "none",
        color: isSelected ? option.selectedColor : option.color,
        cursor: isAnswering ? "default" : "pointer",
        opacity: isAnswering && !isSelected ? 0.42 : 1,
        transform: isSelected
            ? "translateY(-2px) scale(1.035)"
            : isAnswering
                ? "scale(0.985)"
                : "scale(1)"
    };
}

function TextMediaPreview({ src, alt, onClose }) {
    useEffect(() => {
        function handleKeyDown(event) {
            const isInsidePreview = Boolean(
                event.target?.closest?.("[data-text-media-preview]")
            );

            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }

            if (!isInsidePreview && previewShortcutKeys.has(event.key)) {
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
                data-text-media-preview
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

// Renders a review item's media by kind: image as a clickable thumbnail with a
// full-screen lightbox, audio/video as native players. Used for both the
// question prompt media and the answer media.
function ReviewMedia({ media, label = "média", style }) {
    const [previewOpen, setPreviewOpen] = useState(false);
    const src = resolveMediaUrl(media);

    useEffect(() => {
        setPreviewOpen(false);
    }, [src]);

    if (!src) return null;

    const kind = getMediaKind(media);
    const wrapperStyle = { marginBottom: "34px", ...style };

    if (kind === "audio") {
        return (
            <div style={wrapperStyle}>
                <audio
                    src={src}
                    controls
                    style={{ maxWidth: "100%", width: "420px" }}
                />
            </div>
        );
    }

    if (kind === "video") {
        return (
            <div style={wrapperStyle}>
                <video
                    src={src}
                    controls
                    style={{
                        borderRadius: "12px",
                        maxHeight: "360px",
                        maxWidth: "100%"
                    }}
                />
            </div>
        );
    }

    return (
        <div style={wrapperStyle}>
            <button
                type="button"
                aria-label={`Agrandir l'image de la ${label}`}
                onClick={() => setPreviewOpen(true)}
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
                    width: "100%"
                }}
            >
                <img
                    src={src}
                    alt={label}
                    style={{
                        borderRadius: "8px",
                        display: "block",
                        maxHeight: "132px",
                        maxWidth: "100%",
                        objectFit: "contain"
                    }}
                />
            </button>

            {previewOpen && (
                <TextMediaPreview
                    src={src}
                    alt={label}
                    onClose={() => setPreviewOpen(false)}
                />
            )}
        </div>
    );
}

export default function TextReviewCard({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleAnswer,
    currentQuality,
    selectedQuality,
    showQualityButtons = true
}) {
    const answerActionsRef = useRef(null);
    const isAnswering = selectedQuality !== null;
    const displayQuality = selectedQuality ?? currentQuality;
    // Pick one image from the question's pool for this presentation (stable for
    // the card's lifetime; a new card mount re-picks, avoiding a repeat).
    const questionMedia = useMemo(
        () => pickReviewMedia(q.question_id ?? q.id, mediaPoolFrom(q)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [q.question_id ?? q.id]
    );
    const hasQuestionMedia = Boolean(questionMedia);
    const typeStyle = getQuestionTypeChipStyle(q.type_q);
    const relearning = isRelearningQuestion(q);
    const gradeOptions = relearning ? relearningOptions : answerOptions;

    useEffect(() => {
        if (!showAnswer) return undefined;

        const scrollFrame = window.requestAnimationFrame(() => {
            answerActionsRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "end",
                inline: "nearest"
            });
        });

        return () => {
            window.cancelAnimationFrame(scrollFrame);
        };
    }, [showAnswer]);

    return (
        <>
            <div
                key={currentIndex}
                style={{
                    background: "#181818",
                    border: "1px solid #262626",
                    borderRadius: "22px",
                    overflow: "hidden",
                    ...fadeInStyle
                }}
            >

            {/* HEADER */}
            <div
                style={{
                    padding: "18px 24px",
                    borderBottom: "1px solid #262626",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#161616"
                }}
            >

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px"
                    }}
                >

                    <div
                        style={{
                            background: typeStyle.background,
                            color: typeStyle.color,
                            padding: "4px 10px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: "700"
                        }}
                    >
                        {typeStyle.label}
                    </div>

                    <div
                        style={{
                            color: "#666",
                            fontSize: "13px"
                        }}
                    >
                        Question #{q.question_id ?? q.id}
                    </div>

                </div>

            </div>

            {/* CONTENT */}
            <div
                style={{
                    padding: "34px"
                }}
            >

                {/* QUESTION */}
                <div
                    style={{
                        fontSize: "34px",
                        lineHeight: 1.35,
                        fontWeight: "700",
                        color: "#f3f3f3",
                        marginBottom: hasQuestionMedia ? "24px" : "0"
                    }}
                >
                    <RichText>{q.question}</RichText>
                </div>

                {/* QUESTION MEDIA */}
                <ReviewMedia
                    media={questionMedia}
                    label="question"
                    style={{ marginTop: "18px", marginBottom: 0 }}
                />

                {/* SHOW ANSWER */}
                {!showAnswer && (
                    <div
                        style={{
                            marginTop: "34px"
                        }}
                    >
                        <button
                            onClick={() => setShowAnswer(true)}
                            style={{
                                background: "#232323",
                                border: "1px solid #333",
                                color: "#eee",
                                padding: "16px 22px",
                                borderRadius: "14px",
                                cursor: "pointer",
                                fontWeight: "600",
                                fontSize: "15px"
                            }}
                        >
                            Voir la réponse
                        </button>
                    </div>
                )}

                {/* ANSWER */}
                {showAnswer && (
                    <div
                        style={{
                            marginTop: "36px",
                            paddingTop: "28px",
                            borderTop: "1px solid #2a2a2a"
                        }}
                    >

                        <div
                            style={{
                                color: "#666",
                                fontSize: "12px",
                                fontWeight: "700",
                                letterSpacing: "0.08em",
                                marginBottom: "12px"
                            }}
                        >
                            ANSWER
                        </div>

                        <div
                            style={{
                                color: "#ddd",
                                fontSize: "26px",
                                lineHeight: 1.5,
                                marginBottom: q.answer_media ? "20px" : "34px"
                            }}
                        >
                            <RichText>{q.answer}</RichText>
                        </div>

                        <ReviewMedia media={q.answer_media} label="réponse" />

                        {showQualityButtons ? (
                            <div
                                ref={answerActionsRef}
                                style={{
                                    display: "flex",
                                    gap: "14px",
                                    flexWrap: "wrap"
                                }}
                            >

                                {gradeOptions.map(option => (
                                    <button
                                        key={option.value}
                                        aria-pressed={displayQuality === option.value}
                                        disabled={isAnswering}
                                        onClick={() => handleAnswer(option.value)}
                                        style={getAnswerButtonStyle(
                                            option,
                                            displayQuality,
                                            isAnswering
                                        )}
                                    >
                                        {option.label}
                                    </button>
                                ))}

                            </div>
                        ) : (
                            <button
                                ref={answerActionsRef}
                                type="button"
                                onClick={() => handleAnswer()}
                                style={{
                                    background: "#233228",
                                    border: "1px solid #385544",
                                    borderRadius: "12px",
                                    color: "#d7f5df",
                                    cursor: "pointer",
                                    fontSize: "15px",
                                    fontWeight: "700",
                                    padding: "14px 18px"
                                }}
                            >
                                Continuer
                            </button>
                        )}

                    </div>
                )}

            </div>

            </div>
        </>
    );
}
