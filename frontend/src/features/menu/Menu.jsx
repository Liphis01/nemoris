import { useCallback, useEffect, useMemo, useState } from "react";
import { getPackCatalogSettings, searchPackCatalog } from "../../api/packs";
import { getStats } from "../../api/stats";
import { getSyncStatus } from "../../api/sync";
import "./Menu.css";

const PACK_CAROUSEL_MS = 7000;
const POPULAR_PACK_LIMIT = 5;

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

function formatNumber(value) {
  if (value === null || value === undefined || value === "...") {
    return "...";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return numeric.toLocaleString("fr-FR");
}

function questionCountLabel(count) {
  if (count === null || count === undefined) {
    return "Questions";
  }

  return `${formatNumber(count)} question${count > 1 ? "s" : ""}`;
}

function packDownloadLabel(count) {
  if (count === null || count === undefined) {
    return "Catalogue";
  }

  return `${formatNumber(count)} téléchargement${count > 1 ? "s" : ""}`;
}

function syncLabel(status, loading, error) {
  if (loading) {
    return "Vérification";
  }

  if (error) {
    return "Indisponible";
  }

  return status?.signed_in ? "Connecté" : "Non connecté";
}

function syncCaption(status, loading, error) {
  if (loading) {
    return "Cloud";
  }

  if (error) {
    return "Sync";
  }

  return status?.signed_in
    ? status.account_email || "Compte connecté"
    : "Aucun compte";
}

function MenuSyncStatus({
  error,
  loading,
  onOpenSettingsSection,
  setMode,
  status
}) {
  const signedIn = Boolean(status?.signed_in);

  function openSyncSettings() {
    if (onOpenSettingsSection) {
      onOpenSettingsSection("settings-sync");
      return;
    }

    setMode("settings");
  }

  return (
    <div
      className={`menu-sync-card${signedIn ? " menu-sync-card-on" : ""}${error ? " menu-sync-card-error" : ""}`}
      aria-label={`Synchronisation: ${syncLabel(status, loading, error)}, ${syncCaption(status, loading, error)}`}
    >
      <span className="menu-sync-mark" aria-hidden="true">⇄</span>

      <span className="menu-sync-copy">
        <strong>{syncLabel(status, loading, error)}</strong>
        <span>{syncCaption(status, loading, error)}</span>
      </span>

      {!signedIn && (
        <button
          type="button"
          className="menu-sync-button"
          onClick={openSyncSettings}
        >
          Se connecter
        </button>
      )}
    </div>
  );
}

function MenuPackCarousel({
  activeIndex,
  cycleKey,
  error,
  loading,
  onOpenPack,
  onSelect,
  packs,
  setMode
}) {
  const activePack = packs[activeIndex] || null;
  const hasMultiple = packs.length > 1;

  function showPrevious() {
    if (!hasMultiple) return;
    onSelect((activeIndex - 1 + packs.length) % packs.length);
  }

  function showNext() {
    if (!hasMultiple) return;
    onSelect((activeIndex + 1) % packs.length);
  }

  function openPack() {
    if (activePack && onOpenPack) {
      onOpenPack(activePack);
      return;
    }

    setMode("packs");
  }

  if (loading) {
    return (
      <section className="menu-context-card menu-pack-card">
        <span className="menu-eyebrow">Catalogue</span>
        <h2>Packs populaires</h2>
        <p>Chargement du catalogue...</p>
      </section>
    );
  }

  if (error || !activePack) {
    return (
      <section className="menu-context-card menu-pack-card">
        <span className="menu-eyebrow">Catalogue</span>
        <h2>Packs populaires</h2>
        <p>{error || "Aucun pack populaire disponible."}</p>
        <button
          type="button"
          className="menu-context-action menu-context-action-teal"
          onClick={() => setMode("packs")}
        >
          <span>Ouvrir les packs</span>
          <span aria-hidden="true">→</span>
        </button>
      </section>
    );
  }

  return (
    <section
      role="button"
      tabIndex={0}
      className="menu-context-card menu-pack-card menu-pack-card-clickable"
      onClick={openPack}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPack();
        }
      }}
      aria-label={`Voir le pack ${activePack.name}`}
    >
      {hasMultiple && (
        <span className="menu-pack-progress-edge" aria-hidden="true">
          <span
            key={`${activePack.pack_guid || activeIndex}-${activeIndex}-${cycleKey}`}
            style={{ "--menu-pack-cycle-ms": `${PACK_CAROUSEL_MS}ms` }}
          />
        </span>
      )}

      <div className="menu-pack-slide">
        <span className="menu-eyebrow">Pack populaire</span>
        <h2>{activePack.name}</h2>
        {activePack.description && <p>{activePack.description}</p>}
      </div>

      <div className="menu-pack-meta">
        <span>{questionCountLabel(activePack.question_count)}</span>
        <span>{packDownloadLabel(activePack.download_count)}</span>
      </div>

      {hasMultiple && (
        <>
          <button
            type="button"
            className="menu-pack-arrow menu-pack-arrow-left"
            onClick={(event) => {
              event.stopPropagation();
              showPrevious();
            }}
            aria-label="Pack précédent"
            title="Pack précédent"
          >
            ‹
          </button>

          <button
            type="button"
            className="menu-pack-arrow menu-pack-arrow-right"
            onClick={(event) => {
              event.stopPropagation();
              showNext();
            }}
            aria-label="Pack suivant"
            title="Pack suivant"
          >
            ›
          </button>
        </>
      )}

      <div className="menu-pack-bottom">
        <div className="menu-pack-dots" aria-label="Packs populaires">
          {packs.map((pack, index) => (
            <button
              key={pack.pack_guid || `${pack.name}-${index}`}
              type="button"
              className={`menu-pack-dot${index === activeIndex ? " is-active" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(index);
              }}
              aria-label={`Voir le pack ${index + 1}`}
              aria-pressed={index === activeIndex}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function MenuStatsCard({ loading, error, stats }) {
  const counts = stats?.counts || {};
  const weakSpotCount = Object.values(stats?.weak_spots || {}).reduce(
    (total, items) => total + (Array.isArray(items) ? items.length : 0),
    0
  );
  const metrics = [
    {
      label: "Questions",
      value: loading ? "..." : formatNumber(counts.total ?? 0)
    },
    {
      label: "Maîtrisées",
      value: loading ? "..." : formatNumber(counts.mastered ?? 0)
    },
    {
      label: "Points faibles",
      value: loading ? "..." : formatNumber(weakSpotCount)
    }
  ];

  return (
    <section className={`menu-context-card menu-stats-card${error ? " menu-stats-card-error" : ""}`}>
      <div>
        <span className="menu-eyebrow">Progression</span>
        <h2>Statistiques</h2>
      </div>

      <div className="menu-stats-grid">
        {metrics.map((metric) => (
          <div className="menu-stat-tile" key={metric.label}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="menu-stats-footer">
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}

export default function Menu({
  setMode,
  startupNotice,
  onDismissStartupNotice,
  reviewSummary = null,
  reviewSummaryLoading = false,
  reviewSummaryError = "",
  onOpenSettingsSection = null,
  onOpenPack = null
}) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [menuStats, setMenuStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [popularPacks, setPopularPacks] = useState([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packsError, setPacksError] = useState("");
  const [activePackIndex, setActivePackIndex] = useState(0);
  const [packCycleSeed, setPackCycleSeed] = useState(0);

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
  const reviewDueCount = reviewSummary?.due_count ?? 0;
  const reviewTargetMode = "quiz";
  const reviewActionLabel = "Démarrer";
  const reviewIsClear = (
    !reviewSummaryLoading && !reviewSummaryError && reviewDueCount <= 0
  );
  const reviewTitle = reviewIsClear
    ? "Session terminée"
    : "Révision du jour";
  const reviewText = reviewIsClear
    ? "Répondre à de nouvelles questions pour les ajouter au flux de review."
    : "Lance la session due avec les questions texte, maps, images, timelines et séquences.";
  const reviewFooterTitle = reviewIsClear
    ? "Bonus"
    : "File active";
  const reviewFooterCaption = reviewIsClear
    ? "Questions neuves"
    : `${reviewCountCaption} aujourd'hui`;
  const reviewDialAngle = (
    reviewSummaryLoading || reviewSummaryError
      ? 90
      : reviewDueCount <= 0
        ? 0
        : Math.min(330, 72 + reviewDueCount * 18)
  );
  const reviewDialStyle = {
    "--menu-review-dial-angle": `${reviewDialAngle}deg`
  };

  const selectPack = useCallback((index) => {
    setActivePackIndex(index);
    setPackCycleSeed((seed) => seed + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    setSyncLoading(true);
    setSyncError("");

    getSyncStatus()
      .then((status) => {
        if (cancelled) return;

        setSyncStatus(status);
      })
      .catch((error) => {
        console.error(error);

        if (!cancelled) {
          setSyncError(error.message || "Statut sync indisponible.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSyncLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setStatsLoading(true);
    setStatsError("");

    getStats()
      .then((stats) => {
        if (cancelled) return;

        setMenuStats(stats);
      })
      .catch((error) => {
        console.error(error);

        if (!cancelled) {
          setStatsError(error.message || "Stats indisponibles.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStatsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setPacksLoading(true);
    setPacksError("");

    getPackCatalogSettings()
      .then((settings) => {
        if (!settings.url || !settings.key) {
          return { packs: [], configured: false };
        }

        return searchPackCatalog({
          sort: "populaires",
          status: "all",
          limit: POPULAR_PACK_LIMIT
        }).then((catalog) => ({ ...catalog, configured: true }));
      })
      .then((catalog) => {
        if (cancelled) return;

        const packs = Array.isArray(catalog?.packs) ? catalog.packs : [];
        setPopularPacks(packs);
        setActivePackIndex(0);
        setPacksError(
          catalog?.configured === false
            ? "Catalogue Supabase non configuré."
            : ""
        );
      })
      .catch((error) => {
        console.error(error);

        if (!cancelled) {
          setPacksError(error.message || "Catalogue impossible à charger.");
          setPopularPacks([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPacksLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (popularPacks.length <= 1) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      selectPack((activePackIndex + 1) % popularPacks.length);
    }, PACK_CAROUSEL_MS);

    return () => window.clearTimeout(timer);
  }, [activePackIndex, packCycleSeed, popularPacks.length, selectPack]);

  const activePackIndexBounded = useMemo(() => {
    if (popularPacks.length === 0) {
      return 0;
    }

    return Math.min(activePackIndex, popularPacks.length - 1);
  }, [activePackIndex, popularPacks.length]);

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

          <MenuSyncStatus
            error={syncError}
            loading={syncLoading}
            onOpenSettingsSection={onOpenSettingsSection}
            setMode={setMode}
            status={syncStatus}
          />
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
              aria-label={`${reviewTitle}: ${reviewCountValue} questions, ${reviewCountCaption}`}
              onClick={() => setMode(reviewTargetMode)}
            >
              <span className="menu-review-content">
                <span className="menu-pill menu-pill-amber">Review</span>

                <span>
                  <span className="menu-review-title">{reviewTitle}</span>
                  <span className="menu-review-text">
                    {reviewText}
                  </span>
                </span>
              </span>

              <span className="menu-review-visual" aria-hidden="true">
                <span className="menu-review-dial" style={reviewDialStyle}>
                  <span className="menu-review-dial-core">
                    <strong>{reviewCountValue}</strong>
                    <span>{reviewCountCaption}</span>
                  </span>
                </span>

                <span className="menu-review-lanes">
                  <span />
                  <span />
                  <span />
                </span>
              </span>

              <span className="menu-review-footer">
                <span className="menu-review-session-cue">
                  <span className="menu-review-session-icon" aria-hidden="true">
                    {reviewIsClear ? "+" : "↻"}
                  </span>
                  <span>
                    <strong>{reviewFooterTitle}</strong>
                    <span>{reviewFooterCaption}</span>
                  </span>
                </span>

                <span className="menu-review-action">
                  <span>{reviewActionLabel}</span>
                  <span className="menu-review-action-icon" aria-hidden="true">→</span>
                </span>
              </span>
            </button>

            <aside className="menu-context" aria-label="Résumé">
              <MenuPackCarousel
                activeIndex={activePackIndexBounded}
                cycleKey={packCycleSeed}
                error={packsError}
                loading={packsLoading}
                onOpenPack={onOpenPack}
                onSelect={selectPack}
                packs={popularPacks}
                setMode={setMode}
              />

              <MenuStatsCard
                error={statsError}
                loading={statsLoading}
                stats={menuStats}
              />
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
