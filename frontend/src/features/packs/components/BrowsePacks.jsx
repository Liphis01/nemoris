import { useEffect, useMemo, useState } from "react";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import {
  getPackTypeChipStyle,
  packTypeChipStyles
} from "../../../shared/questionTypes";
import {
  POPULAR_THEME,
  useBrowsePacks
} from "../hooks/useBrowsePacks";
import PackCard from "./PackCard";
import PackReviewsSection from "./PackReviewsSection";
import PublicationsManager from "./PublicationsManager";
import { formatSize, questionCountLabel } from "./packFormatting";
import "./BrowsePacks.css";

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

function downloadCountLabel(count) {
  if (count === null || count === undefined) {
    return null;
  }

  return `${count.toLocaleString("fr-FR")} téléchargement${count > 1 ? "s" : ""}`;
}

function statusLabel(status, installedVersion) {
  if (status === "local_copy") {
    return "Déjà présent";
  }

  if (status === "update_available") {
    return installedVersion ? `v${installedVersion} installée` : "Mise à jour";
  }

  if (status === "up_to_date") {
    return installedVersion ? `À jour v${installedVersion}` : "À jour";
  }

  return "À installer";
}

function statusClassName(status) {
  if (status === "update_available") return "pack-status-pill-update";
  if (status === "not_installed") return "pack-status-pill-install";
  if (status === "local_copy") return "pack-status-pill-local";
  return "";
}

function versionCheckLabel(status) {
  if (status === "update_available") return "Mise à jour disponible";
  if (status === "up_to_date") return "À jour";
  if (status === "local_copy") return "Présent localement";
  return "Non installé";
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

function CatalogueState({ catalogUrl, error, loading, reload, setMode }) {
  if (loading) {
    return (
      <StatePanel title="Chargement du catalogue">
        <p>Recherche dans le catalogue Supabase.</p>
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

  if (catalogUrl === null) {
    return (
      <StatePanel title="Catalogue Supabase non configuré">
        <p>Ajoute l'URL du projet et la clé publishable dans les paramètres.</p>
        <button
          type="button"
          className="pack-primary-button"
          onClick={() => setMode("settings")}
        >
          Configurer le catalogue
        </button>
      </StatePanel>
    );
  }

  return null;
}

function PackDetailPanel({
  item,
  onInstall,
  onOpenGroup,
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
    installedVersion,
    hasLocalContent,
    isMine,
    localGroupId,
    localPackVersion,
    action
  } = item;
  const typeStyle = getPackTypeChipStyle(entry.type_group);
  const sizeLabel = formatSize(entry.size_bytes);
  const downloadLabel = downloadCountLabel(entry.download_count);
  const canUnsubscribe = (
    status === "up_to_date" || status === "update_available"
  );
  const canOpenGroup = Boolean(localGroupId && onOpenGroup);

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
            {statusLabel(status, installedVersion)}
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
          <span>Catalogue</span>
          <strong>v{entry.version ?? "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Statut</span>
          <strong>{versionCheckLabel(status)}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Local</span>
          <strong>{hasLocalContent ? "Déjà présent" : "Absent"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Propriétaire</span>
          <strong>{isMine ? "Moi" : "Autre"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Taille</span>
          <strong>{sizeLabel || "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Licence</span>
          <strong>{entry.license || "—"}</strong>
        </div>
      </div>

      <div className="pack-detail-meta">
        <span>{questionCountLabel(entry.question_count)}</span>
        {downloadLabel && <span>{downloadLabel}</span>}
        {installedVersion && <span>v{installedVersion} installée</span>}
        {!installedVersion && localPackVersion && (
          <span>v{localPackVersion} locale</span>
        )}
      </div>

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

      <PackReviewsSection entry={entry} setMode={setMode} />
    </aside>
  );
}

function ImporterScreen({
  initialPackGuid,
  initialSearch,
  onInitialPackHandled,
  onOpenGroup,
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
    catalogUrl,
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
    unsubscribe
  } = useBrowsePacks(filters);

  const themes = facets?.themes || [];
  const selectedItem = (
    items.find((item) => item.entry.pack_guid === activeGuid) ||
    items[0] ||
    null
  );
  const showStatePanel = loading || Boolean(error) || catalogUrl === null;

  return (
    <div className="pack-import-layout">
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
            catalogUrl={catalogUrl}
            error={error}
            loading={loading}
            reload={reload}
            setMode={setMode}
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
