export function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return null;

  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} Ko`
    : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
