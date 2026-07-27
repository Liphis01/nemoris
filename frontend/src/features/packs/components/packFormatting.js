export function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return null;

  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} Ko`
    : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function formatRatingLabel(avgRating, ratingCount) {
  if (!ratingCount) return null;

  return `★ ${avgRating.toFixed(1)} (${ratingCount})`;
}

export function questionCountLabel(count) {
  if (count === null || count === undefined) {
    return "questions";
  }

  return `${count} question${count > 1 ? "s" : ""}`;
}

export function splitTerms(value) {
  const seen = new Set();
  const terms = [];

  String(value || "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
    .forEach((term) => {
      const key = term.toLocaleLowerCase("fr-FR");

      if (!seen.has(key)) {
        seen.add(key);
        terms.push(term);
      }
    });

  return terms;
}
