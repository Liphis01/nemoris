import { useEffect, useMemo, useRef, useState } from "react";
import AutocompleteInput from "../../../shared/AutocompleteInput";
import { resolveMediaUrl } from "../../../shared/media";
import { apiUrl } from "../../../api/config";
import {
  cancelMapImport,
  commitMapImport,
  createMapUpgradeDraft,
  patchMapImport
} from "../../../api/maps";
import {
  cancelButtonStyle,
  disabledCancelButtonStyle,
  disabledSaveButtonStyle,
  pendingSaveDotStyle,
  pendingSaveButtonStyle
} from "../../manage/components/QuestionEditorStyles";
import MapMediaInput from "./MapMediaInput";
import SvgMap from "./SvgMap";
import {
  getZoneCode,
  isBlankTemporaryZone,
  normalizeZone,
  useMapZones
} from "../hooks/useMapZones";

// The zone editor's resting height, reserved in the layout so the map box is a
// constant size. Anything that makes the editor taller (an alias chip wrapping to
// a new line) grows it upwards over the map instead of shrinking the map
// underneath, which would re-fit and visibly move an already-framed zone.
const zoneEditorReservedHeight = 248;

export default function MapEditor({
  group,
  onClose,
  onSave,
  onZoneSelect,
  selectedZone,
  headerAction,
  registerPendingSaveHandler,
  availableTags = []
}) {
  // MapEditor turns SVG zones into atomic map questions. The group is visual
  // context; each saved zone remains its own reviewable question.
  const [editingZone, setEditingZone] = useState(null);
  const [mapFocusCode, setMapFocusCode] = useState(null);
  const [aliasInput, setAliasInput] = useState("");
  const [groupTagInput, setGroupTagInput] = useState("");
  const [upgradeDraft, setUpgradeDraft] = useState(null);
  const [upgradeError, setUpgradeError] = useState("");
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const labelInputRef = useRef(null);
  const aliasInputRef = useRef(null);
  const focusLabelAfterZoneChangeRef = useRef(false);
  const saveMapEditsRef = useRef(null);
  const suppressFocusForCodeRef = useRef(null);
  const {
    cancelChanges,
    clearDirty,
    dirtyZoneCodes,
    dirtyZoneCodesRef,
    editableGroup,
    foundCodes,
    handleCodesLoaded,
    hasDirtyChanges,
    saveMapZones,
    setZones,
    syncDirtyForZone,
    svgCodes,
    updateGroupField,
    zones
  } = useMapZones(group);

  useEffect(() => {
    if (!selectedZone) {
      setMapFocusCode(null);
      return;
    }

    const selectedCode = getZoneCode(selectedZone);
    // When opened from an existing map question, focus that zone and discard any
    // unsaved blank temporary row from a previous click.
    setZones(prev => prev.filter(zone => !isBlankTemporaryZone(zone)));
    setEditingZone(normalizeZone(selectedZone, group));

    // A save re-selects the zone it just persisted so the list scrolls to it.
    // That re-selection must not re-zoom the map onto the saved zone, so skip the
    // focus for this one code while keeping every other auto-zoom intact.
    if (suppressFocusForCodeRef.current === selectedCode) {
      suppressFocusForCodeRef.current = null;
      return;
    }

    suppressFocusForCodeRef.current = null;
    setMapFocusCode(selectedCode);
  }, [group, selectedZone, setZones]);

  const totalCodeCount = svgCodes.length;
  const namedZoneCount = zones.filter(
    zone => String(zone.answer || "").trim()
  ).length;
  const assignmentRatio = totalCodeCount
    ? Math.min(namedZoneCount / totalCodeCount, 1)
    : 0;
  const assignmentDegrees = Math.round(assignmentRatio * 360);
  const hasPendingMapChanges = hasDirtyChanges();
  const zoneLabels = useMemo(() => {
    const labels = {};

    zones.forEach(zone => {
      const code = getZoneCode(zone);
      const answer = String(zone.answer || "").trim();

      if (code && answer) {
        labels[code] = answer;
      }
    });

    return labels;
  }, [zones]);

  async function analyzeLegacyUpgrade() {
    setUpgradeBusy(true);
    setUpgradeError("");
    try {
      setUpgradeDraft(await createMapUpgradeDraft(group.id));
    } catch (error) {
      setUpgradeError(String(error.message || error));
    } finally {
      setUpgradeBusy(false);
    }
  }

  async function acknowledgeUpgradeWarnings() {
    setUpgradeBusy(true);
    setUpgradeError("");
    try {
      const acknowledgements = upgradeDraft.diagnostics
        .filter(item => item.requires_acknowledgement)
        .map(item => item.code);
      setUpgradeDraft(await patchMapImport(upgradeDraft.draft_id, {
        acknowledgements
      }));
    } catch (error) {
      setUpgradeError(String(error.message || error));
    } finally {
      setUpgradeBusy(false);
    }
  }

  async function applyLegacyUpgrade() {
    setUpgradeBusy(true);
    setUpgradeError("");
    try {
      const result = await commitMapImport(
        upgradeDraft.draft_id, editableGroup.name
      );
      setUpgradeDraft(null);
      await onSave?.(0, {
        group: result.group,
        zones: result.zones,
        createdQuestionIds: result.createdQuestionIds
      });
    } catch (error) {
      setUpgradeError(String(error.message || error));
    } finally {
      setUpgradeBusy(false);
    }
  }

  async function closeLegacyUpgrade() {
    const draftId = upgradeDraft?.draft_id;
    setUpgradeDraft(null);
    if (!draftId) return;
    try {
      await cancelMapImport(draftId);
    } catch {
      // Expiry is the fallback if the backend already removed the draft.
    }
  }

  function createTemporaryZone(code) {
    return {
      id: "tmp-" + code,
      type_q: "map",
      question: "",
      answer: "",
      tags: editableGroup.tags || [],
      group_id: group.id,
      data: { code, aliases: [] }
    };
  }

  function addGroupTag(selectedTag) {
    const value = String(selectedTag ?? groupTagInput).trim();
    const currentTags = editableGroup.tags || [];

    if (!value || currentTags.includes(value)) {
      setGroupTagInput("");
      return;
    }

    updateGroupField("tags", [...currentTags, value]);
    setGroupTagInput("");
  }

  function removeGroupTag(tag) {
    updateGroupField(
      "tags",
      (editableGroup.tags || []).filter(item => item !== tag)
    );
  }

  function handleHorizontalChipWheel(event) {
    const chip = event.target?.closest?.("[data-chip-wheel-target]");

    if (!chip || !event.currentTarget.contains(chip)) {
      return;
    }

    const strip = event.currentTarget;
    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;

    if (maxScrollLeft <= 0) {
      return;
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;

    if (!delta) {
      return;
    }

    event.preventDefault();
    strip.scrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, strip.scrollLeft + delta)
    );
  }

  function discardBlankEditingZone(sourceZones) {
    if (isBlankTemporaryZone(editingZone)) {
      clearDirty(getZoneCode(editingZone));
      return sourceZones.filter(z => z.id !== editingZone.id);
    }

    return sourceZones;
  }

  function selectZoneCode(code, sourceZones) {
    const zone = sourceZones.find(z => getZoneCode(z) === code)
      || createTemporaryZone(code);
    setEditingZone(zone);

    return zone;
  }

  function handleSelect(code) {
    // Clicking an SVG region either edits its saved question or creates a
    // temporary unsaved zone row for that data-code.
    const nextZones = discardBlankEditingZone(zones);

    if (nextZones !== zones) {
      setZones(nextZones);
    }

    const zone = selectZoneCode(code, nextZones);

    // Only saved zones own a question row, so temporary ids have nothing to
    // reveal in the Manage list.
    if (!String(zone.id || "").startsWith("tmp-")) {
      onZoneSelect?.(zone);
    }
  }

  function handleZoneTab(e) {
    if (e.key !== "Tab") return;

    e.preventDefault();

    if (svgCodes.length === 0) {
      return;
    }

    const currentCode = getZoneCode(editingZone);
    const nextZones = discardBlankEditingZone(zones);
    const occupiedCodes = new Set(
      nextZones
        .filter(zone => !isBlankTemporaryZone(zone))
        .map(getZoneCode)
        .filter(Boolean)
    );
    const currentIndex = svgCodes.indexOf(currentCode);
    const startIndex = currentIndex >= 0 ? currentIndex : -1;
    let nextCode = null;

    for (let offset = 1; offset <= svgCodes.length; offset += 1) {
      const candidate = svgCodes[(startIndex + offset) % svgCodes.length];

      if (!occupiedCodes.has(candidate)) {
        nextCode = candidate;
        break;
      }
    }

    if (nextZones !== zones) {
      setZones(nextZones);
    }

    if (nextCode) {
      focusLabelAfterZoneChangeRef.current = true;
      setMapFocusCode(nextCode);
      selectZoneCode(nextCode, nextZones);
    }
  }

  function updateZoneAnswer(value) {
    // The first non-empty answer promotes a temporary zone into the local zone
    // list so it will be included in the next save.
    const nextEditing = { ...editingZone, answer: value };
    const code = getZoneCode(editingZone);
    syncDirtyForZone(nextEditing);

    setZones(prev => {
      if (isBlankTemporaryZone(nextEditing)) {
        return prev.filter(z => z.id !== editingZone.id);
      }

      const zoneExists = prev.some(z => getZoneCode(z) === code);

      if (!zoneExists) {
        return [...prev, nextEditing];
      }

      return prev.map(z =>
        getZoneCode(z) === code ? { ...z, answer: value } : z
      );
    });
    setEditingZone(nextEditing);
  }

  function addAlias(focusAfter = false) {
    // Aliases are stored under data.aliases and are used by map review matching.
    const value = aliasInput.trim();
    if (!value) return;

    const currentAliases = editingZone.data?.aliases || [];
    const newAliases = [...currentAliases, value];
    const code = getZoneCode(editingZone);
    const nextEditing = {
      ...editingZone,
      data: { ...editingZone.data, aliases: newAliases }
    };
    syncDirtyForZone(nextEditing);

    setZones(prev =>
      prev.map(z =>
        getZoneCode(z) === code
          ? {
            ...z,
            data: { ...z.data, aliases: newAliases }
          }
          : z
      )
    );

    setEditingZone(nextEditing);

    setAliasInput("");

    if (focusAfter) {
      aliasInputRef.current?.focus();
    }
  }

  function removeAlias(index) {
    const currentAliases = editingZone.data?.aliases || [];
    const newAliases = currentAliases.filter((_, i) => i !== index);
    const code = getZoneCode(editingZone);
    const nextEditing = {
      ...editingZone,
      data: { ...editingZone.data, aliases: newAliases }
    };
    syncDirtyForZone(nextEditing);

    setZones(prev =>
      prev.map(z =>
        getZoneCode(z) === code
          ? {
            ...z,
            data: { ...z.data, aliases: newAliases }
          }
          : z
      )
    );
    setEditingZone(nextEditing);
  }

  function handleAliasKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addAlias(true);
      return;
    }

    if (e.key === "Tab") {
      if (aliasInput.trim()) {
        addAlias(false);
      }

      handleZoneTab(e);
    }
  }

  function handleZoneAnswerKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      aliasInputRef.current?.focus();
      return;
    }

    handleZoneTab(e);
  }

  async function saveMapEdits({ autosave = false } = {}) {
    const shouldDiscardBlankTemporaryZone = isBlankTemporaryZone(editingZone);
    // Remove the selected temporary zone when it still has no answer.
    const zonesToSave = shouldDiscardBlankTemporaryZone
      ? zones.filter((z) => z.id !== editingZone.id)
      : zones;
    const savedEditingCode = editingZone && !shouldDiscardBlankTemporaryZone
      ? getZoneCode(editingZone)
      : null;
    const dirtyCodes = dirtyZoneCodesRef.current;
    // Save only dirty existing zones plus temporary zones that need real ids.
    const changedZones = zonesToSave.filter(z => {
      const code = getZoneCode(z);
      return dirtyCodes.has(code) || String(z.id || "").startsWith("tmp-");
    });
    const shouldSave = changedZones.length > 0 || hasDirtyChanges();

    if (shouldDiscardBlankTemporaryZone) {
      clearDirty(getZoneCode(editingZone));
      setZones(zonesToSave);
    }

    if (!shouldSave) {
      if (!autosave) {
        setEditingZone(null);
      }

      return { saved: false };
    }

    let saved;

    try {
      saved = await saveMapZones({ zonesToSave, changedZones });
    } catch (error) {
      if (!autosave) {
        alert(error.message || "Impossible de sauvegarder la carte.");
      }

      throw error;
    }

    const { delta, savedZones, saveResult } = saved;
    setEditingZone(null);

    if (savedEditingCode) {
      // The parent re-selects this saved zone to scroll the list to it; flag the
      // code so the resulting re-selection does not auto-zoom the map.
      suppressFocusForCodeRef.current = savedEditingCode;
    }

    if (onSave) {
      // Bubble enough detail to ManageInspector to patch local lists and
      // highlight newly created/updated question rows.
      await onSave(delta, {
        selectedZoneCode: savedEditingCode,
        createdQuestionIds: saveResult.createdQuestionIds || [],
        createdZoneCodes: saveResult.createdZoneCodes || [],
        updatedQuestionIds: saveResult.updatedQuestionIds || [],
        updatedZoneCodes: saveResult.updatedZoneCodes || [],
        group: saveResult.group,
        zones: savedZones,
        questionCount: saveResult.question_count
      });
    }

    if (onClose) {
      onClose();
    }

    return { saved: true };
  }

  function cancelMapEdits() {
    // Revert the group and zone list to the last saved state, then re-point the
    // open editing panel at that zone's reverted values (or close it, if it was
    // an unsaved temporary zone that no longer exists in the reverted list).
    const code = getZoneCode(editingZone);
    const revertedZones = cancelChanges();
    setAliasInput("");
    setEditingZone(
      code
        ? revertedZones.find(zone => getZoneCode(zone) === code) || null
        : null
    );
  }

  useEffect(() => {
    saveMapEditsRef.current = saveMapEdits;
  });

  useEffect(() => {
    if (!registerPendingSaveHandler) {
      return undefined;
    }

    const saveIfDirty = () => saveMapEditsRef.current?.({ autosave: true }) || {
      saved: false
    };

    return registerPendingSaveHandler(saveIfDirty);
  }, [registerPendingSaveHandler]);

  useEffect(() => {
    if (editingZone) {
      if (
        !focusLabelAfterZoneChangeRef.current &&
        document.activeElement === aliasInputRef.current
      ) {
        return;
      }
      focusLabelAfterZoneChangeRef.current = false;
      labelInputRef.current?.focus();
    }
  }, [editingZone]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
        overflow: "hidden"
      }}
    >

      {/* 🗺️ MAP SECTION */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          // The zone editor below is taken out of flow and overlaid on the map,
          // so growing it (an alias chip wrapping to a new line) can never resize
          // the map box underneath — a resize would re-fit and visibly move a zone
          // that is already framed.
          position: "relative"
        }}
      >

        {/* HEADER */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #333",
            display: "flex",
            gap: "14px",
            alignItems: "center",
            background: "#181818",
            flexWrap: "wrap"
          }}
        >

          {/* NAME */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: "220px",
              flex: 1
            }}
          >
            <label
              style={{
                fontSize: "12px",
                color: "#777",
                marginBottom: "4px"
              }}
            >
              Nom
            </label>

            <input
              value={editableGroup.name}
              onChange={(e) =>
                updateGroupField("name", e.target.value)
              }
              style={{
                padding: "10px",
                background: "#111",
                color: "#eee",
                border: "1px solid #333",
                borderRadius: "8px"
              }}
            />
          </div>

            {/* MEDIA */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: "260px",
              flex: 1
            }}
          >
            <label
              style={{
                fontSize: "12px",
                color: "#777",
                marginBottom: "4px"
              }}
            >
              Media
            </label>

            {editableGroup.map ? (
              <div style={{
                padding: "10px",
                background: "#111",
                color: "#8fd9ad",
                border: "1px solid #333",
                borderRadius: "8px",
                fontSize: "13px"
              }}>
                SVG canonique · format v2
              </div>
            ) : (
              <MapMediaInput
                value={editableGroup.media}
                onChange={(url) => updateGroupField("media", url)}
                style={{
                  padding: "10px",
                  background: "#111",
                  color: "#eee",
                  border: "1px solid #333",
                  borderRadius: "8px"
                }}
              />
            )}
            </div>

            {/* TAGS */}
            <div
              style={{
                borderLeft: "1px solid #303030",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                paddingLeft: "14px",
                minWidth: "180px",
                flex: "1 1 220px"
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  color: "#777",
                  marginBottom: "4px"
                }}
              >
                Tags
              </label>

              {(editableGroup.tags || []).length > 0 && (
                <div
                  style={{
                    marginBottom: "6px",
                    minWidth: 0,
                    position: "relative"
                  }}
                >
                  <div
                    className="map-editor-chip-strip"
                    onWheel={handleHorizontalChipWheel}
                    style={{
                      display: "flex",
                      flexWrap: "nowrap",
                      gap: "5px",
                      minWidth: 0,
                      overflowX: "auto",
                      overflowY: "hidden",
                      paddingRight: "24px",
                      scrollbarWidth: "none"
                    }}
                  >
                    {(editableGroup.tags || []).map((tag) => (
                      <span
                        key={tag}
                        data-chip-wheel-target
                        style={{
                          alignItems: "center",
                          background: "#242424",
                          borderRadius: "999px",
                          color: "#b8b8b8",
                          display: "inline-flex",
                          flex: "0 0 auto",
                          fontSize: "11px",
                          gap: "6px",
                          lineHeight: 1,
                          maxWidth: "110px",
                          padding: "5px 7px"
                        }}
                      >
                        <span
                          title={tag}
                          style={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          #{tag}
                        </span>
                        <button
                          type="button"
                          aria-label={`Retirer le tag ${tag}`}
                          onClick={() => removeGroupTag(tag)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#888",
                            cursor: "pointer",
                            flexShrink: 0,
                            lineHeight: 1,
                            padding: 0
                          }}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <div
                    aria-hidden="true"
                    style={{
                      background: "linear-gradient(90deg, rgba(24, 24, 24, 0), #181818 82%)",
                      bottom: 0,
                      pointerEvents: "none",
                      position: "absolute",
                      right: 0,
                      top: 0,
                      width: "28px"
                    }}
                  />
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gap: "6px",
                  gridTemplateColumns: "minmax(0, 1fr) 32px"
                }}
              >
                <AutocompleteInput
                  value={groupTagInput}
                  onChange={(event) => setGroupTagInput(event.target.value)}
                  onSuggestionSelect={addGroupTag}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addGroupTag();
                    }
                  }}
                  placeholder="Tag"
                  suggestions={availableTags.filter(tag =>
                    !(editableGroup.tags || []).includes(tag)
                  )}
                  style={{
                    padding: "8px 9px",
                    background: "#111",
                    color: "#eee",
                    border: "1px solid #333",
                    borderRadius: "8px",
                    fontSize: "13px"
                  }}
                />
                <button
                  type="button"
                  onClick={() => addGroupTag()}
                  title="Ajouter le tag"
                  style={{
                    background: "#242424",
                    border: "1px solid #333",
                    borderRadius: "8px",
                    color: "#ddd",
                    cursor: "pointer",
                    fontSize: "18px",
                    lineHeight: 1,
                    padding: 0
                  }}
                >
                  +
                </button>
              </div>
            </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              alignSelf: "end",
              flexShrink: 0
            }}
          >
            {!editableGroup.map && (
              <button
                type="button"
                disabled={upgradeBusy}
                onClick={analyzeLegacyUpgrade}
                style={{
                  background: "#173826",
                  border: "1px solid #2b7650",
                  borderRadius: "8px",
                  color: "#b8f7d2",
                  cursor: upgradeBusy ? "wait" : "pointer",
                  padding: "9px 11px"
                }}
              >
                Mettre à niveau
              </button>
            )}
            {/* INFOS */}
            <div
              title={`${namedZoneCount} named zones out of ${totalCodeCount} unique SVG zones`}
              style={{
                width: "54px",
                height: "54px",
                borderRadius: "50%",
                background: `conic-gradient(#21eb75 ${assignmentDegrees}deg, #303030 0deg)`,
                display: "grid",
                placeItems: "center",
                boxShadow: "0 0 0 1px #333, 0 8px 24px rgba(0, 0, 0, 0.28)"
              }}
            >
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "50%",
                  background: "#181818",
                  color: "#eee",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums"
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700
                  }}
                >
                  {namedZoneCount}
                </span>
                <span
                  style={{
                    color: "#888",
                    fontSize: "10px",
                    marginTop: "3px"
                  }}
                >
                  / {totalCodeCount}
                </span>
              </div>
            </div>

            {headerAction}
          </div>

        </div>

        {upgradeDraft && (
          <div style={{
            background: "#171d19",
            borderBottom: "1px solid #31543e",
            display: "grid",
            gap: "12px",
            gridTemplateColumns: "180px 1fr auto",
            padding: "12px 18px"
          }}>
            <img
              src={apiUrl(upgradeDraft.preview_url)}
              alt="Aperçu de la mise à niveau"
              style={{
                background: "#111",
                height: "100px",
                objectFit: "contain",
                width: "180px"
              }}
            />
            <div style={{ color: "#ccc", fontSize: "12px" }}>
              <div style={{ color: "#b8f7d2", fontWeight: 700 }}>
                {upgradeDraft.summary.zone_count} zones détectées
              </div>
              <div>
                La mise à niveau conserve les réponses, identifiants et progrès,
                puis crée une ligne vide pour chaque nouvelle zone.
              </div>
              {upgradeDraft.diagnostics.map((item, index) => (
                <div key={`${item.code}-${index}`} style={{
                  color: item.severity === "error" ? "#fca5a5" : "#fbbf24"
                }}>
                  {item.code}
                </div>
              ))}
              {upgradeError && <div style={{ color: "#fca5a5" }}>{upgradeError}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {!upgradeDraft.can_commit && upgradeDraft.diagnostics.some(
                item => item.requires_acknowledgement
              ) && (
                <button type="button" onClick={acknowledgeUpgradeWarnings}>
                  Accepter les avertissements
                </button>
              )}
              <button
                type="button"
                disabled={!upgradeDraft.can_commit || upgradeBusy}
                onClick={applyLegacyUpgrade}
              >
                Confirmer
              </button>
              <button type="button" onClick={closeLegacyUpgrade}>
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* MAP */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: "10px"
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "#111",
              borderRadius: "10px",
              overflow: "hidden"
            }}
          >
            <SvgMap
              svgPath={resolveMediaUrl(editableGroup.media)}
              mapManifest={editableGroup.map}
              found={foundCodes}
              unsaved={dirtyZoneCodes}
              selected={getZoneCode(editingZone)}
              focusCode={mapFocusCode}
              zoneLabels={zoneLabels}
              onSelect={handleSelect}
              onCodesLoaded={handleCodesLoaded}
            />
          </div>
        </div>

        {/* The editor's normal footprint, held open in flow. The map box is sized
            against this and therefore never changes, while the editor itself is
            out of flow and simply grows up over the map when it needs more room. */}
        <div aria-hidden="true" style={{ flexShrink: 0, height: `${zoneEditorReservedHeight}px` }} />

        {/* EDITOR — overlays the map instead of shrinking it. */}
        <div
          className="app-scrollbar"
          style={{
            background: "#181818",
            borderTop: "1px solid #333",
            bottom: 0,
            // border-box so the reserved height below is the rendered height, not
            // the content height (padding would otherwise push it over the map).
            boxSizing: "border-box",
            boxShadow: "0 -12px 24px rgba(0, 0, 0, 0.45)",
            left: 0,
            maxHeight: "70%",
            minHeight: `${zoneEditorReservedHeight}px`,
            overflowY: "auto",
            padding: "15px",
            position: "absolute",
            right: 0,
            zIndex: 3
          }}
        >
          {editingZone ? (
            <>
              <div
                style={{
                  marginBottom: "8px",
                  color: "#888"
                }}
              >
                Zone : {editingZone.data?.code}
              </div>

              <input
                autoFocus
                ref={labelInputRef}
                value={editingZone.answer || ""}
                onChange={(e) =>
                  updateZoneAnswer(e.target.value)
                }
                onKeyDown={handleZoneAnswerKeyDown}
                placeholder="Nom"
                style={{
                  width: "100%",
                  marginBottom: "12px",
                  padding: "10px",
                  background: "#111",
                  color: "#eee",
                  border: "1px solid #333",
                  borderRadius: "8px",
                  boxSizing: "border-box"
                }}
              />

              {/* ALIASES */}
              <div
                style={{
                  marginBottom: "10px",
                  minWidth: 0,
                  position: "relative"
                }}
              >
                <div
                  className="map-editor-chip-strip"
                  onWheel={handleHorizontalChipWheel}
                  style={{
                    display: "flex",
                    flexWrap: "nowrap",
                    gap: "6px",
                    minHeight: "27px",
                    minWidth: 0,
                    overflowX: "auto",
                    overflowY: "hidden",
                    paddingRight: "24px",
                    scrollbarWidth: "none"
                  }}
                >
                  {(editingZone.data?.aliases || []).map((alias, index) => (
                    <div
                      key={index}
                      data-chip-wheel-target
                      style={{
                        alignItems: "center",
                        background: "#333",
                        borderRadius: "6px",
                        display: "inline-flex",
                        flex: "0 0 auto",
                        gap: "6px",
                        maxWidth: "150px",
                        padding: "5px 8px"
                      }}
                    >
                      <span
                        title={alias}
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {alias}
                      </span>

                      <button
                        type="button"
                        aria-label={`Retirer l'alias ${alias}`}
                        onClick={() => removeAlias(index)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#999",
                          cursor: "pointer",
                          flexShrink: 0,
                          lineHeight: 1,
                          padding: 0
                        }}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
                {(editingZone.data?.aliases || []).length > 0 && (
                  <div
                    aria-hidden="true"
                    style={{
                      background: "linear-gradient(90deg, rgba(24, 24, 24, 0), #181818 82%)",
                      bottom: 0,
                      pointerEvents: "none",
                      position: "absolute",
                      right: 0,
                      top: 0,
                      width: "28px"
                    }}
                  />
                )}
              </div>

              <input
                ref={aliasInputRef}
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={handleAliasKeyDown}
                onBlur={addAlias}
                placeholder="Alias"
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "#111",
                  color: "#eee",
                  border: "1px solid #333",
                  borderRadius: "8px",
                  boxSizing: "border-box"
                }}
              />
            </>
          ) : (
            <div style={{ color: "#666" }}>
              Sélectionner une zone
            </div>
          )}
          <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
            <button
              type="button"
              disabled={!hasPendingMapChanges}
              onClick={cancelMapEdits}
              title={hasPendingMapChanges ? undefined : "Aucune modification à annuler"}
              style={{
                ...(hasPendingMapChanges
                  ? cancelButtonStyle
                  : disabledCancelButtonStyle),
                flex: 1,
                padding: "12px",
                borderRadius: "8px"
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={!hasPendingMapChanges}
              onClick={saveMapEdits}
              title={hasPendingMapChanges ? "Sauvegarder" : "Aucune modification à enregistrer"}
              style={{
                ...(hasPendingMapChanges
                  ? pendingSaveButtonStyle
                  : disabledSaveButtonStyle),
                flex: 1,
                padding: "12px",
                borderRadius: "8px"
              }}
            >
              {hasPendingMapChanges && (
                <span aria-hidden="true" style={pendingSaveDotStyle} />
              )}
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
