// Shared between the Study screen (frontend/src/features/study/components/
// StudyScreen.jsx) and the pack detail panel (frontend/src/features/packs/
// components/BrowsePacks.jsx), so an installed pack's "what to do next" line
// always matches what Study itself would recommend for that same scope.

export function numberLabel(value) {
  return Number(value || 0).toLocaleString("fr-FR");
}


export function questionCountLabel(count) {
  const value = Number(count || 0);

  return `${numberLabel(value)} question${value > 1 ? "s" : ""}`;
}


export function recommendationFor(summary) {
  const counts = summary?.counts || {};
  const buckets = summary?.buckets || {};

  if ((counts.due_now || 0) > 0) {
    return {
      title: "Faire la review due",
      detail: questionCountLabel(counts.due_now),
      action: "review"
    };
  }

  if ((summary?.recent_misses?.item_count || 0) > 0) {
    return {
      title: "Reprendre les erreurs récentes",
      detail: `${numberLabel(summary.recent_misses.item_count)} item${summary.recent_misses.item_count > 1 ? "s" : ""} à stabiliser`,
      practiceId: "recent_misses"
    };
  }

  if ((summary?.confusions?.event_count || 0) > 0) {
    return {
      title: "Clarifier les confusions",
      detail: `${numberLabel(summary.confusions.event_count)} confusion${summary.confusions.event_count > 1 ? "s" : ""} récente${summary.confusions.event_count > 1 ? "s" : ""}`,
      practiceId: "commonly_confused_pairs"
    };
  }

  if ((buckets.unseen || 0) > 0) {
    return {
      title: "Apprendre les nouveaux items",
      detail: questionCountLabel(buckets.unseen),
      targetTab: "learn"
    };
  }

  return {
    title: "Entretenir ce scope",
    detail: questionCountLabel(counts.active_questions || 0),
    targetTab: "train"
  };
}
