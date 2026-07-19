export const IMAGE_MODE_TYPE_ALL = "type_all";
export const IMAGE_MODE_TYPE_PROMPT = "type_prompt";
export const IMAGE_MODE_MULTIPLE_CHOICE_LABEL = "multiple_choice_label";
export const IMAGE_MODE_MULTIPLE_CHOICE_IMAGE = "multiple_choice_image";

export const IMAGE_MODES = [
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
];

export const defaultImageMode = IMAGE_MODE_TYPE_PROMPT;

export const imageModeLabels = {
  [IMAGE_MODE_TYPE_ALL]: "Tout taper",
  [IMAGE_MODE_TYPE_PROMPT]: "Nommer",
  [IMAGE_MODE_MULTIPLE_CHOICE_LABEL]: "QCM noms",
  [IMAGE_MODE_MULTIPLE_CHOICE_IMAGE]: "QCM médias"
};

export const imageModeDetails = {
  [IMAGE_MODE_TYPE_ALL]: "Tape tous les médias dans l'ordre que tu veux.",
  [IMAGE_MODE_TYPE_PROMPT]: "Consulte le média surligné, puis tape son nom.",
  [IMAGE_MODE_MULTIPLE_CHOICE_LABEL]: "Consulte le média, puis choisis son nom.",
  [IMAGE_MODE_MULTIPLE_CHOICE_IMAGE]: "Lis le nom, puis choisis le bon média."
};

export function normalizeImageMode(mode) {
  return IMAGE_MODES.includes(mode) ? mode : defaultImageMode;
}
