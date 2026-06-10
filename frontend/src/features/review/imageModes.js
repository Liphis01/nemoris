export const IMAGE_MODE_TYPE_ALL = "type_all";
export const IMAGE_MODE_CLICK_PROMPT = "click_prompt";
export const IMAGE_MODE_TYPE_PROMPT = "type_prompt";
export const IMAGE_MODE_MULTIPLE_CHOICE_LABEL = "multiple_choice_label";
export const IMAGE_MODE_MULTIPLE_CHOICE_IMAGE = "multiple_choice_image";

export const IMAGE_MODES = [
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_CLICK_PROMPT,
  IMAGE_MODE_TYPE_PROMPT,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
];

export const defaultImageMode = IMAGE_MODE_TYPE_PROMPT;

export const imageModeLabels = {
  [IMAGE_MODE_TYPE_ALL]: "Tout taper",
  [IMAGE_MODE_CLICK_PROMPT]: "Cliquer image",
  [IMAGE_MODE_TYPE_PROMPT]: "Nommer",
  [IMAGE_MODE_MULTIPLE_CHOICE_LABEL]: "QCM noms",
  [IMAGE_MODE_MULTIPLE_CHOICE_IMAGE]: "QCM images"
};

export const imageModeDetails = {
  [IMAGE_MODE_TYPE_ALL]: "Tape toutes les images dans l'ordre que tu veux.",
  [IMAGE_MODE_CLICK_PROMPT]: "Lis le nom, puis clique la bonne image.",
  [IMAGE_MODE_TYPE_PROMPT]: "Regarde l'image surlignée, puis tape son nom.",
  [IMAGE_MODE_MULTIPLE_CHOICE_LABEL]: "Regarde l'image, puis choisis son nom.",
  [IMAGE_MODE_MULTIPLE_CHOICE_IMAGE]: "Lis le nom, puis choisis la bonne image."
};

export function normalizeImageMode(mode) {
  return IMAGE_MODES.includes(mode) ? mode : defaultImageMode;
}
