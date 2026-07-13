export const SEQUENCE_MODE_TYPE_POSITION = "type_position";
export const SEQUENCE_MODE_NEXT_IN_SEQUENCE = "next_in_sequence";
export const SEQUENCE_MODE_MULTIPLE_CHOICE = "multiple_choice";
export const SEQUENCE_MODE_REORDER = "reorder";

export const SEQUENCE_MODES = [
  SEQUENCE_MODE_TYPE_POSITION,
  SEQUENCE_MODE_NEXT_IN_SEQUENCE,
  SEQUENCE_MODE_MULTIPLE_CHOICE,
  SEQUENCE_MODE_REORDER
];

export const defaultSequenceMode = SEQUENCE_MODE_TYPE_POSITION;

export const sequenceModeLabels = {
  [SEQUENCE_MODE_TYPE_POSITION]: "Par rang",
  [SEQUENCE_MODE_NEXT_IN_SEQUENCE]: "Suivant",
  [SEQUENCE_MODE_MULTIPLE_CHOICE]: "QCM",
  [SEQUENCE_MODE_REORDER]: "Remettre en ordre"
};

export const sequenceModeDetails = {
  [SEQUENCE_MODE_TYPE_POSITION]: "Tape l'élément qui occupe chaque rang.",
  [SEQUENCE_MODE_NEXT_IN_SEQUENCE]: "Tape l'élément qui suit celui affiché.",
  [SEQUENCE_MODE_MULTIPLE_CHOICE]: "Choisis l'élément qui occupe le rang demandé.",
  [SEQUENCE_MODE_REORDER]: "Fais glisser les éléments à leur place."
};

export function normalizeSequenceMode(mode) {
  return SEQUENCE_MODES.includes(mode) ? mode : defaultSequenceMode;
}
