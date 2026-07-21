import { useEffect } from "react";
import { useAppUpdate } from "../../update/useAppUpdate";

export default function UpdateSection() {
  const {
    status,
    updateInfo,
    progress,
    error,
    currentVersion,
    check,
    install
  } = useAppUpdate();

  useEffect(() => {
    check();
  }, [check]);

  const busy = status === "checking" || status === "installing";
  const percent =
    progress?.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <section className="settings-panel">
      <div className="settings-section-head">
        <span className="settings-section-icon" aria-hidden="true">
          ⟳
        </span>
        <div>
          <div className="settings-overline">Application</div>
          <h2>Mises à jour</h2>
        </div>
      </div>

      <p className="settings-help">
        Version actuelle : {currentVersion || "…"}
      </p>

      {status === "available" && updateInfo && (
        <p className="settings-help">
          Version {updateInfo.version} disponible
          {updateInfo.notes ? ` — ${updateInfo.notes}` : ""}.
        </p>
      )}

      {status === "installing" && (
        <p className="settings-help">
          Téléchargement en cours{percent != null ? ` (${percent}%)` : "..."}
        </p>
      )}

      <div className="settings-actions">
        {status === "available" ? (
          <button
            type="button"
            onClick={install}
            disabled={busy}
            className="settings-save"
          >
            {status === "installing" ? "..." : "Redémarrer et mettre à jour"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => check()}
            disabled={busy}
            className="settings-save"
          >
            {status === "checking" ? "Vérification..." : "Vérifier les mises à jour"}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="settings-alert">
          {error}
        </div>
      )}
    </section>
  );
}
