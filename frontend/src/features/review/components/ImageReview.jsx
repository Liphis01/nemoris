import { resolveMediaUrl } from "../../../shared/media";
import { fadeInStyle } from "../../../shared/styles";
import { useImageReview } from "../hooks/useImageReview";

const qualityOptions = [
  { value: 0, label: "0 · Faux", background: "#3a1f24", color: "#ff9aa5" },
  { value: 1, label: "1 · Dur", background: "#35311f", color: "#ffd36b" },
  { value: 2, label: "2 · Bon", background: "#1f2f3a", color: "#8fc7ff" },
  { value: 3, label: "3 · Facile", background: "#1d3a2b", color: "#7ee2a8" }
];

const buttonStyle = {
  border: "1px solid #333",
  borderRadius: "10px",
  background: "#232323",
  color: "#eee",
  cursor: "pointer",
  fontWeight: 700,
  padding: "12px 16px"
};

const inputStyle = {
  width: "100%",
  padding: "14px 16px",
  background: "#101010",
  color: "#eee",
  border: "1px solid #2d2d2d",
  borderRadius: "12px",
  boxSizing: "border-box",
  outline: "none",
  fontSize: "15px"
};

function QualityButton({ option, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: selected ? `1px solid ${option.color}` : "1px solid transparent",
        borderRadius: "10px",
        background: option.background,
        color: option.color,
        cursor: "pointer",
        fontWeight: 800,
        padding: "10px 12px"
      }}
    >
      {option.label}
    </button>
  );
}

