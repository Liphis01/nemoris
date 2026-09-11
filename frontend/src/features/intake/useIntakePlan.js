import { useCallback, useEffect, useRef, useState } from "react";

import { applyIntakePlanActions, getIntakePlan } from "../../api/review";

const CONFLICT_MESSAGE = "Le plan a changé ailleurs : la vue a été mise à jour.";


export function useIntakePlan({ onChanged } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Kept until the next successful action or an explicit dismiss: a reload
  // must never wipe the only sign that the last change did not go through.
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const snapshotRef = useRef(null);
  const savingRef = useRef(false);
  const onChangedRef = useRef(onChanged);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const adopt = useCallback((next) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      adopt(await getIntakePlan());
    } catch (caught) {
      setLoadError(caught?.message || "File des nouvelles indisponible.");
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  useEffect(() => {
    reload();
  }, [reload]);

  // One action at a time: each is built on the current revision, so a second
  // one sent before the first returns would only bounce off a 409.
  const apply = useCallback(async (actions, { optimistic } = {}) => {
    const current = snapshotRef.current;

    if (!current || savingRef.current) return null;

    savingRef.current = true;
    setSaving(true);

    if (optimistic) adopt(optimistic(current));

    try {
      const next = await applyIntakePlanActions(actions, current.revision);
      adopt(next);
      setActionError("");
      onChangedRef.current?.(next);
      return next;
    } catch (caught) {
      if (caught?.status === 409 && caught.snapshot) {
        adopt(caught.snapshot);
        setActionError(CONFLICT_MESSAGE);
      } else {
        adopt(current);
        setActionError(caught?.message || "La modification n'a pas pu être enregistrée.");
      }

      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [adopt]);

  return {
    snapshot,
    loading,
    loadError,
    actionError,
    saving,
    reload,
    apply,
    dismissError: () => setActionError("")
  };
}
