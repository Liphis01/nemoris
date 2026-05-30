import { useEffect, useRef, useState } from "react";
import AutocompleteInput from "../../../shared/AutocompleteInput";
import MapFileInput from "./MapFileInput";
import SvgMap from "./SvgMap";
import {
  getZoneCode,
  isBlankTemporaryZone,
  normalizeZone,
  useMapZones
} from "../hooks/useMapZones";

export default function MapEditor({
  group,
  onClose,
  onSave,
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
  const labelInputRef = useRef(null);
  const aliasInputRef = useRef(null);
  const focusLabelAfterZoneChangeRef = useRef(false);
  const saveMapEditsRef = useRef(null);
  const {
    clearDirty,
    dirtyZoneCodes,
    dirtyZoneCodesRef,
    editableGroup,
    foundCodes,
    handleCodesLoaded,
    hasDirtyChanges,
    savedQuestionCount,
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
    setMapFocusCode(selectedCode);
  }, [group, selectedZone, setZones]);

  const totalCodeCount = svgCodes.length;
  const assignmentRatio = totalCodeCount
    ? Math.min(savedQuestionCount / totalCodeCount, 1)
    : 0;
  const assignmentDegrees = Math.round(assignmentRatio * 360);

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

  function handleGroupTagWheel(event) {
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
  }

  function handleSelect(code) {
    // Clicking an SVG region either edits its saved question or creates a
    // temporary unsaved zone row for that data-code.
    const nextZones = discardBlankEditingZone(zones);

    if (nextZones !== zones) {
      setZones(nextZones);
    }

    selectZoneCode(code, nextZones);
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
          minHeight: 0
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

            {/* TYPE */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "140px"
            }}
          >
            <label
              style={{
                fontSize: "12px",
                color: "#777",
                marginBottom: "4px"
              }}
            >
              Type
            </label>

            <select
              value={editableGroup.type_group}
              onChange={(e) =>
                updateGroupField("type_group", e.target.value)
              }
              style={{
                padding: "10px",
                background: "#111",
                color: "#eee",
                border: "1px solid #333",
                borderRadius: "8px"
              }}
            >
              <option value="map">map</option>
            </select>
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

            <MapFileInput
              value={editableGroup.media}
              onChange={(e) =>
                updateGroupField("media", e.target.value)
              }
              placeholder="world.svg"
              style={{
                padding: "10px",
                background: "#111",
                color: "#eee",
                border: "1px solid #333",
                borderRadius: "8px"
              }}
            />
            </div>

            {/* TAGS */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
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
                    className="map-editor-tag-strip"
                    onWheel={handleGroupTagWheel}
                    style={{
                      display: "flex",
                      flexWrap: "nowrap",
                      gap: "5px",
                      minWidth: 0,
                      overscrollBehavior: "contain",
                      overflowX: "auto",
                      overflowY: "hidden",
                      paddingRight: "24px",
                      scrollbarWidth: "none"
                    }}
                  >
                    {(editableGroup.tags || []).map((tag) => (
                      <span
                        key={tag}
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
            {/* INFOS */}
            <div
              title={`${savedQuestionCount} saved questions out of ${totalCodeCount} unique SVG codes`}
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
                  {savedQuestionCount}
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
              svgPath={`/maps/${editableGroup.media}`}
              found={foundCodes}
              unsaved={dirtyZoneCodes}
              selected={getZoneCode(editingZone)}
              focusCode={mapFocusCode}
              onSelect={handleSelect}
              onCodesLoaded={handleCodesLoaded}
            />
          </div>
        </div>

        {/* EDITOR */}
        <div
          style={{
            borderTop: "1px solid #333",
            padding: "15px",
            background: "#181818"
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

              {/* TAGS */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginBottom: "10px"
                }}
              >
                {(editingZone.data?.aliases || []).map((alias, index) => (
                  <div
                    key={index}
                    style={{
                      background: "#333",
                      padding: "5px 8px",
                      borderRadius: "6px",
                      display: "flex",
                      gap: "6px",
                      alignItems: "center"
                    }}
                  >
                    <span>{alias}</span>

                    <span
                      onClick={() => removeAlias(index)}
                      style={{
                        cursor: "pointer",
                        color: "#999"
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ))}
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
          <div style={{ marginTop: "15px" }}>
            <button
              onClick={saveMapEdits}
              title="Sauvegarder"
              style={{
                width: "100%",
                padding: "12px",
                background: "#3a7afe",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer"
              }}
            >
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
