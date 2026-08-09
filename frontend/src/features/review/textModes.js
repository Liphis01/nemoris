export const TEXT_MODE_TYPE_ALL = "type_all";
export const TEXT_MODE_MATCH = "match";
export const TEXT_MODE_TYPE_REVERSE = "type_reverse";

export const TEXT_MODES = [
  TEXT_MODE_TYPE_ALL,
  TEXT_MODE_MATCH,
  TEXT_MODE_TYPE_REVERSE
];

export const defaultTextMode = TEXT_MODE_TYPE_ALL;

export const textModeLabels = {
  [TEXT_MODE_TYPE_ALL]: "Tout taper",
  [TEXT_MODE_MATCH]: "Associer",
  [TEXT_MODE_TYPE_REVERSE]: "Inverser"
};

export const textModeDetails = {
  [TEXT_MODE_TYPE_ALL]: "Tape la réponse de chaque élément.",
  [TEXT_MODE_MATCH]: "Relie chaque élément à sa réponse.",
  [TEXT_MODE_TYPE_REVERSE]: "Lis la réponse, puis tape l'indice d'origine."
};

export function normalizeTextMode(mode) {
  return TEXT_MODES.includes(mode) ? mode : defaultTextMode;
}
