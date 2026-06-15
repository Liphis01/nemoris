import "./Menu.css";

const destinations = [
  {
    mode: "manage",
    eyebrow: "Bibliothèque",
    title: "Gestionnaire",
    description: "Questions, tags, groupes, collections et maps.",
    detail: "Édition rapide",
    accent: "violet",
    icon: "✎"
  },
  {
    mode: "training",
    eyebrow: "Libre",
    title: "Entrainement",
    description: "Pratiquer un groupe ou un tag sans modifier le planning.",
    detail: "Sans score",
    accent: "amber",
    icon: "◎"
  },
  {
    mode: "calendar",
    eyebrow: "Planning",
    title: "Calendrier",
    description: "Charge quotidienne, retard et prochaines reviews.",
    detail: "Vue par jour",
    accent: "green",
    icon: "▦"
  },
  {
    mode: "stats",
    eyebrow: "Analyse",
    title: "Statistiques",
    description: "Rétention, favoris, charge et points faibles.",
    detail: "Suivi global",
    accent: "blue",
    icon: "▥"
  },
  {
    mode: "settings",
    eyebrow: "Rythme",
    title: "Réglages",
    description: "Objectif quotidien et calendrier de review.",
    detail: "Paramètres",
    accent: "neutral",
    icon: "⚙"
  }
];

const reviewTypes = [
  { label: "Texte", accent: "violet" },
  { label: "Map", accent: "amber" },
  { label: "Image", accent: "green" },
  { label: "Timeline", accent: "blue" }
];

function DestinationButton({ item, setMode }) {
  return (
    <button
      type="button"
      className={`menu-destination menu-destination-${item.accent}`}
      onClick={() => setMode(item.mode)}
    >
      <span className="menu-destination-icon" aria-hidden="true">
        {item.icon}
      </span>

      <span className="menu-destination-body">
        <span className="menu-eyebrow">{item.eyebrow}</span>
        <strong>{item.title}</strong>
        <span>{item.description}</span>
      </span>

      <span className="menu-destination-meta">
        <span>{item.detail}</span>
        <span aria-hidden="true">→</span>
      </span>
    </button>
  );
}

function reviewDueValue(summary, loading, error) {
  if (loading) {
    return "...";
  }

  if (error) {
    return "!";
  }

  return String(summary?.due_count ?? 0);
}

function reviewDueCaption(summary, loading, error) {
  if (loading) {
    return "Calcul";
  }

  if (error) {
    return "Indisponible";
  }

  return (summary?.due_count ?? 0) === 0 ? "À jour" : "À revoir";
}

export default function Menu({
  setMode,
  startupNotice,
  onDismissStartupNotice,
  reviewSummary = null,
  reviewSummaryLoading = false,
  reviewSummaryError = ""
}) {
  const reviewCountValue = reviewDueValue(
    reviewSummary,
    reviewSummaryLoading,
    reviewSummaryError
  );
  const reviewCountCaption = reviewDueCaption(
    reviewSummary,
    reviewSummaryLoading,
    reviewSummaryError
  );

  return (
    <div className="menu-screen">
      <div className="menu-shell">
        <header className="menu-topbar" aria-label="Nemoris">
          <div className="menu-brand-row">
            <div className="menu-brand-mark" aria-hidden="true">
              N
            </div>
            <div>
              <div className="menu-overline">
                Spaced repetition system
              </div>
              <h1>Nemoris</h1>
            </div>
          </div>
        </header>

        {startupNotice && (
          <div className="menu-notice">
            <div>
              <div className="menu-notice-title">
                Calendrier rééquilibré
              </div>
              <div className="menu-notice-text">
                {startupNotice.moved} question{startupNotice.moved > 1 ? "s" : ""} déplacée{startupNotice.moved > 1 ? "s" : ""} pour garder environ {startupNotice.daily_target}/jour.
              </div>
            </div>

            <button
              type="button"
              className="menu-notice-close"
              onClick={onDismissStartupNotice}
              aria-label="Masquer"
              title="Masquer"
            >
              ×
            </button>
          </div>
        )}

        <main className="menu-command-grid" aria-label="Actions">
          <button
            type="button"
            className={`menu-review${reviewSummaryError ? " menu-review-error" : ""}`}
            onClick={() => setMode("quiz")}
          >
            <span className="menu-review-content">
              <span className="menu-review-topline">
                <span className="menu-pill menu-pill-amber">Review</span>
              </span>

              <span className="menu-review-title">Révision du jour</span>
              <span className="menu-review-text">
                Lance la session due avec les questions texte, maps, images et timelines.
              </span>

              <span className="menu-review-types" aria-label="Types supportés">
                {reviewTypes.map((type) => (
                  <span
                    className={`menu-type-chip menu-type-${type.accent}`}
                    key={type.label}
                  >
                    {type.label}
                  </span>
                ))}
              </span>
            </span>

            <span className="menu-review-status" aria-hidden="true">
              <span className="menu-review-status-label">Aujourd’hui</span>
              <span className="menu-review-status-value">
                {reviewCountValue}
              </span>
              <span className="menu-review-status-caption">
                {reviewCountCaption}
              </span>
              <span className="menu-review-status-lines">
                <span />
                <span />
                <span />
              </span>
            </span>

            <span className="menu-review-action">
              <span>Démarrer</span>
              <span className="menu-review-action-icon" aria-hidden="true">→</span>
            </span>
          </button>

          <section className="menu-destinations" aria-label="Espaces de travail">
            <div className="menu-destinations-header">
              <span className="menu-eyebrow">Espaces</span>
              <strong>Aller vers</strong>
            </div>

            <div className="menu-destination-list">
              {destinations.map((item) => (
                <DestinationButton
                  item={item}
                  key={item.mode}
                  setMode={setMode}
                />
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
