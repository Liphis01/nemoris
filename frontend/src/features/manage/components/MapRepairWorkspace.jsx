import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../../../api/config";
import {
  applyMapImportRepairAction,
  cancelMapImport,
  commitMapImport,
  getMapImport,
  getMapImportRepair,
  patchMapImport,
  startMapImportRepair
} from "../../../api/maps";
import SvgMap from "../../map/components/SvgMap";
import SvgRepairCanvas from "./SvgRepairCanvas";


const diagnosticLabels = {
  "svg.expected_zone_count_mismatch": "Le nombre de zones ne correspond pas au total attendu.",
  "svg.labels_removed": "Les libellés texte visibles ont été retirés.",
  "svg.repair_no_zones": "Aucune zone jouable ne reste dans ce brouillon.",
  "svg.repair_required_unresolved": "Des formes probablement importantes doivent encore être classées.",
  "svg.repair_optional_unresolved": "Des formes peu risquées resteront comme décoration non cliquable.",
  "svg.unsupported_elements_removed": "Des éléments SVG non pris en charge ont été retirés.",
  "svg.unsafe_css_removed": "Du CSS dangereux a été retiré."
};

const roleLabels = {
  zone: "Zone",
  unresolved: "À classer",
  decoration: "Décoration",
  label: "Libellé",
  excluded: "Exclue"
};

const filterOptions = [
  ["all", "Toutes"],
  ["required", "À résoudre"],
  ["optional", "Facultatives"],
  ["zone", "Zones"],
  ["multipart", "Multiparties"],
  ["decoration", "Décorations"],
  ["label", "Libellés"],
  ["excluded", "Exclues"]
];

const buttonBase = {
  background: "#242424",
  border: "1px solid #3a3a3a",
  borderRadius: "7px",
  color: "#eee",
  cursor: "pointer",
  fontSize: "12px",
  padding: "7px 9px"
};


function errorMessage(error) {
  return String(error?.message || error || "Une erreur est survenue.");
}


