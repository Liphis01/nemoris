const toastBaseStyle = {
  position: "fixed",
  right: "20px",
  bottom: "20px",
  zIndex: 30,
  maxWidth: "min(460px, calc(100vw - 40px))"
};

const syncingStyle = {
  ...toastBaseStyle,
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  color: "#a7b2ab",
  background: "rgba(18, 18, 18, 0.72)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: "999px",
  padding: "6px 10px",
  fontSize: "12px",
  lineHeight: 1,
  pointerEvents: "none",
  userSelect: "none"
};

const syncDotStyle = {
  width: "6px",
  height: "6px",
  borderRadius: "999px",
  background: "#6f8f7d",
  flex: "0 0 auto"
};

const bannerStyle = {
  ...toastBaseStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  background: "#17211d",
  color: "#e5e5e5",
  border: "1px solid #2f4b3a",
  borderRadius: "8px",
  padding: "10px 16px",
  boxShadow: "0 10px 28px rgba(0, 0, 0, 0.28)",
  fontSize: "14px",
  pointerEvents: "auto"
};

const conflictStyle = {
  ...bannerStyle,
  background: "#221b16",
  border: "1px solid #5c3d23"
};

const errorStyle = {
  ...bannerStyle,
  background: "#241919",
  border: "1px solid #5a2a2a"
};

const actionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px"
};

export default function AutoSyncBanner({
  phase,
  error,
  conflictVersion,
  resolveByPull,
  resolveByForcePush,
  dismiss
}) {
  if (phase === "syncing") {
    return (
      <div
        style={syncingStyle}
        role="status"
        aria-label="Synchronisation en cours"
        title="Synchronisation en cours"
      >
        <span style={syncDotStyle} aria-hidden="true" />
        <span>Synchro</span>
      </div>
    );
  }

  if (phase === "conflict") {
    return (
      <div style={conflictStyle} role="alert">
        <span>
          Conflit de synchronisation
          {conflictVersion != null ? ` : cloud v${conflictVersion}` : ""}.
        </span>

        <span style={actionsStyle}>
          <button
            type="button"
            className="settings-secondary"
            onClick={resolveByPull}
          >
            Télécharger
          </button>

          <button
            type="button"
            className="settings-secondary"
            onClick={resolveByForcePush}
          >
            Envoyer quand même
          </button>
        </span>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={errorStyle} role="alert">
        <span>{error || "Synchronisation automatique impossible."}</span>

        <button
          type="button"
          className="settings-secondary"
          onClick={dismiss}
        >
          Fermer
        </button>
      </div>
    );
  }

  return null;
}
