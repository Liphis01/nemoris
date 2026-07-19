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

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "oga", "m4a", "m4b", "aac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov"]);

// Media is stored as a bare URL string, so the renderer infers how to display it
// from the file extension. Uploaded files always keep a canonical extension, so
// this is reliable; anything unknown (extensionless or data URLs) falls back to
// an image, matching the historical image-only behaviour.
export function getMediaKind(media) {
  const src = String(media || "").trim();

  if (!src) return "";

  const withoutQuery = src.split(/[?#]/)[0];
  const extension = withoutQuery.split(".").pop().toLowerCase();

  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";

  return "image";
}
