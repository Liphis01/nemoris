export function formatDuration(ms) {
  const value = Number(ms);

  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }

  const totalSeconds = Math.max(1, Math.round(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  return `${seconds}s`;
}


export function formatPercent(found, total) {
  const foundValue = Number(found);
  const totalValue = Number(total);

  if (
    !Number.isFinite(foundValue) ||
    !Number.isFinite(totalValue) ||
    totalValue <= 0
  ) {
    return "—";
  }

  return `${Math.round((foundValue / totalValue) * 100)}%`;
}


export function formatRecordPercent(record) {
  const percent = Number(record?.best_found_percent);

  if (!Number.isFinite(percent)) {
    return "—";
  }

  return `${Math.round(percent)}%`;
}
