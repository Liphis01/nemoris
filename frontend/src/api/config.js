// Under Tauri the frontend is served by the app shell while the FastAPI
// backend runs as a sidecar on its own localhost port, which the Rust host
// injects as window.__NEMORIS_BACKEND__ before any app script runs. In a
// plain browser (dev, or the old same-origin build) that global is absent
// and we fall back to the relative / dev-server base.
const injectedBackend =
  typeof window !== "undefined" ? window.__NEMORIS_BACKEND__ : undefined;

export const API_BASE_URL =
  injectedBackend ??
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://localhost:8000" : "");

export function apiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
