import { useEffect, useState } from "react";
import { apiUrl } from "../../../api/config";
import {
  cancelMapImport,
  commitMapImport,
  createMapImportFromFile,
  createMapImportFromUrl,
  getMapImport,
  listMapImports,
  patchMapImport
} from "../../../api/maps";
import { questionTypeChipStyles } from "../../../shared/questionTypes";
import SvgMap from "../../map/components/SvgMap";
import {
  buttonStyle,
  inputStyle,
  labelStyle,
  panelStyle
} from "./QuestionEditorStyles";

const stackedLabelStyle = {
  ...labelStyle,
  display: "block",
  marginBottom: "8px"
};

const stackedInputStyle = {
  ...inputStyle,
  marginBottom: "16px"
};

const diagnosticLabels = {
  "svg.labels_removed": "Les libellés texte visibles ont été retirés.",
  "svg.expected_zone_count_mismatch": "Le nombre de zones ne correspond pas au total attendu.",
  "svg.no_usable_data_code": "Aucune zone data-code exploitable n’a été trouvée.",
  "svg.embedded_raster_requires_manual": "Cette carte contient une image raster et nécessitera l’éditeur manuel.",
  "svg.unsupported_elements_removed": "Des éléments SVG non pris en charge ont été retirés.",
  "svg.unsafe_css_removed": "Du CSS dangereux a été retiré.",
  "svg.multiple_interpretations": "Plusieurs couches géographiques plausibles ont été détectées.",
  "svg.duplicate_source_ids": "Des identifiants SVG dupliqués ont été ignorés.",
  "svg.generated_ids_ignored": "Les identifiants techniques générés par l’éditeur ont été ignorés.",
  "svg.ontology_mismatch": "La structure ne correspond pas à l’ontologie choisie.",
  "svg.semantic_label_layer_removed": "Une couche identifiée comme libellés a été retirée.",
  "svg.probable_path_labels": "Des libellés probablement convertis en tracés doivent être classés dans l’éditeur assisté.",
  "svg.incomplete_semantic_layer": "Les identifiants trouvés ne couvrent qu’une partie d’une couche visuellement cohérente."
};

const ontologyOptions = [
  ["auto", "Détection automatique"],
  ["generic", "Structure SVG générique"],
  ["iso3166-alpha2", "Pays et territoires (ISO alpha-2)"],
  ["country-capitals", "Capitales de pays"],
  ["us-states-50", "50 États des États-Unis"],
  ["us-states-dc-51", "États-Unis avec Washington D.C."],
  ["fr-departments-101", "101 départements français"]
];

const routeLabels = {
  automatic: "Import automatique",
  assisted: "Choix assisté",
  manual: "Éditeur manuel requis"
};

