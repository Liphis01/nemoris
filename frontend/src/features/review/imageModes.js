export const IMAGE_MODE_TYPE_ALL = "type_all";
export const IMAGE_MODE_TYPE_PROMPT = "type_prompt";
export const IMAGE_MODE_MULTIPLE_CHOICE_LABEL = "multiple_choice_label";
export const IMAGE_MODE_MULTIPLE_CHOICE_MEDIA = "multiple_choice_media";
export const LEGACY_IMAGE_MODE_MULTIPLE_CHOICE_IMAGE = "multiple_choice_image";
export const IMAGE_MODE_MULTIPLE_CHOICE_IMAGE = IMAGE_MODE_MULTIPLE_CHOICE_MEDIA;

export const IMAGE_MODES = [
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_MULTIPLE_CHOICE_MEDIA
];

export const defaultImageMode = IMAGE_MODE_TYPE_PROMPT;

export const imageModeLabels = {
  [IMAGE_MODE_TYPE_ALL]: "Tout taper",
  [IMAGE_MODE_TYPE_PROMPT]: "Nommer",
  [IMAGE_MODE_MULTIPLE_CHOICE_LABEL]: "QCM noms",
  [IMAGE_MODE_MULTIPLE_CHOICE_MEDIA]: "QCM médias"
};

export const imageModeDetails = {
  [IMAGE_MODE_TYPE_ALL]: "Tape tous les médias dans l'ordre que tu veux.",
  [IMAGE_MODE_TYPE_PROMPT]: "Consulte le média surligné, puis tape son nom.",
  [IMAGE_MODE_MULTIPLE_CHOICE_LABEL]: "Consulte le média, puis choisis son nom.",
  [IMAGE_MODE_MULTIPLE_CHOICE_MEDIA]: "Lis le nom, puis choisis le bon média."
};

export function normalizeImageMode(mode) {
  if (mode === LEGACY_IMAGE_MODE_MULTIPLE_CHOICE_IMAGE) {
    return IMAGE_MODE_MULTIPLE_CHOICE_MEDIA;
  }

  return IMAGE_MODES.includes(mode) ? mode : defaultImageMode;
}


export function normalizeImageModeForItemCount(mode, itemCount) {
  const normalizedMode = normalizeImageMode(mode);
  const count = Number(itemCount);

  if (
    Number.isFinite(count) &&
    count <= 1 &&
    normalizedMode === IMAGE_MODE_TYPE_ALL
  ) {
    return IMAGE_MODE_TYPE_PROMPT;
  }

  return normalizedMode;
}


export function imageModesForItemCount(itemCount, modes = IMAGE_MODES) {
  const count = Number(itemCount);

  if (!Number.isFinite(count) || count > 1) {
    return modes;
  }

  return modes.filter(mode => mode !== IMAGE_MODE_TYPE_ALL);
}
