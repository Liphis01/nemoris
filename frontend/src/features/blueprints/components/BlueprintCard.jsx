import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import { formatSize } from "./blueprintFormatting";

function questionCountLabel(count) {
  if (count === null || count === undefined) {
    return "Questions";
  }

  return `${count} question${count > 1 ? "s" : ""}`;
}

function downloadCountLabel(count) {
  if (count === null || count === undefined) {
    return null;
  }

  return `${count.toLocaleString("fr-FR")} téléchargement${count > 1 ? "s" : ""}`;
}

function statusLabel(status, installedVersion) {
  if (status === "update_available") {
    return installedVersion ? `v${installedVersion} installée` : "Mise à jour";
  }

  if (status === "up_to_date") {
    return installedVersion ? `Installé v${installedVersion}` : "Installé";
  }

  return "À installer";
}

function statusClassName(status) {
  if (status === "update_available") return "blueprint-status-pill-update";
  if (status === "not_installed") return "blueprint-status-pill-install";
  return "";
}

function actionCopy(status, busy) {
  if (status === "update_available") {
    return busy ? "Mise à jour..." : "Mettre à jour";
  }

  if (status === "not_installed") {
    return busy ? "Import..." : "Installer";
  }

  return "Installé";
}

export default function BlueprintCard({
  density = "grid",
  item,
  onInstall,
  onSelect,
  onUpdate,
  selected = false
}) {
  const { entry, status, installedVersion, action } = item;
  const typeStyle = getQuestionTypeChipStyle(entry.type_group);
  const busy = Boolean(action.busy);
  const sizeLabel = formatSize(entry.size_bytes);
  const downloadLabel = downloadCountLabel(entry.download_count);
  const canAct = status === "not_installed" || status === "update_available";

  function handleAction(event) {
    event.stopPropagation();

    if (status === "not_installed") {
      onInstall(entry);
    } else if (status === "update_available") {
      onUpdate(entry, { deleteRemoved: false });
    }
  }

  return (
    <article
      data-blueprint-guid={entry.blueprint_guid}
      data-testid={`blueprint-card-${density}-${entry.blueprint_guid}`}
      className={`blueprint-card blueprint-card-${density}${selected ? " is-selected" : ""}`}
      style={{
        "--blueprint-type-bg": typeStyle.background,
        "--blueprint-type-color": typeStyle.color
      }}
    >
      <button
        type="button"
        className="blueprint-card-body"
        onClick={() => onSelect(item)}
        aria-pressed={selected}
        aria-label={`Voir ${entry.name}`}
      >
        <div className="blueprint-card-topline">
          <span className="blueprint-type-chip">
            {typeStyle.label}
          </span>

          <span className={`blueprint-status-pill ${statusClassName(status)}`}>
            {statusLabel(status, installedVersion)}
          </span>
        </div>

        <div>
          <h3>{entry.name}</h3>
          {entry.description && <p>{entry.description}</p>}
        </div>

        <div className="blueprint-card-stats" aria-label="Métadonnées">
          <span className="blueprint-card-stat">
            <strong>{entry.question_count ?? "—"}</strong>
            <span>questions</span>
          </span>
          <span className="blueprint-card-stat">
            <strong>v{entry.version ?? "—"}</strong>
            <span>version</span>
          </span>
        </div>

        <div className="blueprint-card-meta">
          <span>{questionCountLabel(entry.question_count)}</span>
          {sizeLabel && <span>{sizeLabel}</span>}
          {downloadLabel && <span>{downloadLabel}</span>}
          {entry.license && <span>{entry.license}</span>}
        </div>
      </button>

      <div className="blueprint-card-actions">
        {canAct ? (
          <button
            type="button"
            disabled={busy}
            onClick={handleAction}
            className="blueprint-card-action"
            aria-label={`${actionCopy(status, false)} ${entry.name}`}
          >
            {actionCopy(status, busy)}
          </button>
        ) : (
          <span className="blueprint-status-pill blueprint-status-pill-install">
            Installé
          </span>
        )}

        {status === "update_available" && (
          <span className="blueprint-detail-muted">
            v{entry.version} disponible
          </span>
        )}
      </div>

      {action.error && (
        <div className="blueprint-action-error" role="alert">
          {action.error}
        </div>
      )}

      {action.pendingRemoval && (
        <div className="blueprint-pending-removal">
          <span>
            {action.pendingRemoval.length} question
            {action.pendingRemoval.length > 1 ? "s" : ""} retirée
            {action.pendingRemoval.length > 1 ? "s" : ""} du pack.
          </span>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onUpdate(entry, { deleteRemoved: true });
            }}
            className="blueprint-danger-button"
          >
            Supprimer
          </button>
        </div>
      )}
    </article>
  );
}
