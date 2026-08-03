// Presentation layer for the SVG map import flow. Everything here turns the
// technical draft report into the plain-language vocabulary the creation path
// uses: four states, one headline, one primary action. No network access, no
// React — so both the start panel and the result workspace agree on wording.

const ONTOLOGY_PLAIN_LABELS = {
  "iso3166-alpha2": "Pays",
  "country-capitals": "Capitales"
};

// Only the two structural modes are offered. The country and capital
// referentials still name zones on their own through automatic inference, so
// exposing them as choices would list a handful of subjects among thousands
// and suggest the importer only handles those.
export const ontologyOptions = [
  ["auto", "Détection automatique"],
  ["generic", "Structure SVG générique"]
];

// Raw diagnostic codes stay out of the creation path; these are the sentences
// shown in the "À vérifier" checklist and beside the create action.
export const diagnosticLabels = {
  "svg.labels_removed": "Les libellés texte visibles ont été retirés de la carte.",
  "svg.expected_zone_count_mismatch": "Le nombre de zones trouvées ne correspond pas au total attendu.",
  "svg.no_usable_data_code": "Aucune zone exploitable n’a été trouvée dans ce fichier.",
  "svg.embedded_raster_requires_manual": "Cette carte contient une image bitmap, qui ne peut pas être découpée automatiquement.",
  "svg.unsupported_elements_removed": "Des éléments non pris en charge ont été retirés.",
  "svg.unsafe_css_removed": "Du style potentiellement dangereux a été retiré.",
  "svg.multiple_interpretations": "Plusieurs cartes possibles ont été trouvées dans ce fichier.",
  "svg.duplicate_source_ids": "Des identifiants en double ont été ignorés.",
  "svg.generated_ids_ignored": "Des identifiants générés par un logiciel de dessin ont été ignorés.",
  "svg.ontology_mismatch": "La structure du fichier ne correspond pas au type de carte choisi.",
  "svg.semantic_label_layer_removed": "Des formes qui affichaient les noms des zones ont été retirées, pour que les réponses ne soient pas visibles sur la carte.",
  "svg.probable_path_labels": "Certains libellés ont été dessinés comme des formes et doivent être classés.",
  "svg.incomplete_semantic_layer": "Les zones reconnues ne couvrent qu’une partie de la carte.",
  "svg.repair_no_zones": "Aucune zone jouable ne reste dans ce brouillon.",
  "svg.repair_required_unresolved": "Des formes importantes doivent encore être classées.",
  "svg.repair_optional_unresolved": "Des formes secondaires resteront en décoration non cliquable."
};

const BLOCKER_LABELS = {
  "repair.no_zones": "La carte ne contient plus aucune zone.",
  "repair.required_unresolved": "Des formes importantes ne sont pas encore attribuées à une zone.",
  "repair.expected_count": "Le nombre de zones ne correspond pas au total attendu.",
  "repair.acknowledgements": "Un avertissement doit être confirmé avant la création.",
  "repair.optional_acknowledgement": "Des formes secondaires doivent être confirmées.",
  "repair.state_invalid": "La correction en cours est illisible ; recommencez l’import."
};

export function describeDiagnostic(code) {
  return diagnosticLabels[code] || "Un point technique demande votre attention.";
}

export function describeBlocker(code) {
  return BLOCKER_LABELS[code] || diagnosticLabels[code] || describeDiagnostic(code);
}

/**
 * Turn a file name or URL into a provisional map name: drop the .svg
 * extension, replace separators with spaces, collapse whitespace.
 */
