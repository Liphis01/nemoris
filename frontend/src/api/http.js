import { apiUrl } from "./config";


export const COLLECTION_MUTATION_EVENT = "nemoris:collection-mutated";

const collectionMutationRules = [
  ["POST", /^\/questions\/?$/],
  ["POST", /^\/questions\/bulk\/?$/],
  ["PUT", /^\/questions\/\d+\/?$/],
  ["DELETE", /^\/questions\/\d+\/?$/],
  ["PUT", /^\/questions\/\d+\/collections\/?$/],
  ["DELETE", /^\/questions\/\d+\/image\/?$/],
  ["POST", /^\/groups\/?$/],
  ["PUT", /^\/groups\/\d+\/?$/],
  ["DELETE", /^\/groups\/\d+\/?$/],
  ["POST", /^\/collections\/?$/],
  ["PUT", /^\/collections\/\d+\/?$/],
  ["DELETE", /^\/collections\/\d+\/?$/],
  ["PUT", /^\/tags\/hierarchy\/?$/],
  ["POST", /^\/tags\/actions\/?$/],
  ["POST", /^\/tags\/inbox\/resolve\/?$/],
  ["POST", /^\/tags\/conflicts\/resolve\/?$/],
  ["POST", /^\/upload\/?$/],
  ["POST", /^\/upload\/url\/?$/],
  ["PATCH", /^\/maps\/\d+\/zones\/?$/],
  ["POST", /^\/map-imports\/[^/]+\/commit\/?$/],
  ["PATCH", /^\/media-groups\/\d+\/items\/?$/],
  ["POST", /^\/media-groups\/\d+\/upload\/?$/],
  ["POST", /^\/media-groups\/\d+\/upload\/url\/?$/],
  ["PATCH", /^\/text-groups\/\d+\/items\/?$/],
  ["PATCH", /^\/sequence-groups\/\d+\/items\/?$/],
  ["PUT", /^\/review\/settings\/?$/],
  ["POST", /^\/answer\/?$/],
  ["POST", /^\/answer\/revise\/?$/],
  ["POST", /^\/answer\/relearning_graduate\/?$/],
  ["POST", /^\/answer_map\/?$/],
  ["POST", /^\/answer_media\/?$/],
  ["POST", /^\/answer_text\/?$/],
  ["POST", /^\/answer_timeline\/?$/],
  ["POST", /^\/answer_sequence\/?$/],
  ["POST", /^\/backup\/import\/?$/],
  ["POST", /^\/packs\/import\/?$/],
  ["POST", /^\/blueprints\/import\/?$/],
  ["POST", /^\/packs\/update\/?$/],
  ["POST", /^\/blueprints\/update\/?$/],
  ["POST", /^\/packs\/[^/]+\/unsubscribe\/?$/],
  ["POST", /^\/blueprints\/[^/]+\/unsubscribe\/?$/]
];


function isCollectionMutation(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const normalizedPath = String(path || "").split("?", 1)[0].replace(/\/+$/, "") || "/";

  if (normalizedPath.startsWith("/sync")) {
    return false;
  }

  return collectionMutationRules.some(([ruleMethod, pattern]) =>
    ruleMethod === method && pattern.test(normalizedPath)
  );
}


function notifyCollectionMutation(path, options) {
  if (
    typeof window === "undefined" ||
    !isCollectionMutation(path, options)
  ) {
    return;
  }

  window.dispatchEvent(new CustomEvent(COLLECTION_MUTATION_EVENT, {
    detail: {
      path,
      method: String(options.method || "GET").toUpperCase()
    }
  }));
}


export async function requestJson(path, options = {}) {
  const response = await fetch(apiUrl(path), options);

  if (!response.ok) {
    // FastAPI usually returns {detail}; a few legacy endpoints return {error}.
    // Normalize both into one thrown Error for hooks/components.
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail || payload?.error;
    const error = new Error(
      (detail && typeof detail === "object" ? detail.message : detail)
      || "Request failed"
    );
    error.status = response.status;
    error.detail = detail;
    error.payload = payload;
    error.snapshot = detail && typeof detail === "object"
      ? detail.snapshot
      : undefined;
    throw error;
  }

  const payload = await response.json();
  notifyCollectionMutation(path, options);

  return payload;
}


export async function requestOk(path, options = {}) {
  const response = await fetch(apiUrl(path), options);

  if (!response.ok) {
    // Use this helper for endpoints where the caller wants the raw Response
    // instead of parsed JSON, but keep error handling consistent.
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail || payload?.error;
    const error = new Error(
      (detail && typeof detail === "object" ? detail.message : detail)
      || "Request failed"
    );
    error.status = response.status;
    error.detail = detail;
    error.payload = payload;
    throw error;
  }

  notifyCollectionMutation(path, options);

  return response;
}
