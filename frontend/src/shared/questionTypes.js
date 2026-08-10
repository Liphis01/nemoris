export const questionTypeChipStyles = {
  text: {
    label: "TEXT",
    background: "#163b63",
    color: "#5eb6ff"
  },
  numeric: {
    label: "NUM",
    background: "#423018",
    color: "#f2b56b"
  },
  cloze: {
    label: "CLOZE",
    background: "#402044",
    color: "#f0a6ff"
  },
  grid: {
    label: "GRILLE",
    background: "#163b38",
    color: "#5eead4"
  },
  set: {
    label: "ENSEMBLE",
    background: "#24334c",
    color: "#9ac5ff"
  },
  enumeration: { label: "QUOTA", background: "#4b2d4c", color: "#f3a8ef" },
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

// A pack can span several question types (a playlist mixing a map group with
// text questions); a single question never can. "mixed" lives here rather
// than in questionTypeChipStyles because that map is enumerated to build the
// group-creation chooser, which must not offer it as a group type.
export const packTypeChipStyles = {
  ...questionTypeChipStyles,
  mixed: {
    label: "MIXTE",
    background: "#3a2542",
    color: "#e2a9f3"
  }
};

export function getPackTypeChipStyle(type) {
  return packTypeChipStyles[type] || packTypeChipStyles.text;
}
