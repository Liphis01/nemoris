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
  map: {
    label: "MAP",
    background: "#1f3d2a",
    color: "#75d991"
  }
};

export function getQuestionTypeChipStyle(type) {
  return questionTypeChipStyles[type] || questionTypeChipStyles.text;
}