export default function MapRepairWorkspace({
  initialDraft,
  groupName,
  onExit,
  onImported
}) {
  const [draftReport, setDraftReport] = useState(initialDraft);
  const [repair, setRepair] = useState(null);
  const [selectedRefs, setSelectedRefs] = useState([]);
  const [hoveredRef, setHoveredRef] = useState(null);
  const [filter, setFilter] = useState("all");
  const [previewMode, setPreviewMode] = useState("inspection");
  const [targetZoneId, setTargetZoneId] = useState("");
  const [primaryZoneId, setPrimaryZoneId] = useState("");
  const [busy, setBusy] = useState(true);
  const [saveStatus, setSaveStatus] = useState("Chargement…");
  const [error, setError] = useState("");
  const repairRef = useRef(null);
  const mutationQueueRef = useRef(Promise.resolve());
  const pendingMutationsRef = useRef(0);

  useEffect(() => {
    repairRef.current = repair;
  }, [repair]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError("");
      try {
        const report = initialDraft?.interpretations
          ? initialDraft
          : await getMapImport(initialDraft.draft_id);
        if (cancelled) return;
        setDraftReport(report);
        let loaded;
        if (report.repair_available) {
          loaded = await getMapImportRepair(report.draft_id);
        } else {
          const interpretationId = (
            report.selected_interpretation_id
            || report.interpretations?.find(item => item.selectable)?.id
          );
          if (!interpretationId) {
            throw new Error("Aucune interprétation ne peut être corrigée.");
          }
          loaded = await startMapImportRepair(
            report.draft_id, interpretationId
          );
        }
        if (!cancelled) {
          setRepair(loaded);
          setSaveStatus("Enregistré");
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(errorMessage(requestError));
          setSaveStatus("Erreur");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [initialDraft]);

  const shapeByRef = useMemo(
    () => new Map((repair?.shapes || []).map(shape => [shape.ref, shape])),
    [repair]
  );
  const zoneById = useMemo(
    () => new Map((repair?.zones || []).map(zone => [zone.zone_id, zone])),
    [repair]
  );
  const zoneShapeCounts = useMemo(() => {
    const counts = new Map();
    (repair?.zones || []).forEach(zone => {
      counts.set(zone.zone_id, zone.shape_refs?.length || 0);
    });
    return counts;
  }, [repair]);
  const selectedShapes = selectedRefs
    .map(ref => shapeByRef.get(ref))
    .filter(Boolean);
  const hoveredShape = hoveredRef ? shapeByRef.get(hoveredRef) : null;
  const selectedZoneIds = [...new Set(
    selectedShapes.map(shape => shape.zone_id).filter(Boolean)
  )];
  const selectedSets = useMemo(() => {
    const ids = new Set(
      selectedRefs.flatMap(ref => shapeByRef.get(ref)?.selection_set_ids || [])
    );
    return (repair?.selection_sets || []).filter(item => ids.has(item.id));
  }, [repair, selectedRefs, shapeByRef]);

  useEffect(() => {
    if (!targetZoneId && repair?.zones?.[0]) {
      setTargetZoneId(repair.zones[0].zone_id);
    }
    if (
      targetZoneId
      && repair
      && !repair.zones.some(zone => zone.zone_id === targetZoneId)
    ) {
      setTargetZoneId(repair.zones[0]?.zone_id || "");
    }
  }, [repair, targetZoneId]);

  useEffect(() => {
    if (!selectedZoneIds.includes(primaryZoneId)) {
      setPrimaryZoneId(selectedZoneIds[0] || "");
    }
  }, [primaryZoneId, selectedZoneIds]);

  function runAction(action) {
    if (!repairRef.current) return Promise.resolve();
    pendingMutationsRef.current += 1;
    setBusy(true);
    setSaveStatus("Enregistrement…");
    setError("");

    const task = mutationQueueRef.current.then(async () => {
      const current = repairRef.current;
      if (!current) return;
      try {
        const next = await applyMapImportRepairAction(
          current.draft_id, current.revision, action
        );
        repairRef.current = next;
        setRepair(next);
        setSelectedRefs(previous => previous.filter(ref =>
          next.shapes.some(shape => shape.ref === ref)
        ));
      } catch (requestError) {
        setSaveStatus("Erreur");
        setError(errorMessage(requestError));
        try {
          const confirmed = await getMapImportRepair(current.draft_id);
          repairRef.current = confirmed;
          setRepair(confirmed);
        } catch {
          // Keep the last confirmed response when even conflict recovery fails.
        }
      }
    });
    mutationQueueRef.current = task.catch(() => {});
    return task.finally(() => {
      pendingMutationsRef.current -= 1;
      if (pendingMutationsRef.current === 0) {
        setBusy(false);
        setSaveStatus(current => current === "Erreur"
          ? current
          : "Enregistré");
      }
    });
  }

  useEffect(() => {
    function handleKeyDown(event) {
      const target = event.target;
      if (
        target?.matches?.("input, textarea, select, [contenteditable='true']")
        || !(event.ctrlKey || event.metaKey)
        || event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) runAction({ type: "redo" });
      else runAction({ type: "undo" });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  async function switchInterpretation(interpretationId) {
    if (!repair || busy || interpretationId === repair.active_interpretation_id) {
      return;
    }
    setBusy(true);
    setSaveStatus("Enregistrement…");
    setError("");
    try {
      const next = await startMapImportRepair(
        repair.draft_id, interpretationId
      );
      setRepair(next);
      setSelectedRefs([]);
      setSaveStatus("Enregistré");
    } catch (requestError) {
      setSaveStatus("Erreur");
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(code, checked) {
    if (!repair || busy) return;
    const acknowledgements = new Set(repair.acknowledgements || []);
    if (checked) acknowledgements.add(code);
    else acknowledgements.delete(code);
    setBusy(true);
    setSaveStatus("Enregistrement…");
    try {
      await patchMapImport(repair.draft_id, {
        acknowledgements: [...acknowledgements]
      });
      setRepair(await getMapImportRepair(repair.draft_id));
      setSaveStatus("Enregistré");
    } catch (requestError) {
      setError(errorMessage(requestError));
      setSaveStatus("Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!repair?.can_commit || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await commitMapImport(
        repair.draft_id, String(groupName || "").trim()
      );
      await onImported(result);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }

  async function abandon() {
    if (
      !repair
      || !window.confirm("Supprimer définitivement ce brouillon d’import ?")
    ) {
      return;
    }
    setBusy(true);
    try {
      await cancelMapImport(repair.draft_id);
      onExit();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }

  const filteredShapes = (repair?.shapes || []).filter(shape => {
    if (filter === "all") return true;
    if (filter === "required") return shape.risk === "required";
    if (filter === "optional") return shape.risk === "optional";
    if (filter === "multipart") {
      return shape.zone_id && (zoneShapeCounts.get(shape.zone_id) || 0) > 1;
    }
    return shape.role === filter;
  });
  const visibleShapeRows = filteredShapes.slice(0, 2000);
  const previewLabels = Object.fromEntries(
    (repair?.zones || []).map(zone => [
      zone.code,
      zone.proposed_answer || zone.code
    ])
  );

  if (!repair) {
    return (
      <div style={{
        alignItems: "center",
        background: "#121212",
        color: error ? "#fca5a5" : "#bbb",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%"
      }}>
        {error || "Préparation de l’éditeur assisté…"}
      </div>
    );
  }

  return (
    <div style={{
      background: "#121212",
      color: "#eee",
      display: "grid",
      gridTemplateColumns: "280px minmax(420px, 1fr) 330px",
      height: "100%",
      minHeight: 0,
      minWidth: 0,
      overflow: "hidden",
      width: "100%"
    }}>
      <aside
        className="app-scrollbar"
        style={{
          borderRight: "1px solid #2d2d2d",
          minHeight: 0,
          overflowY: "auto",
          padding: "16px"
        }}
      >
        <div style={{ color: "#fff", fontSize: "17px", fontWeight: 800 }}>
          Réparer la structure
        </div>
        <div style={{ color: "#777", fontSize: "11px", margin: "5px 0 16px" }}>
          {saveStatus} · révision {repair.revision}
        </div>

        {(draftReport?.interpretations || []).length > 1 && (
          <>
            <div style={{ color: "#aaa", fontSize: "11px", marginBottom: "6px" }}>
              Interprétation
            </div>
            <select
              disabled={busy}
              value={repair.active_interpretation_id}
              onChange={event => switchInterpretation(event.target.value)}
              style={{
                background: "#1b1b1b",
                border: "1px solid #3b3b3b",
                borderRadius: "7px",
                color: "#eee",
                marginBottom: "14px",
                padding: "8px",
                width: "100%"
              }}
            >
              {draftReport.interpretations
                .filter(item => item.selectable)
                .map(item => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.zone_count}
                  </option>
                ))}
            </select>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(
              "Réinitialiser toutes les corrections de cette interprétation ?"
            )) {
              runAction({ type: "reset_branch" });
              setSelectedRefs([]);
            }
          }}
          style={{
            ...buttonBase,
            background: "#321f1f",
            marginBottom: "14px",
            width: "100%"
          }}
        >
          Réinitialiser cette couche
        </button>

        <div style={{
          background: "#181818",
          border: "1px solid #303030",
          borderRadius: "9px",
          fontSize: "12px",
          lineHeight: 1.7,
          marginBottom: "14px",
          padding: "10px"
        }}>
          <div>{repair.summary.zone_count} zones</div>
          <div>{repair.summary.assigned_shape_count} formes attribuées</div>
          <div style={{
            color: repair.summary.required_unresolved_count
              ? "#fca5a5" : "#86efac"
          }}>
            {repair.summary.required_unresolved_count} à résoudre
          </div>
          <div style={{ color: "#fcd34d" }}>
            {repair.summary.optional_unresolved_count} facultatives
          </div>
          {repair.expected_zone_count && (
            <div>
              Attendu : {repair.expected_zone_count}
            </div>
          )}
        </div>

        <div style={{ color: "#aaa", fontSize: "11px", marginBottom: "6px" }}>
          Vérifications
        </div>
        {[
          [
            repair.summary.zone_count > 0,
            "Au moins une zone"
          ],
          [
            repair.summary.required_unresolved_count === 0,
            "Toutes les formes importantes sont classées"
          ],
          [
            !repair.expected_zone_count
              || repair.summary.zone_count === repair.expected_zone_count,
            "Nombre de zones conforme"
          ]
        ].map(([ready, label]) => (
          <div
            key={label}
            style={{
              color: ready ? "#86efac" : "#fca5a5",
              fontSize: "12px",
              marginBottom: "5px"
            }}
          >
            {ready ? "✓" : "○"} {label}
          </div>
        ))}

        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "5px",
          margin: "16px 0 10px"
        }}>
          {filterOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              style={{
                ...buttonBase,
                background: filter === value ? "#164e63" : "#222",
                padding: "5px 7px"
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ color: "#777", fontSize: "11px", marginBottom: "6px" }}>
          {filteredShapes.length} formes
          {filteredShapes.length > visibleShapeRows.length
            ? ` · ${visibleShapeRows.length} affichées`
            : ""}
        </div>
        {visibleShapeRows.map(shape => {
          const selected = selectedRefs.includes(shape.ref);
          const hovered = hoveredRef === shape.ref;
          const zone = shape.zone_id ? zoneById.get(shape.zone_id) : null;
          return (
            <button
              key={shape.ref}
              type="button"
              onMouseEnter={() => setHoveredRef(shape.ref)}
              onMouseLeave={() => setHoveredRef(null)}
              onClick={event => {
                if (event.shiftKey) {
                  const next = new Set(selectedRefs);
                  if (next.has(shape.ref)) next.delete(shape.ref);
                  else next.add(shape.ref);
                  setSelectedRefs([...next]);
                } else {
                  setSelectedRefs([shape.ref]);
                }
              }}
              style={{
                background: selected
                  ? "#123744" : hovered ? "#202d31" : "#191919",
                border: `1px solid ${
                  selected || hovered ? "#22d3ee" : "#2d2d2d"
                }`,
                borderRadius: "6px",
                color: "#ddd",
                cursor: "pointer",
                display: "block",
                fontSize: "11px",
                marginBottom: "4px",
                padding: "7px",
                textAlign: "left",
                width: "100%"
              }}
            >
              <div>{shape.ref} · {zone?.code || roleLabels[shape.role]}</div>
              {shape.risk && (
                <div style={{
                  color: shape.risk === "required" ? "#fca5a5" : "#fcd34d",
                  marginTop: "2px"
                }}>
                  {shape.risk === "required" ? "à résoudre" : "faible risque"}
                </div>
              )}
            </button>
          );
        })}
      </aside>

      <main style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden"
      }}>
        <div style={{
          alignItems: "center",
          borderBottom: "1px solid #2d2d2d",
          display: "flex",
          gap: "8px",
          minHeight: "48px",
          padding: "0 12px"
        }}>
          {[
            ["inspection", "Toutes les formes"],
            ["result", "Résultat jouable"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreviewMode(value)}
              style={{
                ...buttonBase,
                background: previewMode === value ? "#164e63" : "#222"
              }}
            >
              {label}
            </button>
          ))}
          <span style={{ color: "#777", fontSize: "11px", marginLeft: "auto" }}>
            {selectedRefs.length} sélectionnée(s)
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {previewMode === "inspection" ? (
            <SvgRepairCanvas
              svgPath={apiUrl(
                `${repair.inspection_url}?revision=${repair.revision}`
              )}
              shapes={repair.shapes}
              selectedRefs={selectedRefs}
              hoveredRef={hoveredRef}
              onSelectionChange={setSelectedRefs}
              onHover={setHoveredRef}
            />
          ) : repair.preview_manifest ? (
            <SvgMap
              key={repair.revision}
              svgPath={apiUrl(
                `${repair.preview_url}?revision=${repair.revision}`
              )}
              mapManifest={repair.preview_manifest}
              found={[]}
              selected={null}
              clickableCodes={repair.zones.map(zone => zone.code)}
              zoneLabels={previewLabels}
              onSelect={() => {}}
            />
          ) : (
            <div style={{
              alignItems: "center",
              color: "#888",
              display: "flex",
              height: "100%",
              justifyContent: "center"
            }}>
              Aucune zone jouable à prévisualiser.
            </div>
          )}
        </div>
      </main>

      <aside
        className="app-scrollbar"
        style={{
          borderLeft: "1px solid #2d2d2d",
          minHeight: 0,
          overflowY: "auto",
          padding: "16px"
        }}
      >
        <div style={{ fontSize: "14px", fontWeight: 800, marginBottom: "10px" }}>
          Sélection
        </div>
        {selectedRefs.length === 0 ? (
          <>
            <div style={{ color: "#777", fontSize: "12px", lineHeight: 1.5 }}>
              Cliquez sur une forme, utilisez Maj pour en sélectionner plusieurs,
              ou tracez un rectangle sur la carte.
            </div>
            {hoveredShape && (
              <div style={{
                borderTop: "1px solid #303030",
                color: "#999",
                fontSize: "11px",
                lineHeight: 1.6,
                marginTop: "12px",
                paddingTop: "10px"
              }}>
                <div style={{ color: "#ddd", fontWeight: 700 }}>
                  {hoveredShape.ref} · {roleLabels[hoveredShape.role]}
                </div>
                {hoveredShape.evidence?.map((item, index) => (
                  <div key={`${item.kind}-${item.value}-${index}`}>
                    {item.kind} · {item.value}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "10px" }}>
              {selectedRefs.length} forme(s) · {selectedZoneIds.length} zone(s)
            </div>

            {selectedSets.slice(0, 8).map(selectionSet => (
              <button
                key={selectionSet.id}
                type="button"
                onClick={() => setSelectedRefs(selectionSet.shape_refs)}
                style={{
                  ...buttonBase,
                  display: "block",
                  marginBottom: "5px",
                  textAlign: "left",
                  width: "100%"
                }}
              >
                {selectionSet.label} · {selectionSet.shape_refs.length}
              </button>
            ))}

            <div style={{
              display: "grid",
              gap: "6px",
              gridTemplateColumns: "1fr 1fr",
              margin: "14px 0"
            }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction({
                  type: "create_zone", shape_refs: selectedRefs
                })}
                style={buttonBase}
              >
                Nouvelle zone
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction({
                  type: "set_role",
                  shape_refs: selectedRefs,
                  role: "unresolved"
                })}
                style={buttonBase}
              >
                Désattribuer
              </button>
              {[
                ["decoration", "Décoration"],
                ["label", "Libellé"],
                ["excluded", "Exclure"]
              ].map(([role, label]) => (
                <button
                  key={role}
                  type="button"
                  disabled={busy}
                  onClick={() => runAction({
                    type: "set_role",
                    shape_refs: selectedRefs,
                    role
                  })}
                  style={buttonBase}
                >
                  {label}
                </button>
              ))}
            </div>

            <label style={{ color: "#999", fontSize: "11px" }}>
              Ajouter à une zone
            </label>
            <div style={{ display: "flex", gap: "6px", margin: "6px 0 14px" }}>
              <select
                value={targetZoneId}
                onChange={event => setTargetZoneId(event.target.value)}
                style={{
                  background: "#1b1b1b",
                  border: "1px solid #3b3b3b",
                  borderRadius: "6px",
                  color: "#eee",
                  minWidth: 0,
                  padding: "7px",
                  width: "100%"
                }}
              >
                {repair.zones.map(zone => (
                  <option key={zone.zone_id} value={zone.zone_id}>
                    {zone.proposed_answer || zone.code}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !targetZoneId}
                onClick={() => runAction({
                  type: "assign_to_zone",
                  shape_refs: selectedRefs,
                  zone_id: targetZoneId
                })}
                style={buttonBase}
              >
                Ajouter
              </button>
            </div>

            {selectedZoneIds.length >= 2 && (
              <div style={{
                borderTop: "1px solid #303030",
                marginTop: "12px",
                paddingTop: "12px"
              }}>
                <label style={{ color: "#999", fontSize: "11px" }}>
                  Code principal après fusion
                </label>
                <select
                  value={primaryZoneId}
                  onChange={event => setPrimaryZoneId(event.target.value)}
                  style={{
                    background: "#1b1b1b",
                    border: "1px solid #3b3b3b",
                    borderRadius: "6px",
                    color: "#eee",
                    margin: "6px 0",
                    padding: "7px",
                    width: "100%"
                  }}
                >
                  {selectedZoneIds.map(zoneId => (
                    <option key={zoneId} value={zoneId}>
                      {zoneById.get(zoneId)?.code || zoneId}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !primaryZoneId}
                  onClick={() => runAction({
                    type: "merge_zones",
                    zone_ids: selectedZoneIds,
                    primary_zone_id: primaryZoneId
                  })}
                  style={{ ...buttonBase, width: "100%" }}
                >
                  Fusionner les zones
                </button>
              </div>
            )}

            {selectedZoneIds.length === 1
              && (zoneShapeCounts.get(selectedZoneIds[0]) || 0) > 1 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction({
                    type: "explode_zone",
                    zone_id: selectedZoneIds[0]
                  })}
                  style={{
                    ...buttonBase,
                    marginTop: "8px",
                    width: "100%"
                  }}
                >
                  Séparer chaque forme
                </button>
              )}

            {selectedShapes[0]?.evidence?.length > 0 && (
              <div style={{
                borderTop: "1px solid #303030",
                color: "#777",
                fontSize: "11px",
                lineHeight: 1.6,
                marginTop: "14px",
                paddingTop: "12px"
              }}>
                {selectedShapes[0].evidence.map((item, index) => (
                  <div key={`${item.kind}-${item.value}-${index}`}>
                    {item.kind} · {item.value}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{
          borderTop: "1px solid #303030",
          marginTop: "18px",
          paddingTop: "14px"
        }}>
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <button
              type="button"
              disabled={busy || !repair.can_undo}
              onClick={() => runAction({ type: "undo" })}
              style={{
                ...buttonBase,
                opacity: repair.can_undo ? 1 : 0.45,
                width: "50%"
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={busy || !repair.can_redo}
              onClick={() => runAction({ type: "redo" })}
              style={{
                ...buttonBase,
                opacity: repair.can_redo ? 1 : 0.45,
                width: "50%"
              }}
            >
              Rétablir
            </button>
          </div>

          {repair.diagnostics.map((diagnostic, index) => (
            <label
              key={`${diagnostic.code}-${index}`}
              style={{
                background: diagnostic.severity === "error"
                  ? "#351919" : "#2b2817",
                borderRadius: "6px",
                display: "block",
                fontSize: "11px",
                marginBottom: "6px",
                padding: "8px"
              }}
            >
              {diagnostic.requires_acknowledgement && (
                <input
                  type="checkbox"
                  checked={(repair.acknowledgements || []).includes(
                    diagnostic.code
                  )}
                  onChange={event => acknowledge(
                    diagnostic.code, event.target.checked
                  )}
                  style={{ marginRight: "6px" }}
                />
              )}
              {diagnosticLabels[diagnostic.code] || diagnostic.code}
            </label>
          ))}

          {error && (
            <div style={{ color: "#fca5a5", fontSize: "12px", margin: "8px 0" }}>
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={busy || !repair.can_commit}
            onClick={commit}
            style={{
              ...buttonBase,
              background: repair.can_commit ? "#166534" : "#243127",
              fontWeight: 800,
              opacity: repair.can_commit ? 1 : 0.55,
              width: "100%"
            }}
          >
            Importer {repair.summary.zone_count} zones
          </button>
          <button
            type="button"
            onClick={onExit}
            style={{ ...buttonBase, marginTop: "7px", width: "100%" }}
          >
            Quitter et reprendre plus tard
          </button>
          <button
            type="button"
            onClick={abandon}
            style={{
              ...buttonBase,
              background: "#4b1d1d",
              marginTop: "7px",
              width: "100%"
            }}
          >
            Abandonner le brouillon
          </button>
        </div>
      </aside>
    </div>
  );
}
