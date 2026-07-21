import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import { useBrowseBlueprints } from "../hooks/useBrowseBlueprints";
import BlueprintCard from "./BlueprintCard";

export default function BrowseBlueprints({ setMode }) {
  const {
    catalogUrl,
    items,
    loading,
    error,
    reload,
    install,
    update,
    unsubscribe
  } = useBrowseBlueprints();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        maxWidth: "720px",
        margin: "0 auto",
        width: "100%"
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div>
          <div
            style={{
              fontSize: "11px",
              color: "#666",
              fontWeight: "700",
              letterSpacing: "0.08em",
              textTransform: "uppercase"
            }}
          >
            Blueprints
          </div>
          <h1 style={{ margin: "4px 0 0", fontSize: "22px" }}>
            Parcourir les blueprints
          </h1>
        </div>

        <ReturnToMenuButton onClick={() => setMode("menu")} />
      </header>

      {catalogUrl === null && !loading && (
        <div
          style={{
            padding: "24px",
            borderRadius: "14px",
            border: "1px solid #262626",
            background: "#171717",
            textAlign: "center",
            color: "#999"
          }}
        >
          <p style={{ margin: "0 0 14px" }}>
            Aucun catalogue configuré pour l'instant.
          </p>
          <button
            type="button"
            onClick={() => setMode("settings")}
            style={{
              padding: "9px 16px",
              borderRadius: "999px",
              border: "1px solid #385544",
              background: "#1f2d24",
              color: "#d7f5df",
              cursor: "pointer",
              fontSize: "13px"
            }}
          >
            Configurer un catalogue
          </button>
        </div>
      )}

      {loading && (
        <div style={{ color: "#888", fontSize: "13px" }}>
          Chargement du catalogue...
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            borderRadius: "10px",
            background: "#261717",
            border: "1px solid rgba(255,156,156,0.28)",
            color: "#ff9c9c",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px"
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={reload}
            style={{
              padding: "6px 12px",
              borderRadius: "999px",
              border: "1px solid #3a3a3a",
              background: "#232323",
              color: "#ddd",
              cursor: "pointer",
              fontSize: "12px",
              flexShrink: 0
            }}
          >
            Réessayer
          </button>
        </div>
      )}

      {!loading && !error && catalogUrl && items.length === 0 && (
        <div style={{ color: "#888", fontSize: "13px" }}>
          Ce catalogue ne contient aucun blueprint pour le moment.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {items.map((item) => (
            <BlueprintCard
              key={item.entry.blueprint_guid}
              item={item}
              onInstall={install}
              onUpdate={update}
              onUnsubscribe={unsubscribe}
            />
          ))}
        </div>
      )}
    </div>
  );
}
