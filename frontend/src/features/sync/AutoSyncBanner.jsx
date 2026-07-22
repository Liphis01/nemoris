const bannerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  background: "#17211d",
  color: "#e5e5e5",
  border: "1px solid #2f4b3a",
  borderRadius: "8px",
  padding: "10px 16px",
  marginBottom: "16px",
  fontSize: "14px"
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
      <div style={bannerStyle} role="status">
        <span>Synchronisation...</span>
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