export default function ImageReview({ group, reviewItems, onComplete }) {
  const {
    activeIndex,
    activeItem,
    answeredCount,
    feedbackTone,
    finishReview,
    handleSubmit,
    input,
    progressPercent,
    recapRows,
    remainingCount,
    sendResult,
    setInput,
    setQuality,
    showRecap,
    skipItem
  } = useImageReview(reviewItems, onComplete);

  if (!activeItem && !showRecap) {
    return null;
  }

  if (showRecap) {
    return (
      <div
        style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: "18px",
          overflow: "hidden",
          ...fadeInStyle
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: "1px solid #262626",
            display: "flex",
            justifyContent: "space-between",
            padding: "22px 24px"
          }}
        >
          <div>
            <div style={{ color: "#f0c36a", fontSize: "12px", fontWeight: 800 }}>
              IMAGE RESULT
            </div>
            <div style={{ color: "#f3f3f3", fontSize: "26px", fontWeight: 800, marginTop: "8px" }}>
              {group.name || "Images"}
            </div>
          </div>
          <button
            type="button"
            onClick={sendResult}
            style={{
              ...buttonStyle,
              background: "#1d3a29",
              border: "1px solid #2c5c3e",
              color: "#7ee2a8"
            }}
          >
            Valider
          </button>
        </div>

        <div
          className="app-scrollbar"
          style={{
            display: "grid",
            gap: "10px",
            maxHeight: "62vh",
            overflow: "auto",
            padding: "18px"
          }}
        >
          {recapRows.map(({ item, quality, isFailed }) => {
            const mediaSrc = resolveMediaUrl(item.media);

            return (
              <div
                key={item.question_id}
                style={{
                  alignItems: "center",
                  background: isFailed ? "#211719" : "#171717",
                  border: isFailed ? "1px solid #5f2930" : "1px solid #292929",
                  borderRadius: "10px",
                  display: "grid",
                  gap: "12px",
                  gridTemplateColumns: "72px minmax(0, 1fr) auto",
                  padding: "10px"
                }}
              >
                {mediaSrc ? (
                  <img
                    src={mediaSrc}
                    alt={item.label || item.answer || "image"}
                    style={{
                      border: "1px solid #333",
                      borderRadius: "8px",
                      height: "48px",
                      objectFit: "contain",
                      width: "68px"
                    }}
                  />
                ) : (
                  <div
                    style={{
                      alignItems: "center",
                      border: "1px solid #333",
                      borderRadius: "8px",
                      color: "#666",
                      display: "flex",
                      height: "48px",
                      justifyContent: "center",
                      width: "68px"
                    }}
                  >
                    image
                  </div>
                )}

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: "#eee",
                      fontWeight: 800,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {item.label || item.answer || "Image"}
                  </div>
                  <div style={{ color: isFailed ? "#ff9aa5" : "#777", fontSize: "12px", marginTop: "4px" }}>
                    {isFailed ? "A revoir" : "Réussi"}
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "flex-end" }}>
                  {qualityOptions.map(option => (
                    <QualityButton
                      key={option.value}
                      option={option}
                      selected={quality === option.value}
                      onClick={() => setQuality(item.question_id, option.value)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const mediaSrc = resolveMediaUrl(activeItem.media);

  return (
    <div
      style={{
        background: "#1a1a1a",
        border: "1px solid #2a2a2a",
        borderRadius: "18px",
        overflow: "hidden",
        ...fadeInStyle
      }}
    >
      <div
        style={{
          borderBottom: "1px solid #262626",
          padding: "22px 24px 18px"
        }}
      >
        <div
          style={{
            alignItems: "flex-start",
            display: "flex",
            gap: "20px",
            justifyContent: "space-between",
            marginBottom: "16px"
          }}
        >
          <div>
            <div style={{ color: "#f0c36a", fontSize: "12px", fontWeight: 800 }}>
              IMAGE
            </div>
            <div style={{ color: "#f3f3f3", fontSize: "28px", fontWeight: 800, marginTop: "12px" }}>
              {group.name || "Images"}
            </div>
          </div>

          <div style={{ color: "#fff", fontSize: "28px", fontWeight: 800, textAlign: "right" }}>
            {answeredCount}
            <span style={{ color: "#666", fontSize: "18px", marginLeft: "4px" }}>
              / {reviewItems.length}
            </span>
          </div>
        </div>

        <div
          style={{
            background: "#111",
            border: "1px solid #2a2a2a",
            borderRadius: "999px",
            height: "10px",
            overflow: "hidden"
          }}
        >
          <div
            style={{
              background: "linear-gradient(90deg, #f0c36a, #8fc7ff)",
              height: "100%",
              transition: "width 0.2s ease",
              width: `${progressPercent}%`
            }}
          />
        </div>

        <div style={{ color: "#777", display: "flex", fontSize: "12px", justifyContent: "space-between", marginTop: "8px" }}>
          <span>{remainingCount} restantes</span>
          <span>{activeIndex + 1} / {reviewItems.length}</span>
        </div>
      </div>

      <div style={{ padding: "24px" }}>
        <div
          style={{
            alignItems: "center",
            background: "#101010",
            border: "1px solid #292929",
            borderRadius: "14px",
            display: "flex",
            justifyContent: "center",
            minHeight: "320px",
            overflow: "hidden",
            padding: "18px"
          }}
        >
          {mediaSrc ? (
            <img
              src={mediaSrc}
              alt="question"
              style={{
                maxHeight: "52vh",
                maxWidth: "100%",
                objectFit: "contain"
              }}
            />
          ) : (
            <div style={{ color: "#666" }}>Image manquante</div>
          )}
        </div>

        <div style={{ marginTop: "22px" }}>
          <input
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSubmit();
              }
            }}
            placeholder="Tape la réponse..."
            style={{
              ...inputStyle,
              border: feedbackTone === "incorrect"
                ? "1px solid rgba(248, 113, 113, 0.9)"
                : feedbackTone === "correct"
                  ? "1px solid rgba(134, 239, 172, 0.85)"
                  : inputStyle.border
            }}
          />
        </div>

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            justifyContent: "space-between",
            marginTop: "18px"
          }}
        >
          <div
            style={{
              color: feedbackTone === "incorrect"
                ? "#fca5a5"
                : feedbackTone === "correct"
                  ? "#86efac"
                  : "#777",
              fontSize: "13px"
            }}
          >
            {feedbackTone === "incorrect"
              ? "Réponse incorrecte."
              : feedbackTone === "correct"
                ? "Bonne réponse."
                : " "}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button type="button" onClick={skipItem} style={buttonStyle}>
              Passer
            </button>
            <button type="button" onClick={finishReview} style={buttonStyle}>
              Terminer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
