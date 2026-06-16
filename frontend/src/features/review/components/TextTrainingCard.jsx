import { useEffect, useMemo, useState } from "react";
import { fadeInStyle } from "../../../shared/styles";
import { resolveMediaUrl } from "../../../shared/media";
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

export default function TextTrainingCard({
  q,
  currentIndex,
  onComplete
}) {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState("idle");
  const mediaSrc = resolveMediaUrl(q.media);
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
  }, [currentIndex, q?.question_id, q?.id]);

  function completeMissed() {
    onComplete({
      failedQuestionIds: [q.question_id ?? q.id]
    });
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (missed) {
      completeMissed();
      return;
    }

    if (!normalizeTextTrainingAnswer(draft).trim()) {
      setResult("skipped");
      return;
    }

    if (matchesTextTrainingAnswer(q, draft)) {
      onComplete({ failedQuestionIds: [] });
      return;
    }

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

        {mediaSrc && (
          <div
            style={{
              alignItems: "center",
              background: "#101010",
              border: "1px solid #262626",
              borderRadius: "12px",
              display: "inline-flex",
              height: "154px",
              justifyContent: "center",
              marginTop: "18px",
              maxWidth: "260px",
              overflow: "hidden",
              padding: "10px",
              width: "100%"
            }}
          >
            <img
              src={mediaSrc}
              alt="question"
              style={{
                borderRadius: "8px",
                display: "block",
                maxHeight: "132px",
                maxWidth: "100%",
                objectFit: "contain"
              }}
            />
          </div>
        )}

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
