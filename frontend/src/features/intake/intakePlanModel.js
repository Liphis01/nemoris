import { PACE_TIER_LABELS } from "../../shared/paceTiers";

export const FOCUS_OPTIONS = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 0, label: "Tous" }
];

export const NEW_DECK_POLICY_OPTIONS = [
  { value: "end", label: "À la fin" },
  { value: "start", label: "En premier" },
  { value: "paused", label: "En pause" }
];

// The backend only ever sends buckets: a day count would promise a precision
// the intake estimate does not have.
const ETA_LABELS = {
  today: "aujourd'hui",
  week: "cette semaine",
  month: "ce mois-ci",
  months: "dans quelques mois",
  later: "plus tard"
};

// Must match NEW_INTAKE_SATURATION_STOP in backend/app/services/intake.py.
const SATURATION_STOP = 1.5;


export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${Math.abs(count) <= 1 ? singular : pluralForm}`;
}


export function deckNoun(typeGroup, count) {
  if (typeGroup === "map") return plural(count, "zone");
  if (typeGroup === "media") return plural(count, "image");
  return plural(count, "question");
}


export function etaLabel(bucket) {
  return ETA_LABELS[bucket] || null;
}


export function focusDescription(focus) {
  if (focus === 1) {
    return "Un paquet à la fois : le suivant démarre quand le premier est épuisé.";
  }

  if (!focus) {
    return "Tous les paquets actifs se partagent les nouvelles du jour.";
  }

  return `Les nouvelles du jour sont réparties entre les ${focus} premiers paquets actifs.`;
}


export function sectionDecks(decks = []) {
  return {
    focus: decks.filter(deck => deck.section === "focus"),
    next: decks.filter(deck => deck.section === "next"),
    paused: decks.filter(deck => deck.section === "paused")
  };
}


export function activeDeckKeys(decks = []) {
  return decks.filter(deck => !deck.paused).map(deck => deck.key);
}


export function moveItem(list, fromIndex, toIndex) {
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
  return next;
}


// Index to send as `to_index` when `draggedKey` is dropped before/after
// `targetKey` among `keys`, counted once the dragged entry is taken out.
export function dropIndex(keys, draggedKey, targetKey, placement) {
  const remaining = keys.filter(key => key !== draggedKey);
  const targetIndex = remaining.indexOf(targetKey);

  if (targetIndex < 0) return null;

  return placement === "after" ? targetIndex + 1 : targetIndex;
}


// Optimistic twin of the backend `move` action: same ordering, same section
// rule (the focus window counts only decks that still have something to feed).
export function moveDeckInSnapshot(snapshot, key, toIndex) {
  if (!snapshot) return snapshot;

  const active = snapshot.decks.filter(deck => !deck.paused);
  const paused = snapshot.decks.filter(deck => deck.paused);
  const fromIndex = active.findIndex(deck => deck.key === key);

  if (fromIndex < 0) return snapshot;

  const focus = snapshot.settings?.focus ?? 2;
  let windowed = 0;
  const reordered = moveItem(active, fromIndex, toIndex).map((deck, index) => {
    const feeds = deck.counts?.unseen > 0;
    const inWindow = feeds && (!focus || windowed < focus);

    if (inWindow) windowed += 1;

    return {
      ...deck,
      position: index + 1,
      section: inWindow ? "focus" : "next"
    };
  });

  return { ...snapshot, decks: [...reordered, ...paused] };
}


export function deckMeta(deck) {
  if (deck.paused) {
    return `En pause · ${deckNoun(deck.type_group, deck.counts?.unseen ?? 0)} en attente`;
  }

  const parts = [deckNoun(deck.type_group, deck.counts?.unseen ?? 0)];

  if (deck.today_count > 0) {
    parts.push(`${deck.today_count} aujourd'hui`);
  } else if (deck.eta?.starts && deck.eta.starts !== "today") {
    parts.push(`démarre ${etaLabel(deck.eta.starts)}`);
  }

  if (deck.section === "focus" && deck.eta?.finishes) {
    parts.push(`fini ${etaLabel(deck.eta.finishes)}`);
  }

  if (deck.counts?.suspended > 0) {
    parts.push(`${deck.counts.suspended} suspendue${deck.counts.suspended > 1 ? "s" : ""}`);
  }

  return parts.join(" · ");
}


export function planSummary(snapshot) {
  if (!snapshot) return "";

  const counts = snapshot.counts || {};
  const parts = [
    `${snapshot.today?.count ?? 0} aujourd'hui`,
    `${counts.waiting ?? 0} en attente`,
    plural(counts.decks ?? 0, "paquet")
  ];

  if (counts.paused_decks > 0) {
    parts.push(`${counts.paused_decks} en pause`);
  }

  return parts.join(" · ");
}


