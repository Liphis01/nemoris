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

const workflowItems = [
  "Revoir",
  "Organiser",
  "Explorer"
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

export default function Menu({
  setMode,
  startupNotice,
  onDismissStartupNotice
}) {
  return (
    <div className="menu-screen">
      <div className="menu-layout">
        <aside className="menu-identity" aria-label="Nemoris">
          <div>
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

            <p className="menu-subtitle">
              L'outil ultime pour apprendre et réviser efficacement grâce à la répétition espacée.
            </p>
          </div>

          <div className="menu-workflow" aria-label="Navigation principale">
            {workflowItems.map((item, index) => (
              <div className="menu-workflow-item" key={item}>
                <span className="menu-workflow-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </aside>

        <main className="menu-actions" aria-label="Actions">
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

          <button
            type="button"
            className="menu-review"
            onClick={() => setMode("quiz")}
          >
            <span className="menu-review-main">
              <span className="menu-pill menu-pill-amber">Review</span>
              <span className="menu-review-title">Révision du jour</span>
              <span className="menu-review-text">
                Lance la session due avec les questions texte, maps, images et timelines.
              </span>
            </span>

            <span className="menu-review-side">
              <span className="menu-play" aria-hidden="true">▶</span>
              <span>Démarrer</span>
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
          </button>

          <div className="menu-destination-grid">
            {destinations.map((item) => (
              <DestinationButton
                item={item}
                key={item.mode}
                setMode={setMode}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
