import { useMemo, useState } from "react";

import { resolveTagInbox } from "../../../api/tags";
import TagPicker from "../../../shared/TagPicker";
import { labelForTag, primeTags, useTagHierarchy } from "../../../shared/tagLabels";


export default function UnplacedTagRootsDialog({ roots = [], onClose }) {
  const { inbox, labels } = useTagHierarchy();
  const [parents, setParents] = useState({});
  const [inputs, setInputs] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const requested = useMemo(() => new Set(roots.filter(Boolean)), [roots]);
  const entries = useMemo(
    () => (inbox?.pending || []).filter(entry =>
      requested.size === 0 || requested.has(entry.tag_id)
    ),
    [inbox, requested]
  );

  if (!entries.length) return null;

  async function resolve(entry, action, extra = {}) {
    setBusyId(entry.id);
    setError("");
    try {
      const next = await resolveTagInbox({
        pack_guid: entry.pack_guid,
        tag_id: entry.tag_id,
        action,
        ...extra
      });
      primeTags(next);
      if (action === "defer" || (next.inbox?.pending || []).filter(
        item => requested.has(item.tag_id) && item.status === "pending"
      ).length === 0) {
        onClose?.();
      }
    } catch (resolveError) {
      console.error(resolveError);
      setError(resolveError.message || "Action impossible");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Ranger les thèmes importés" style={{
      position: "fixed", inset: "var(--shell-top, 0px) 0 0", zIndex: 60,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.58)", padding: "24px"
    }}>
      <div style={{
        width: "min(680px, 96vw)", maxHeight: "min(84vh, 760px)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        background: "#151515", border: "1px solid #2b2b2b", borderRadius: "16px"
      }}>
        <header style={{ padding: "18px 20px", borderBottom: "1px solid #262626" }}>
          <h2 style={{ color: "#eee", fontSize: "18px", margin: 0 }}>Tags à classer</h2>
          <p style={{ color: "#8a8a8a", fontSize: "12px", lineHeight: 1.5, margin: "7px 0 0" }}>
            Ces identifiants viennent d’un pack et restent distincts, même si leur nom ressemble à un tag local.
          </p>
        </header>

        <div className="app-scrollbar" style={{ overflowY: "auto", padding: "14px 20px" }}>
          {entries.map(entry => {
            const label = entry.label || labelForTag(entry.tag_id, labels);
            const selectedParent = parents[entry.tag_id];
            return (
              <section key={entry.id} style={{ borderBottom: "1px solid #242424", padding: "4px 0 16px", marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <div>
                    <strong style={{ color: "#d2c2ff" }}>#{label}</strong>
                    <div style={{ color: "#777", fontSize: "11px", marginTop: "4px" }}>
                      {entry.pack_name || "Pack"} · {entry.question_count || 0} question(s)
                    </div>
                  </div>
                  <button type="button" disabled={busyId === entry.id} onClick={() => resolve(entry, "keep_root")}
                    style={{ border: "1px solid #333", borderRadius: "8px", background: "#1c1c1c", color: "#bbb", padding: "7px 10px" }}>
                    Garder comme racine
                  </button>
                </div>

                {(entry.sample_questions || []).length > 0 && (
                  <div style={{ color: "#777", fontSize: "11px", marginTop: "8px" }}>
                    Exemples : {entry.sample_questions.join(" · ")}
                  </div>
                )}

                <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <TagPicker
                      value={inputs[entry.tag_id] || ""}
                      onChange={value => setInputs(current => ({ ...current, [entry.tag_id]: value }))}
                      onAdd={parentId => setParents(current => ({ ...current, [entry.tag_id]: parentId }))}
                      allowCreate={false}
                      showChips={false}
                      extraKeys={[]}
                      placeholder={`Ranger « ${label} » sous…`}
                      inputStyle={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #333", background: "#101010", color: "#eee" }}
                    />
                    {selectedParent && (
                      <div style={{ color: "#999", fontSize: "11px", marginTop: "5px" }}>
                        Sous #{labelForTag(selectedParent, labels)}
                      </div>
                    )}
                  </div>
                  <button type="button" disabled={!selectedParent || busyId === entry.id}
                    onClick={() => resolve(entry, "place", { parent_id: selectedParent })}
                    style={{ border: "1px solid #49396d", borderRadius: "8px", background: "#2b2047", color: "#d2c2ff", padding: "8px 12px" }}>
                    Ranger
                  </button>
                </div>

                {(entry.suggested_matches || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
                    <span style={{ color: "#777", fontSize: "11px", padding: "6px 0" }}>Fusionner avec :</span>
                    {entry.suggested_matches.map(targetId => (
                      <button key={targetId} type="button" disabled={busyId === entry.id}
                        onClick={() => resolve(entry, "merge", { target_id: targetId })}
                        style={{ border: "1px solid #3a3320", borderRadius: "999px", background: "#211d12", color: "#d8c89a", padding: "5px 9px" }}>
                        #{labelForTag(targetId, labels)}
                      </button>
                    ))}
                  </div>
                )}

                <button type="button" disabled={busyId === entry.id} onClick={() => resolve(entry, "defer")}
                  style={{ marginTop: "10px", border: 0, background: "transparent", color: "#777", textDecoration: "underline" }}>
                  Décider plus tard
                </button>
              </section>
            );
          })}
        </div>

        <footer style={{ padding: "12px 20px", borderTop: "1px solid #262626", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {error ? <span role="alert" style={{ color: "#f2b8b8", fontSize: "12px" }}>{error}</span> : <span />}
          <button type="button" onClick={onClose} style={{ border: "1px solid #333", borderRadius: "9px", background: "#1d1d1d", color: "#aaa", padding: "9px 13px" }}>
            Fermer
          </button>
        </footer>
      </div>
    </div>
  );
}
