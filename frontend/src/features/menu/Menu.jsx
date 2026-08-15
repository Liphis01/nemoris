import { useCallback, useEffect, useMemo, useState } from "react";
import { searchPackCatalog } from "../../api/packs";
import { getProfile } from "../../api/profile";
import { getStats } from "../../api/stats";
import "./Menu.css";

const PACK_CAROUSEL_MS = 7000;
const POPULAR_PACK_LIMIT = 5;

const destinations = [
  {
    mode: "manage",
    eyebrow: "Bibliothèque",
    title: "Gestionnaire",
    description: "Questions, tags, groupes, playlists et maps.",
    detail: "Édition rapide",
    accent: "violet",
    icon: "✎"
  },
  {
    mode: "training",
    eyebrow: "Libre",
    title: "Entrainement",
    description: "Pratiquer un groupe, une playlist ou un tag sans modifier le planning.",
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
    mode: "profile",
    eyebrow: "Identité",
    title: "Profil",
    description: "Pseudo, avatar et résumé de ta progression.",
    detail: "Compte",
    accent: "blue",
    icon: "☺"
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

  return String(sessionCount(summary));
}

// Due reviews plus the new questions intake will introduce today: the dial and
// its caption describe the whole session, not just the backlog.
function sessionCount(summary) {
  return summary?.session_count
    ?? ((summary?.due_count ?? 0) + (summary?.new_count ?? 0));
}

function reviewDueCaption(summary, loading, error) {
  if (loading) {
    return "Calcul";
  }

  if (error) {
    return "Indisponible";
  }

  return sessionCount(summary) === 0 ? "À jour" : "À faire";
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


// The carousel is the tall card now, so each pack gets an emblem built from its
// own name to fill the space between the title and the meta row.
function packInitial(name) {
  const letter = String(name || "").trim().charAt(0);

  return letter ? letter.toUpperCase() : "◫";
}


function pickStudyTarget(guidance) {
  if (!guidance) return null;

  const fragileLoad = guidance.fragile_upcoming_load_groups?.[0];
  if (fragileLoad) {
    return {
      group: fragileLoad,
      title: fragileLoad.name,
      detail: `${fragileLoad.fragile_count} fragiles · ${fragileLoad.upcoming_load} dues bientôt`,
      label: "Charge fragile"
    };
  }

  const weakest = guidance.weakest_groups?.[0];
  if (weakest) {
    return {
      group: weakest,
      title: weakest.name,
      detail: `${weakest.fragile_count}/${weakest.total} fragiles`,
      label: "Groupe fragile"
    };
  }

  const closeToMastery = guidance.close_to_mastery_groups?.[0];
  if (closeToMastery) {
    return {
      group: closeToMastery,
      title: closeToMastery.name,
      detail: `${closeToMastery.mastered}/${closeToMastery.total} maîtrisées`,
      label: "Proche maîtrise"
    };
  }

  const improving = guidance.improving_groups?.[0];
  if (improving) {
    return {
      group: improving,
      title: improving.name,
      detail: `+${improving.delta} pts de rétention`,
      label: "En progression"
    };
  }

  return null;
}


function MenuAccountChip({
  loading,
  onOpenSettingsSection,
  profile,
  setMode,
  signedIn
}) {
  const label = loading
    ? "Chargement"
    : signedIn
      ? (profile?.username || "Pseudo à choisir")
      : "Non connecté";
  const caption = loading ? "..." : signedIn ? "Connecté" : "Aucun compte";

  function openProfile() {
    setMode("profile");
  }

  function openSignIn(event) {
    event.stopPropagation();

    if (onOpenSettingsSection) {
      onOpenSettingsSection("settings-sync");
      return;
    }

    setMode("settings");
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`menu-account-chip${signedIn ? " menu-account-chip-on" : ""}`}
      onClick={openProfile}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProfile();
        }
      }}
      aria-label={`Ouvrir le profil${signedIn ? ` de ${label}` : ""}`}
    >
      {loading ? (
        <span className="menu-account-avatar menu-account-avatar-neutral" aria-hidden="true">…</span>
      ) : signedIn ? (
        <span
          className={`menu-account-avatar menu-account-avatar-${profile?.avatar_color || "neutral"}`}
          aria-hidden="true"
        >
          {profile?.avatar_emoji || "🙂"}
        </span>
      ) : (
        <span className="menu-account-avatar menu-account-avatar-neutral" aria-hidden="true">
          ?
        </span>
      )}

      <span className="menu-account-copy">
        <strong>{label}</strong>
        <span>{caption}</span>
      </span>

      {!loading && !signedIn && (
        <button
          type="button"
          className="menu-account-button"
          onClick={openSignIn}
        >
          Se connecter
        </button>
      )}
    </div>
  );
}


