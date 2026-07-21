import { useState } from "react";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";

const UPDATE_TONE = {
  background: "#3a211c",
  borderColor: "#613025",
  primary: "#ff9a7a"
};

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return null;

  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} Ko`
    : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function BlueprintCard({ item, onInstall, onUpdate, onUnsubscribe }) {
  const [expanded, setExpanded] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  const { entry, status, installedVersion, action } = item;
  const typeStyle = getQuestionTypeChipStyle(entry.type_group);
  const busy = Boolean(action.busy);
  const sizeLabel = formatSize(entry.size_bytes);
  const installed = status === "up_to_date" || status === "update_available";

  function handleBodyClick() {
    if (railOpen) {
      setRailOpen(false);
      return;
    }

    setExpanded((current) => !current);
  }

  function handleDeleteConfirm(event) {
    event.stopPropagation();

    const confirmed = window.confirm(
      `Supprimer "${entry.name}" et ses questions de votre bibliothèque ? ` +
        "Une sauvegarde est créée automatiquement avant la suppression. Continuer ?"
    );

    if (!confirmed) return;

    setRailOpen(false);
    onUnsubscribe(entry.blueprint_guid, { deleteContent: true });
  }

  return (
    <div
      data-blueprint-guid={entry.blueprint_guid}
      style={{
        position: "relative",
        padding: "12px 14px",
        border: "1px solid #262626",
        borderRadius: "14px",
        background: "transparent",
        overflow: "hidden"
      }}
    >
      {installed && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            height: "100%",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "0 12px",
            transform: railOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform 0.18s ease",
            background: "rgba(30, 30, 30, 0.97)",
            borderLeft: "1px solid rgba(255,255,255,0.05)",
            zIndex: 2
          }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setRailOpen(false);
              onUnsubscribe(entry.blueprint_guid, { deleteContent: false });
            }}
            style={{
              padding: "8px 12px",
              borderRadius: "999px",
              border: "1px solid #3a3a3a",
              background: "#232323",
              color: "#ddd",
              cursor: "pointer",
              fontSize: "12px",
              whiteSpace: "nowrap"
            }}
          >
            Garder
          </button>

          <button
            type="button"
            onClick={handleDeleteConfirm}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "999px",
              border: "none",
              background: "#b01d1d",
              color: "white",
              cursor: "pointer",
              fontSize: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            🗑
          </button>
        </div>
      )}

      <div
        onClick={handleBodyClick}
        style={{ position: "relative", zIndex: 1, cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontSize: "10px",
              fontWeight: "700",
              padding: "2px 6px",
              borderRadius: "999px",
              background: typeStyle.background,
              color: typeStyle.color,
              flexShrink: 0
            }}
          >
            {typeStyle.label}
          </span>

          <span
            style={{
              color: "#e5e5e5",
              fontWeight: "600",
              fontSize: "14px",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {entry.name}
          </span>

          {status === "update_available" && (
            <span
              title={`v${entry.version} disponible (installé : v${installedVersion})`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: "20px",
                padding: "0 6px",
                borderRadius: "999px",
                border: `1px solid ${UPDATE_TONE.borderColor}`,
                background: UPDATE_TONE.background,
                color: UPDATE_TONE.primary,
                fontSize: "10px",
                fontWeight: "700",
                flexShrink: 0
              }}
            >
              ↑ v{entry.version}
            </span>
          )}

          {entry.question_count != null && (
            <span style={{ color: "#888", fontSize: "12px", flexShrink: 0 }}>
              {entry.question_count} questions
            </span>
          )}
        </div>

        {expanded && (
          <div
            style={{
              marginTop: "8px",
              color: "#999",
              fontSize: "12px",
              lineHeight: 1.5
            }}
          >
            {entry.description && (
              <p style={{ margin: "0 0 6px" }}>{entry.description}</p>
            )}

            <div style={{ display: "flex", gap: "12px", color: "#777" }}>
              {entry.license && <span>Licence : {entry.license}</span>}
              {sizeLabel && <span>{sizeLabel}</span>}
            </div>
          </div>
        )}

        {action.error && (
          <div
            role="alert"
            style={{
              marginTop: "8px",
              padding: "6px 10px",
              borderRadius: "8px",
              background: "#261717",
              border: "1px solid rgba(255,156,156,0.28)",
              color: "#ff9c9c",
              fontSize: "12px"
            }}
          >
            {action.error}
          </div>
        )}

        {action.pendingRemoval && (
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap"
            }}
          >
            <span style={{ color: "#ffb37a", fontSize: "12px" }}>
              {action.pendingRemoval.length} question
              {action.pendingRemoval.length > 1 ? "s" : ""} retirée
              {action.pendingRemoval.length > 1 ? "s" : ""} du pack — les
              supprimer aussi ?
            </span>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUpdate(entry, { deleteRemoved: true });
              }}
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                border: "1px solid #613025",
                background: "#3a211c",
                color: "#ff9a7a",
                fontSize: "11px",
                cursor: "pointer"
              }}
            >
              Supprimer
            </button>
          </div>
        )}

        <div
          style={{
            marginTop: "10px",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}
        >
          {status === "not_installed" && (
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onInstall(entry);
              }}
              style={{
                padding: "8px 14px",
                borderRadius: "999px",
                border: "1px solid #385544",
                background: busy ? "#202020" : "#1f2d24",
                color: busy ? "#888" : "#d7f5df",
                cursor: busy ? "default" : "pointer",
                fontSize: "13px"
              }}
            >
              {busy ? "Import…" : "Installer"}
            </button>
          )}

          {status === "update_available" && (
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onUpdate(entry, { deleteRemoved: false });
              }}
              style={{
                padding: "8px 14px",
                borderRadius: "999px",
                border: "1px solid #385544",
                background: busy ? "#202020" : "#1f2d24",
                color: busy ? "#888" : "#d7f5df",
                cursor: busy ? "default" : "pointer",
                fontSize: "13px"
              }}
            >
              {busy ? "Mise à jour…" : "Mettre à jour"}
            </button>
          )}

          {status === "up_to_date" && (
            <span style={{ color: "#7ee2a8", fontSize: "12px" }}>
              Installé (v{installedVersion})
            </span>
          )}

          {installed && (
            <button
              type="button"
              aria-label="Options"
              onClick={(event) => {
                event.stopPropagation();
                setRailOpen((open) => !open);
              }}
              style={{
                marginLeft: "auto",
                width: "28px",
                height: "28px",
                borderRadius: "999px",
                border: "1px solid #2d2d2d",
                background: "#181818",
                color: "#888",
                cursor: "pointer",
                fontSize: "14px"
              }}
            >
              ⋯
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
