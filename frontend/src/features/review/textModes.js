export const TEXT_MODE_TYPE_ALL = "type_all";
export const TEXT_MODE_MATCH = "match";

export const TEXT_MODES = [
  TEXT_MODE_TYPE_ALL,
  TEXT_MODE_MATCH
];

export const defaultTextMode = TEXT_MODE_TYPE_ALL;

export const textModeLabels = {
  [TEXT_MODE_TYPE_ALL]: "Tout taper",
  [TEXT_MODE_MATCH]: "Associer"
};

export const textModeDetails = {
  [TEXT_MODE_TYPE_ALL]: "Tape la réponse de chaque élément.",
  [TEXT_MODE_MATCH]: "Relie chaque élément à sa réponse."
};

export function normalizeTextMode(mode) {
  return TEXT_MODES.includes(mode) ? mode : defaultTextMode;
}
