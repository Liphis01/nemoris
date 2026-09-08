// Used by the installed-pack progress panel
// (frontend/src/features/packs/components/BrowsePacks.jsx) to put a "what to do
// next" line under a pack's mastery bars.
//
// It used to carry an action for the Study screen to run (review this scope,
// open that practice selector, jump to that tab). The Study screen is now the
// Learn screen and does none of those, so this returns text only -- whoever
// renders it decides what, if anything, to offer next to it.

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
      detail: questionCountLabel(counts.due_now)
    };
  }

  if ((summary?.recent_misses?.item_count || 0) > 0) {
    const count = summary.recent_misses.item_count;

    return {
      title: "Reprendre les erreurs récentes",
      detail: `${numberLabel(count)} item${count > 1 ? "s" : ""} à stabiliser`
    };
  }

  if ((summary?.confusions?.event_count || 0) > 0) {
    const count = summary.confusions.event_count;

    return {
      title: "Clarifier les confusions",
      detail: `${numberLabel(count)} confusion${count > 1 ? "s" : ""} récente${count > 1 ? "s" : ""}`
    };
  }

  if ((buckets.unseen || 0) > 0) {
    return {
      title: "Apprendre les nouveaux items",
      detail: questionCountLabel(buckets.unseen)
    };
  }

  return {
    title: "Entretenir ce scope",
    detail: questionCountLabel(counts.active_questions || 0)
  };
}
