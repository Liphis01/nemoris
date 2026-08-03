// The Nemoris cloud, mirrored from the backend's config.CLOUD_URL/CLOUD_KEY.
// Only the mobile build needs these client-side: it talks to Supabase directly
// instead of going through the FastAPI backend. Desktop reads the backend's
// copy and never sees these values.
//
// The key is a *publishable* key — security comes from RLS plus the user's auth
// token, never from keeping it secret — so shipping it in the bundle is safe.
// Self-hosters override both at build time, matching NEMORIS_SUPABASE_URL/_KEY.
export const CLOUD_URL = String(
  import.meta.env?.VITE_SUPABASE_URL || "https://apauxfgsthjmowjimcwn.supabase.co"
).trim().replace(/\/+$/, "");

export const CLOUD_KEY = String(
  import.meta.env?.VITE_SUPABASE_KEY ||
    "sb_publishable_MMicstgbU4UpPCHYJvTSZQ_FP2gTkFh"
).trim();
