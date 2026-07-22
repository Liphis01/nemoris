import { useEffect, useMemo, useState } from "react";
import { exportPackGroup } from "../../../api/packs";
import { listGroups } from "../../../api/groups";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import {
  getQuestionTypeChipStyle,
  questionTypeChipStyles
} from "../../../shared/questionTypes";
import {
  POPULAR_THEME,
  useBrowsePacks
} from "../hooks/useBrowsePacks";
import PackCard from "./PackCard";
import { formatSize } from "./packFormatting";
import "./BrowsePacks.css";

const STATUS_FILTERS = [
  { value: "all", label: "Tous statuts" },
  { value: "not_installed", label: "À installer" },
  { value: "update_available", label: "Mises à jour" },
  { value: "up_to_date", label: "Installés" }
];

const TYPE_FILTERS = [
  { value: "all", label: "Tous types" },
  ...Object.entries(questionTypeChipStyles).map(([value, style]) => ({
    value,
    label: style.label
  }))
];

const SORT_OPTIONS = [
  { value: "pertinence", label: "Pertinence" },
  { value: "populaires", label: "Populaires" },
  { value: "récents", label: "Récents" },
  { value: "nom", label: "Nom" },
  { value: "questions", label: "Questions" }
];

function questionCountLabel(count) {
  if (count === null || count === undefined) {
    return "questions";
  }

  return `${count} question${count > 1 ? "s" : ""}`;
}

function downloadCountLabel(count) {
  if (count === null || count === undefined) {
    return null;
  }

  return `${count.toLocaleString("fr-FR")} téléchargement${count > 1 ? "s" : ""}`;
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
  onUnsubscribe,
  onUpdate
}) {
  if (!item) {
    return (
      <aside className="pack-detail-panel pack-detail-empty">
        Sélectionne un pack.
      </aside>
    );
  }

  const { entry, status, installedVersion, action } = item;
  const typeStyle = getQuestionTypeChipStyle(entry.type_group);
  const sizeLabel = formatSize(entry.size_bytes);
  const downloadLabel = downloadCountLabel(entry.download_count);

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
        <span className="pack-status-pill">
          {status === "not_installed" ? "À installer" : "Installé"}
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
          <span>Version</span>
          <strong>v{entry.version ?? "—"}</strong>
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

        {status !== "not_installed" && (
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

      {action.error && (
        <div className="pack-alert" role="alert">
          {action.error}
        </div>
      )}
    </aside>
  );
}

function ImporterScreen({ setMode }) {
  const [activeTheme, setActiveTheme] = useState(POPULAR_THEME);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("pertinence");
  const [activeGuid, setActiveGuid] = useState(null);

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
        onUnsubscribe={unsubscribe}
        onUpdate={update}
      />
    </div>
  );
}

