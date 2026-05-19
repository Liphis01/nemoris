import { useEffect, useRef, useState } from "react";
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
  headerAction
}) {
  // MapEditor turns SVG zones into atomic map questions. The group is visual
  // context; each saved zone remains its own reviewable question.
  const [editingZone, setEditingZone] = useState(null);
  const [aliasInput, setAliasInput] = useState("");
  const labelInputRef = useRef(null);
  const aliasInputRef = useRef(null);
  const {
    clearDirty,
    dirtyZoneCodesRef,
    editableGroup,
    foundCodes,
    handleCodesLoaded,
    markDirty,
    savedQuestionCount,
    saveMapZones,
    setZones,
    svgCodes,
    updateGroupField,
    zones
  } = useMapZones(group);

  useEffect(() => {
    if (!selectedZone) return;
    // When opened from an existing map question, focus that zone and discard any
    // unsaved blank temporary row from a previous click.
    setZones(prev => prev.filter(zone => !isBlankTemporaryZone(zone)));
    setEditingZone(normalizeZone(selectedZone, group));
  }, [group, selectedZone, setZones]);

  const totalCodeCount = svgCodes.length;
  const assignmentRatio = totalCodeCount
    ? Math.min(savedQuestionCount / totalCodeCount, 1)
    : 0;
  const assignmentDegrees = Math.round(assignmentRatio * 360);

  function handleSelect(code) {
    // Clicking an SVG region either edits its saved question or creates a
    // temporary unsaved zone row for that data-code.
    let nextZones = zones;

    if (isBlankTemporaryZone(editingZone)) {
      nextZones = zones.filter(z => z.id !== editingZone.id);
      setZones(nextZones);
      clearDirty(getZoneCode(editingZone));
    }

    let zone = nextZones.find(z => getZoneCode(z) === code);

    if (!zone) {
      zone = {
        id: "tmp-" + code,
        type_q: "map",
        question: "",
        answer: "",
        tags: [],
        group_id: group.id,
        data: { code, aliases: [] }
      };
    }

    setEditingZone(zone);
  }

  function updateZoneAnswer(value) {
    // The first non-empty answer promotes a temporary zone into the local zone
    // list so it will be included in the next save.
    const nextEditing = { ...editingZone, answer: value };
    const code = getZoneCode(editingZone);

    setZones(prev => {
      if (isBlankTemporaryZone(nextEditing)) {
        clearDirty(code);
        return prev.filter(z => z.id !== editingZone.id);
      }

      const zoneExists = prev.some(z => getZoneCode(z) === code);

      if (!zoneExists) {
        markDirty(code);
        return [...prev, nextEditing];
      }

      markDirty(code);
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
    markDirty(code);

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

    setEditingZone(prev => ({
      ...prev,
      data: { ...prev.data, aliases: newAliases }
    }));

    setAliasInput("");

    if (focusAfter) {
      aliasInputRef.current?.focus();
    }
  }

  function removeAlias(index) {
    const currentAliases = editingZone.data?.aliases || [];
    const newAliases = currentAliases.filter((_, i) => i !== index);
    const code = getZoneCode(editingZone);
    markDirty(code);

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
    setEditingZone(prev => ({
      ...prev,
      data: { ...prev.data, aliases: newAliases }
    }));
  }

  function handleAliasKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addAlias(true);
    }
  }

  async function saveMapEdits() {
    // Remove the selected temporary zone when it still has no answer.
    const zonesToSave = editingZone && !editingZone.answer
      ? zones.filter((z) => z.id !== editingZone.id)
      : zones;
    const savedEditingCode = editingZone && editingZone.answer
      ? getZoneCode(editingZone)
      : null;
    const dirtyCodes = dirtyZoneCodesRef.current;
    // Save only dirty existing zones plus temporary zones that need real ids.
    const changedZones = zonesToSave.filter(z => {
      const code = getZoneCode(z);
      return dirtyCodes.has(code) || String(z.id || "").startsWith("tmp-");
    });

    if (editingZone && !editingZone.answer) {
      clearDirty(getZoneCode(editingZone));
      setZones(zonesToSave);
    }
    setEditingZone(null);

    let saved;

    try {
      saved = await saveMapZones({ zonesToSave, changedZones });
    } catch (error) {
      alert(error.message || "Impossible de sauvegarder la carte.");
      return;
    }

    const { delta, savedZones, saveResult } = saved;

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
  }

  useEffect(() => {
    if (editingZone) {
      if (document.activeElement === aliasInputRef.current) {
        return;
      }
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
              Nom du groupe
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

            <input
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
              selected={editingZone?.data?.code}
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
                placeholder="Ajouter un alias"
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
              Sauvegarder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
