import { useEffect, useRef, useState } from "react";
import { exportDatabase, importDatabase } from "../../../api/backup";
import {
  getBlueprintCatalogSettings,
  saveBlueprintCatalogSettings
} from "../../../api/blueprints";
import {
  getReviewSettings,
  rebalanceReviewCalendar,
  updateReviewSettings
} from "../../../api/review";
import "./Settings.css";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import SyncAccountSection from "./SyncAccountSection";
import UpdateSection from "./UpdateSection";
import { useSyncAccount } from "./useSyncAccount";

function normalizeTarget(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

function SettingsGroup({
  children,
  icon,
  accent = "",
  title,
  description,
  badge,
  id
}) {
  return (
    <section className="settings-group" id={id}>
      <div className="settings-group-head">
        <span
          className={`settings-section-icon ${
            accent ? `settings-section-icon-${accent}` : ""
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>

        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>

        {badge && <span className="settings-badge">{badge}</span>}
      </div>

      <div className="settings-group-content">{children}</div>
    </section>
  );
}

function syncRailLabel(sync) {
  if (!sync.status) {
    return "Chargement";
  }

  return sync.signedIn ? "Connecté" : "Non connecté";
}

function syncRailCaption(sync) {
  if (!sync.status) {
    return "...";
  }

  return sync.signedIn
    ? sync.status.account_email || "Compte connecté"
    : "Aucun compte connecté";
}

function SettingsRail({
  loading,
  target,
  sync,
  exporting,
  importing,
  onExport
}) {
  return (
    <aside className="settings-rail app-scrollbar" aria-label="Résumé et raccourcis">
      <div className="settings-rail-card">
        <div className="settings-overline">Sync</div>
        <strong
          className={`settings-rail-sync ${
            sync.signedIn ? "settings-rail-sync-on" : ""
          }`}
        >
          {syncRailLabel(sync)}
        </strong>
        <span>{syncRailCaption(sync)}</span>
      </div>

      <div className="settings-rail-card">
        <div className="settings-overline">Objectif actif</div>
        <strong>{loading ? "..." : target}</strong>
        <span>questions / jour</span>
      </div>

      <div className="settings-rail-card settings-rail-shortcuts">
        <div className="settings-overline">Raccourcis</div>

        <div className="settings-rail-actions">
          <button
            type="button"
            onClick={() => sync.doPush(false)}
            disabled={!sync.signedIn || sync.busy}
            className="settings-save"
          >
            {sync.busy ? "..." : "Envoyer vers le cloud"}
          </button>

          <button
            type="button"
            onClick={sync.doPull}
            disabled={!sync.signedIn || sync.busy}
            className="settings-secondary"
          >
            Télécharger du cloud
          </button>

          <button
            type="button"
            onClick={onExport}
            disabled={exporting || importing}
            className="settings-secondary"
          >
            {exporting ? "Export..." : "Exporter la base"}
          </button>
        </div>
      </div>

      <div className="settings-rail-card settings-rail-note">
        Les sauvegardes locales restent disponibles, mais la synchronisation
        devient l'action principale.
      </div>
    </aside>
  );
}

export default function Settings({ setMode }) {
  const [target, setTarget] = useState(50);
  const [draft, setDraft] = useState("50");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const fileInputRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dataStatus, setDataStatus] = useState("");
  const [dataError, setDataError] = useState("");

  const [catalogDraft, setCatalogDraft] = useState("");
  const [catalogKeyDraft, setCatalogKeyDraft] = useState("");
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState("");
  const [catalogError, setCatalogError] = useState("");

  const sync = useSyncAccount();

  useEffect(() => {
    const screen = document.querySelector(".settings-groups");

    if (screen) {
      screen.scrollLeft = 0;
      screen.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");
    setStatus("");

    getReviewSettings()
      .then((settings) => {
        if (cancelled) return;

        const loadedTarget = settings.catchup_daily_target || 50;
        setTarget(loadedTarget);
        setDraft(String(loadedTarget));
        setLoading(false);
      })
      .catch((settingsError) => {
        console.error(settingsError);

        if (!cancelled) {
          setError(settingsError.message || "Paramètres impossibles à charger.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    getBlueprintCatalogSettings()
      .then((settings) => {
        if (!cancelled) {
          setCatalogDraft(settings.url || "");
          setCatalogKeyDraft(settings.key || "");
        }
      })
      .catch((catalogSettingsError) => {
        console.error(catalogSettingsError);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function saveTarget() {
    const nextTarget = normalizeTarget(draft, target);

    if (nextTarget === target) {
      setDraft(String(target));
      setStatus("");
      setError("");
      return;
    }

    setSaving(true);
    setError("");
    setStatus("");

    try {
      const settings = await updateReviewSettings({
        catchup_daily_target: nextTarget
      });
      const savedTarget = settings.catchup_daily_target || nextTarget;

      setTarget(savedTarget);
      setDraft(String(savedTarget));
      await rebalanceReviewCalendar();
      setStatus("Paramètres enregistrés. Calendrier rééquilibré.");
    } catch (saveError) {
      console.error(saveError);
      setDraft(String(target));
      setError(saveError.message || "Paramètres impossibles à enregistrer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setDataStatus("");
    setDataError("");

    try {
      const filename = await exportDatabase();
      setDataStatus(`Base exportée : ${filename}`);
    } catch (exportError) {
      console.error(exportError);
      setDataError(exportError.message || "Export impossible.");
    } finally {
      setExporting(false);
    }
  }

  function openImportPicker() {
    setDataStatus("");
    setDataError("");
    fileInputRef.current?.click();
  }

  async function handleImportFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    // Reset so re-selecting the same file still fires onChange.
    input.value = "";

    if (!file) {
      return;
    }

    const confirmed = window.confirm(
      "Importer cette sauvegarde remplacera TOUTE la base de données et les " +
        "médias actuels. Cette action est irréversible. Continuer ?"
    );

    if (!confirmed) {
      return;
    }

    setImporting(true);
    setDataStatus("");
    setDataError("");

    try {
      await importDatabase(file);
      // The whole database changed under us; reload so every view refetches.
      setDataStatus("Base importée. Rechargement...");
      window.location.reload();
    } catch (importError) {
      console.error(importError);
      setDataError(importError.message || "Import impossible.");
      setImporting(false);
    }
  }

  async function saveCatalogSettings() {
    setCatalogSaving(true);
    setCatalogStatus("");
    setCatalogError("");

    try {
      const settings = await saveBlueprintCatalogSettings({
        url: catalogDraft.trim(),
        key: catalogKeyDraft.trim()
      });
      setCatalogDraft(settings.url || "");
      setCatalogKeyDraft(settings.key || "");
      setCatalogStatus("Catalogue enregistré.");
    } catch (catalogSaveError) {
      console.error(catalogSaveError);
      setCatalogError(
        catalogSaveError.message || "Catalogue impossible à enregistrer."
      );
    } finally {
      setCatalogSaving(false);
    }
  }

  return (
    <div className="settings-screen">
      <div className="settings-shell">
        <header className="settings-header">
          <div className="settings-brand-row">
            <div className="settings-brand-mark" aria-hidden="true">
              N
            </div>

            <div className="settings-title-block">
              <div className="settings-overline">Nemoris</div>
              <h1>Paramètres</h1>
              <p>Préférences, synchronisation et sauvegardes.</p>
            </div>
          </div>

          <ReturnToMenuButton
            onClick={() => setMode("menu")}
            className="settings-back"
          />
        </header>

        <div className="settings-layout">
          <SettingsRail
            loading={loading}
            target={target}
            sync={sync}
            exporting={exporting}
            importing={importing}
            onExport={handleExport}
          />

          <main className="settings-groups app-scrollbar" aria-label="Paramètres">
            <SyncAccountSection sync={sync} />

            <SettingsGroup
              id="settings-review"
              icon="↻"
              accent="amber"
              title="Review"
              description="Rythme quotidien"
              badge={loading ? "..." : `${target} / jour`}
            >
              {loading ? (
                <div className="settings-loading">
                  Chargement des paramètres...
                </div>
              ) : (
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>Objectif quotidien</strong>
                    <span>
                      Volume visé par le rééquilibrage du calendrier.
                    </span>
                  </div>

                  <div className="settings-inline-actions">
                    <input
                      aria-label="Objectif quotidien"
                      type="number"
                      min="1"
                      max="10000"
                      value={draft}
                      disabled={saving}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          saveTarget();
                        }
                      }}
                      className="settings-input settings-input-number"
                    />

                    <span className="settings-unit">/ jour</span>

                    <button
                      type="button"
                      onClick={saveTarget}
                      disabled={saving}
                      className="settings-save"
                    >
                      {saving ? "Enregistrement..." : "Enregistrer"}
                    </button>
                  </div>
                </div>
              )}

              {status && (
                <div className="settings-status" role="status">
                  {status}
                </div>
              )}

              {error && (
                <div role="alert" className="settings-alert">
                  {error}
                </div>
              )}
            </SettingsGroup>

            <SettingsGroup
              id="settings-data"
              icon="⇣"
              accent="green"
              title="Données"
              description="Sauvegarde complète et restauration"
              badge="2 actions"
            >
              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>Exporter la base</strong>
                  <span>
                    Questions, progression et médias dans une archive ZIP.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || importing}
                  className="settings-secondary"
                >
                  {exporting ? "Export..." : "Exporter"}
                </button>
              </div>

              <div className="settings-row settings-row-danger">
                <div className="settings-row-copy">
                  <strong>Importer une sauvegarde</strong>
                  <span>
                    Remplace toutes les données locales après confirmation.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={openImportPicker}
                  disabled={exporting || importing}
                  className="settings-danger"
                >
                  {importing ? "Import..." : "Importer"}
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  aria-label="Importer la base"
                  className="settings-file-input"
                  onChange={handleImportFile}
                />
              </div>

              {dataStatus && (
                <div className="settings-status" role="status">
                  {dataStatus}
                </div>
              )}

              {dataError && (
                <div role="alert" className="settings-alert">
                  {dataError}
                </div>
              )}
            </SettingsGroup>

            <SettingsGroup
              id="settings-blueprints"
              icon="▣"
              accent="violet"
              title="Blueprints"
              description="Catalogue de packs partagés"
              badge={catalogDraft.trim() && catalogKeyDraft.trim() ? "Configuré" : "Vide"}
            >
              <div className="settings-row settings-row-catalog">
                <div className="settings-row-copy">
                  <strong>Catalogue Supabase</strong>
                  <span>Projet et clé publique utilisés par l'écran Blueprints.</span>
                </div>

                <div className="settings-auth-row settings-catalog-row">
                  <input
                    aria-label="URL du projet Supabase"
                    type="text"
                    placeholder="https://...supabase.co"
                    value={catalogDraft}
                    disabled={catalogSaving}
                    onChange={(event) => setCatalogDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        saveCatalogSettings();
                      }
                    }}
                    className="settings-input settings-input-wide"
                  />

                  <input
                    aria-label="Clé publishable Supabase"
                    type="text"
                    placeholder="sb_publishable_..."
                    value={catalogKeyDraft}
                    disabled={catalogSaving}
                    onChange={(event) => setCatalogKeyDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        saveCatalogSettings();
                      }
                    }}
                    className="settings-input settings-input-wide"
                  />

                  <button
                    type="button"
                    onClick={saveCatalogSettings}
                    disabled={catalogSaving}
                    aria-label="Enregistrer le catalogue"
                    className="settings-save"
                  >
                    {catalogSaving ? "..." : "OK"}
                  </button>
                </div>
              </div>

              {catalogStatus && (
                <div className="settings-status" role="status">
                  {catalogStatus}
                </div>
              )}

              {catalogError && (
                <div role="alert" className="settings-alert">
                  {catalogError}
                </div>
              )}
            </SettingsGroup>

            <UpdateSection />
          </main>
        </div>
      </div>
    </div>
  );
}
