import { useEffect, useMemo, useState } from "react";
import { exportBlueprintGroup } from "../../../api/blueprints";
import { listGroups } from "../../../api/groups";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import {
  getQuestionTypeChipStyle,
  questionTypeChipStyles
} from "../../../shared/questionTypes";
import {
  POPULAR_THEME,
  useBrowseBlueprints
} from "../hooks/useBrowseBlueprints";
import BlueprintCard from "./BlueprintCard";
import { formatSize } from "./blueprintFormatting";
import "./BrowseBlueprints.css";

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
    <div className="blueprint-state-panel">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function FieldSelect({ label, value, options, onChange }) {
  return (
    <label className="blueprint-toolbar-field">
      <span className="blueprint-field-label">{label}</span>
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
    <div className="blueprint-search-toolbar">
      <label className="blueprint-toolbar-search">
        <span className="blueprint-field-label">Recherche</span>
        <span className="blueprint-search-symbol" aria-hidden="true">⌕</span>
        <input
          aria-label="Rechercher un blueprint"
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
    <aside className="blueprint-theme-panel app-scrollbar" aria-label="Thèmes">
      <div className="blueprint-section-head">
        <div>
          <h2>Thèmes</h2>
          <p>{themes.length} entrée{themes.length > 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="blueprint-theme-list">
        {themes.map((theme) => {
          const active = activeTheme === theme.value;

          return (
            <button
              key={theme.value}
              type="button"
              className={`blueprint-theme-button${active ? " is-active" : ""}`}
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
          <div className="blueprint-theme-empty">
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
          className="blueprint-secondary-button"
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
          className="blueprint-primary-button"
          onClick={() => setMode("settings")}
        >
          Configurer le catalogue
        </button>
      </StatePanel>
    );
  }

  return null;
}

function BlueprintDetailPanel({
  item,
  onInstall,
  onUnsubscribe,
  onUpdate
}) {
  if (!item) {
    return (
      <aside className="blueprint-detail-panel blueprint-detail-empty">
        Sélectionne un blueprint.
      </aside>
    );
  }

  const { entry, status, installedVersion, action } = item;
  const typeStyle = getQuestionTypeChipStyle(entry.type_group);
  const sizeLabel = formatSize(entry.size_bytes);
  const downloadLabel = downloadCountLabel(entry.download_count);

  return (
    <aside className="blueprint-detail-panel app-scrollbar" aria-label="Détail du blueprint">
      <div className="blueprint-card-topline">
        <span
          className="blueprint-type-chip"
          style={{
            "--blueprint-type-bg": typeStyle.background,
            "--blueprint-type-color": typeStyle.color
          }}
        >
          {typeStyle.label}
        </span>
        <span className="blueprint-status-pill">
          {status === "not_installed" ? "À installer" : "Installé"}
        </span>
      </div>

      <div>
        <h2>{entry.name}</h2>
        {entry.description && (
          <p className="blueprint-detail-description">{entry.description}</p>
        )}
      </div>

      <div className="blueprint-detail-stat-grid">
        <div className="blueprint-detail-stat">
          <span>Questions</span>
          <strong>{entry.question_count ?? "—"}</strong>
        </div>
        <div className="blueprint-detail-stat">
          <span>Version</span>
          <strong>v{entry.version ?? "—"}</strong>
        </div>
        <div className="blueprint-detail-stat">
          <span>Taille</span>
          <strong>{sizeLabel || "—"}</strong>
        </div>
        <div className="blueprint-detail-stat">
          <span>Licence</span>
          <strong>{entry.license || "—"}</strong>
        </div>
      </div>

      <div className="blueprint-detail-meta">
        <span>{questionCountLabel(entry.question_count)}</span>
        {downloadLabel && <span>{downloadLabel}</span>}
        {installedVersion && <span>v{installedVersion} installée</span>}
      </div>

      <div className="blueprint-action-row">
        {status === "not_installed" && (
          <button
            type="button"
            className="blueprint-primary-button"
            disabled={action.busy}
            onClick={() => onInstall(entry)}
          >
            {action.busy ? "Import..." : "Installer"}
          </button>
        )}

        {status === "update_available" && (
          <button
            type="button"
            className="blueprint-primary-button"
            disabled={action.busy}
            onClick={() => onUpdate(entry, { deleteRemoved: false })}
          >
            {action.busy ? "Mise à jour..." : "Mettre à jour"}
          </button>
        )}

        {status !== "not_installed" && (
          <button
            type="button"
            className="blueprint-secondary-button"
            disabled={action.busy}
            onClick={() => onUnsubscribe(entry.blueprint_guid)}
          >
            Se désabonner
          </button>
        )}
      </div>

      {action.error && (
        <div className="blueprint-alert" role="alert">
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
  } = useBrowseBlueprints(filters);

  const themes = facets?.themes || [];
  const selectedItem = (
    items.find((item) => item.entry.blueprint_guid === activeGuid) ||
    items[0] ||
    null
  );
  const showStatePanel = loading || Boolean(error) || catalogUrl === null;

  return (
    <div className="blueprint-import-layout">
      <ThemeRail
        activeTheme={activeTheme}
        loading={loading}
        onSelectTheme={setActiveTheme}
        themes={themes}
      />

      <section className="blueprint-panel blueprint-results-panel app-scrollbar" aria-label="Catalogue">
        <div className="blueprint-section-head">
          <div>
            <h2>Catalogue</h2>
            <p>
              {loading ? "Chargement" : `${items.length} sur ${total} résultat${total > 1 ? "s" : ""}`}
            </p>
          </div>
          <span className="blueprint-count-pill">{total}</span>
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
                <p>Aucun blueprint ne correspond à cette recherche.</p>
              </StatePanel>
            ) : (
              <div className="blueprint-dense-list">
                {items.map((item) => (
                  <BlueprintCard
                    key={item.entry.blueprint_guid}
                    density="row"
                    item={item}
                    onInstall={install}
                    onSelect={(nextItem) => setActiveGuid(nextItem.entry.blueprint_guid)}
                    onUpdate={update}
                    selected={selectedItem?.entry.blueprint_guid === item.entry.blueprint_guid}
                  />
                ))}
              </div>
            )}

            {hasMore && (
              <button
                type="button"
                className="blueprint-secondary-button blueprint-load-more"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Chargement..." : "Charger plus"}
              </button>
            )}
          </>
        )}
      </section>

      <BlueprintDetailPanel
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
      const filename = await exportBlueprintGroup(selectedGroup.id, {
        version: Math.floor(versionNumber),
        name: title.trim(),
        description: description.trim(),
        license: license.trim()
      });
      setExportStatus(`Blueprint exporté : ${filename}`);
    } catch (error) {
      console.error(error);
      setExportError(error.message || "Export impossible.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="blueprint-export-layout">
      <section className="blueprint-panel app-scrollbar" aria-label="Groupes exportables">
        <div className="blueprint-section-head">
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
          <div className="blueprint-export-group-list">
            {groups.map((group) => {
              const active = String(group.id) === selectedGroupId;
              const typeStyle = getQuestionTypeChipStyle(group.type_group);

              return (
                <button
                  key={group.id}
                  type="button"
                  className={`blueprint-export-group${active ? " is-active" : ""}`}
                  onClick={() => {
                    setSelectedGroupId(String(group.id));
                    setTitle(group.name || "");
                  }}
                  aria-pressed={active}
                >
                  <span>{group.name}</span>
                  <small
                    style={{
                      "--blueprint-type-bg": typeStyle.background,
                      "--blueprint-type-color": typeStyle.color
                    }}
                  >
                    {typeStyle.label} · {questionCountLabel(group.question_count)}
                  </small>
                </button>
              );
            })}

            {groups.length === 0 && (
              <div className="blueprint-theme-empty">
                Aucun groupe exportable.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="blueprint-export-panel app-scrollbar" aria-label="Exporter un blueprint">
        <div className="blueprint-section-head">
          <div>
            <h2>Exporter</h2>
            <p>Archive locale ZIP</p>
          </div>
        </div>

        <form onSubmit={handleExport}>
          <label className="blueprint-field">
            <span className="blueprint-field-label">Titre</span>
            <input
              aria-label="Titre du blueprint"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={exporting}
            />
          </label>

          <div className="blueprint-form-grid">
            <label className="blueprint-field">
              <span className="blueprint-field-label">Version</span>
              <input
                aria-label="Version du blueprint"
                type="number"
                min="1"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                disabled={exporting}
              />
            </label>

            <label className="blueprint-field">
              <span className="blueprint-field-label">Licence</span>
              <input
                aria-label="Licence du blueprint"
                type="text"
                placeholder="CC0, CC-BY..."
                value={license}
                onChange={(event) => setLicense(event.target.value)}
                disabled={exporting}
              />
            </label>
          </div>

          <label className="blueprint-field">
            <span className="blueprint-field-label">Description</span>
            <textarea
              aria-label="Description du blueprint"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={exporting}
            />
          </label>

          {selectedGroup && (
            <div className="blueprint-export-preview">
              <strong>{selectedGroup.name}</strong>
              <span>{questionCountLabel(selectedGroup.question_count)}</span>
            </div>
          )}

          <button
            type="submit"
            className="blueprint-primary-button"
            disabled={!canExport}
          >
            {exporting ? "Export..." : "Exporter le blueprint"}
          </button>
        </form>

        <div className="blueprint-export-soon">
          Publication Supabase plus tard.
        </div>

        {exportStatus && (
          <div className="blueprint-status" role="status">{exportStatus}</div>
        )}

        {exportError && (
          <div className="blueprint-alert" role="alert">{exportError}</div>
        )}
      </section>
    </div>
  );
}

export default function BrowseBlueprints({ setMode }) {
  const [activeTab, setActiveTab] = useState("import");

  return (
    <div className={`blueprint-screen blueprint-layout-dense blueprint-tab-${activeTab}`}>
      <div className="blueprint-shell">
        <header className="blueprint-header" aria-label="Blueprints">
          <div className="blueprint-title-row">
            <div className="blueprint-mark" aria-hidden="true">▣</div>
            <div className="blueprint-title-block">
              <div className="blueprint-overline">Catalogue</div>
              <h1>Blueprints</h1>
              <p>Importer des packs et exporter un groupe local.</p>
            </div>
          </div>

          <div className="blueprint-header-actions">
            <div className="blueprint-tab-list" role="tablist" aria-label="Menus Blueprints">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "import"}
                className={`blueprint-tab-button${activeTab === "import" ? " is-active" : ""}`}
                onClick={() => setActiveTab("import")}
              >
                Importer
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "export"}
                className={`blueprint-tab-button${activeTab === "export" ? " is-active" : ""}`}
                onClick={() => setActiveTab("export")}
              >
                Exporter
              </button>
            </div>

            <ReturnToMenuButton
              onClick={() => setMode("menu")}
              className="blueprint-back"
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
