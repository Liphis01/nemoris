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
    description: "Pratiquer un groupe, une collection ou un tag sans modifier le planning.",
    detail: "Records",
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
    mode: "packs",
    eyebrow: "Catalogue",
    title: "Packs",
    description: "Parcourir et installer des packs de contenu partagés.",
    detail: "Découvrir",
    accent: "teal",
    icon: "◫"
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

      <span className="menu-destination-label">
        {item.title}
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

function reviewLoadWidth(summary, loading, error) {
  if (loading || error) {
    return "28%";
  }

  const dueCount = summary?.due_count ?? 0;
  if (dueCount <= 0) {
    return "6%";
  }

  return `${Math.min(100, Math.max(22, dueCount * 12))}%`;
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
  const featuredDestination = destinations[0];
  const reviewLoadStyle = {
    width: reviewLoadWidth(
      reviewSummary,
      reviewSummaryLoading,
      reviewSummaryError
    )
  };

  return (
    <div className="menu-screen">
      <div className="menu-shell">
        <header className="menu-topbar" aria-label="Nemoris">
          <div>
            <div className="menu-overline">
              Spaced repetition system
            </div>
            <h1>Nemoris</h1>
          </div>

          <div
            className={`menu-today-pill${reviewSummaryError ? " menu-today-pill-error" : ""}`}
            aria-label={`Aujourd'hui: ${reviewCountValue}, ${reviewCountCaption}`}
          >
            <strong>{reviewCountValue}</strong>
            <span>
              <span>Aujourd’hui</span>
              <span>{reviewCountCaption}</span>
            </span>
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

        <main className="menu-main" aria-label="Actions">
          <div className="menu-primary-row">
            <button
              type="button"
              className={`menu-review${reviewSummaryError ? " menu-review-error" : ""}`}
              onClick={() => setMode("quiz")}
            >
              <span className="menu-review-content">
                <span className="menu-pill menu-pill-amber">Review</span>

                <span>
                  <span className="menu-review-title">Révision du jour</span>
                  <span className="menu-review-text">
                    Lance la session due avec les questions texte, maps, images, timelines et séquences.
                  </span>
                </span>
              </span>

              <span className="menu-review-footer">
                <span className="menu-review-count">
                  <strong>{reviewCountValue}</strong>
                  <span>
                    Questions dues
                    <br />
                    Aujourd’hui
                  </span>
                </span>

                <span className="menu-review-action">
                  <span>Démarrer</span>
                  <span className="menu-review-action-icon" aria-hidden="true">→</span>
                </span>
              </span>
            </button>

            <aside className="menu-context" aria-label="Résumé">
              <section className="menu-context-card">
                <div>
                  <span className="menu-eyebrow">
                    {featuredDestination.eyebrow}
                  </span>
                  <h2>{featuredDestination.title}</h2>
                  <p>{featuredDestination.description}</p>
                </div>

                <button
                  type="button"
                  className={`menu-context-action menu-context-action-${featuredDestination.accent}`}
                  onClick={() => setMode(featuredDestination.mode)}
                >
                  <span>{featuredDestination.detail}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </section>

              <section className="menu-context-card">
                <div>
                  <span className="menu-eyebrow">Aujourd’hui</span>
                  <h2>Charge de review</h2>
                </div>

                <div className="menu-load-summary">
                  <div className="menu-load-row">
                    <span>Due</span>
                    <strong>{reviewCountValue}</strong>
                  </div>
                  <div className="menu-load-row">
                    <span>Statut</span>
                    <strong>{reviewCountCaption}</strong>
                  </div>
                </div>

                <div className="menu-load-track" aria-hidden="true">
                  <span style={reviewLoadStyle} />
                </div>
              </section>
            </aside>
          </div>

          <nav className="menu-destination-dock" aria-label="Espaces de travail">
            {destinations.map((item) => (
              <DestinationButton
                item={item}
                key={item.mode}
                setMode={setMode}
              />
            ))}
          </nav>
        </main>
      </div>
    </div>
  );
}