export function entrySummary(snapshot) {
  if (!snapshot) return "";

  const focusNames = snapshot.decks
    .filter(deck => deck.section === "focus")
    .map(deck => deck.name);
  const today = `${snapshot.today?.count ?? 0} aujourd'hui`;

  if (focusNames.length) return `${today} · ${focusNames.join(", ")}`;
  if (snapshot.counts?.paused > 0) return `${today} · paquets en pause`;
  return `${today} · aucune nouvelle en attente`;
}


// Label for the home review card's intake control, from /review/summary.
// null hides the control: there is nothing new to manage.
export function menuIntakeLabel(summary) {
  if (!summary) return null;

  const newCount = summary.new_count ?? 0;

  if (newCount > 0) {
    return `${plural(newCount, "nouvelle")} · Gérer`;
  }

  if ((summary.new_waiting ?? 0) > 0) {
    return "0 nouvelle aujourd'hui · Pourquoi ?";
  }

  if ((summary.new_paused ?? 0) > 0) {
    return "Nouvelles en pause · Gérer";
  }

  return null;
}


// Plain-language reasons behind today's number, from compute_intake_quota's
// intermediates (backend/app/services/intake.py returns every step so the UI
// can explain a small or zero quota).
export function quotaExplanation(today, counts = {}) {
  const breakdown = today?.breakdown;

  if (!breakdown) return [];

  const lines = [];
  const tierLabel = PACE_TIER_LABELS[breakdown.pace_tier];

  lines.push(
    tierLabel
      ? `Rythme ${tierLabel} : entre ${breakdown.new_min} et ${breakdown.new_max} nouvelles par jour.`
      : `Objectif : ${breakdown.daily_target} révisions par jour, dont ${breakdown.new_min} à ${breakdown.new_max} nouvelles.`
  );

  if (breakdown.saturation >= SATURATION_STOP) {
    lines.push(
      `Journée saturée : ${breakdown.review_load} révisions prévues pour un objectif de ${breakdown.daily_target}. Les nouvelles reprendront quand la charge baissera.`
    );
  } else if (breakdown.wip_factor <= 0) {
    lines.push(
      `Trop de questions en cours d'apprentissage (${breakdown.wip_count} pour une limite de ${breakdown.wip_cap}). Les nouvelles reprendront quand elles seront consolidées.`
    );
  } else {
    if (breakdown.review_load >= breakdown.daily_target || breakdown.new_fill <= breakdown.new_min) {
      lines.push(
        `${breakdown.review_load} révisions déjà prévues aujourd'hui (objectif ${breakdown.daily_target}) : seulement le minimum du rythme.`
      );
    } else {
      lines.push(
        `${breakdown.review_load} révisions prévues pour un objectif de ${breakdown.daily_target} : il reste de la place pour ${breakdown.new_fill} nouvelles.`
      );
    }

    if (breakdown.new_budget_tuned < breakdown.new_fill) {
      lines.push(`Réduit à ${breakdown.new_budget_tuned} d'après ta rétention récente.`);
    } else if (breakdown.new_budget_tuned > breakdown.new_fill) {
      lines.push(`Augmenté à ${breakdown.new_budget_tuned} : ta rétention récente est bonne.`);
    }

    if (
      breakdown.ramp_ceiling !== null &&
      breakdown.ramp_ceiling !== undefined &&
      breakdown.new_budget < breakdown.new_budget_tuned
    ) {
      lines.push(
        `Hausse limitée à +25 % par rapport à hier (${breakdown.introduced_yesterday} introduites) : ${breakdown.new_budget}.`
      );
    }

    if (breakdown.wip_factor < 1) {
      lines.push(
        `Beaucoup de questions en cours d'apprentissage (${breakdown.wip_count}/${breakdown.wip_cap}) : les nouvelles sont réduites.`
      );
    }
  }

  if (breakdown.introduced_today > 0) {
    lines.push(`${plural(breakdown.introduced_today, "déjà introduite")} aujourd'hui.`);
  }

  const available = today.count ?? 0;

  if (available < (today.quota ?? 0)) {
    lines.push(
      (counts.waiting ?? 0) === 0 && (counts.paused ?? 0) > 0
        ? "Tous les paquets restants sont en pause."
        : `Plus que ${plural(counts.waiting ?? available, "nouvelle")} dans les paquets actifs.`
    );
  }

  return lines;
}
