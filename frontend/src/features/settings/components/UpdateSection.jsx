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
  const badge = status === "available" ? "Disponible" : "À jour";

  return (
    <section className="settings-group" id="settings-application">
      <div className="settings-group-head">
        <span
          className="settings-section-icon settings-section-icon-blue"
          aria-hidden="true"
        >
          ◌
        </span>

        <div>
          <h2>Application</h2>
          <p>Version et mises à jour</p>
        </div>

        <span className="settings-badge">{badge}</span>
      </div>

      <div className="settings-group-content">
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>Version actuelle {currentVersion || "..."}</strong>
            <span>
              {status === "available" && updateInfo
                ? `Version ${updateInfo.version} disponible${
                    updateInfo.notes ? ` : ${updateInfo.notes}` : ""
                  }.`
                : "Aucune mise à jour disponible."}
            </span>
          </div>

          {status === "available" ? (
            <button
              type="button"
              onClick={install}
              disabled={busy}
              className="settings-save"
            >
              {status === "installing" ? "..." : "Mettre à jour"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => check()}
              disabled={busy}
              className="settings-secondary"
            >
              {status === "checking" ? "Vérification..." : "Vérifier"}
            </button>
          )}
        </div>

        {status === "installing" && (
          <p className="settings-help settings-help-compact">
            Téléchargement en cours{percent != null ? ` (${percent}%)` : "..."}
          </p>
        )}

        {error && (
          <div role="alert" className="settings-alert">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
