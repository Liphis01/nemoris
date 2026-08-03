import { useCallback, useEffect, useState } from "react";
import { getProfile, updateProfile } from "../../../api/profile";
import { getStats } from "../../../api/stats";

export const AVATAR_EMOJI_PRESETS = [
  "🙂", "😀", "😎", "🤓", "🥸", "🥳", "🤔",
  "🦊", "🐼", "🦉", "🐙", "🐢", "🦁", "🐳",
  "🌵", "🌟", "🔥", "🌊", "🍀", "⚡", "🌙",
  "🎯", "🎲", "🧠", "🚀", "🎨", "📚", "🎮"
];

export const AVATAR_COLOR_PRESETS = [
  { value: "violet", accent: "#b69cff" },
  { value: "amber", accent: "#ffcc7a" },
  { value: "green", accent: "#7ee2a8" },
  { value: "blue", accent: "#8fc7ff" },
  { value: "teal", accent: "#5eead4" },
  { value: "neutral", accent: "#b8d7e8" }
];

const DEFAULT_EMOJI = "🙂";
const DEFAULT_COLOR = "violet";

export function overallRetention(retentionByType) {
  const totals = Object.values(retentionByType || {}).reduce(
    (acc, group) => ({
      reviews: acc.reviews + (group?.reviews || 0),
      success: acc.success + (group?.success || 0)
    }),
    { reviews: 0, success: 0 }
  );

  return totals.reviews > 0
    ? Math.round((totals.success / totals.reviews) * 100)
    : null;
}

export function useProfile() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [emojiDraft, setEmojiDraft] = useState(DEFAULT_EMOJI);
  const [colorDraft, setColorDraft] = useState(DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saveError, setSaveError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const next = await getProfile();
      setStatus(next);

      if (next.profile) {
        setUsernameDraft(next.profile.username || "");
        setEmojiDraft(next.profile.avatar_emoji || DEFAULT_EMOJI);
        setColorDraft(next.profile.avatar_color || DEFAULT_COLOR);
      }
    } catch (error) {
      console.error(error);
      setLoadError(error.message || "Profil indisponible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;

    setStatsLoading(true);
    setStatsError("");

    getStats()
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch((error) => {
        console.error(error);

        if (!cancelled) {
          setStatsError(error.message || "Stats indisponibles.");
        }
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setSaveStatus("");
    setSaveError("");

    try {
      const next = await updateProfile({
        username: usernameDraft.trim(),
        avatar_emoji: emojiDraft,
        avatar_color: colorDraft
      });
      setStatus(next);
      setSaveStatus("Profil enregistré.");
    } catch (error) {
      console.error(error);
      setSaveError(error.message || "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return {
    signedIn: Boolean(status?.signed_in),
    accountEmail: status?.account_email || null,
    profile: status?.profile || null,
    loading,
    loadError,
    stats,
    statsLoading,
    statsError,
    usernameDraft,
    setUsernameDraft,
    emojiDraft,
    setEmojiDraft,
    colorDraft,
    setColorDraft,
    saving,
    saveStatus,
    saveError,
    save,
    refresh
  };
}
