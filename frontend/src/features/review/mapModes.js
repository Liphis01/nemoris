export const MAP_MODE_TYPE_ALL = "type_all";
export const MAP_MODE_CLICK_PROMPT = "click_prompt";
export const MAP_MODE_TYPE_PROMPT = "type_prompt";
export const MAP_MODE_MULTIPLE_CHOICE = "multiple_choice";

export const MAP_MODES = [
  MAP_MODE_TYPE_ALL,
  MAP_MODE_TYPE_PROMPT,
  MAP_MODE_CLICK_PROMPT,
  MAP_MODE_MULTIPLE_CHOICE
];

export const defaultMapMode = MAP_MODE_TYPE_ALL;

export const mapModeLabels = {
  [MAP_MODE_TYPE_ALL]: "Tout taper",
  [MAP_MODE_CLICK_PROMPT]: "Cliquer",
  [MAP_MODE_TYPE_PROMPT]: "Nommer",
  [MAP_MODE_MULTIPLE_CHOICE]: "QCM"
};

export const mapModeDetails = {
  [MAP_MODE_TYPE_ALL]: "Tape toutes les zones dans l'ordre que tu veux.",
  [MAP_MODE_CLICK_PROMPT]: "Lis le nom, puis clique la bonne zone.",
  [MAP_MODE_TYPE_PROMPT]: "Regarde la zone surlignée, puis tape son nom.",
  [MAP_MODE_MULTIPLE_CHOICE]: "Regarde la zone surlignée, puis choisis le nom."
};

export function normalizeMapMode(mode) {
  return MAP_MODES.includes(mode) ? mode : defaultMapMode;
}