function draftAge(updatedAt) {
  const timestamp = Date.parse(updatedAt || "");
  if (!Number.isFinite(timestamp)) return "date inconnue";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `il y a ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

export default function CreateMapGroupEditor({
  groupDraft,
  onCancel,
  onImported,
  onOpenRepair,
  setGroupDraft
}) {
  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [expectedCount, setExpectedCount] = useState("");
  const [ontology, setOntology] = useState("auto");
  const [draft, setDraft] = useState(null);
  const [selectedCode, setSelectedCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resumableDrafts, setResumableDrafts] = useState([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const typeStyle = questionTypeChipStyles.map;

  async function refreshResumableDrafts() {
    setDraftsLoading(true);
    try {
      const response = await listMapImports();
      setResumableDrafts(response?.drafts || []);
    } catch {
      // Import remains usable even if the local-draft inventory is unavailable.
    } finally {
      setDraftsLoading(false);
    }
  }

  useEffect(() => {
    refreshResumableDrafts();
  }, []);

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      const options = {
        expectedZoneCount: expectedCount ? Number(expectedCount) : null,
        name: groupDraft.name,
        ontology
      };
      const result = file
        ? await createMapImportFromFile(file, options)
        : await createMapImportFromUrl(sourceUrl.trim(), options);
      setDraft(result);
      setSelectedCode(result.zones?.[0]?.code || "");
      await refreshResumableDrafts();
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setBusy(false);
    }
  }

  async function selectInterpretation(interpretationId) {
    setBusy(true);
    setError("");
    try {
      const result = await patchMapImport(draft.draft_id, {
        selected_interpretation_id: interpretationId
      });
      setDraft(result);
      setSelectedCode(result.zones?.[0]?.code || "");
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(code, checked) {
    const current = new Set(draft.acknowledgements || []);
    if (checked) current.add(code);
    else current.delete(code);
    setBusy(true);
    setError("");
    try {
      setDraft(await patchMapImport(draft.draft_id, {
        acknowledgements: [...current]
      }));
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError("");
    try {
      const result = await commitMapImport(draft.draft_id, groupDraft.name.trim());
      await onImported(result);
    } catch (requestError) {
      setError(String(requestError.message || requestError));
      setBusy(false);
    }
  }

  async function cancel() {
    onCancel();
  }

  async function abandonDraft(draftId = draft?.draft_id) {
    if (
      !draftId
      || !window.confirm("Supprimer définitivement ce brouillon d’import ?")
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await cancelMapImport(draftId);
      if (draft?.draft_id === draftId) setDraft(null);
      await refreshResumableDrafts();
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setBusy(false);
    }
  }

  async function resumeDraft(item) {
    setBusy(true);
    setError("");
    try {
      const report = await getMapImport(item.draft_id);
      const resumedName = item.name || groupDraft.name;
      if (resumedName !== groupDraft.name) {
        setGroupDraft({ ...groupDraft, name: resumedName });
      }
      if (item.repair_available) {
        onOpenRepair?.(report, resumedName);
      } else {
        setDraft(report);
        setSelectedCode(report.zones?.[0]?.code || "");
      }
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setBusy(false);
    }
  }

  const hasSource = Boolean(file || sourceUrl.trim());
  const canAnalyze = Boolean(groupDraft.name.trim() && hasSource && !busy);
  const canCommit = Boolean(draft?.can_commit && groupDraft.name.trim() && !busy);
  const selectedZone = draft?.zones?.find(zone => zone.code === selectedCode);
  const previewLabels = Object.fromEntries(
    (draft?.zones || []).map(zone => [
      zone.code,
      zone.proposed_answer || zone.code
    ])
  );

  return (
    <div className="app-scrollbar" style={panelStyle}>
      <div style={{ marginBottom: "18px", color: "#888" }}>Nouvelle carte</div>
      <div style={{
        alignItems: "center",
        background: typeStyle.background,
        border: `1px solid ${typeStyle.color}`,
        borderRadius: "8px",
        color: typeStyle.color,
        display: "inline-flex",
        fontSize: "12px",
        fontWeight: 800,
        marginBottom: "18px",
        padding: "6px 10px",
        textTransform: "uppercase"
      }}>
        Import SVG sécurisé
      </div>

      {(draftsLoading || resumableDrafts.length > 0) && !draft && (
        <div style={{
          background: "#171717",
          border: "1px solid #303030",
          borderRadius: "9px",
          marginBottom: "16px",
          padding: "10px"
        }}>
          <div style={{ color: "#bbb", fontSize: "12px", marginBottom: "7px" }}>
            Brouillons locaux
          </div>
          {draftsLoading ? (
            <div style={{ color: "#777", fontSize: "11px" }}>Chargement…</div>
          ) : resumableDrafts.slice(0, 6).map(item => (
            <div
              key={item.draft_id}
              style={{
                alignItems: "center",
                borderTop: "1px solid #292929",
                display: "flex",
                gap: "7px",
                padding: "8px 0"
              }}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => resumeDraft(item)}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "#eee",
                  cursor: "pointer",
                  flex: 1,
                  minWidth: 0,
                  padding: 0,
                  textAlign: "left"
                }}
              >
                <div style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}>
                  {item.name || "Carte sans nom"}
                </div>
                <div style={{ color: "#777", fontSize: "10px", marginTop: "2px" }}>
                  {item.repair_summary?.zone_count
                    ?? item.summary?.zone_count
                    ?? 0} zones ·{" "}
                  {item.can_commit
                    ? "prêt"
                    : item.readiness_blockers?.length
                      ? `${item.readiness_blockers.length} blocage(s)`
                      : item.repair_available
                        ? "réparation commencée"
                        : "analysé"}{" "}
                  · {draftAge(item.updated_at)}
                </div>
              </button>
              <button
                type="button"
                aria-label={`Supprimer ${item.name || "le brouillon"}`}
                disabled={busy}
                onClick={() => abandonDraft(item.draft_id)}
                style={{
                  background: "#3b1c1c",
                  border: "1px solid #643232",
                  borderRadius: "5px",
                  color: "#fca5a5",
                  cursor: "pointer",
                  padding: "4px 7px"
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <label style={stackedLabelStyle}>Nom du groupe</label>
      <input
        style={stackedInputStyle}
        value={groupDraft.name}
        onChange={(event) => setGroupDraft({
          ...groupDraft, name: event.target.value
        })}
        placeholder="Ex : Départements français"
      />

      <label style={stackedLabelStyle}>Nombre de zones attendu (optionnel)</label>
      <input
        min="1"
        max="50000"
        type="number"
        style={stackedInputStyle}
        value={expectedCount}
        onChange={(event) => setExpectedCount(event.target.value)}
        placeholder="Ex : 101"
      />

      <label htmlFor="map-import-ontology" style={stackedLabelStyle}>
        Type de carte
      </label>
      <select
        id="map-import-ontology"
        style={stackedInputStyle}
        value={ontology}
        onChange={(event) => setOntology(event.target.value)}
      >
        {ontologyOptions.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <label htmlFor="map-import-file" style={stackedLabelStyle}>
        Fichier SVG
      </label>
      <input
        id="map-import-file"
        accept=".svg,image/svg+xml"
        type="file"
        style={stackedInputStyle}
        onChange={(event) => {
          setFile(event.target.files?.[0] || null);
          if (event.target.files?.[0]) setSourceUrl("");
        }}
      />

      <label style={stackedLabelStyle}>ou URL publique</label>
      <input
        style={stackedInputStyle}
        value={sourceUrl}
        onChange={(event) => {
          setSourceUrl(event.target.value);
          if (event.target.value) setFile(null);
        }}
        placeholder="https://…/carte.svg"
      />

      <button
        type="button"
        disabled={!canAnalyze}
        onClick={analyze}
        style={{
          ...buttonStyle,
          cursor: canAnalyze ? "pointer" : "not-allowed",
          opacity: canAnalyze ? 1 : 0.55,
          marginBottom: "16px"
        }}
      >
        {busy && !draft ? "Analyse…" : "Analyser la carte"}
      </button>

      {draft && (
        <>
          <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px",
            marginBottom: "10px"
          }}>
            <span style={{
              background: draft.route === "automatic"
                ? "#153d2a"
                : draft.route === "manual" ? "#451d1d" : "#453a16",
              borderRadius: "999px",
              color: draft.route === "automatic"
                ? "#86efac"
                : draft.route === "manual" ? "#fca5a5" : "#fde68a",
              fontSize: "11px",
              fontWeight: 800,
              padding: "5px 9px",
              textTransform: "uppercase"
            }}>
              {routeLabels[draft.route] || draft.route}
            </span>
            {draft.selected_interpretation_id && (
              <span style={{ color: "#888", fontSize: "12px" }}>
                Interprétation prête
              </span>
            )}
          </div>

          {draft.interpretations?.length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ color: "#bbb", fontSize: "12px", marginBottom: "7px" }}>
                Choisissez la couche à transformer en questions
              </div>
              {draft.interpretations.map(interpretation => {
                const checked = (
                  draft.selected_interpretation_id === interpretation.id
                );
                return (
                  <label
                    key={interpretation.id}
                    style={{
                      background: checked ? "#18382a" : "#191919",
                      border: `1px solid ${checked ? "#34d399" : "#343434"}`,
                      borderRadius: "8px",
                      cursor: busy ? "wait" : "pointer",
                      display: "block",
                      marginBottom: "7px",
                      padding: "10px"
                    }}
                  >
                    <input
                      type="radio"
                      name="map-interpretation"
                      checked={checked}
                      disabled={busy || !interpretation.selectable}
                      onChange={() => selectInterpretation(interpretation.id)}
                      style={{ marginRight: "8px" }}
                    />
                    <span style={{ color: "#eee", fontSize: "13px", fontWeight: 700 }}>
                      {interpretation.title}
                    </span>
                    <div style={{
                      color: "#999",
                      fontSize: "11px",
                      marginLeft: "24px",
                      marginTop: "4px"
                    }}>
                      {interpretation.zone_count} zones ·{" "}
                      {interpretation.verified_label_count} noms vérifiés ·{" "}
                      {interpretation.unassigned_shape_count} objets non attribués
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          <div style={{
            background: "#111",
            border: "1px solid #2d2d2d",
            borderRadius: "10px",
            height: "220px",
            marginBottom: "14px",
            overflow: "hidden",
            padding: "10px"
          }}>
            {draft.preview_manifest ? (
              <SvgMap
                svgPath={apiUrl(draft.preview_url)}
                mapManifest={draft.preview_manifest}
                found={[]}
                selected={selectedCode}
                clickableCodes={(draft.zones || []).map(zone => zone.code)}
                zoneLabels={previewLabels}
                onSelect={setSelectedCode}
              />
            ) : (
              <img
                src={apiUrl(draft.preview_url)}
                alt="Aperçu SVG canonique"
                style={{ height: "100%", objectFit: "contain", width: "100%" }}
              />
            )}
          </div>
          <div style={{ color: "#bbb", fontSize: "13px", marginBottom: "12px" }}>
            {draft.summary.zone_count} zones · {draft.summary.multipart_zone_count} multiparties ·{" "}
            {draft.summary.hit_shape_count} zones de clic · {draft.summary.removed_text_count} libellés retirés
          </div>
          {selectedZone && (
            <div style={{
              background: "#171717",
              border: "1px solid #303030",
              borderRadius: "8px",
              color: "#bbb",
              fontSize: "12px",
              marginBottom: "12px",
              padding: "10px"
            }}>
              <div style={{ color: "#eee", fontWeight: 800, marginBottom: "5px" }}>
                {selectedZone.proposed_answer || selectedZone.code}
                {selectedZone.proposal_verified && (
                  <span style={{ color: "#86efac", marginLeft: "7px" }}>
                    nom vérifié
                  </span>
                )}
              </div>
              <div>
                Code {selectedZone.code} ·{" "}
                {(selectedZone.shape_ids?.length || 0)
                  + (selectedZone.hit_shape_ids?.length || 0)} forme(s)
              </div>
              <div style={{ color: "#777", marginTop: "4px" }}>
                {(selectedZone.source_keys || []).join(" · ")}
              </div>
              {(selectedZone.evidence || []).map((evidence, index) => (
                <div
                  key={`${evidence.kind}-${evidence.value}-${index}`}
                  style={{ color: "#777", marginTop: "3px" }}
                >
                  {evidence.kind} · {evidence.value} · {evidence.strength}
                </div>
              ))}
            </div>
          )}
          {draft.diagnostics.map((diagnostic, index) => (
            <label
              key={`${diagnostic.code}-${index}`}
              style={{
                background: diagnostic.severity === "error" ? "#351919" : "#2b2817",
                borderRadius: "7px",
                color: "#ddd",
                display: "block",
                fontSize: "12px",
                marginBottom: "7px",
                padding: "9px"
              }}
            >
              {diagnostic.requires_acknowledgement && (
                <input
                  type="checkbox"
                  checked={(draft.acknowledgements || []).includes(diagnostic.code)}
                  onChange={(event) => acknowledge(
                    diagnostic.code, event.target.checked
                  )}
                  style={{ marginRight: "8px" }}
                />
              )}
              {diagnosticLabels[diagnostic.code] || diagnostic.code}
            </label>
          ))}
          {!draft.can_commit && draft.route !== "automatic" && (
            <div style={{ color: "#fbbf24", fontSize: "12px", margin: "10px 0" }}>
              {draft.route === "manual"
                ? "Cette carte nécessitera les outils de création manuelle de zones."
                : draft.selection_required
                  ? "Choisissez une interprétation ou ouvrez la correction de structure."
                  : "Cette interprétation contient encore un blocage indiqué ci-dessus."}
            </div>
          )}
          {draft.route !== "manual"
            && draft.interpretations?.some(item => item.selectable) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpenRepair?.(
                  draft, groupDraft.name.trim()
                )}
                style={{
                  ...buttonStyle,
                  background: "#155e75",
                  margin: "4px 0 8px",
                  width: "100%"
                }}
              >
                {draft.route === "automatic"
                  ? "Vérifier ou corriger la structure"
                  : "Corriger la structure"}
              </button>
            )}
        </>
      )}

      {error && <div style={{ color: "#fca5a5", margin: "10px 0" }}>{error}</div>}
      <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
        <button
          type="button"
          onClick={commit}
          disabled={!canCommit}
          style={{
            ...buttonStyle,
            cursor: canCommit ? "pointer" : "not-allowed",
            opacity: canCommit ? 1 : 0.55
          }}
        >
          Importer et ouvrir l’éditeur
        </button>
        <button
          type="button"
          onClick={cancel}
          style={{ ...buttonStyle, background: "#333" }}
        >
          Quitter
        </button>
        {draft?.draft_id && (
          <button
            type="button"
            onClick={() => abandonDraft()}
            style={{ ...buttonStyle, background: "#641c1c" }}
          >
            Abandonner
          </button>
        )}
      </div>
    </div>
  );
}
