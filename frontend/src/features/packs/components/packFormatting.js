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
