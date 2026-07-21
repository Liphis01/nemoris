import { useCallback, useEffect, useState } from "react";
import {
  fetchCatalog,
  getBlueprintCatalogSettings,
  installBlueprintFromCatalog,
  listInstalledBlueprints,
  unsubscribeBlueprint as requestUnsubscribe,
  updateBlueprintFromCatalog
} from "../../../api/blueprints";

export function blueprintStatus(entry, installed) {
  if (!installed) {
    return "not_installed";
  }

  return installed.installed_version < entry.version
    ? "update_available"
    : "up_to_date";
}

export function useBrowseBlueprints() {
  const [catalogUrl, setCatalogUrl] = useState(null);
  const [entries, setEntries] = useState([]);
  const [installedByGuid, setInstalledByGuid] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionState, setActionState] = useState({});

  const loadInstalled = useCallback(async () => {
    const rows = await listInstalledBlueprints();
    const byGuid = {};
    rows.forEach((row) => {
      byGuid[row.blueprint_guid] = row;
    });
    setInstalledByGuid(byGuid);
    return byGuid;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const settings = await getBlueprintCatalogSettings();
      const url = settings.url || "";
      setCatalogUrl(url || null);

      if (!url) {
        setEntries([]);
        setInstalledByGuid({});
        return;
      }

      const [catalog] = await Promise.all([
        fetchCatalog(url),
        loadInstalled()
      ]);

      setEntries(Array.isArray(catalog.blueprints) ? catalog.blueprints : []);
    } catch (loadError) {
      console.error(loadError);
      setError(loadError.message || "Catalogue impossible à charger.");
    } finally {
      setLoading(false);
    }
  }, [loadInstalled]);

  useEffect(() => {
    load();
  }, [load]);

  function patchAction(guid, patch) {
    setActionState((previous) => ({
      ...previous,
      [guid]: { ...previous[guid], ...patch }
    }));
  }

  async function install(entry) {
    patchAction(entry.blueprint_guid, { busy: true, error: "" });

    try {
      await installBlueprintFromCatalog(entry);
      await loadInstalled();
      patchAction(entry.blueprint_guid, { busy: false });
    } catch (installError) {
      console.error(installError);
      patchAction(entry.blueprint_guid, {
        busy: false,
        error: installError.message || "Installation impossible."
      });
    }
  }

  async function update(entry, { deleteRemoved = false } = {}) {
    patchAction(entry.blueprint_guid, { busy: true, error: "" });

    try {
      const result = await updateBlueprintFromCatalog(entry, { deleteRemoved });
      await loadInstalled();

      patchAction(entry.blueprint_guid, {
        busy: false,
        pendingRemoval:
          !deleteRemoved && result.removed?.length ? result.removed : null
      });
    } catch (updateError) {
      console.error(updateError);
      patchAction(entry.blueprint_guid, {
        busy: false,
        error: updateError.message || "Mise à jour impossible."
      });
    }
  }

  async function unsubscribe(blueprintGuid, { deleteContent = false } = {}) {
    patchAction(blueprintGuid, { busy: true, error: "" });

    try {
      await requestUnsubscribe(blueprintGuid, { deleteContent });
      await loadInstalled();
      patchAction(blueprintGuid, { busy: false, pendingRemoval: null });
    } catch (unsubscribeError) {
      console.error(unsubscribeError);
      patchAction(blueprintGuid, {
        busy: false,
        error: unsubscribeError.message || "Désabonnement impossible."
      });
    }
  }

  const items = entries.map((entry) => {
    const installed = installedByGuid[entry.blueprint_guid] || null;

    return {
      entry,
      status: blueprintStatus(entry, installed),
      installedVersion: installed?.installed_version ?? null,
      action: actionState[entry.blueprint_guid] || {}
    };
  });

  return {
    catalogUrl,
    items,
    loading,
    error,
    reload: load,
    install,
    update,
    unsubscribe
  };
}
