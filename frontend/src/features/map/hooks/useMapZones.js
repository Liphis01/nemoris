import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMapZones, patchMapZones } from "../../../api/maps";


export function getZoneCode(zone) {
  // Saved zones store the SVG identifier in data.code; temporary/editor rows
  // may also carry code at the top level.
  return zone?.data?.code || zone?.code;
}


export function isBlankTemporaryZone(zone) {
  // Temporary rows exist only while the user is editing an unsaved SVG zone.
  // If no answer was entered, there is nothing worth saving.
  return String(zone?.id || "").startsWith("tmp-") && !zone?.answer?.trim();
}

function arraysMatch(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}


function mergeTagsFromZones(zones = []) {
  const tagsByKey = new Map();

  zones.forEach((zone) => {
    (zone.tags || []).forEach((tag) => {
      const value = String(tag || "").trim();
      const key = value.toLowerCase();

      if (value && !tagsByKey.has(key)) {
        tagsByKey.set(key, value);
      }
    });
  });

  return [...tagsByKey.values()];
}


function buildEditableGroup(group, zones = []) {
  return {
    name: group.name || "",
    type_group: group.type_group || "map",
    media: group.media || "",
    tags: Array.isArray(group.tags) ? group.tags : mergeTagsFromZones(zones),
    data: group.data || {},
    map: group.map || group.data?.map || null
  };
}


export function normalizeZone(zone, group) {
  // Keep map zones shaped like normal Manage questions while guaranteeing the
  // map-specific data.code/data.aliases fields exist.
  const code = getZoneCode(zone);
  const aliases = zone?.data?.aliases || zone?.aliases || [];
  const zoneGroup = zone?.group || {};

  return {
    ...zone,
    type_q: "map",
    question: zone?.question || `${group.name || ""} - ${code}`,
    answer: zone?.answer || zone?.label || "",
    media: zone?.media || "",
    tags: zone?.tags || [],
    group_id: zone?.group_id || group.id,
    group: {
      id: zoneGroup.id || group.id,
      type_group: zoneGroup.type_group || group.type_group || "map",
      name: zoneGroup.name || group.name,
      media: zoneGroup.media || group.media,
      data: zoneGroup.data || group.data || {},
      map: zoneGroup.map || group.map || group.data?.map || null,
      tags: Array.isArray(zoneGroup.tags) ? zoneGroup.tags : group.tags || []
    },
    data: {
      ...(zone?.data || {}),
      code,
      aliases
    }
  };
}


