import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fadeInStyle } from "../../../shared/styles";
import {
  getMediaKind,
  mediaPoolFrom,
  pickReviewMedia,
  resolveMediaUrl
} from "../../../shared/media";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import {
  matchesTextTrainingAnswer,
  normalizeTextTrainingAnswer,
  textAnswerValues
} from "../textTrainingUtils";


const inputStyle = {
  background: "#101010",
  border: "1px solid #333333",
  borderRadius: "12px",
  boxSizing: "border-box",
  color: "#eeeeee",
  fontSize: "17px",
  fontWeight: 700,
  minHeight: "52px",
  outline: "none",
  padding: "13px 14px",
  width: "100%"
};

const buttonStyle = {
  background: "#232323",
  border: "1px solid #333333",
  borderRadius: "12px",
  color: "#eeeeee",
  cursor: "pointer",
  fontSize: "15px",
  fontWeight: 800,
  padding: "13px 16px"
};

const primaryButtonStyle = {
  ...buttonStyle,
  background: "#233228",
  borderColor: "#385544",
  color: "#d7f5df"
};

// Renders a training item's media by kind. `boxed` frames images in a thumbnail
// (used for the question prompt); the plain form is used inline in the answer
// reveal. Used for both the question media and the answer media.
function TrainingMedia({ media, label = "média", boxed = false, style }) {
  const src = resolveMediaUrl(media);

  if (!src) return null;

  const kind = getMediaKind(media);

  if (kind === "audio") {
    return (
      <audio
        src={src}
        controls
        style={{ ...style, maxWidth: "100%", width: "360px" }}
      />
    );
  }

  if (kind === "video") {
    return (
      <video
        src={src}
        controls
        style={{
          ...style,
          borderRadius: "10px",
          maxHeight: "260px",
          maxWidth: "100%"
        }}
      />
    );
  }

  const image = (
    <img
      src={src}
      alt={label}
      style={{
        borderRadius: "8px",
        display: "block",
        maxHeight: boxed ? "132px" : "180px",
        maxWidth: "100%",
        objectFit: "contain"
      }}
    />
  );

  if (boxed) {
    return (
      <div
        style={{
          ...style,
          alignItems: "center",
          background: "#101010",
          border: "1px solid #262626",
          borderRadius: "12px",
          display: "inline-flex",
          height: "154px",
          justifyContent: "center",
          maxWidth: "260px",
          overflow: "hidden",
          padding: "10px",
          width: "100%"
        }}
      >
        {image}
      </div>
    );
  }

  return <div style={style}>{image}</div>;
}

export default function TextTrainingCard({
  q,
  currentIndex,
  onAnsweringComplete,
  onComplete
}) {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState("idle");
  const missedCompletionSubmittedRef = useRef(false);
  // One image from the question's pool for this presentation; a new card mount
  // re-picks so successive trainings vary the picture.
  const questionMedia = useMemo(
    () => pickReviewMedia(q.question_id ?? q.id, mediaPoolFrom(q)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.question_id ?? q.id]
  );
  const mediaSrc = resolveMediaUrl(questionMedia);
  const typeStyle = getQuestionTypeChipStyle(q.type_q);
  const expectedAnswer = textAnswerValues(q)[0] || "";
  const missed = result === "wrong" || result === "skipped";
  const statusCopy = useMemo(() => {
    if (result === "wrong") return "Réponse incorrecte.";
    if (result === "skipped") return "Question passée.";
    return "";
  }, [result]);

  useEffect(() => {
    setDraft("");
    setResult("idle");
    missedCompletionSubmittedRef.current = false;
  }, [currentIndex, q?.question_id, q?.id]);

  const completeMissed = useCallback(() => {
    if (missedCompletionSubmittedRef.current) return;

    missedCompletionSubmittedRef.current = true;
    onComplete({
      failedQuestionIds: [q.question_id ?? q.id]
    });
  }, [onComplete, q.id, q.question_id]);

  useEffect(() => {
    if (!missed) return undefined;

    function handleKeyDown(event) {
      if (event.key !== "Enter" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      completeMissed();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [completeMissed, missed]);

  function handleSubmit(event) {
    event.preventDefault();

    if (missed) {
      completeMissed();
      return;
    }

    // Whichever branch follows, the user is done answering: a correct answer
    // moves on, the others just reveal the expected one.
    const questionId = q.question_id ?? q.id;

    if (!normalizeTextTrainingAnswer(draft).trim()) {
      onAnsweringComplete?.([questionId]);
      setResult("skipped");
      return;
    }

    if (matchesTextTrainingAnswer(q, draft)) {
      onAnsweringComplete?.([]);
      onComplete({ failedQuestionIds: [] });
      return;
    }

    onAnsweringComplete?.([questionId]);
    setResult("wrong");
  }

  return (
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
      <div
        style={{
          alignItems: "center",
          background: "#161616",
          borderBottom: "1px solid #262626",
          display: "flex",
          justifyContent: "space-between",
          padding: "18px 24px"
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "10px"
          }}
        >
          <div
            style={{
              background: typeStyle.background,
              borderRadius: "999px",
              color: typeStyle.color,
              fontSize: "11px",
              fontWeight: 800,
              padding: "4px 10px"
            }}
          >
            {typeStyle.label}
          </div>
          <div style={{ color: "#666666", fontSize: "13px" }}>
            Question #{q.question_id ?? q.id}
          </div>
        </div>
      </div>

      <div style={{ padding: "34px" }}>
        <div
          style={{
            color: "#f3f3f3",
            fontSize: "34px",
            fontWeight: 800,
            lineHeight: 1.35,
            marginBottom: mediaSrc ? "24px" : "0"
          }}
        >
          {q.question}
        </div>

        <TrainingMedia
          media={questionMedia}
          label="image de la question"
          boxed
          style={{ marginTop: "18px" }}
        />

        <form
          onSubmit={handleSubmit}
          style={{
            borderTop: "1px solid #2a2a2a",
            display: "grid",
            gap: "14px",
            marginTop: "34px",
            paddingTop: "28px"
          }}
        >
          <label
            style={{
              color: "#777777",
              fontSize: "11px",
              fontWeight: 900,
              textTransform: "uppercase"
            }}
          >
            Réponse
          </label>

          <input
            aria-label="Réponse"
            autoComplete="off"
            autoFocus
            disabled={missed}
            onChange={(event) => setDraft(event.target.value)}
            style={{
              ...inputStyle,
              borderColor: missed ? "#4a3030" : "#333333"
            }}
            value={draft}
          />

          {missed && (
            <div
              role="status"
              style={{
                background: "#141414",
                border: "1px solid #303030",
                borderLeft: "4px solid #ffcc7a",
                borderRadius: "8px",
                color: "#dddddd",
                display: "grid",
                gap: "8px",
                padding: "13px 14px"
              }}
            >
              <strong style={{ color: "#ffcc7a" }}>{statusCopy}</strong>
              <span>{expectedAnswer}</span>
              <TrainingMedia
                media={q.answer_media}
                label="image de la réponse"
                style={{ marginTop: "4px" }}
              />
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px"
            }}
          >
            <button
              type="submit"
              style={primaryButtonStyle}
            >
              {missed ? "Continuer" : "Valider"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
