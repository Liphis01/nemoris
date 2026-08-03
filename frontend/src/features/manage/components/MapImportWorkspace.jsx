import { useState } from "react";
import MapImportResultWorkspace from "./MapImportResultWorkspace";
import MapRepairWorkspace from "./MapRepairWorkspace";

/**
 * The single full-width import workspace. It owns the mode the import is being
 * worked on in — `result` for reviewing and creating, `repair` for structural
 * correction — so Manage only has to know that an import is open.
 *
 * Once correction has started the backend locks interpretation and ontology
 * changes to the repair branch, so the import stays in repair mode until it is
 * committed or left; resuming such a draft reopens repair directly.
 */
export default function MapImportWorkspace({
  initialMode = "result",
  draft,
  name,
  onExit,
  onImported
}) {
  const [mode, setMode] = useState(initialMode);
  const [activeDraft, setActiveDraft] = useState(draft);
  const [activeName, setActiveName] = useState(name || "");

  if (mode === "repair") {
    return (
      <MapRepairWorkspace
        initialDraft={activeDraft}
        groupName={activeName}
        onExit={onExit}
        onImported={onImported}
      />
    );
  }

  return (
    <MapImportResultWorkspace
      initialDraft={activeDraft}
      initialName={activeName}
      onExit={onExit}
      onImported={onImported}
      onOpenRepair={(report, repairName) => {
        setActiveDraft(report);
        setActiveName(repairName || activeName);
        setMode("repair");
      }}
    />
  );
}
