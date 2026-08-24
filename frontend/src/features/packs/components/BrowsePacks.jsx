import { useEffect, useMemo, useState } from "react";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import {
  getPackTypeChipStyle,
  getQuestionTypeChipStyle,
  packTypeChipStyles
} from "../../../shared/questionTypes";
import { getStudySummary } from "../../../api/study";
import { fetchPackPreview } from "../../../api/packs";
import {
  numberLabel,
  questionCountLabel,
  recommendationFor
} from "../../study/studyRecommendation";
import {
  POPULAR_THEME,
  useBrowsePacks
} from "../hooks/useBrowsePacks";
import PackCard from "./PackCard";
import PackReviewsSection from "./PackReviewsSection";
import UnplacedTagRootsDialog from "./UnplacedTagRootsDialog";
import PublicationsManager from "./PublicationsManager";
import { formatSize } from "./packFormatting";
import "./BrowsePacks.css";

const PROGRESS_BUCKETS = [
  { key: "mastered", label: "Maîtrisé" },
  { key: "stable", label: "Stable" },
  { key: "fragile", label: "Fragile" },
  { key: "learning", label: "Apprentissage" },
  { key: "unseen", label: "Nouveau" }
];

const STATUS_FILTERS = [
  { value: "all", label: "Tous statuts" },
  { value: "not_installed", label: "À installer" },
  { value: "update_available", label: "Mises à jour" },
  { value: "up_to_date", label: "À jour" },
  { value: "local_copy", label: "Déjà présents" }
];

const TYPE_FILTERS = [
  { value: "all", label: "Tous types" },
  ...Object.entries(packTypeChipStyles).map(([value, style]) => ({
    value,
    label: style.label
  }))
];

const SORT_OPTIONS = [
  { value: "pertinence", label: "Pertinence" },
  { value: "populaires", label: "Populaires" },
  { value: "note", label: "Mieux notés" },
  { value: "récents", label: "Récents" },
  { value: "nom", label: "Nom" },
  { value: "questions", label: "Questions" }
];

function statusLabel(status) {
  if (status === "local_copy") {
    return "Déjà présent";
  }

  if (status === "update_available") {
    return "Changements disponibles";
  }

  if (status === "up_to_date") {
    return "Installé";
  }

  return "À installer";
}

function statusClassName(status) {
  if (status === "update_available") return "pack-status-pill-update";
  if (status === "not_installed") return "pack-status-pill-install";
  if (status === "local_copy") return "pack-status-pill-local";
  return "";
}