export function inferMapName(source) {
  let raw = String(source || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const segments = parsed.pathname.split("/").filter(Boolean);
      raw = segments[segments.length - 1] || parsed.hostname;
    } catch {
      raw = raw.split("/").filter(Boolean).pop() || raw;
    }
  }

  const withoutExtension = raw.replace(/\.svg$/i, "");
  const spaced = withoutExtension
    .replace(/[_\-.+]+/g, " ")
    .replace(/%20/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Short, human name for a detected layer: "Provinces", "Capitales", "Pays".
 * Backend titles carry technical qualifiers after an em dash or inside « ».
 */
export function simplifyInterpretationTitle(interpretation) {
  const title = String(interpretation?.title || "").trim();
  const quoted = title.match(/«\s*(.+?)\s*»/);
  if (quoted) {
    const value = quoted[1].replace(/[_\-.]+/g, " ").trim();
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  const plain = ONTOLOGY_PLAIN_LABELS[interpretation?.ontology];
  if (plain) return plain;

  const head = title.split(/\s*[—–-]\s*/)[0].trim();
  return head || "Zones de la carte";
}

function requiredAcknowledgements(draft) {
  return (draft?.diagnostics || [])
    .filter(diagnostic => diagnostic.requires_acknowledgement)
    .map(diagnostic => diagnostic.code);
}

export function pendingAcknowledgements(draft) {
  const done = new Set(draft?.acknowledgements || []);
  return requiredAcknowledgements(draft).filter(code => !done.has(code));
}

function errorDiagnostics(draft) {
  return (draft?.diagnostics || []).filter(
    diagnostic => diagnostic.severity === "error"
  );
}

export function selectableInterpretations(draft) {
  return (draft?.interpretations || []).filter(item => item.selectable);
}

function zoneCount(draft) {
  return draft?.zones?.length || draft?.summary?.zone_count || 0;
}

function verifiedNameCount(draft) {
  return (draft?.zones || []).filter(zone => zone.proposal_verified).length;
}

/**
 * Deterministic mapping from a backend draft report to the four presentation
 * states of the creation path.
 *
 * ready       — the map can be created (possibly after ticking a warning)
 * choice      — several layers were detected and one must be picked
 * correction  — the structure has to be repaired before creating
 * unsupported — this SVG cannot be separated automatically at all
 */
export function deriveImportState(draft) {
  if (!draft) return "unsupported";

  if (draft.route === "manual") return "unsupported";

  if (draft.selection_required) {
    return selectableInterpretations(draft).length > 0 ? "choice" : "unsupported";
  }

  if (draft.can_commit) return "ready";

  // The draft is complete but a warning still has to be confirmed; that is an
  // acknowledgement beside the create button, not a structural correction.
  if (
    !errorDiagnostics(draft).length
    && draft.selected_interpretation_id
    && pendingAcknowledgements(draft).length > 0
  ) {
    return "ready";
  }

  if (selectableInterpretations(draft).length > 0) return "correction";

  return "unsupported";
}

function readinessChecklist(draft) {
  const items = [];
  errorDiagnostics(draft).forEach(diagnostic => {
    items.push({ code: diagnostic.code, label: describeDiagnostic(diagnostic.code) });
  });
  (draft?.readiness_blockers || []).forEach(code => {
    if (items.some(item => item.code === code)) return;
    items.push({ code, label: describeBlocker(code) });
  });
  return items;
}

/**
 * Full presentation payload for the result workspace: one headline, one
 * primary action, and the short checklist that explains any blocking point.
 */
export function describeImport(draft) {
  const state = deriveImportState(draft);
  const zones = zoneCount(draft);
  const verified = verifiedNameCount(draft);
  const acknowledgements = pendingAcknowledgements(draft);
  const checklist = readinessChecklist(draft);
  const nameProgress = zones > 0 && verified > 0 && verified < zones
    ? `${verified} noms reconnus sur ${zones}`
    : "";

  if (state === "ready") {
    return {
      state,
      zoneCount: zones,
      nameProgress,
      headline: `${zones} zones détectées — la carte est prête.`,
      detail: acknowledgements.length
        ? "Confirmez le point ci-dessous pour créer la carte."
        : "",
      primaryLabel: "Créer la carte",
      primaryAction: "commit",
      pendingAcknowledgements: acknowledgements,
      checklist: []
    };
  }

  if (state === "choice") {
    return {
      state,
      zoneCount: zones,
      nameProgress,
      headline: "Nous avons trouvé plusieurs cartes possibles.",
      detail: "Choisissez celle que vous voulez transformer en questions.",
      primaryLabel: "Créer la carte",
      primaryAction: "select",
      pendingAcknowledgements: acknowledgements,
      checklist: []
    };
  }

  if (state === "correction") {
    return {
      state,
      zoneCount: zones,
      nameProgress,
      headline: "Cette carte a besoin d’une petite mise au point.",
      detail: checklist.length
        ? "Voici ce qui reste à régler :"
        : "Certaines formes doivent être attribuées à leurs zones.",
      primaryLabel: "Corriger les zones",
      primaryAction: "repair",
      pendingAcknowledgements: acknowledgements,
      checklist
    };
  }

  const raster = (draft?.diagnostics || []).some(
    diagnostic => diagnostic.code === "svg.embedded_raster_requires_manual"
  );

  return {
    state: "unsupported",
    zoneCount: zones,
    nameProgress: "",
    headline: raster
      ? "Ce fichier est une image, pas une carte découpée."
      : "Ce fichier ne contient pas de zones séparables.",
    detail: raster
      ? "Nemoris ne peut pas encore séparer les zones d’une image bitmap. Choisissez un SVG dont les régions sont des formes distinctes."
      : "Les régions de ce SVG ne sont pas dessinées séparément, il n’y a donc rien à rendre cliquable.",
    primaryLabel: "Choisir un autre SVG",
    primaryAction: "restart",
    pendingAcknowledgements: [],
    checklist: []
  };
}

/** Human-readable state for a saved draft in the "Reprendre un import" list. */
export function describeDraftListItem(item) {
  if (!item) return "";
  if (item.can_commit) return "prête";
  if (item.route === "manual") return "non prise en charge";
  if (item.repair_available) return "correction en cours";
  if (item.readiness_blockers?.length) return "correction nécessaire";
  return "couche à choisir";
}

export function draftZoneCount(item) {
  return item?.repair_summary?.zone_count ?? item?.summary?.zone_count ?? 0;
}

export function draftAge(updatedAt) {
  const timestamp = Date.parse(updatedAt || "");
  if (!Number.isFinite(timestamp)) return "date inconnue";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `il y a ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}
