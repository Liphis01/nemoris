import { apiUrl } from "./config";


export async function requestJson(path, options = {}) {
  const response = await fetch(apiUrl(path), options);

  if (!response.ok) {
    // FastAPI usually returns {detail}; a few legacy endpoints return {error}.
    // Normalize both into one thrown Error for hooks/components.
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || payload?.error || "Request failed");
  }

  return response.json();
}


export async function requestOk(path, options = {}) {
  const response = await fetch(apiUrl(path), options);

  if (!response.ok) {
    // Use this helper for endpoints where the caller wants the raw Response
    // instead of parsed JSON, but keep error handling consistent.
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || payload?.error || "Request failed");
  }

  return response;
}
