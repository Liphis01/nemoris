export function normalizeTextTrainingAnswer(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/[-\s]+/g, " ");
}


export function textAnswerValues(question) {
  return [
    question?.answer,
    ...(question?.aliases || question?.data?.aliases || [])
  ].filter(Boolean);
}


export function matchesTextTrainingAnswer(question, value) {
  const normalized = normalizeTextTrainingAnswer(value);

  if (!normalized) return false;

  return textAnswerValues(question).some(answer =>
    normalizeTextTrainingAnswer(answer) === normalized
  );
}
