import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getBlueprintCatalogSettings,
  installBlueprintFromCatalog,
  listInstalledBlueprints,
  searchBlueprintCatalog,
  unsubscribeBlueprint as requestUnsubscribe,
  updateBlueprintFromCatalog
} from "../../../api/blueprints";

export const POPULAR_THEME = "__popular__";
const DEFAULT_LIMIT = 24;

export function blueprintStatus(entry, installed) {
  if (!installed) {
    return "not_installed";
  }

  return installed.installed_version < entry.version
    ? "update_available"
    : "up_to_date";
}

function dedupeEntries(entries) {
  const byGuid = new Map();

  entries.forEach((entry) => {
    if (entry?.blueprint_guid) {
      byGuid.set(entry.blueprint_guid, entry);
    }
  });

  return [...byGuid.values()];
}

export function useBrowseBlueprints(filters = {}) {
  const search = filters.search || "";
  const theme = filters.theme || "";
  const type = filters.type || "all";
  const status = filters.status || "all";
  const sort = filters.sort || "pertinence";
  const limit = filters.limit || DEFAULT_LIMIT;

  const [catalogUrl, setCatalogUrl] = useState(null);
  const [entries, setEntries] = useState([]);
  const [facets, setFacets] = useState({ themes: [] });
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [installedByGuid, setInstalledByGuid] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [actionState, setActionState] = useState({});
  const requestIdRef = useRef(0);

  const loadInstalled = useCallback(async () => {
    const rows = await listInstalledBlueprints();
    const byGuid = {};
    rows.forEach((row) => {
      byGuid[row.blueprint_guid] = row;
    });
    setInstalledByGuid(byGuid);
    return byGuid;
  }, []);

  const loadPage = useCallback(async ({ append = false, cursor = null } = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setNextCursor(null);
    }

    setError("");

    try {
      const settings = await getBlueprintCatalogSettings();
      const configured = Boolean(settings.url && settings.key);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setCatalogUrl(configured ? settings.url : null);

      if (!configured) {
        setEntries([]);
        setFacets({ themes: [] });
        setTotal(0);
        setInstalledByGuid({});
        return;
      }

      const [catalog] = await Promise.all([
        searchBlueprintCatalog({
          q: search,
          theme,
          type: type === "all" ? "" : type,
          status,
          sort,
          limit,
          cursor
        }),
        loadInstalled()
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      const blueprints = Array.isArray(catalog.blueprints)
        ? catalog.blueprints
        : [];
      setEntries((previous) => (
        append ? dedupeEntries([...previous, ...blueprints]) : blueprints
      ));
      setFacets(catalog.facets || { themes: [] });
      setTotal(Number.isFinite(catalog.total) ? catalog.total : blueprints.length);
      setNextCursor(catalog.next_cursor || null);
    } catch (loadError) {
      console.error(loadError);

      if (requestId === requestIdRef.current) {
        setError(loadError.message || "Catalogue impossible à charger.");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [limit, loadInstalled, search, sort, status, theme, type]);

  useEffect(() => {
    loadPage({ append: false });
  }, [loadPage]);

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
      await loadPage({ append: false });
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
      await loadPage({ append: false });

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
      await loadPage({ append: false });
      patchAction(blueprintGuid, { busy: false, pendingRemoval: null });
    } catch (unsubscribeError) {
      console.error(unsubscribeError);
      patchAction(blueprintGuid, {
        busy: false,
        error: unsubscribeError.message || "Désabonnement impossible."
      });
    }
  }

  const items = useMemo(() => entries.map((entry) => {
    const installed = installedByGuid[entry.blueprint_guid] || null;

    return {
      entry,
      status: blueprintStatus(entry, installed),
      installedVersion: installed?.installed_version ?? null,
      action: actionState[entry.blueprint_guid] || {}
    };
  }), [actionState, entries, installedByGuid]);

  return {
    catalogUrl,
    facets,
    items,
    loading,
    loadingMore,
    error,
    total,
    hasMore: Boolean(nextCursor),
    reload: () => loadPage({ append: false }),
    loadMore: () => (
      nextCursor
        ? loadPage({ append: true, cursor: nextCursor })
        : Promise.resolve()
    ),
    install,
    update,
    unsubscribe
  };
}
