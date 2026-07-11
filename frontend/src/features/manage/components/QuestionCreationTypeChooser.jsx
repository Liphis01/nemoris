import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import { buttonStyle, panelStyle } from "./QuestionEditorStyles";

const questionCreationTypes = [
  {
    value: "text",
    label: "Question texte",
    detail: "Question et réponse libre"
  },
  {
    value: "timeline",
    label: "Événement timeline",
    detail: "Date ponctuelle ou intervalle"
  },
  {
    value: "map",
    label: "Carte",
    detail: "Créer un groupe map et ses zones"
  },
  {
    value: "media",
    label: "Groupe média",
    detail: "Créer un groupe d'images, audio ou vidéo"
  },
  {
    value: "text_group",
    label: "Groupe texte",
    detail: "Créer un groupe d'associations texte↔texte"
  }
];

export default function QuestionCreationTypeChooser({ onSelect, onCancel }) {
  return (
    <div style={panelStyle}>
      <div style={{ marginBottom: "22px", color: "#888" }}>
        Nouvelle question
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginBottom: "22px"
        }}
      >
        {questionCreationTypes.map((type) => {
          const typeStyle = getQuestionTypeChipStyle(type.value);

          return (
            <button
              key={type.value}
              type="button"
              onClick={() => onSelect?.(type.value)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "18px",
                width: "100%",
                padding: "16px",
                borderRadius: "8px",
                border: `1px solid ${typeStyle.color}`,
                background: typeStyle.background,
                color: typeStyle.color,
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    color: typeStyle.color,
                    fontSize: "16px",
                    fontWeight: "800",
                    marginBottom: "5px"
                  }}
                >
                  {type.label}
                </span>
                <span
                  style={{
                    display: "block",
                    color: typeStyle.color,
                    fontSize: "13px",
                    lineHeight: 1.35
                  }}
                >
                  {type.detail}
                </span>
              </span>
              <span
                aria-hidden="true"
                style={{
                  color: typeStyle.color,
                  fontSize: "22px",
                  lineHeight: 1,
                  flexShrink: 0
                }}
              >
                →
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onCancel}
        style={{ ...buttonStyle, background: "#641c1c", marginRight: "12px" }}
      >
        Annuler
      </button>
    </div>
  );
}
