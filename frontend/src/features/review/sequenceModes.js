export const SEQUENCE_MODE_TYPE_POSITION = "type_position";
export const SEQUENCE_MODE_GAP_FILL = "gap_fill";
export const SEQUENCE_MODE_MULTIPLE_CHOICE = "multiple_choice";
export const SEQUENCE_MODE_REORDER = "reorder";
export const SEQUENCE_MODE_RECITE = "recite";

export const SEQUENCE_MODES = [
  SEQUENCE_MODE_TYPE_POSITION,
  SEQUENCE_MODE_GAP_FILL,
  SEQUENCE_MODE_MULTIPLE_CHOICE,
  SEQUENCE_MODE_REORDER,
  SEQUENCE_MODE_RECITE
];

export const defaultSequenceMode = SEQUENCE_MODE_TYPE_POSITION;

export const sequenceModeLabels = {
  [SEQUENCE_MODE_TYPE_POSITION]: "Par rang",
  [SEQUENCE_MODE_GAP_FILL]: "Trous",
  [SEQUENCE_MODE_MULTIPLE_CHOICE]: "QCM",
  [SEQUENCE_MODE_REORDER]: "Remettre en ordre",
  [SEQUENCE_MODE_RECITE]: "Réciter"
};

export const sequenceModeDetails = {
  [SEQUENCE_MODE_TYPE_POSITION]: "Tape l'élément qui occupe chaque rang.",
  [SEQUENCE_MODE_GAP_FILL]: "Complète les trous de la liste affichée.",
  [SEQUENCE_MODE_MULTIPLE_CHOICE]: "Choisis l'élément qui occupe le rang demandé.",
  [SEQUENCE_MODE_REORDER]: "Fais glisser les éléments à leur place.",
  [SEQUENCE_MODE_RECITE]: "Continue la liste jusqu'à ce que tu bloques."
};

// The rail is drawn for every mode except the two that deliberately show no
// context: type_position probes a bare rank (the random-access case), and the
// QCM carries its own options.
export const SEQUENCE_RAIL_MODES = [
  SEQUENCE_MODE_GAP_FILL,
  SEQUENCE_MODE_REORDER,
  SEQUENCE_MODE_RECITE
];

export function normalizeSequenceMode(mode) {
  return SEQUENCE_MODES.includes(mode) ? mode : defaultSequenceMode;
}
