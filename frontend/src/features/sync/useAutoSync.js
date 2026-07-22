import { useCallback, useEffect, useRef, useState } from "react";
import { COLLECTION_MUTATION_EVENT } from "../../api/http";
import {
  getSyncStatus,
  syncAuto,
  syncPull,
  syncPush
} from "../../api/sync";

const AUTO_SYNC_DEBOUNCE_MS = 20000;
const LIFECYCLE_MIN_INTERVAL_MS = 30000;

function canAutoSync(status) {
  return Boolean(status?.signed_in && status?.auto_sync_enabled);
}

function reloadApp() {
  window.setTimeout(() => {
    window.location.reload();
  }, 0);
}

export function useAutoSync({
  debounceMs = AUTO_SYNC_DEBOUNCE_MS,
  lifecycleMinIntervalMs = LIFECYCLE_MIN_INTERVAL_MS
} = {}) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const inFlightRef = useRef(false);
  const startupCheckedRef = useRef(false);
  const debounceRef = useRef(null);
  const mountedRef = useRef(false);
  const lastLifecycleRunAtRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyResult = useCallback((result) => {
    if (!mountedRef.current || !result) return;

    setLastResult(result);

    if (result.status === "conflict") {
      setPhase("conflict");
      setError("");
      setConflictVersion(result.server_version ?? null);
      return;
    }

    if (result.status === "error" || result.error) {
      setPhase("error");
      setError(result.error || "Synchronisation automatique impossible.");
      setConflictVersion(null);
      return;
    }

    setPhase("idle");
    setError("");
    setConflictVersion(null);

    if (result.reload_required) {
      reloadApp();
    }
  }, []);

  const runAutoSync = useCallback(async ({
    lifecycle = false,
    prechecked = false
  } = {}) => {
    if (inFlightRef.current) {
      return { status: "busy" };
    }

    if (lifecycle) {
      const now = Date.now();

      if (
        lastLifecycleRunAtRef.current &&
        now - lastLifecycleRunAtRef.current < lifecycleMinIntervalMs
      ) {
        return { status: "skipped", reason: "throttled" };
      }

      lastLifecycleRunAtRef.current = now;
    }

    if (!prechecked) {
      try {
        const status = await getSyncStatus();

        if (!canAutoSync(status)) {
          return { status: "skipped", reason: "disabled" };
        }
      } catch (statusError) {
        console.error(statusError);
        return { status: "skipped", reason: "status_unavailable" };
      }
    }

    inFlightRef.current = true;

    if (mountedRef.current) {
      setPhase("syncing");
      setError("");
    }

    try {
      const result = await syncAuto();
      applyResult(result);
      return result;
    } catch (syncError) {
      console.error(syncError);

      if (mountedRef.current) {
        setPhase("error");
        setError(syncError.message || "Synchronisation automatique impossible.");
        setConflictVersion(null);
      }

      return { status: "error", error: syncError.message };
    } finally {
      inFlightRef.current = false;
    }
  }, [applyResult, lifecycleMinIntervalMs]);

  const runManualResolution = useCallback(async (operation) => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setPhase("syncing");
    setError("");

    try {
      const result = await operation();
      applyResult(result);
    } catch (manualError) {
      console.error(manualError);
      setPhase("error");
      setError(manualError.message || "Synchronisation impossible.");
      setConflictVersion(null);
    } finally {
      inFlightRef.current = false;
    }
  }, [applyResult]);

  const resolveByPull = useCallback(async () => {
    const confirmed = window.confirm(
      "Télécharger remplacera les données de cet appareil par la copie du " +
        "cloud. Continuer ?"
    );

    if (!confirmed) return;

    await runManualResolution(async () => ({
      ...(await syncPull()),
      reload_required: true
    }));
  }, [runManualResolution]);

  const resolveByForcePush = useCallback(async () => {
    await runManualResolution(() => syncPush({ force: true }));
  }, [runManualResolution]);

  const dismiss = useCallback(() => {
    setPhase("idle");
    setError("");
    setConflictVersion(null);
  }, []);

  useEffect(() => {
    if (startupCheckedRef.current) return undefined;

    startupCheckedRef.current = true;
    let cancelled = false;

    getSyncStatus()
      .then((status) => {
        if (cancelled || !canAutoSync(status)) return;
        runAutoSync({ lifecycle: true, prechecked: true });
      })
      .catch((statusError) => {
        console.error(statusError);
      });

    return () => {
      cancelled = true;
    };
  }, [runAutoSync]);

  useEffect(() => {
    function runLifecycleSync() {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }

      runAutoSync({ lifecycle: true });
    }

    window.addEventListener("focus", runLifecycleSync);
    document.addEventListener("visibilitychange", runLifecycleSync);

    return () => {
      window.removeEventListener("focus", runLifecycleSync);
      document.removeEventListener("visibilitychange", runLifecycleSync);
    };
  }, [runAutoSync]);

  useEffect(() => {
    function scheduleMutationSync() {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        runAutoSync();
      }, debounceMs);
    }

    window.addEventListener(COLLECTION_MUTATION_EVENT, scheduleMutationSync);

    return () => {
      window.removeEventListener(COLLECTION_MUTATION_EVENT, scheduleMutationSync);

      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [debounceMs, runAutoSync]);

  return {
    phase,
    error,
    conflictVersion,
    lastResult,
    runAutoSync,
    resolveByPull,
    resolveByForcePush,
    dismiss
  };
}
