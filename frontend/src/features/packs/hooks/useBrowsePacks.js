import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPackCatalogSettings,
  installPackFromCatalog,
  listInstalledPacks,
  searchPackCatalog,
  unsubscribePack as requestUnsubscribe,
  updatePackFromCatalog
} from "../../../api/packs";

export const POPULAR_THEME = "__popular__";
const DEFAULT_LIMIT = 24;

export function packStatus(entry, installed) {
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
    if (entry?.pack_guid) {
      byGuid.set(entry.pack_guid, entry);
    }
  });

  return [...byGuid.values()];
}

export function useBrowsePacks(filters = {}) {
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
    const rows = await listInstalledPacks();
    const byGuid = {};
    rows.forEach((row) => {
      byGuid[row.pack_guid] = row;
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
      const settings = await getPackCatalogSettings();
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
        searchPackCatalog({
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

      const packs = Array.isArray(catalog.packs)
        ? catalog.packs
        : [];
      setEntries((previous) => (
        append ? dedupeEntries([...previous, ...packs]) : packs
      ));
      setFacets(catalog.facets || { themes: [] });
      setTotal(Number.isFinite(catalog.total) ? catalog.total : packs.length);
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
    patchAction(entry.pack_guid, { busy: true, error: "" });

    try {
      await installPackFromCatalog(entry);
      await loadPage({ append: false });
      patchAction(entry.pack_guid, { busy: false });
    } catch (installError) {
      console.error(installError);
      patchAction(entry.pack_guid, {
        busy: false,
        error: installError.message || "Installation impossible."
      });
    }
  }

  async function update(entry, { deleteRemoved = false } = {}) {
    patchAction(entry.pack_guid, { busy: true, error: "" });

    try {
      const result = await updatePackFromCatalog(entry, { deleteRemoved });
      await loadPage({ append: false });

      patchAction(entry.pack_guid, {
        busy: false,
        pendingRemoval:
          !deleteRemoved && result.removed?.length ? result.removed : null
      });
    } catch (updateError) {
      console.error(updateError);
      patchAction(entry.pack_guid, {
        busy: false,
        error: updateError.message || "Mise à jour impossible."
      });
    }
  }

  async function unsubscribe(packGuid, { deleteContent = false } = {}) {
    patchAction(packGuid, { busy: true, error: "" });

    try {
      await requestUnsubscribe(packGuid, { deleteContent });
      await loadPage({ append: false });
      patchAction(packGuid, { busy: false, pendingRemoval: null });
    } catch (unsubscribeError) {
      console.error(unsubscribeError);
      patchAction(packGuid, {
        busy: false,
        error: unsubscribeError.message || "Désabonnement impossible."
      });
    }
  }

  const items = useMemo(() => entries.map((entry) => {
    const installed = installedByGuid[entry.pack_guid] || null;

    return {
      entry,
      status: packStatus(entry, installed),
      installedVersion: installed?.installed_version ?? null,
      action: actionState[entry.pack_guid] || {}
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