function ExporterScreen() {
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [groupsError, setGroupsError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("1");
  const [license, setLicense] = useState("");
  const [description, setDescription] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let cancelled = false;

    setLoadingGroups(true);
    setGroupsError("");

    listGroups()
      .then((rows) => {
        if (cancelled) return;

        const nextGroups = Array.isArray(rows) ? rows : [];
        setGroups(nextGroups);

        if (nextGroups.length) {
          setSelectedGroupId(String(nextGroups[0].id));
          setTitle(nextGroups[0].name || "");
        }
      })
      .catch((error) => {
        console.error(error);

        if (!cancelled) {
          setGroupsError(error.message || "Groupes impossibles à charger.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingGroups(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedGroup = groups.find((group) => String(group.id) === selectedGroupId);
  const versionNumber = Number(version);
  const canExport = (
    selectedGroup &&
    !exporting &&
    title.trim() &&
    Number.isFinite(versionNumber) &&
    versionNumber >= 1 &&
    (selectedGroup.question_count || 0) > 0
  );

  async function handleExport(event) {
    event.preventDefault();

    if (!canExport) {
      return;
    }

    setExporting(true);
    setExportStatus("");
    setExportError("");

    try {
      const filename = await exportPackGroup(selectedGroup.id, {
        version: Math.floor(versionNumber),
        name: title.trim(),
        description: description.trim(),
        license: license.trim()
      });
      setExportStatus(`Pack exporté : ${filename}`);
    } catch (error) {
      console.error(error);
      setExportError(error.message || "Export impossible.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="pack-export-layout">
      <section className="pack-panel app-scrollbar" aria-label="Groupes exportables">
        <div className="pack-section-head">
          <div>
            <h2>Groupes</h2>
            <p>{groups.length} groupe{groups.length > 1 ? "s" : ""}</p>
          </div>
        </div>

        {loadingGroups && (
          <StatePanel title="Chargement">
            <p>Groupes locaux en cours de chargement.</p>
          </StatePanel>
        )}

        {!loadingGroups && groupsError && (
          <StatePanel title="Groupes indisponibles">
            <p role="alert">{groupsError}</p>
          </StatePanel>
        )}

        {!loadingGroups && !groupsError && (
          <div className="pack-export-group-list">
            {groups.map((group) => {
              const active = String(group.id) === selectedGroupId;
              const typeStyle = getQuestionTypeChipStyle(group.type_group);

              return (
                <button
                  key={group.id}
                  type="button"
                  className={`pack-export-group${active ? " is-active" : ""}`}
                  onClick={() => {
                    setSelectedGroupId(String(group.id));
                    setTitle(group.name || "");
                  }}
                  aria-pressed={active}
                >
                  <span>{group.name}</span>
                  <small
                    style={{
                      "--pack-type-bg": typeStyle.background,
                      "--pack-type-color": typeStyle.color
                    }}
                  >
                    {typeStyle.label} · {questionCountLabel(group.question_count)}
                  </small>
                </button>
              );
            })}

            {groups.length === 0 && (
              <div className="pack-theme-empty">
                Aucun groupe exportable.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="pack-export-panel app-scrollbar" aria-label="Exporter un pack">
        <div className="pack-section-head">
          <div>
            <h2>Exporter</h2>
            <p>Archive locale ZIP</p>
          </div>
        </div>

        <form onSubmit={handleExport}>
          <label className="pack-field">
            <span className="pack-field-label">Titre</span>
            <input
              aria-label="Titre du pack"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={exporting}
            />
          </label>

          <div className="pack-form-grid">
            <label className="pack-field">
              <span className="pack-field-label">Version</span>
              <input
                aria-label="Version du pack"
                type="number"
                min="1"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                disabled={exporting}
              />
            </label>

            <label className="pack-field">
              <span className="pack-field-label">Licence</span>
              <input
                aria-label="Licence du pack"
                type="text"
                placeholder="CC0, CC-BY..."
                value={license}
                onChange={(event) => setLicense(event.target.value)}
                disabled={exporting}
              />
            </label>
          </div>

          <label className="pack-field">
            <span className="pack-field-label">Description</span>
            <textarea
              aria-label="Description du pack"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={exporting}
            />
          </label>

          {selectedGroup && (
            <div className="pack-export-preview">
              <strong>{selectedGroup.name}</strong>
              <span>{questionCountLabel(selectedGroup.question_count)}</span>
            </div>
          )}

          <button
            type="submit"
            className="pack-primary-button"
            disabled={!canExport}
          >
            {exporting ? "Export..." : "Exporter le pack"}
          </button>
        </form>

        <div className="pack-export-soon">
          Publication Supabase plus tard.
        </div>

        {exportStatus && (
          <div className="pack-status" role="status">{exportStatus}</div>
        )}

        {exportError && (
          <div className="pack-alert" role="alert">{exportError}</div>
        )}
      </section>
    </div>
  );
}

export default function BrowsePacks({ setMode }) {
  const [activeTab, setActiveTab] = useState("import");

  return (
    <div className={`pack-screen pack-layout-dense pack-tab-${activeTab}`}>
      <div className="pack-shell">
        <header className="pack-header" aria-label="Packs">
          <div className="pack-title-row">
            <div className="pack-mark" aria-hidden="true">▣</div>
            <div className="pack-title-block">
              <div className="pack-overline">Catalogue</div>
              <h1>Packs</h1>
              <p>Importer des packs et exporter un groupe local.</p>
            </div>
          </div>

          <div className="pack-header-actions">
            <div className="pack-tab-list" role="tablist" aria-label="Menus Packs">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "import"}
                className={`pack-tab-button${activeTab === "import" ? " is-active" : ""}`}
                onClick={() => setActiveTab("import")}
              >
                Importer
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "export"}
                className={`pack-tab-button${activeTab === "export" ? " is-active" : ""}`}
                onClick={() => setActiveTab("export")}
              >
                Exporter
              </button>
            </div>

            <ReturnToMenuButton
              onClick={() => setMode("menu")}
              className="pack-back"
            />
          </div>
        </header>

        {activeTab === "import" ? (
          <ImporterScreen setMode={setMode} />
        ) : (
          <ExporterScreen />
        )}
      </div>
    </div>
  );
}