export function useMapZones(group) {
  // Data layer for MapEditor: loads saved zones, tracks SVG codes discovered by
  // SvgMap, remembers dirty zone codes, and persists changed zones in bulk.
  const [zones, setZones] = useState([]);
  const [svgCodes, setSvgCodes] = useState([]);
  const [dirtyZoneCodes, setDirtyZoneCodes] = useState([]);
  const [editableGroup, setEditableGroup] = useState(() =>
    buildEditableGroup(group)
  );
  const initialZonesRef = useRef([]);
  const initialGroupRef = useRef(buildEditableGroup(group));
  const dirtyZoneCodesRef = useRef(new Set());
  const zonesRef = useRef([]);

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  const clearAllDirty = useCallback(() => {
    dirtyZoneCodesRef.current.clear();
    setDirtyZoneCodes([]);
  }, []);

  useEffect(() => {
    async function loadZones() {
      try {
        // The backend returns atomic map questions; normalize them into editor
        // rows before comparing or saving.
        const data = await getMapZones(group.id);
        const mapZones = data.map(zone => normalizeZone(zone, group));
        const nextGroup = buildEditableGroup(group, mapZones);

        setZones(mapZones);
        initialZonesRef.current = mapZones;
        setEditableGroup(nextGroup);
        initialGroupRef.current = nextGroup;
        clearAllDirty();
      } catch (error) {
        console.error("Error loading zones:", error);
      }
    }

    if (group.id) {
      const nextGroup = buildEditableGroup(group);

      setEditableGroup(nextGroup);
      initialGroupRef.current = nextGroup;
      loadZones();
    }
  }, [clearAllDirty, group]);

  const handleCodesLoaded = useCallback((codes) => {
    // Avoid state churn when the same SVG reports the same code list again.
    setSvgCodes(prev => {
      if (
        prev.length === codes.length &&
        prev.every((code, index) => code === codes[index])
      ) {
        return prev;
      }

      return codes;
    });
  }, []);

  const foundCodes = useMemo(
    () => zones
      .filter(zone => String(zone.answer || "").trim())
      .map(getZoneCode)
      .filter(Boolean),
    [zones]
  );

  const savedQuestionCount = useMemo(
    () => zones.filter(zone => !isBlankTemporaryZone(zone)).length,
    [zones]
  );

  function markDirty(code) {
    // Track dirtiness by SVG code rather than database id so temporary rows and
    // existing rows share the same save path.
    if (!code || dirtyZoneCodesRef.current.has(code)) {
      return;
    }

    dirtyZoneCodesRef.current.add(code);
    setDirtyZoneCodes([...dirtyZoneCodesRef.current]);
  }

  function clearDirty(code) {
    if (!code || !dirtyZoneCodesRef.current.has(code)) {
      return;
    }

    dirtyZoneCodesRef.current.delete(code);
    setDirtyZoneCodes([...dirtyZoneCodesRef.current]);
  }

  function zoneDiffersFromSaved(zone) {
    if (isBlankTemporaryZone(zone)) {
      return false;
    }

    const code = getZoneCode(zone);
    const savedZone = initialZonesRef.current.find(saved =>
      getZoneCode(saved) === code
    );

    if (!savedZone) {
      return Boolean(zone?.answer?.trim());
    }

    const zoneAliases = zone.data?.aliases || [];
    const savedAliases = savedZone.data?.aliases || [];

    return (
      (zone.answer || "") !== (savedZone.answer || "") ||
      !arraysMatch(zoneAliases, savedAliases)
    );
  }

  function syncDirtyForZone(zone) {
    const code = getZoneCode(zone);
    if (!code) {
      return;
    }

    if (zoneDiffersFromSaved(zone)) {
      markDirty(code);
    } else {
      clearDirty(code);
    }
  }

  function updateGroupField(field, value) {
    setEditableGroup(prev => ({
      ...prev,
      [field]: value
    }));
  }

  function groupDiffersFromSaved() {
    const initialGroup = initialGroupRef.current || {};

    return (
      (editableGroup.name || "") !== (initialGroup.name || "") ||
      (editableGroup.media || "") !== (initialGroup.media || "") ||
      !arraysMatch(editableGroup.tags || [], initialGroup.tags || [])
    );
  }

  function hasDirtyChanges() {
    return dirtyZoneCodesRef.current.size > 0 || groupDiffersFromSaved();
  }

  const cancelChanges = useCallback(() => {
    const revertedZones = initialZonesRef.current;

    setZones(revertedZones);
    setEditableGroup(initialGroupRef.current);
    clearAllDirty();

    return revertedZones;
  }, [clearAllDirty]);

  async function saveMapZones({ zonesToSave, changedZones }) {
    // Send only changed zones, but rebuild local state from the server response
    // so newly created rows get their real database ids/progress.
    const saveResult = await patchMapZones(group.id, {
      group: {
        name: editableGroup.name,
        media: editableGroup.media,
        tags: editableGroup.tags || []
      },
      zones: changedZones.map(zone => ({
        id: String(zone.id || "").startsWith("tmp-") ? null : zone.id,
        code: getZoneCode(zone),
        answer: zone.answer || "",
        aliases: zone.data?.aliases || []
      }))
    });

    const savedZones = (saveResult.zones || []).map(zone =>
      normalizeZone(zone, saveResult.group || group)
    );
    const savedByCode = new Map(
      savedZones.map(zone => [getZoneCode(zone), zone])
    );
    const nextZones = zonesToSave.map(zone =>
      savedByCode.get(getZoneCode(zone)) || zone
    );
    const initialCount = (initialZonesRef.current || []).length;
    const newCount = saveResult.question_count ?? nextZones.length;

    setZones(nextZones);
    clearAllDirty();
    initialZonesRef.current = nextZones;

    const nextGroup = {
      name: saveResult.group?.name ?? editableGroup.name ?? "",
      type_group: saveResult.group?.type_group ?? editableGroup.type_group ?? "map",
      media: saveResult.group?.media ?? editableGroup.media ?? "",
      tags: saveResult.group?.tags ?? editableGroup.tags ?? []
    };

    setEditableGroup(nextGroup);
    initialGroupRef.current = nextGroup;

    return {
      delta: newCount - initialCount,
      nextZones,
      savedZones,
      saveResult
    };
  }

  return {
    cancelChanges,
    clearDirty,
    dirtyZoneCodes,
    dirtyZoneCodesRef,
    editableGroup,
    foundCodes,
    handleCodesLoaded,
    hasDirtyChanges,
    markDirty,
    savedQuestionCount,
    saveMapZones,
    setEditableGroup,
    setZones,
    syncDirtyForZone,
    svgCodes,
    updateGroupField,
    zones,
    zonesRef
  };
}
