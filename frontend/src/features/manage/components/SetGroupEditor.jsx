import { useCallback, useEffect, useMemo, useState } from "react";
import { getSetGroup, patchSetGroup } from "../../../api/setGroups";
import { RichText } from "../../../shared/RichText";
import { buttonStyle, disabledSaveButtonStyle, inputStyle, pendingSaveButtonStyle } from "./QuestionEditorStyles";
import { EditorSection, QuestionEditorField, TagEditor } from "./QuestionEditorPrimitives";
import AnswerPolicyControl from "./AnswerPolicyControl";
import { answerPolicyFromGroup } from "./answerPolicyControlUtils";
import { matchesSearch } from "../utils/questionFilters";

function key() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function blankMembers() { return [{ key: key(), value: "", aliases: [] }]; }
function signature(group, members) { return JSON.stringify({ name: group?.name || "", tags: group?.tags || [], policy: answerPolicyFromGroup(group), members }); }

const addMemberSlotStyle = {
  alignItems: "center",
  background: "#171717",
  border: "1px dashed #3a3a3a",
  borderRadius: "10px",
  boxSizing: "border-box",
  color: "#999",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  justifyContent: "center",
  minHeight: "104px",
  padding: "18px",
  textAlign: "center"
};

export default function SetGroupEditor({ group, availableTags = [], ensurePersistedGroup, onSave, registerPendingSaveHandler, headerAction }) {
  const [editableGroup, setEditableGroup] = useState(group);
  const [members, setMembers] = useState(blankMembers());
  const [tagInput, setTagInput] = useState("");
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [editPolicy, setEditPolicy] = useState("replace_progress");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setEditableGroup(group); setError(""); setEditPolicy("replace_progress"); setSearchQuery("");
    if (!group?.id) { const next = blankMembers(); setMembers(next); setSaved(signature(group, next)); return undefined; }
    getSetGroup(group.id).then(result => {
      if (cancelled) return;
      const nextGroup = { ...group, ...result.group };
      const nextMembers = result.group?.members || blankMembers();
      setEditableGroup(nextGroup); setMembers(nextMembers); setSaved(signature(nextGroup, nextMembers));
    }).catch(loadError => !cancelled && setError(loadError.message || "Chargement impossible"));
    return () => { cancelled = true; };
  }, [group]);

  const dirty = useMemo(() => signature(editableGroup, members) !== saved, [editableGroup, members, saved]);
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;

    return members.filter(member => matchesSearch({
      answer: member.value,
      aliases: member.aliasText
        ? String(member.aliasText).split(",").map(alias => alias.trim()).filter(Boolean)
        : member.aliases || []
    }, searchQuery));
  }, [members, searchQuery]);
  const changeMember = (memberKey, field, value) => setMembers(current => current.map(member => member.key === memberKey ? { ...member, [field]: value } : member));
  const addTag = (value) => { const next = String(value || tagInput).trim(); if (!next || editableGroup?.tags?.includes(next)) return; setEditableGroup(current => ({ ...current, tags: [...(current?.tags || []), next] })); setTagInput(""); };
  const addMember = () => { setMembers(current => [...current, { key: key(), value: "", aliases: [] }]); setSearchQuery(""); };

  const save = useCallback(async () => {
    const meaningful = members.map(member => ({ ...member, value: String(member.value || "").trim(), aliases: String(member.aliasText ?? (member.aliases?.join(", ") || "")).split(",").map(alias => alias.trim()).filter(Boolean) })).filter(member => member.value);
    if (!String(editableGroup?.name || "").trim()) { setError("Donne un nom à cet ensemble."); return null; }
    if (!meaningful.length) { setError("Ajoute au moins un membre."); return null; }
    setStatus("Enregistrement..."); setError("");
    try {
      const target = group?.id ? group : await ensurePersistedGroup?.({ name: editableGroup.name, itemCount: meaningful.length });
      if (!target?.id) return null;
      const result = await patchSetGroup(target.id, { name: editableGroup.name, tags: editableGroup.tags || [], answer_policy: answerPolicyFromGroup(editableGroup), members: meaningful, edit_policy: editPolicy });
      const nextGroup = { ...editableGroup, ...result.group };
      const nextMembers = result.group.members;
      setEditableGroup(nextGroup); setMembers(nextMembers); setSaved(signature(nextGroup, nextMembers)); setStatus("Enregistré ✔");
      await onSave?.({ ...result, group: { ...target, ...result.group }, items: result.items || result.cards || [] });
      return result;
    } catch (saveError) { setStatus(""); setError(saveError.message || "Enregistrement impossible"); return null; }
  }, [editPolicy, editableGroup, ensurePersistedGroup, group, members, onSave]);
  useEffect(() => registerPendingSaveHandler?.(() => (dirty ? save() : null)), [dirty, registerPendingSaveHandler, save]);

  return <div className="app-scrollbar" style={{ height: "100%", overflow: "auto", padding: "18px" }}>
    <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: "14px" }}><div><div style={{ color: "#888" }}>Ensemble</div><strong style={{ color: "#9ac5ff" }}>SET</strong></div><div style={{ display: "flex", gap: "8px" }}>{headerAction}<button type="button" onClick={save} disabled={!dirty} style={dirty ? pendingSaveButtonStyle : disabledSaveButtonStyle}>Enregistrer</button></div></div>
    <div style={{ display: "grid", gap: "16px" }}>
      <EditorSection title="Ensemble" accent="#9ac5ff"><QuestionEditorField label="Nom"><input value={editableGroup?.name || ""} onChange={event => setEditableGroup(current => ({ ...current, name: event.target.value }))} style={inputStyle} /></QuestionEditorField><TagEditor tags={editableGroup?.tags || []} tagInput={tagInput} availableTags={availableTags} onTagInputChange={setTagInput} onAddTag={addTag} onRemoveTag={tag => setEditableGroup(current => ({ ...current, tags: (current?.tags || []).filter(value => value !== tag) }))} /><AnswerPolicyControl policy={answerPolicyFromGroup(editableGroup)} onChange={answer_policy => setEditableGroup(current => ({ ...current, data: { ...(current?.data || {}), answer_policy } }))} />{group?.id && <QuestionEditorField label="Type de modification"><select aria-label="Type de modification" value={editPolicy} onChange={event => setEditPolicy(event.target.value)} style={inputStyle}><option value="replace_progress">Changer le fait appris</option><option value="preserve_progress">Corriger une faute</option></select></QuestionEditorField>}</EditorSection>
      <EditorSection title="Membres" accent="#9ac5ff"><p style={{ color: "#aaa", marginTop: 0 }}>Une réponse par ligne ; les alias facultatifs sont séparés par des virgules.</p><div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px" }}><div style={{ flex: "1 1 160px", maxWidth: "240px", position: "relative" }}><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Recherche..." aria-label="Rechercher dans le groupe" style={{ ...inputStyle, ...(searchQuery ? { paddingRight: "28px" } : null), width: "100%" }} />{searchQuery && <button type="button" onClick={() => setSearchQuery("")} aria-label="Effacer la recherche" style={{ background: "transparent", border: "none", borderRadius: "50%", color: "#777", cursor: "pointer", fontSize: "16px", height: "20px", lineHeight: 1, position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", width: "20px" }}>×</button>}</div>{searchQuery.trim() && <span style={{ color: "#888", fontSize: "12px" }}>{filteredMembers.length} / {members.length}</span>}</div>{searchQuery.trim() && filteredMembers.length === 0 && <div style={{ alignItems: "center", border: "1px dashed #333", borderRadius: "10px", color: "#777", display: "flex", justifyContent: "center", minHeight: "80px", padding: "18px", textAlign: "center" }}>Aucun résultat pour « {searchQuery.trim()} »</div>}<div style={{ display: "grid", gap: "10px" }}>{filteredMembers.map((member) => { const index = members.findIndex(item => item.key === member.key); return <div key={member.key} style={{ background: "#171b22", border: "1px solid #345", borderRadius: "8px", display: "grid", gap: "6px", padding: "10px" }}><input aria-label={`Membre ${index + 1}`} placeholder="Membre" value={member.value} onChange={event => changeMember(member.key, "value", event.target.value)} style={inputStyle} /><input aria-label={`Alias ${index + 1}`} placeholder="Alias (facultatifs, séparés par des virgules)" value={member.aliasText ?? member.aliases?.join(", ") ?? ""} onChange={event => changeMember(member.key, "aliasText", event.target.value)} style={inputStyle} />{member.value && <div style={{ color: "#aaa", fontSize: "12px" }}><RichText>{member.value}</RichText></div>}<button type="button" onClick={() => setMembers(current => current.length === 1 ? current : current.filter(item => item.key !== member.key))} style={{ ...buttonStyle, background: "transparent", color: "#d99", width: "fit-content" }}>Retirer</button></div>; })}</div><button data-set-group-add-cell onClick={addMember} style={addMemberSlotStyle} type="button"><span aria-hidden="true" style={{ fontSize: "26px" }}>＋</span><span style={{ fontSize: "13px" }}>Nouveau membre</span></button></EditorSection>
      {(status || error) && <div style={{ color: error ? "#ff9494" : "#8ee9ac" }}>{error || status}</div>}
    </div>
  </div>;
}
