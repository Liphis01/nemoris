import { useEffect, useState } from "react";
import {
  completeDailyGrove,
  getDailyGroveStatus
} from "../../api/dailyGrove";
import GroveArtwork from "./GroveArtwork";
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

const reviewTypes = [
  { label: "Texte", accent: "violet" },
  { label: "Map", accent: "amber" },
  { label: "Image", accent: "green" },
  { label: "Timeline", accent: "blue" }
];

const plantStageLabels = {
  dormant: "Graine dormante",
  seedling: "Jeune pousse",
  sprout: "Premier bourgeon",
  young_grove: "Feuille de garde",
  grove: "Bouton lumineux",
  canopy: "Fleur ouverte",
  forest: "Fleur radieuse",
  ancient_forest: "Fleur rare",
  sanctuary: "Floraison Nemoris"
};

function groveStatusLabel(status, loading, checking, error) {
  if (loading) return "Chargement...";
  if (error) return "Synchronisation indisponible";
  if (checking) return "Arrosage de la plante...";
  if (!status) return "Plante indisponible";
  if (status.today_complete) return "Plante arrosée";
  if ((status.due_count || 0) > 0) {
    return `${status.due_count} révision${status.due_count > 1 ? "s" : ""} à terminer`;
  }

  return "Check-in prêt";
}

function plantStageLabel(status) {
  const key = status?.grove_stage?.key;

  return plantStageLabels[key] || status?.grove_stage?.label || "Graine dormante";
}

function GrovePanel({
  status,
  loading,
  checking,
  error
}) {
  const streak = status?.current_streak || 0;
  const longest = status?.longest_streak || 0;
  const restLeaves = status?.rest_leaves || 0;
  const shieldCapacity = status?.shield_capacity || 0;
  const stage = plantStageLabel(status);
  const milestone = status?.next_milestone;
  const progress = status?.milestone_progress || {};
  const rawProgressPercent = Math.max(0, Math.min(100, progress.percent || 0));
  const progressPercent = streak > 0
    ? Math.max(6, rawProgressPercent)
    : rawProgressPercent;
  const statusLabel = groveStatusLabel(status, loading, checking, error);

  return (
    <section className="menu-grove-panel" aria-label="Plante Nemoris">
      <div className="menu-grove-header">
        <div>
          <div className="menu-overline">Plante Nemoris</div>
          <div className="menu-grove-stage">{stage}</div>
        </div>

        <div className="menu-grove-streak">
          <strong>{streak}</strong>
          <span>jour{streak > 1 ? "s" : ""}</span>
        </div>
      </div>

      <GroveArtwork
        status={status}
        loading={loading}
        checking={checking}
        error={error}
      />

      <div className="menu-grove-track" aria-hidden="true">
        <div
          className="menu-grove-track-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="menu-grove-status">{statusLabel}</div>

      {status?.milestone_reached && (
        <div className="menu-grove-bloom">
          Floraison des {status.milestone_reached} jours
        </div>
      )}

      <div className="menu-grove-meta">
        <span>Record {longest} j</span>
        <span>{restLeaves}/{shieldCapacity} feuilles de garde</span>
        <span>
          {milestone
            ? `Cap ${milestone} j`
            : "Tous les caps atteints"}
        </span>
      </div>
    </section>
  );
}

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
  const [dailyGrove, setDailyGrove] = useState(null);
  const [dailyGroveLoading, setDailyGroveLoading] = useState(true);
  const [dailyGroveChecking, setDailyGroveChecking] = useState(false);
  const [dailyGroveError, setDailyGroveError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDailyGrove() {
      setDailyGroveLoading(true);
      setDailyGroveError("");

      try {
        const status = await getDailyGroveStatus();

        if (cancelled) return;

        setDailyGrove(status);
        setDailyGroveLoading(false);

        if (!status?.eligible) return;

        setDailyGroveChecking(true);

        try {
          const completed = await completeDailyGrove();

          if (!cancelled) {
            setDailyGrove(completed);
          }
        } catch (completionError) {
          console.error(completionError);

          if (!cancelled) {
            setDailyGroveError(
              completionError.message || "Plante impossible à synchroniser."
            );
          }
        } finally {
          if (!cancelled) {
            setDailyGroveChecking(false);
          }
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setDailyGroveError(
            error.message || "Plante impossible à synchroniser."
          );
          setDailyGroveLoading(false);
        }
      }
    }

    loadDailyGrove();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="menu-screen">
      <div className="menu-layout">
        <aside className="menu-identity" aria-label="Nemoris">
          <div className="menu-brand-block">
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

          <div className="menu-grove-anchor">
            <GrovePanel
              status={dailyGrove}
              loading={dailyGroveLoading}
              checking={dailyGroveChecking}
              error={dailyGroveError}
            />
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
