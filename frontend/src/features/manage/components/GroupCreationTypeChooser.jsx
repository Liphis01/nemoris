import { questionTypeChipStyles } from "../../../shared/questionTypes";
import { buttonStyle, panelStyle } from "./QuestionEditorStyles";

const groupCreationTypes = [
  {
    value: "map",
    label: "Groupe carte",
    detail: "Carte SVG et zones associées"
  },
  {
    value: "image",
    label: "Groupe d'images",
    detail: "Images avec réponses indépendantes"
  }
];

export default function GroupCreationTypeChooser({ onSelect, onCancel }) {
  return (
    <div style={panelStyle}>
      <div style={{ marginBottom: "22px", color: "#888" }}>
        Nouveau groupe
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginBottom: "22px"
        }}
      >
        {groupCreationTypes.map((type) => {
          const typeStyle = questionTypeChipStyles[type.value];

          return (
            <button
              key={type.value}
              type="button"
              onClick={() => onSelect?.(type.value)}
              style={{
                alignItems: "center",
                background: typeStyle.background,
                border: `1px solid ${typeStyle.color}`,
                borderRadius: "8px",
                color: typeStyle.color,
                cursor: "pointer",
                display: "flex",
                gap: "18px",
                justifyContent: "space-between",
                padding: "16px",
                textAlign: "left",
                width: "100%"
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    color: typeStyle.color,
                    display: "block",
                    fontSize: "16px",
                    fontWeight: "800",
                    marginBottom: "5px"
                  }}
                >
                  {type.label}
                </span>
                <span
                  style={{
                    color: typeStyle.color,
                    display: "block",
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
                  flexShrink: 0,
                  fontSize: "22px",
                  lineHeight: 1
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
