import { useEffect, useState } from "react";
import { useAppUpdate } from "./useAppUpdate";

function dismissedStorageKey(version) {
  return `update-banner-dismissed:${version}`;
}

const bannerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  background: "#1f2937",
  color: "#e5e5e5",
  border: "1px solid #374151",
  borderRadius: "8px",
  padding: "10px 16px",
  fontSize: "14px",
  pointerEvents: "auto"
};

export default function UpdateBanner() {
  const { status, updateInfo, progress, error, install, check } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    check({ silent: true });
    // Silent: an unreachable update endpoint (offline, first run) should
    // never surface an error the user didn't ask about.
  }, [check]);

  if (dismissed || status === "idle" || status === "checking") {
    return null;
  }

  if (status === "available" && updateInfo) {
    if (
      (() => {
        try {
          return localStorage.getItem(dismissedStorageKey(updateInfo.version));
        } catch {
          return false;
        }
      })()
    ) {
      return null;
    }

    return (
      <div style={bannerStyle}>
        <span>Mise à jour {updateInfo.version} disponible.</span>
        <span style={{ display: "flex", gap: "8px" }}>
          <button type="button" onClick={install} className="settings-save">
            Redémarrer et mettre à jour
          </button>
          <button
            type="button"
            className="settings-secondary"
            onClick={() => {
              try {
                localStorage.setItem(dismissedStorageKey(updateInfo.version), "1");
              } catch (storageError) {
                console.error(storageError);
              }
              setDismissed(true);
            }}
          >
            Plus tard
          </button>
        </span>
      </div>
    );
  }

  if (status === "installing") {
    const percent =
      progress?.total > 0
        ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
        : null;

    return (
      <div style={bannerStyle}>
        <span>
          Téléchargement de la mise à jour{percent != null ? ` (${percent}%)` : "..."}
        </span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={bannerStyle} role="alert">
        <span>{error || "Mise à jour impossible."}</span>
        <button type="button" className="settings-secondary" onClick={() => setDismissed(true)}>
          Fermer
        </button>
      </div>
    );
  }

  return null;
}
