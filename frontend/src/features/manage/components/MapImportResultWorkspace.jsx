import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../../../api/config";
import {
  cancelMapImport,
  commitMapImport,
  patchMapImport
} from "../../../api/maps";
import SvgMap from "../../map/components/SvgMap";
import {
  describeDiagnostic,
  describeImport,
  ontologyOptions,
  selectableInterpretations,
  simplifyInterpretationTitle
} from "../mapImportPresentation";

const railButtonStyle = {
  background: "#242424",
  border: "1px solid #3a3a3a",
  borderRadius: "8px",
  color: "#eee",
  cursor: "pointer",
  fontSize: "13px",
  padding: "10px 12px",
  width: "100%"
};

const linkButtonStyle = {
  background: "transparent",
  border: 0,
  color: "#9db8ff",
  cursor: "pointer",
  fontSize: "12px",
  padding: 0,
  textAlign: "left"
};

function errorMessage(error) {
  return String(error?.message || error || "Une erreur est survenue.");
}

export default function MapImportResultWorkspace({
  initialDraft,
  initialName,
  onExit,
  onImported,
  onOpenRepair
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [name, setName] = useState(initialName || "");
  const [selectedCode, setSelectedCode] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ontology, setOntology] = useState(initialDraft?.ontology || "auto");
  const [expectedCount, setExpectedCount] = useState(
    initialDraft?.expected_zone_count ? String(initialDraft.expected_zone_count) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // A patched draft (new layer, new ontology) brings a new zone set, so the
    // preview goes back to showing the whole map rather than a stale zone.
    setSelectedCode("");
  }, [draft]);

  const presentation = useMemo(() => describeImport(draft), [draft]);
  const layers = selectableInterpretations(draft);
  const previewLabels = useMemo(() => Object.fromEntries(
    (draft?.zones || []).map(zone => [zone.code, zone.proposed_answer || zone.code])
  ), [draft]);
  const clickableCodes = useMemo(
    () => (draft?.zones || []).map(zone => zone.code),
    [draft]
  );
  // The preview keeps a stable URL across interpretations, so the canonical
  // asset hash busts the fetch when the chosen layer changes.
  const previewSrc = draft?.preview_url
    ? apiUrl(`${draft.preview_url}?v=${draft.asset_sha256 || "0"}`)
    : "";
  const trimmedName = name.trim();
  const canCommit = Boolean(draft?.can_commit && trimmedName && !busy);

  async function patchDraft(payload) {
    setBusy(true);
    setError("");
    try {
      setDraft(await patchMapImport(draft.draft_id, payload));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!canCommit) return;
    setBusy(true);
    setError("");
    try {
      const result = await commitMapImport(draft.draft_id, trimmedName);
      await onImported(result);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }

  async function abandon() {
    if (!window.confirm("Supprimer définitivement ce brouillon d’import ?")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await cancelMapImport(draft.draft_id);
      onExit();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }

  function acknowledge(code, checked) {
    const current = new Set(draft.acknowledgements || []);
    if (checked) current.add(code);
    else current.delete(code);
    return patchDraft({ acknowledgements: [...current] });
  }

  function runPrimaryAction() {
    if (presentation.primaryAction === "commit") return commit();
    if (presentation.primaryAction === "repair") {
      return onOpenRepair(draft, trimmedName);
    }
    return onExit();
  }

  return (
    <div style={{
      background: "#121212",
      color: "#eee",
      display: "grid",
      gridTemplateColumns: "1fr 340px",
      gridTemplateRows: "auto 1fr",
      height: "100%",
      minHeight: 0,
      minWidth: 0,
      overflow: "hidden",
      width: "100%"
    }}>
      <header style={{
        alignItems: "center",
        borderBottom: "1px solid #262626",
        display: "flex",
        gap: "12px",
        gridColumn: "1 / -1",
        padding: "14px 18px"
      }}>
        <input
          value={name}
          aria-label="Nom de la carte"
          onChange={(event) => setName(event.target.value)}
          placeholder="Nom de la carte"
          style={{
            background: "#181818",
            border: "1px solid #2f2f2f",
            borderRadius: "9px",
            color: "#eee",
            flex: 1,
            fontSize: "17px",
            fontWeight: 700,
            minWidth: 0,
            outline: "none",
            padding: "10px 12px"
          }}
        />
        <button
          type="button"
          onClick={onExit}
          style={{ ...railButtonStyle, width: "auto" }}
        >
          Revenir à Manage
        </button>
      </header>

      <main style={{
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
        padding: "16px"
      }}>
        <div style={{
          background: "#0f0f0f",
          border: "1px solid #262626",
          borderRadius: "12px",
          boxSizing: "border-box",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          padding: "10px",
          width: "100%"
        }}>
          {draft?.preview_manifest ? (
            <SvgMap
              svgPath={previewSrc}
              mapManifest={draft.preview_manifest}
              found={[]}
              selected={selectedCode}
              clickableCodes={clickableCodes}
              zoneLabels={previewLabels}
              onSelect={setSelectedCode}
            />
          ) : (
            <img
              src={previewSrc}
              alt="Aperçu de la carte"
              style={{ height: "100%", objectFit: "contain", width: "100%" }}
            />
          )}
        </div>
      </main>

      <aside
        className="app-scrollbar"
        style={{
          borderLeft: "1px solid #262626",
          boxSizing: "border-box",
          minHeight: 0,
          overflowY: "auto",
          padding: "16px",
          textAlign: "left"
        }}
      >
        <div style={{
          color: "#eee",
          fontSize: "16px",
          fontWeight: 800,
          lineHeight: 1.35,
          marginBottom: presentation.detail ? "6px" : "14px"
        }}>
          {presentation.headline}
        </div>
        {presentation.detail && (
          <div style={{
            color: "#9a9a9a",
            fontSize: "13px",
            lineHeight: 1.5,
            marginBottom: "14px"
          }}>
            {presentation.detail}
          </div>
        )}
        {presentation.nameProgress && (
          <div style={{ color: "#8a8a8a", fontSize: "12px", marginBottom: "14px" }}>
            {presentation.nameProgress}
          </div>
        )}

        {presentation.state === "choice" && layers.map(layer => {
          const checked = draft.selected_interpretation_id === layer.id;
          return (
            <button
              key={layer.id}
              type="button"
              disabled={busy}
              onClick={() => patchDraft({ selected_interpretation_id: layer.id })}
              style={{
                background: checked ? "#18382a" : "#191919",
                border: `1px solid ${checked ? "#34d399" : "#343434"}`,
                borderRadius: "10px",
                color: "#eee",
                cursor: busy ? "wait" : "pointer",
                display: "block",
                marginBottom: "8px",
                padding: "12px",
                textAlign: "left",
                width: "100%"
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 700 }}>
                {simplifyInterpretationTitle(layer)}
              </div>
              <div style={{ color: "#9a9a9a", fontSize: "12px", marginTop: "3px" }}>
                {layer.zone_count} zones
              </div>
            </button>
          );
        })}

        {presentation.checklist.length > 0 && (
          <div style={{ marginBottom: "14px" }}>
            <div style={{ color: "#bbb", fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
              À vérifier
            </div>
            {presentation.checklist.map(item => (
              <div
                key={item.code}
                style={{
                  background: "#2b2817",
                  borderRadius: "7px",
                  color: "#ddd",
                  fontSize: "12px",
                  lineHeight: 1.45,
                  marginBottom: "6px",
                  padding: "9px"
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}

        {presentation.pendingAcknowledgements.map(code => (
          <label
            key={code}
            style={{
              alignItems: "flex-start",
              background: "#2b2817",
              borderRadius: "7px",
              color: "#ddd",
              cursor: "pointer",
              display: "flex",
              fontSize: "12px",
              gap: "8px",
              lineHeight: 1.45,
              marginBottom: "8px",
              padding: "9px"
            }}
          >
            <input
              type="checkbox"
              checked={false}
              disabled={busy}
              onChange={(event) => acknowledge(code, event.target.checked)}
            />
            <span>{describeDiagnostic(code)}</span>
          </label>
        ))}

        {error && (
          <div style={{ color: "#fca5a5", fontSize: "12px", margin: "8px 0" }}>
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={
            busy
            || (presentation.primaryAction === "commit" && !canCommit)
            || (presentation.primaryAction === "select")
          }
          onClick={runPrimaryAction}
          style={{
            ...railButtonStyle,
            background: presentation.primaryAction === "commit" && !canCommit
              ? "#243127"
              : "#166534",
            border: "1px solid #2f7a4d",
            fontSize: "14px",
            fontWeight: 800,
            marginTop: "6px",
            opacity: (
              busy
              || presentation.primaryAction === "select"
              || (presentation.primaryAction === "commit" && !canCommit)
            ) ? 0.55 : 1,
            padding: "13px 12px"
          }}
        >
          {presentation.primaryLabel}
        </button>

        {(presentation.state === "ready" || presentation.state === "choice")
          && layers.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenRepair(draft, trimmedName)}
            style={{ ...railButtonStyle, marginTop: "8px" }}
          >
            Corriger les zones
          </button>
        )}

        <div style={{ borderTop: "1px solid #262626", marginTop: "18px", paddingTop: "12px" }}>
          <button
            type="button"
            onClick={() => setDetailsOpen(open => !open)}
            style={linkButtonStyle}
          >
            Détails techniques
          </button>
          {detailsOpen && (
            <div style={{ marginTop: "10px" }}>
              <div style={{ color: "#8a8a8a", fontSize: "11px", lineHeight: 1.6, marginBottom: "10px" }}>
                {draft.summary.zone_count} zones ·{" "}
                {draft.summary.multipart_zone_count} multiparties ·{" "}
                {draft.summary.hit_shape_count} zones de clic ·{" "}
                {draft.summary.removed_text_count} libellés retirés
              </div>
              {(draft.diagnostics || []).map((diagnostic, index) => (
                <div
                  key={`${diagnostic.code}-${index}`}
                  style={{
                    background: diagnostic.severity === "error" ? "#351919" : "#1d1d1d",
                    borderRadius: "6px",
                    color: "#bbb",
                    fontSize: "11px",
                    marginBottom: "5px",
                    padding: "7px"
                  }}
                >
                  {diagnostic.code}
                </div>
              ))}

              <label
                htmlFor="map-result-ontology"
                style={{ color: "#bbb", display: "block", fontSize: "11px", margin: "10px 0 5px" }}
              >
                Type de carte
              </label>
              <select
                id="map-result-ontology"
                value={ontology}
                disabled={busy}
                onChange={(event) => {
                  setOntology(event.target.value);
                  patchDraft({ ontology: event.target.value });
                }}
                style={{
                  background: "#121212",
                  border: "1px solid #2a2a2a",
                  borderRadius: "7px",
                  color: "#eee",
                  fontSize: "12px",
                  padding: "7px",
                  width: "100%"
                }}
              >
                {ontologyOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>

              <label
                htmlFor="map-result-expected"
                style={{ color: "#bbb", display: "block", fontSize: "11px", margin: "10px 0 5px" }}
              >
                Nombre de zones attendu
              </label>
              <input
                id="map-result-expected"
                type="number"
                min="1"
                max="50000"
                value={expectedCount}
                disabled={busy}
                onChange={(event) => setExpectedCount(event.target.value)}
                onBlur={() => patchDraft({
                  expected_zone_count: expectedCount ? Number(expectedCount) : null
                })}
                placeholder="Automatique"
                style={{
                  background: "#121212",
                  border: "1px solid #2a2a2a",
                  borderRadius: "7px",
                  boxSizing: "border-box",
                  color: "#eee",
                  fontSize: "12px",
                  padding: "7px",
                  width: "100%"
                }}
              />

              <button
                type="button"
                disabled={busy}
                onClick={abandon}
                style={{
                  ...railButtonStyle,
                  background: "#4b1d1d",
                  border: "1px solid #7b2929",
                  fontSize: "12px",
                  marginTop: "12px"
                }}
              >
                Abandonner le brouillon
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
