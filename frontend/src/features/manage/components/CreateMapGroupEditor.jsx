import { useEffect, useRef, useState } from "react";
import {
  cancelMapImport,
  createMapImportFromFile,
  createMapImportFromUrl,
  getMapImport,
  listMapImports
} from "../../../api/maps";
import {
  draftAge,
  draftZoneCount,
  describeDraftListItem,
  inferMapName,
  ontologyOptions
} from "../mapImportPresentation";
import {
  buttonStyle,
  cancelButtonStyle,
  inputStyle,
  panelStyle
} from "./QuestionEditorStyles";

const sectionTitleStyle = {
  color: "#eee",
  fontSize: "18px",
  fontWeight: 800,
  marginBottom: "8px"
};

const explanationStyle = {
  color: "#9a9a9a",
  fontSize: "13px",
  lineHeight: 1.5,
  marginBottom: "20px"
};

const linkButtonStyle = {
  background: "transparent",
  border: 0,
  color: "#9db8ff",
  cursor: "pointer",
  fontSize: "13px",
  padding: 0,
  textAlign: "left"
};

export default function CreateMapGroupEditor({
  groupDraft,
  onCancel,
  onAnalyzed,
  onOpenRepair,
  setGroupDraft
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [urlOpen, setUrlOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [expectedCount, setExpectedCount] = useState("");
  const [ontology, setOntology] = useState("auto");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resumableDrafts, setResumableDrafts] = useState([]);
  const fileInputRef = useRef(null);

  async function refreshResumableDrafts() {
    try {
      const response = await listMapImports();
      setResumableDrafts(response?.drafts || []);
    } catch {
      // Import remains usable even if the local-draft inventory is unavailable.
    }
  }

  useEffect(() => {
    refreshResumableDrafts();
  }, []);

  function analysisOptions() {
    return {
      expectedZoneCount: expectedCount ? Number(expectedCount) : null,
      ontology
    };
  }

  // Choosing a source is the whole interaction: analysis starts immediately and
  // the result opens in the full-width workspace.
  async function analyzeFile(file) {
    if (!file || busy) return;
    const name = inferMapName(file.name) || groupDraft.name || "Nouvelle carte";
    setBusy(true);
    setError("");
    try {
      const result = await createMapImportFromFile(file, {
        ...analysisOptions(),
        name
      });
      setGroupDraft({ ...groupDraft, name });
      await refreshResumableDrafts();
      onAnalyzed(result, name);
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setBusy(false);
    }
  }

  async function analyzeUrl() {
    const url = sourceUrl.trim();
    if (!url || busy) return;
    const name = inferMapName(url) || groupDraft.name || "Nouvelle carte";
    setBusy(true);
    setError("");
    try {
      const result = await createMapImportFromUrl(url, {
        ...analysisOptions(),
        name
      });
      setGroupDraft({ ...groupDraft, name });
      await refreshResumableDrafts();
      onAnalyzed(result, name);
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
      const resumedName = item.name || groupDraft.name || "Carte importée";
      setGroupDraft({ ...groupDraft, name: resumedName });
      if (item.repair_available) onOpenRepair(report, resumedName);
      else onAnalyzed(report, resumedName);
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setBusy(false);
    }
  }

  async function abandonDraft(draftId) {
    if (!window.confirm("Supprimer définitivement ce brouillon d’import ?")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await cancelMapImport(draftId);
      await refreshResumableDrafts();
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    analyzeFile(event.dataTransfer?.files?.[0]);
  }

  return (
    <div className="app-scrollbar" style={panelStyle}>
      <div style={sectionTitleStyle}>Créer une carte</div>
      <div style={explanationStyle}>
        Choisissez un fichier SVG. Nemoris recherchera automatiquement les zones
        utilisables.
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          alignItems: "center",
          background: dragging ? "#182a22" : "#171717",
          border: `2px dashed ${dragging ? "#34d399" : "#3a3a3a"}`,
          borderRadius: "14px",
          color: "#ddd",
          cursor: busy ? "wait" : "pointer",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          justifyContent: "center",
          marginBottom: "14px",
          minHeight: "168px",
          padding: "24px",
          textAlign: "center",
          width: "100%"
        }}
      >
        <span style={{ fontSize: "28px" }} aria-hidden="true">🗺️</span>
        <span style={{ fontSize: "14px", fontWeight: 700 }}>
          {busy ? "Analyse en cours…" : "Déposez un fichier SVG ici"}
        </span>
        <span style={{ color: "#8a8a8a", fontSize: "12px" }}>
          ou cliquez pour parcourir vos fichiers
        </span>
      </button>
      <input
        ref={fileInputRef}
        id="map-import-file"
        accept=".svg,image/svg+xml"
        type="file"
        aria-label="Fichier SVG"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          analyzeFile(file);
        }}
        style={{
          height: "1px",
          opacity: 0,
          position: "absolute",
          width: "1px"
        }}
      />

      <div style={{ marginBottom: "14px" }}>
        <button
          type="button"
          onClick={() => setUrlOpen(open => !open)}
          style={linkButtonStyle}
        >
          Importer depuis un lien
        </button>
        {urlOpen && (
          <div style={{ marginTop: "10px" }}>
            <input
              style={{ ...inputStyle, marginBottom: "8px" }}
              value={sourceUrl}
              aria-label="Lien vers un fichier SVG"
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://…/carte.svg"
            />
            <button
              type="button"
              disabled={busy || !sourceUrl.trim()}
              onClick={analyzeUrl}
              style={{
                ...buttonStyle,
                cursor: sourceUrl.trim() && !busy ? "pointer" : "not-allowed",
                opacity: sourceUrl.trim() && !busy ? 1 : 0.55
              }}
            >
              Importer ce lien
            </button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: "14px" }}>
        <button
          type="button"
          onClick={() => setOptionsOpen(open => !open)}
          style={linkButtonStyle}
        >
          Options de détection
        </button>
        {optionsOpen && (
          <div style={{ marginTop: "10px" }}>
            <label
              htmlFor="map-import-ontology"
              style={{ color: "#bbb", display: "block", fontSize: "12px", marginBottom: "6px" }}
            >
              Type de carte
            </label>
            <select
              id="map-import-ontology"
              style={{ ...inputStyle, marginBottom: "12px" }}
              value={ontology}
              onChange={(event) => setOntology(event.target.value)}
            >
              {ontologyOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>

            <label
              htmlFor="map-import-expected"
              style={{ color: "#bbb", display: "block", fontSize: "12px", marginBottom: "6px" }}
            >
              Nombre de zones attendu
            </label>
            <input
              id="map-import-expected"
              min="1"
              max="50000"
              type="number"
              style={inputStyle}
              value={expectedCount}
              onChange={(event) => setExpectedCount(event.target.value)}
              placeholder="Automatique"
            />
          </div>
        )}
      </div>

      {resumableDrafts.length > 0 && (
        <div style={{ marginBottom: "14px" }}>
          <button
            type="button"
            onClick={() => setDraftsOpen(open => !open)}
            style={linkButtonStyle}
          >
            Reprendre un import ({resumableDrafts.length})
          </button>
          {draftsOpen && (
            <div style={{ marginTop: "10px" }}>
              {resumableDrafts.slice(0, 8).map(item => (
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
                      {describeDraftListItem(item)} · {draftZoneCount(item)} zones
                      {" "}· {draftAge(item.updated_at)}
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
        </div>
      )}

      {error && (
        <div style={{ color: "#fca5a5", fontSize: "13px", margin: "12px 0" }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onCancel}
        style={{ ...cancelButtonStyle, marginTop: "6px" }}
      >
        Annuler
      </button>
    </div>
  );
}
