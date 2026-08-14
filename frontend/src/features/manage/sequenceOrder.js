// Client-side twin of services/sequence_order.py. The server is the authority --
// it recomputes every rank on save -- so this only has to agree well enough to
// preview the order the author is about to get.

export function normalizeOrder(order) {
  // Absent means manual, matching the backend, so every existing group keeps
  // working with no migration.
  return {
    mode: order?.mode === "derived" ? "derived" : "manual",
    kind: order?.kind === "number" ? "number" : "date",
    label: order?.label || ""
  };
}

export function normalizeReviewGoal(value) {
  return ["recitation", "random_access"].includes(value) ? value : "auto";
}

export function resolvedReviewGoal(value, order) {
  const normalized = normalizeReviewGoal(value);

  if (normalized !== "auto") return normalized;

  return normalizeOrder(order).mode === "derived"
    ? "random_access"
    : "recitation";
}

export function orderValueText(value, kind) {
  if (value === null || value === undefined) return "";
  if (kind === "number") return String(value);

  return value?.year === null || value?.year === undefined
    ? ""
    : String(value.year);
}

export function parseOrderValue(text, kind) {
  const trimmed = String(text ?? "").trim();

  if (!trimmed) return null;

  if (kind === "number") {
    const parsed = Number(trimmed);

    return Number.isFinite(parsed) ? parsed : null;
  }

  const year = Number.parseInt(trimmed, 10);

  // Year precision only for now: it is what dynasties and discographies need,
  // and it stores the timeline date shape so a finer editor can drop in later
  // without changing what is written.
  return Number.isFinite(year)
    ? { year, month: null, day: null, precision: "year" }
    : null;
}

export function sortableOrderValue(item, kind) {
  const value = item?.data?.order_value;

  if (value === null || value === undefined) return null;

  if (kind === "number") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return Number.isFinite(value?.year) && Number(value.year) !== 0 ? value.year : null;
}
