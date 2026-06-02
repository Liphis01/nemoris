import { useEffect, useState } from "react";
import {
  getReviewSettings,
  rebalanceReviewCalendar,
  updateReviewSettings
} from "../../../api/review";
import "./Settings.css";

function normalizeTarget(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

export default function Settings({ setMode }) {
  const [target, setTarget] = useState(50);
  const [draft, setDraft] = useState("50");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

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

  return (
    <div className="settings-screen">
      <div className="settings-shell">
        <header className="settings-header">
          <div className="settings-title-block">
            <div className="settings-overline">Paramètres</div>
            <h1>Paramètres</h1>
            <p>Rythme de révision et rééquilibrage du calendrier.</p>
          </div>

          <button
            type="button"
            onClick={() => setMode("menu")}
            className="settings-back"
          >
            ← Retour
          </button>
        </header>

        <main className="settings-grid">
          <section className="settings-panel">
            <div className="settings-section-head">
              <span className="settings-section-icon" aria-hidden="true">
                ↻
              </span>

              <div>
                <div className="settings-overline">Review</div>
                <h2>Rythme quotidien</h2>
              </div>
            </div>

            {loading ? (
              <div className="settings-loading">
                Chargement des paramètres...
              </div>
            ) : (
              <>
                <label className="settings-field">
                  <span className="settings-label">Objectif quotidien</span>

                  <span className="settings-control">
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
                      className="settings-input"
                    />
                    <span className="settings-unit">questions / jour</span>
                  </span>
                </label>

                <div className="settings-actions">
                  <button
                    type="button"
                    onClick={saveTarget}
                    disabled={saving}
                    className="settings-save"
                  >
                    {saving ? "Enregistrement..." : "Enregistrer"}
                  </button>

                  {status && (
                    <div className="settings-status" role="status">
                      {status}
                    </div>
                  )}
                </div>
              </>
            )}

            {error && (
              <div role="alert" className="settings-alert">
                {error}
              </div>
            )}
          </section>

          <aside className="settings-summary" aria-label="Résumé">
            <div className="settings-summary-card">
              <div className="settings-overline">Objectif actif</div>
              <strong>{loading ? "..." : target}</strong>
              <span>questions / jour</span>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
