import { useCallback, useEffect, useState } from "react";

import { getIntakePlan } from "../../../api/review";
import { entrySummary } from "../intakePlanModel";
import IntakePlanDialog from "./IntakePlanDialog";
import "./IntakePlan.css";


// The Manage sidebar's way into the new-questions plan.
export default function IntakePlanEntry({
  onOpenQuestion = null,
  onQuestionsChanged = null
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getIntakePlan());
      setError("");
    } catch (caught) {
      setError(caught?.message || "File indisponible");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const todayCount = snapshot?.today?.count ?? 0;
  const summary = snapshot
    ? entrySummary(snapshot)
    : error
      ? "File indisponible"
      : "Chargement…";

  return (
    <div className="intake-entry">
      <button
        type="button"
        className="intake-entry-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="intake-entry-text">
          <span className="intake-entry-title">File des nouvelles</span>
          <span className="intake-entry-summary">{summary}</span>
        </span>
        <span className="intake-entry-count" aria-label={`${todayCount} aujourd'hui`}>
          {todayCount}
        </span>
      </button>

      {open && (
        <IntakePlanDialog
          onClose={() => {
            setOpen(false);
            refresh();
          }}
          onPlanChanged={setSnapshot}
          onOpenQuestion={onOpenQuestion}
          onQuestionsChanged={onQuestionsChanged}
        />
      )}
    </div>
  );
}
