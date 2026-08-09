import {
  answerPolicyForPreset
} from "../../review/answerPolicy";
import { policyPresetValue } from "./answerPolicyControlUtils";

const controlStyle = {
  alignItems: "center",
  display: "flex",
  gap: "8px",
  minWidth: 0
};

const labelStyle = {
  color: "#888",
  fontSize: "12px",
  fontWeight: 700
};

const selectStyle = {
  background: "#111",
  border: "1px solid #333",
  borderRadius: "8px",
  color: "#eee",
  fontSize: "13px",
  padding: "8px 10px"
};

export default function AnswerPolicyControl({
  policy,
  onChange,
  label = "Réponses"
}) {
  const value = policyPresetValue(policy);

  return (
    <label style={controlStyle}>
      <span style={labelStyle}>{label}</span>
      <select
        aria-label="Politique de réponse"
        onChange={event => onChange?.(answerPolicyForPreset(event.target.value))}
        style={selectStyle}
        value={value}
      >
        <option value="relaxed">Souple</option>
        <option value="exact">Orthographe exacte</option>
      </select>
    </label>
  );
}
