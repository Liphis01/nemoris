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

export const standaloneQuestionTypeOptions = [
  { value: "text", label: "Texte" },
  { value: "numeric", label: "Numérique" },
  { value: "enumeration", label: "Énumération" },
  { value: "timeline", label: "Timeline" }
];

export const groupedQuestionTypeOptions = [
  { value: "map", label: "Carte" },
  { value: "media", label: "Média" },
  { value: "text", label: "Texte groupé" },
  { value: "cloze", label: "Texte à trous" },
  { value: "grid", label: "Grille" },
  { value: "set", label: "Ensemble" },
  { value: "sequence", label: "Séquence" }
];

export const questionTypeFilterOptions = [
  { value: "", label: "Tous les types" },
  ...standaloneQuestionTypeOptions,
  { value: "map", label: "Carte" },
  { value: "media", label: "Média" },
  { value: "cloze", label: "Cloze" },
  { value: "grid", label: "Grille" },
  { value: "set", label: "Ensemble" },
  { value: "sequence", label: "Séquence" }
];

export const groupTypeFilterOptions = [
  { value: "", label: "Tous les types" },
  ...groupedQuestionTypeOptions
];

export const creationIntentOptions = [
  { kind: "question", value: "text", label: "Carte simple", detail: "Question et réponse libre" },
  { kind: "question", value: "numeric", label: "Valeur numérique", detail: "Nombre, unité et tolérance" },
  { kind: "question", value: "enumeration", label: "Quota de réponses", detail: "Produire au moins k réponses parmi une liste" },
  { kind: "question", value: "timeline", label: "Événement daté", detail: "Date ponctuelle ou intervalle" },
  { kind: "group", value: "map", label: "Carte visuelle", detail: "Carte SVG et zones associées" },
  { kind: "group", value: "media", label: "Médias à reconnaître", detail: "Images, audio ou vidéo à réviser" },
  { kind: "group", value: "text", label: "Paquets de texte", detail: "Associations texte↔texte révisées ensemble" },
  { kind: "group", value: "cloze", label: "Note à trous", detail: "Une note dont chaque trou devient une carte" },
  { kind: "group", value: "grid", label: "Tableau ou grille", detail: "Lignes, colonnes et cellules à retrouver" },
  { kind: "group", value: "set", label: "Ensemble de membres", detail: "Membres à rappeler sans ordre" },
  { kind: "group", value: "sequence", label: "Liste ordonnée", detail: "Éléments dont l'ordre compte" }
];

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
