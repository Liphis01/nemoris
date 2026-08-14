import {
  creationIntentOptions,
  getQuestionTypeChipStyle
} from "../../../shared/questionTypes";
import { buttonStyle, panelStyle } from "./QuestionEditorStyles";

export default function CreationIntentChooser({ onSelect, onCancel }) {
  return (
    <div className="app-scrollbar" style={panelStyle}>
      <div style={{ marginBottom: "22px", color: "#888" }}>
        Nouveau contenu
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginBottom: "22px"
        }}
      >
        {creationIntentOptions.map((intent) => {
          const typeStyle = getQuestionTypeChipStyle(intent.value);

          return (
            <button
              key={`${intent.kind}:${intent.value}`}
              type="button"
              onClick={() => onSelect?.(intent)}
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
                  {intent.label}
                </span>
                <span
                  style={{
                    color: typeStyle.color,
                    display: "block",
                    fontSize: "13px",
                    lineHeight: 1.35
                  }}
                >
                  {intent.detail}
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
