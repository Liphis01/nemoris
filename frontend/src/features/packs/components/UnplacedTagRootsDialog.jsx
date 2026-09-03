import { useMemo, useState } from "react";

import { resolveTagInbox } from "../../../api/tags";
import TagPicker from "../../../shared/TagPicker";
import { labelForTag, primeTags, useTagHierarchy } from "../../../shared/tagLabels";


export default function UnplacedTagRootsDialog({ roots = [], onClose }) {
  const { inbox, labels } = useTagHierarchy();
  const [parents, setParents] = useState({});
  const [inputs, setInputs] = useState({});
  const [decisions, setDecisions] = useState({});
  const [openOptions, setOpenOptions] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requested = useMemo(() => new Set(roots.filter(Boolean)), [roots]);
  const entries = useMemo(
    () => (inbox?.pending || []).filter(entry =>
      requested.size === 0 || requested.has(entry.tag_id)
    ),
    [inbox, requested]
  );

  if (!entries.length) return null;

  function setDecision(tagId, decision) {
    setDecisions(current => ({
      ...current,
      [tagId]: decision
    }));
  }

  function decisionFor(entry) {
    return decisions[entry.tag_id] || { action: "keep_root" };
  }

  function decisionPayload(entry, override = null) {
    const decision = override || decisionFor(entry);
    if (decision.action === "merge" && decision.target_id) {
      return { action: "merge", target_id: decision.target_id };
    }
    if (decision.action === "place" && decision.parent_id) {
      return { action: "place", parent_id: decision.parent_id };
    }
    if (decision.action === "defer") {
      return { action: "defer" };
    }
    return { action: "keep_root" };
  }

  async function resolveAll(override = null) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      let latest = null;
      for (const entry of entries) {
        latest = await resolveTagInbox({
          pack_guid: entry.pack_guid,
          tag_id: entry.tag_id,
          ...decisionPayload(entry, override)
        });
        primeTags(latest);
      }
      onClose?.();
    } catch (resolveError) {
      console.error(resolveError);
      setError(resolveError.message || "Action impossible");
    } finally {
      setSaving(false);
    }
  }

  function toggleOptions(tagId) {
    setOpenOptions(current => {
      const next = new Set(current);
      next.has(tagId) ? next.delete(tagId) : next.add(tagId);
      return next;
    });
  }

  function optionStyle(active) {
    return {
      border: active ? "1px solid #5eead4" : "1px solid #333",
      borderRadius: "8px",
      background: active ? "rgba(94, 234, 212, 0.12)" : "#1c1c1c",
      color: active ? "#8ef2e3" : "#bbb",
      cursor: saving ? "default" : "pointer",
      fontSize: "12px",
      fontWeight: 800,
      padding: "8px 10px"
    };
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Import terminé : nouveaux thèmes" style={{
      position: "fixed", inset: "var(--shell-top, 0px) 0 0", zIndex: 60,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.58)", padding: "24px"
    }}>
      <div style={{
        width: "min(720px, 96vw)", maxHeight: "min(84vh, 760px)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        background: "#151515", border: "1px solid #2b2b2b", borderRadius: "12px"
      }}>
        <header style={{ padding: "18px 20px", borderBottom: "1px solid #262626" }}>
          <h2 style={{ color: "#eee", fontSize: "18px", margin: 0 }}>Import terminé</h2>
          <p style={{ color: "#8a8a8a", fontSize: "12px", lineHeight: 1.5, margin: "7px 0 0" }}>
            Ce pack ajoute {entries.length} nouveau{entries.length > 1 ? "x" : ""} thème{entries.length > 1 ? "s" : ""}. Par défaut, ils resteront séparés de tes tags actuels.
          </p>
        </header>

        <div className="app-scrollbar" style={{ overflowY: "auto", padding: "14px 20px" }}>
          {entries.map(entry => {
            const label = entry.label || labelForTag(entry.tag_id, labels);
            const selectedParent = parents[entry.tag_id];
            const decision = decisionFor(entry);
            const suggestedMatch = (entry.suggested_matches || [])[0];
            const optionsOpen = openOptions.has(entry.tag_id);
            return (
              <section key={entry.id} style={{ borderBottom: "1px solid #242424", padding: "4px 0 16px", marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                  <div>
                    <strong style={{ color: "#d2c2ff" }}>#{label}</strong>
                    <div style={{ color: "#777", fontSize: "11px", marginTop: "4px" }}>
                      {entry.pack_name || "Pack"} · {entry.question_count || 0} question(s)
                    </div>
                  </div>
                </div>

                {(entry.sample_questions || []).length > 0 && (
                  <div style={{ color: "#777", fontSize: "11px", marginTop: "8px" }}>
                    Exemples : {entry.sample_questions.join(" · ")}
                  </div>
                )}

                <div role="group" aria-label={`Décision pour ${label}`} style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "11px" }}>
                  <button
                    type="button"
                    disabled={saving}
                    aria-pressed={decision.action === "keep_root"}
                    onClick={() => setDecision(entry.tag_id, { action: "keep_root" })}
                    style={optionStyle(decision.action === "keep_root")}
                  >
                    Garder comme nouveau thème
                  </button>
                  {suggestedMatch && (
                    <button
                      type="button"
                      disabled={saving}
                      aria-pressed={decision.action === "merge" && decision.target_id === suggestedMatch}
                      onClick={() => setDecision(entry.tag_id, { action: "merge", target_id: suggestedMatch })}
                      style={optionStyle(decision.action === "merge" && decision.target_id === suggestedMatch)}
                    >
                      Fusionner avec #{labelForTag(suggestedMatch, labels)}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving}
                    aria-expanded={optionsOpen}
                    onClick={() => toggleOptions(entry.tag_id)}
                    style={optionStyle(decision.action === "place")}
                  >
                    Ranger ailleurs
                  </button>
                </div>

                <div style={{ color: "#8f8f8f", fontSize: "11px", marginTop: "7px" }}>
                  {decision.action === "merge" && decision.target_id
                    ? `Sera fusionné avec #${labelForTag(decision.target_id, labels)}.`
                    : decision.action === "place" && decision.parent_id
                      ? `Sera rangé sous #${labelForTag(decision.parent_id, labels)}.`
                      : "Restera séparé de tes tags actuels."}
                </div>

                {optionsOpen && (
                  <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <TagPicker
                        value={inputs[entry.tag_id] || ""}
                        onChange={value => setInputs(current => ({ ...current, [entry.tag_id]: value }))}
                        onAdd={parentId => {
                          setParents(current => ({ ...current, [entry.tag_id]: parentId }));
                          setInputs(current => ({ ...current, [entry.tag_id]: "" }));
                          setDecision(entry.tag_id, { action: "place", parent_id: parentId });
                        }}
                        allowCreate={false}
                        showChips={false}
                        extraKeys={[]}
                        placeholder={`Ranger « ${label} » sous…`}
                        portalZIndex={80}
                        inputStyle={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #333", background: "#101010", color: "#eee" }}
                      />
                      {decision.action === "place" && selectedParent && (
                        <div style={{ color: "#999", fontSize: "11px", marginTop: "5px" }}>
                          Sous #{labelForTag(selectedParent, labels)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <footer style={{ padding: "12px 20px", borderTop: "1px solid #262626", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {error ? <span role="alert" style={{ color: "#f2b8b8", fontSize: "12px" }}>{error}</span> : <span />}
          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <button type="button" disabled={saving} onClick={() => resolveAll({ action: "defer" })} style={{ border: "1px solid #333", borderRadius: "8px", background: "#1d1d1d", color: "#aaa", padding: "9px 13px" }}>
              Plus tard
            </button>
            <button type="button" disabled={saving} onClick={() => resolveAll()} style={{ border: "1px solid #5eead4", borderRadius: "8px", background: "#5eead4", color: "#06231e", fontWeight: 900, padding: "9px 14px" }}>
              {saving ? "Validation…" : "Valider"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
