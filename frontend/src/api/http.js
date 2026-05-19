import { apiUrl } from "./config";


export async function requestJson(path, options = {}) {
  const response = await fetch(apiUrl(path), options);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || payload?.error || "Request failed");
  }

  return response.json();
}


export async function requestOk(path, options = {}) {
  const response = await fetch(apiUrl(path), options);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || payload?.error || "Request failed");
  }

  return response;
}
