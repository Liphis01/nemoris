export const questionTypeChipStyles = {
  text: {
    label: "TEXT",
    background: "#163b63",
    color: "#5eb6ff"
  },
  timeline: {
    label: "TIMELINE",
    background: "#2b2047",
    color: "#c4b5fd"
  },
  media: {
    label: "MÉDIA",
    background: "#3d2f1f",
    color: "#f0c36a"
  },
  map: {
    label: "MAP",
    background: "#1f3d2a",
    color: "#75d991"
  },
  sequence: {
    label: "SÉQUENCE",
    background: "#123a3a",
    color: "#5eead4"
  }
};

export function getQuestionTypeChipStyle(type) {
  return questionTypeChipStyles[type] || questionTypeChipStyles.text;
}
