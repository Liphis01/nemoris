import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMapZones, patchMapZones } from "../../../api/maps";


export function getZoneCode(zone) {
  return zone?.data?.code || zone?.code;
}


export function isBlankTemporaryZone(zone) {
  return String(zone?.id || "").startsWith("tmp-") && !zone?.answer?.trim();
}


export function normalizeZone(zone, group) {
  const code = getZoneCode(zone);
  const aliases = zone?.data?.aliases || zone?.aliases || [];

  return {
    ...zone,
    type_q: "map",
    question: zone?.question || `${group.name || ""} - ${code}`,
    answer: zone?.answer || zone?.label || "",
    media: zone?.media || "",
    tags: zone?.tags || [],
    group_id: zone?.group_id || group.id,
    group: zone?.group || {
      id: group.id,
      type_group: group.type_group || "map",
      name: group.name,
      media: group.media
    },
    data: {
      ...(zone?.data || {}),
      code,
      aliases
    }
  };
}


export function useMapZones(group) {
  const [zones, setZones] = useState([]);
  const [svgCodes, setSvgCodes] = useState([]);
  const [editableGroup, setEditableGroup] = useState({
    name: group.name || "",
    type_group: group.type_group || "map",
    media: group.media || ""
  });
  const initialZonesRef = useRef([]);
  const dirtyZoneCodesRef = useRef(new Set());
  const zonesRef = useRef([]);

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  useEffect(() => {
    async function loadZones() {
      try {
        const data = await getMapZones(group.id);
        const mapZones = data.map(zone => normalizeZone(zone, group));

        setZones(mapZones);
        initialZonesRef.current = mapZones;
        dirtyZoneCodesRef.current.clear();
      } catch (error) {
        console.error("Error loading zones:", error);
      }
    }

    if (group.id) {
      loadZones();
      setEditableGroup({
        name: group.name || "",
        type_group: group.type_group || "map",
        media: group.media || ""
      });
    }
  }, [group]);

  const handleCodesLoaded = useCallback((codes) => {
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
    () => zones.map(getZoneCode).filter(Boolean),
    [zones]
  );

  const savedQuestionCount = useMemo(
    () => zones.filter(zone => !isBlankTemporaryZone(zone)).length,
    [zones]
  );

  function markDirty(code) {
    if (code) {
      dirtyZoneCodesRef.current.add(code);
    }
  }

  function clearDirty(code) {
    if (code) {
      dirtyZoneCodesRef.current.delete(code);
    }
  }

  function updateGroupField(field, value) {
    setEditableGroup(prev => ({
      ...prev,
      [field]: value
    }));
  }

  async function saveMapZones({ zonesToSave, changedZones }) {
    const saveResult = await patchMapZones(group.id, {
      group: {
        name: editableGroup.name,
        media: editableGroup.media
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
    dirtyZoneCodesRef.current.clear();
    initialZonesRef.current = nextZones;

    return {
      delta: newCount - initialCount,
      nextZones,
      savedZones,
      saveResult
    };
  }

  return {
    clearDirty,
    dirtyZoneCodesRef,
    editableGroup,
    foundCodes,
    handleCodesLoaded,
    markDirty,
    savedQuestionCount,
    saveMapZones,
    setEditableGroup,
    setZones,
    svgCodes,
    updateGroupField,
    zones,
    zonesRef
  };
}