function StatePanel({ children, title }) {
  return (
    <div className="pack-state-panel">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function FieldSelect({ label, value, options, onChange }) {
  return (
    <label className="pack-toolbar-field">
      <span className="pack-field-label">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchToolbar({
  searchDraft,
  setSearchDraft,
  sort,
  setSort,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter
}) {
  return (
    <div className="pack-search-toolbar">
      <label className="pack-toolbar-search">
        <span className="pack-field-label">Recherche</span>
        <span className="pack-search-symbol" aria-hidden="true">⌕</span>
        <input
          aria-label="Rechercher un pack"
          type="search"
          placeholder="Titre, thème, licence..."
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
        />
      </label>

      <FieldSelect
        label="Type"
        value={typeFilter}
        options={TYPE_FILTERS}
        onChange={setTypeFilter}
      />
      <FieldSelect
        label="Statut"
        value={statusFilter}
        options={STATUS_FILTERS}
        onChange={setStatusFilter}
      />
      <FieldSelect
        label="Tri"
        value={sort}
        options={SORT_OPTIONS}
        onChange={setSort}
      />
    </div>
  );
}

function ThemeRail({ activeTheme, loading, onSelectTheme, themes }) {
  return (
    <aside className="pack-theme-panel app-scrollbar" aria-label="Thèmes">
      <div className="pack-section-head">
        <div>
          <h2>Thèmes</h2>
          <p>{themes.length} entrée{themes.length > 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="pack-theme-list">
        {themes.map((theme) => {
          const active = activeTheme === theme.value;

          return (
            <button
              key={theme.value}
              type="button"
              className={`pack-theme-button${active ? " is-active" : ""}`}
              onClick={() => onSelectTheme(theme.value)}
              aria-pressed={active}
            >
              <span>{theme.label}</span>
              {theme.result_count !== null && theme.result_count !== undefined && (
                <strong>{theme.result_count}</strong>
              )}
            </button>
          );
        })}

        {!loading && themes.length === 0 && (
          <div className="pack-theme-empty">
            Aucun thème disponible.
          </div>
        )}
      </div>
    </aside>
  );
}

function CatalogueState({ error, loading, reload }) {
  if (loading) {
    return (
      <StatePanel title="Chargement du catalogue">
        <p>Recherche dans le catalogue.</p>
      </StatePanel>
    );
  }

  if (error) {
    return (
      <StatePanel title="Catalogue indisponible">
        <p role="alert">{error}</p>
        <button
          type="button"
          className="pack-secondary-button"
          onClick={reload}
        >
          Réessayer
        </button>
      </StatePanel>
    );
  }

  return null;
}

function estimatedTimeLabel(minutes) {
  const value = Number(minutes || 0);

  if (!value) return null;

  if (value < 60) return `~${value} min`;

  const hours = Math.floor(value / 60);
  const rest = value % 60;

  return rest ? `~${hours} h ${String(rest).padStart(2, "0")}` : `~${hours} h`;
}


function PackChipGroup({ label, values }) {
  if (!values || values.length === 0) return null;

  return (
    <div className="pack-detail-chip-group">
      <span className="pack-detail-chip-label">{label}</span>
      <div className="pack-chip-row">
        {values.map((value) => (
          <span className="pack-chip" key={value}>{value}</span>
        ))}
      </div>
    </div>
  );
}


function PackPreviewPanel({ entry }) {
  const [state, setState] = useState({ status: "idle", data: null, error: "" });
  const [revealed, setRevealed] = useState(() => new Set());

  function loadPreview() {
    setState({ status: "loading", data: null, error: "" });
    setRevealed(new Set());

    fetchPackPreview(entry.pack_guid, entry.download_url)
      .then((data) => setState({ status: "ready", data, error: "" }))
      .catch((error) => {
        setState({
          status: "error",
          data: null,
          error: error.message || "Aperçu impossible."
        });
      });
  }

  function toggleReveal(index) {
    setRevealed((current) => {
      const next = new Set(current);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  }

  if (state.status === "idle") {
    return (
      <div className="pack-preview-panel">
        <button
          type="button"
          className="pack-secondary-button"
          disabled={!entry.download_url}
          onClick={loadPreview}
        >
          Voir un aperçu
        </button>
      </div>
    );
  }

  const itemTypes = state.data?.item_types || [];

  return (
    <div className="pack-preview-panel">
      <div className="pack-section-head">
        <div>
          <h3>Aperçu</h3>
          {itemTypes.length > 0 && (
            <p>
              {itemTypes
                .map((typeEntry) => `${getQuestionTypeChipStyle(typeEntry.type_q).label} × ${typeEntry.count}`)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      {state.status === "loading" && (
        <div className="pack-status" role="status">Chargement de l'aperçu...</div>
      )}

      {state.status === "error" && (
        <div className="pack-alert" role="alert">{state.error}</div>
      )}

      {state.status === "ready" && (
        <ul className="pack-preview-list">
          {state.data.samples.map((sample, index) => (
            <li className="pack-preview-item" key={index}>
              <span className="pack-preview-question">{sample.question}</span>
              <button
                type="button"
                className="pack-preview-answer-toggle"
                onClick={() => toggleReveal(index)}
              >
                {revealed.has(index) ? sample.answer : "Révéler la réponse"}
              </button>
            </li>
          ))}
          {state.data.truncated && (
            <li className="pack-preview-more">
              + {numberLabel(state.data.question_count - state.data.sample_count)} autres questions
            </li>
          )}
        </ul>
      )}
    </div>
  );
}


function PackProgressPanel({ entry }) {
  const [state, setState] = useState({
    status: "loading",
    summary: null,
    error: ""
  });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading", summary: null, error: "" });

    getStudySummary({ type: "pack", packGuid: entry.pack_guid })
      .then((summary) => {
        if (!cancelled) setState({ status: "ready", summary, error: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            summary: null,
            error: error.message || "Progression indisponible."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entry.pack_guid]);

  if (state.status === "loading") {
    return (
      <div className="pack-progress-panel">
        <div className="pack-status" role="status">Chargement de la progression...</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="pack-progress-panel">
        <div className="pack-alert" role="alert">{state.error}</div>
      </div>
    );
  }

  const summary = state.summary;
  const counts = summary.counts || {};
  const buckets = summary.buckets || {};
  const total = Math.max(1, counts.active_questions || 0);
  const recommendation = recommendationFor(summary);

  return (
    <div className="pack-progress-panel">
      <div className="pack-section-head">
        <div>
          <h3>Progression installée</h3>
          <p>{questionCountLabel(counts.total_atomic_questions)}</p>
        </div>
      </div>

      <div className="pack-progress-bars">
        {PROGRESS_BUCKETS.map((bucket) => {
          const value = buckets[bucket.key] || 0;
          const percent = Math.round((value / total) * 100);

          return (
            <div className="pack-progress-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="pack-progress-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
              </div>
              <strong>{numberLabel(value)}</strong>
            </div>
          );
        })}
      </div>

      <div className="pack-recommendation">
        <span>Prochaine action</span>
        <strong>{recommendation.title}</strong>
        <span>{recommendation.detail}</span>
      </div>
    </div>
  );
}


function PackDetailPanel({
  item,
  onInstall,
  onOpenGroup,
  onOpenStudy,
  onUnsubscribe,
  onUpdate,
  setMode
}) {
  if (!item) {
    return (
      <aside className="pack-detail-panel pack-detail-empty">
        Sélectionne un pack.
      </aside>
    );
  }

  const {
    entry,
    status,
    isMine,
    localGroupId,
    action
  } = item;
  const typeStyle = getPackTypeChipStyle(entry.type_group);
  const sizeLabel = formatSize(entry.size_bytes);
  const canUnsubscribe = (
    status === "up_to_date" || status === "update_available"
  );
  const canOpenGroup = Boolean(localGroupId && onOpenGroup);
  const canOpenStudy = Boolean(canUnsubscribe && entry.pack_guid && onOpenStudy);

  return (
    <aside className="pack-detail-panel app-scrollbar" aria-label="Détail du pack">
      <div className="pack-card-topline">
        <span
          className="pack-type-chip"
          style={{
            "--pack-type-bg": typeStyle.background,
            "--pack-type-color": typeStyle.color
          }}
        >
          {typeStyle.label}
        </span>
        <span className="pack-card-pill-row">
          {isMine && (
            <span className="pack-status-pill pack-status-pill-owned">
              Mon pack
            </span>
          )}
          <span className={`pack-status-pill ${statusClassName(status)}`}>
            {statusLabel(status)}
          </span>
        </span>
      </div>

      <div>
        <h2>{entry.name}</h2>
        {entry.description && (
          <p className="pack-detail-description">{entry.description}</p>
        )}
      </div>

      <div className="pack-detail-stat-grid">
        <div className="pack-detail-stat">
          <span>Questions</span>
          <strong>{entry.question_count ?? "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Téléchargements</span>
          <strong>{entry.download_count?.toLocaleString("fr-FR") ?? "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Taille</span>
          <strong>{sizeLabel || "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Licence</span>
          <strong>{entry.license || "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Temps estimé</span>
          <strong>{estimatedTimeLabel(entry.estimated_minutes) || "—"}</strong>
        </div>
      </div>

      <PackChipGroup label="Thèmes" values={entry.themes} />
      <PackChipGroup label="Tags" values={entry.tags} />

      <div className="pack-action-row">
        {status === "not_installed" && (
          <button
            type="button"
            className="pack-primary-button"
            disabled={action.busy}
            onClick={() => onInstall(entry)}
          >
            {action.busy ? "Import..." : "Installer"}
          </button>
        )}

        {status === "update_available" && (
          <button
            type="button"
            className="pack-primary-button"
            disabled={action.busy}
            onClick={() => onUpdate(entry, { deleteRemoved: false })}
          >
            {action.busy ? "Mise à jour..." : "Mettre à jour"}
          </button>
        )}

        {canOpenGroup && (
          <button
            type="button"
            className="pack-secondary-button"
            disabled={action.busy}
            onClick={() => onOpenGroup(localGroupId)}
          >
            Ouvrir dans le gestionnaire ↗
          </button>
        )}

        {canOpenStudy && (
          <button
            type="button"
            className="pack-secondary-button pack-study-button"
            disabled={action.busy}
            onClick={() => onOpenStudy({
              type: "pack",
              packGuid: entry.pack_guid,
              name: entry.name
            })}
          >
            Étudier ce pack
          </button>
        )}

        {canUnsubscribe && (
          <button
            type="button"
            className="pack-secondary-button"
            disabled={action.busy}
            onClick={() => onUnsubscribe(entry.pack_guid)}
          >
            Se désabonner
          </button>
        )}
      </div>

      {status === "local_copy" && (
        <div className="pack-status">
          Ce pack existe déjà dans tes groupes locaux.
        </div>
      )}

      {action.error && (
        <div className="pack-alert" role="alert">
          {action.error}
        </div>
      )}

      {canOpenStudy && (
        <PackProgressPanel entry={entry} key={`progress-${entry.pack_guid}`} />
      )}

      <PackPreviewPanel entry={entry} key={`preview-${entry.pack_guid}`} />

      <PackReviewsSection entry={entry} isOwner={isMine} setMode={setMode} />
    </aside>
  );
}

function ImporterScreen({
  initialPackGuid,
  initialSearch,
  onInitialPackHandled,
  onOpenGroup,
  onOpenStudy,
  setMode
}) {
  const [activeTheme, setActiveTheme] = useState(POPULAR_THEME);
  const [searchDraft, setSearchDraft] = useState(initialSearch || "");
  const [search, setSearch] = useState((initialSearch || "").trim());
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState(initialPackGuid ? "populaires" : "pertinence");
  const [activeGuid, setActiveGuid] = useState(initialPackGuid || null);

  useEffect(() => {
    if (!initialPackGuid && !initialSearch) {
      return;
    }

    setActiveTheme(POPULAR_THEME);
    setSearchDraft(initialSearch || "");
    setSearch((initialSearch || "").trim());
    setStatusFilter("all");
    setSort("populaires");
    setActiveGuid(initialPackGuid || null);
    onInitialPackHandled?.();
  }, [initialPackGuid, initialSearch, onInitialPackHandled]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  const filters = useMemo(() => ({
    search,
    theme: activeTheme,
    type: typeFilter,
    status: statusFilter,
    sort,
    limit: 24
  }), [activeTheme, search, sort, statusFilter, typeFilter]);

  const {
    facets,
    items,
    loading,
    loadingMore,
    error,
    total,
    hasMore,
    reload,
    loadMore,
    install,
    update,
    unsubscribe,
    unplacedTagRoots = [],
    clearUnplacedTagRoots
  } = useBrowsePacks(filters);

  const themes = facets?.themes || [];
  const activeItem = activeGuid
    ? items.find((item) => item.entry.pack_guid === activeGuid)
    : null;
  const selectedItem = (
    activeItem ||
    items[0] ||
    null
  );
  const showStatePanel = loading || Boolean(error);

  return (
    <div className="pack-import-layout">
      {unplacedTagRoots.length > 0 && (
        <UnplacedTagRootsDialog
          roots={unplacedTagRoots}
          onClose={clearUnplacedTagRoots}
        />
      )}

      <ThemeRail
        activeTheme={activeTheme}
        loading={loading}
        onSelectTheme={setActiveTheme}
        themes={themes}
      />

      <section className="pack-panel pack-results-panel app-scrollbar" aria-label="Catalogue">
        <div className="pack-section-head">
          <div>
            <h2>Catalogue</h2>
            <p>
              {loading ? "Chargement" : `${items.length} sur ${total} résultat${total > 1 ? "s" : ""}`}
            </p>
          </div>
          <span className="pack-count-pill">{total}</span>
        </div>

        <SearchToolbar
          searchDraft={searchDraft}
          setSearchDraft={setSearchDraft}
          sort={sort}
          setSort={setSort}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
        />

        {showStatePanel ? (
          <CatalogueState
            error={error}
            loading={loading}
            reload={reload}
          />
        ) : (
          <>
            {items.length === 0 ? (
              <StatePanel title="Aucun résultat">
                <p>Aucun pack ne correspond à cette recherche.</p>
              </StatePanel>
            ) : (
              <div className="pack-dense-list">
                {items.map((item) => (
                  <PackCard
                    key={item.entry.pack_guid}
                    density="row"
                    item={item}
                    onInstall={install}
                    onOpenGroup={onOpenGroup}
                    onSelect={(nextItem) => setActiveGuid(nextItem.entry.pack_guid)}
                    onUpdate={update}
                    selected={selectedItem?.entry.pack_guid === item.entry.pack_guid}
                  />
                ))}
              </div>
            )}

            {hasMore && (
              <button
                type="button"
                className="pack-secondary-button pack-load-more"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Chargement..." : "Charger plus"}
              </button>
            )}
          </>
        )}
      </section>

      <PackDetailPanel
        item={selectedItem}
        onInstall={install}
        onOpenGroup={onOpenGroup}
        onOpenStudy={onOpenStudy}
        onUnsubscribe={unsubscribe}
        onUpdate={update}
        setMode={setMode}
      />
    </div>
  );
}

export default function BrowsePacks({
  setMode,
  onOpenGroup,
  onOpenStudy,
  initialPackGuid = null,
  initialSearch = "",
  onInitialPackHandled = null
}) {
  const [activeTab, setActiveTab] = useState("import");

  useEffect(() => {
    if (initialPackGuid || initialSearch) {
      setActiveTab("import");
    }
  }, [initialPackGuid, initialSearch]);

  return (
    <div className={`pack-screen pack-layout-dense pack-tab-${activeTab}`}>
      <div className="pack-shell">
        <header className="pack-header" aria-label="Packs">
          <div className="pack-title-row">
            <div className="pack-mark" aria-hidden="true">▣</div>
            <div className="pack-title-block">
              <div className="pack-overline">Catalogue</div>
              <h1>Packs</h1>
              <p>Découvrir des packs partagés et publier les tiens.</p>
            </div>
          </div>

          <div className="pack-header-actions">
            {/*
              Two tabs, not three: publishing and managing what you published
              are the same job, and the old split put a "Publier" button in
              both places.
            */}
            <div className="pack-tab-list" role="tablist" aria-label="Menus Packs">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "import"}
                className={`pack-tab-button${activeTab === "import" ? " is-active" : ""}`}
                onClick={() => setActiveTab("import")}
              >
                Découvrir
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "manage"}
                className={`pack-tab-button${activeTab === "manage" ? " is-active" : ""}`}
                onClick={() => setActiveTab("manage")}
              >
                Publier
              </button>
            </div>

            <ReturnToMenuButton
              onClick={() => setMode("menu")}
              className="pack-back"
            />
          </div>
        </header>

        {activeTab === "import" && (
          <ImporterScreen
            initialPackGuid={initialPackGuid}
            initialSearch={initialSearch}
            onInitialPackHandled={onInitialPackHandled}
            onOpenGroup={onOpenGroup}
            onOpenStudy={onOpenStudy}
            setMode={setMode}
          />
        )}
        {activeTab === "manage" && (
          <PublicationsManager setMode={setMode} onOpenGroup={onOpenGroup} />
        )}
      </div>
    </div>
  );
}
