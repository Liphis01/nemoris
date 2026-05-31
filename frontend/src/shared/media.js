import { API_BASE_URL } from "../api/config";


export function resolveMediaUrl(media) {
  const src = String(media || "").trim();

  if (!src) return "";

  if (
    /^(https?:)?\/\//.test(src) ||
    src.startsWith("data:") ||
    src.startsWith("blob:")
  ) {
    return src;
  }

  if (src.startsWith("/static/")) {
    return API_BASE_URL ? `${API_BASE_URL}${src}` : src;
  }

  return src;
}