// Compact companion of the pack carousel: one line of guidance, no stat chips.
// The whole row is the affordance, so the card stays short under the carousel.
function MenuStudyCard({
  error,
  loading,
  onOpenStudy,
  setMode,
  stats
}) {
  const target = pickStudyTarget(stats?.guidance);

  function openTarget() {
    if (error) {
      setMode("profile");
      return;
    }

    if (target?.group && onOpenStudy) {
      onOpenStudy({
        type: "group",
        id: target.group.id,
        name: target.group.name,
        type_group: target.group.type_group
      });
      return;
    }

    setMode("training");
  }

  if (loading) {
    return (
      <section className="menu-context-card menu-study-card">
        <span className="menu-study-icon" aria-hidden="true">◎</span>

        <span className="menu-study-copy">
          <span className="menu-eyebrow">À étudier</span>
          <h2>Analyse en cours</h2>
          <p>Lecture de tes priorités.</p>
        </span>
      </section>
    );
  }

  const eyebrow = error ? "À étudier" : (target?.label || "À étudier");
  const title = error
    ? "Guidage indisponible"
    : (target?.title || "Rien d'urgent");
  const detail = error
    ? error
    : (target?.detail || "Aucun groupe prioritaire pour le moment.");
  const label = error
    ? "Ouvrir le profil"
    : target
      ? `Étudier ${target.title}`
      : "Ouvrir l'entraînement";

  return (
    <section
      role="button"
      tabIndex={0}
      className={`menu-context-card menu-study-card menu-study-card-clickable${error ? " menu-study-card-error" : ""}`}
      onClick={openTarget}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTarget();
        }
      }}
      aria-label={label}
    >
      <span className="menu-study-icon" aria-hidden="true">◎</span>

      <span className="menu-study-copy">
        <span className="menu-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </span>

      <span className="menu-study-arrow" aria-hidden="true">→</span>
    </section>
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
      <section className="menu-context-card menu-pack-card menu-pack-card-quiet">
        <span className="menu-eyebrow">Catalogue</span>
        <h2>Packs populaires</h2>
        <p>Chargement du catalogue...</p>
      </section>
    );
  }

  if (error || !activePack) {
    return (
      <section className="menu-context-card menu-pack-card menu-pack-card-quiet">
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

      <div className="menu-pack-visual" aria-hidden="true">
        <span className="menu-pack-emblem">{packInitial(activePack.name)}</span>
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

export default function Menu({
  setMode,
  startupNotice,
  onDismissStartupNotice,
  reviewSummary = null,
  reviewSummaryLoading = false,
  reviewSummaryError = "",
  onOpenSettingsSection = null,
  onOpenPack = null,
  onOpenStudy = null,
  onStartReview = null
}) {
  const [menuStats, setMenuStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [menuProfile, setMenuProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
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
  // New questions are introduced automatically, so the tile counts them as part
  // of the session: with 0 due but new ones queued, there is still work to do.
  const reviewNewCount = reviewSummary?.new_count ?? 0;
  const reviewSessionCount = reviewSummary?.session_count
    ?? (reviewDueCount + reviewNewCount);
  const reviewActionLabel = "Démarrer";
  const reviewIsClear = (
    !reviewSummaryLoading && !reviewSummaryError && reviewSessionCount <= 0
  );
  const reviewTitle = reviewIsClear
    ? "Session terminée"
    : "Révision du jour";
  const reviewText = reviewIsClear
    ? "Rien à réviser aujourd'hui. De nouvelles questions arriveront au fil de tes progrès."
    : "Lance la session du jour avec les questions texte, maps, images, timelines et séquences.";
  const reviewFooterTitle = reviewIsClear
    ? "À jour"
    : "File active";
  const reviewFooterCaption = reviewIsClear
    ? "Rien en attente"
    : `${reviewCountCaption} aujourd'hui`;
  const reviewDialAngle = (
    reviewSummaryLoading || reviewSummaryError
      ? 90
      : reviewSessionCount <= 0
        ? 0
        : Math.min(330, 72 + reviewSessionCount * 18)
  );
  const reviewDialStyle = {
    "--menu-review-dial-angle": `${reviewDialAngle}deg`
  };

  function startGlobalReview() {
    if (onStartReview) {
      onStartReview();
      return;
    }

    setMode("quiz");
  }

  const selectPack = useCallback((index) => {
    setActivePackIndex(index);
    setPackCycleSeed((seed) => seed + 1);
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

    setProfileLoading(true);

    getProfile()
      .then((profile) => {
        if (cancelled) return;

        setMenuProfile(profile);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) {
          setProfileLoading(false);
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

    searchPackCatalog({
      sort: "populaires",
      status: "all",
      limit: POPULAR_PACK_LIMIT
    })
      .then((catalog) => {
        if (cancelled) return;

        const packs = Array.isArray(catalog?.packs) ? catalog.packs : [];
        setPopularPacks(packs);
        setActivePackIndex(0);
        setPacksError("");
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

          <MenuAccountChip
            loading={profileLoading}
            onOpenSettingsSection={onOpenSettingsSection}
            profile={menuProfile?.profile}
            setMode={setMode}
            signedIn={Boolean(menuProfile?.signed_in)}
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
              onClick={startGlobalReview}
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

              <MenuStudyCard
                error={statsError}
                loading={statsLoading}
                onOpenStudy={onOpenStudy}
                setMode={setMode}
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
