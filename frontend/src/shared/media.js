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

// Trim, drop empties, and de-duplicate a list of media strings, order kept.
export function normalizeMediaPool(values) {
  const seen = new Set();
  const result = [];

  for (const value of Array.isArray(values) ? values : []) {
    const media = String(value || "").trim();

    if (media && !seen.has(media)) {
      seen.add(media);
      result.push(media);
    }
  }

  return result;
}

// A question can carry several images ("media pool"); one is chosen when the
// card is asked so the picture cannot be rote-memorised. Accepts an item/
// question object (reads `media_pool`, falling back to the single `media`) or a
// raw array. Returns a cleaned, cover-first list.
export function mediaPoolFrom(source) {
  if (Array.isArray(source)) {
    return normalizeMediaPool(source);
  }

  const pool = normalizeMediaPool(source?.media_pool);

  if (pool.length) return pool;

  const single = String(source?.media || "").trim();

  return single ? [single] : [];
}

// Last image shown per question, so successive presentations of the same item
// never repeat back-to-back. Module-scoped: it intentionally persists across the
// component remounts that happen between reviews, and resets on reload.
const lastShownMediaByQuestionId = new Map();

export function resetReviewMediaMemory() {
  lastShownMediaByQuestionId.clear();
}

// Pick one image from a pool, uniformly at random but avoiding an immediate
// repeat for the same question when there is a choice.
export function pickReviewMedia(questionId, pool) {
  const options = mediaPoolFrom(pool);

  if (options.length <= 1) {
    return options[0] || "";
  }

  const last = questionId == null ? null : lastShownMediaByQuestionId.get(questionId);
  const candidates = last ? options.filter((media) => media !== last) : options;
  const drawPool = candidates.length ? candidates : options;
  const chosen = drawPool[Math.floor(Math.random() * drawPool.length)];

  if (questionId != null) {
    lastShownMediaByQuestionId.set(questionId, chosen);
  }

  return chosen;
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
