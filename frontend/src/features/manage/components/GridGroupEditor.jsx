import { useCallback, useEffect, useMemo, useState } from "react";
import { getGridGroup, patchGridGroup } from "../../../api/gridGroups";
import { buttonStyle, disabledSaveButtonStyle, inputStyle, pendingSaveButtonStyle } from "./QuestionEditorStyles";
import { EditorSection, QuestionEditorField, TagEditor } from "./QuestionEditorPrimitives";
import AnswerPolicyControl from "./AnswerPolicyControl";
import { answerPolicyFromGroup } from "./answerPolicyControlUtils";
import { RichText } from "../../../shared/RichText";

function key() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}
function blankGrid() { const row = key(), column = key(), cell = key(); return { format: 1, rows: [{ key: row, label: "Ligne 1" }], columns: [{ key: column, label: "Colonne 1" }], cells: [{ key: cell, row_key: row, column_key: column, value: "" }] }; }
function signature(group, grid) { return JSON.stringify({ name: group?.name || "", tags: group?.tags || [], policy: answerPolicyFromGroup(group), grid }); }

export default function GridGroupEditor({ group, availableTags = [], ensurePersistedGroup, onSave, registerPendingSaveHandler, headerAction }) {
  const [editableGroup, setEditableGroup] = useState(group);
  const [grid, setGrid] = useState(blankGrid());
  const [tagInput, setTagInput] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let cancelled = false;
    setEditableGroup(group); setError("");
    if (!group?.id) { const next = blankGrid(); setGrid(next); setSaved(signature(group, next)); return undefined; }
    getGridGroup(group.id).then((result) => {
      if (cancelled) return;
      const nextGroup = { ...group, ...result.group };
      const nextGrid = result.group?.grid || blankGrid();
      setEditableGroup(nextGroup); setGrid(nextGrid); setSaved(signature(nextGroup, nextGrid));
    }).catch((loadError) => !cancelled && setError(loadError.message || "Chargement impossible"));
    return () => { cancelled = true; };
  }, [group]);

  const dirty = useMemo(() => signature(editableGroup, grid) !== saved, [editableGroup, grid, saved]);
  const updateAxis = (kind, axisKey, label) => setGrid(current => ({ ...current, [kind]: current[kind].map(item => item.key === axisKey ? { ...item, label } : item) }));
  const addAxis = (kind) => setGrid(current => ({ ...current, [kind]: [...current[kind], { key: key(), label: kind === "rows" ? `Ligne ${current.rows.length + 1}` : `Colonne ${current.columns.length + 1}` }] }));
  const removeAxis = (kind, axisKey) => setGrid(current => {
    if (current[kind].length <= 1) return current;
    const field = kind === "rows" ? "row_key" : "column_key";
    return { ...current, [kind]: current[kind].filter(item => item.key !== axisKey), cells: current.cells.filter(cell => cell[field] !== axisKey) };
  });
  const cellFor = (rowKey, columnKey) => grid.cells.find(cell => cell.row_key === rowKey && cell.column_key === columnKey);
  const setCell = (rowKey, columnKey, value) => setGrid(current => {
    const existing = current.cells.find(cell => cell.row_key === rowKey && cell.column_key === columnKey);
    const cells = existing ? current.cells.map(cell => cell.key === existing.key ? { ...cell, value } : cell) : [...current.cells, { key: key(), row_key: rowKey, column_key: columnKey, value }];
    return { ...current, cells };
  });
  const removeCell = (rowKey, columnKey) => setGrid(current => ({ ...current, cells: current.cells.filter(cell => cell.row_key !== rowKey || cell.column_key !== columnKey) }));
  const addTag = (value) => { const next = String(value || tagInput).trim(); if (!next || editableGroup?.tags?.includes(next)) return; setEditableGroup(current => ({ ...current, tags: [...(current?.tags || []), next] })); setTagInput(""); };

  const save = useCallback(async () => {
    if (!String(editableGroup?.name || "").trim()) { setError("Donne un nom à cette grille."); return null; }
    if (!grid.cells.some(cell => String(cell.value || "").trim())) { setError("Ajoute au moins une cellule non vide."); return null; }
    setStatus("Enregistrement..."); setError("");
    try {
      const target = group?.id ? group : await ensurePersistedGroup?.({ name: editableGroup.name, itemCount: grid.cells.length });
      if (!target?.id) return null;
      const result = await patchGridGroup(target.id, { name: editableGroup.name, tags: editableGroup.tags || [], answer_policy: answerPolicyFromGroup(editableGroup), grid: { ...grid, cells: grid.cells.filter(cell => String(cell.value || "").trim()) } });
      const nextGroup = { ...editableGroup, ...result.group };
      const nextGrid = result.group.grid;
      setEditableGroup(nextGroup); setGrid(nextGrid); setSaved(signature(nextGroup, nextGrid)); setStatus("Enregistré ✔");
      await onSave?.({ ...result, group: { ...target, ...result.group }, items: result.items || result.cards || [] });
      return result;
    } catch (saveError) { setStatus(""); setError(saveError.message || "Enregistrement impossible"); return null; }
  }, [editableGroup, ensurePersistedGroup, grid, group, onSave]);
  useEffect(() => registerPendingSaveHandler?.(() => (dirty ? save() : null)), [dirty, registerPendingSaveHandler, save]);

  return <div className="app-scrollbar" style={{ height: "100%", overflow: "auto", padding: "18px" }}>
    <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: "14px" }}><div><div style={{ color: "#888" }}>Grille</div><strong style={{ color: "#8ee9d4" }}>GRID</strong></div><div style={{ display: "flex", gap: "8px" }}>{headerAction}<button type="button" onClick={save} disabled={!dirty} style={dirty ? pendingSaveButtonStyle : disabledSaveButtonStyle}>Enregistrer</button></div></div>
    <div style={{ display: "grid", gap: "16px" }}>
      <EditorSection title="Grille" accent="#5eead4"><QuestionEditorField label="Nom"><input value={editableGroup?.name || ""} onChange={event => setEditableGroup(current => ({ ...current, name: event.target.value }))} style={inputStyle} /></QuestionEditorField><TagEditor tags={editableGroup?.tags || []} tagInput={tagInput} availableTags={availableTags} onTagInputChange={setTagInput} onAddTag={addTag} onRemoveTag={tag => setEditableGroup(current => ({ ...current, tags: (current?.tags || []).filter(value => value !== tag) }))} /><AnswerPolicyControl policy={answerPolicyFromGroup(editableGroup)} onChange={answer_policy => setEditableGroup(current => ({ ...current, data: { ...(current?.data || {}), answer_policy } }))} /></EditorSection>
      <EditorSection title="Lignes et colonnes" accent="#5eead4"><div style={{ display: "grid", gap: "10px", gridTemplateColumns: "1fr 1fr" }}>{["rows", "columns"].map(kind => <div key={kind} style={{ display: "grid", gap: "6px" }}><strong>{kind === "rows" ? "Lignes" : "Colonnes"}</strong>{grid[kind].map(axis => <div key={axis.key} style={{ display: "flex", gap: "6px" }}><input value={axis.label} onChange={event => updateAxis(kind, axis.key, event.target.value)} style={inputStyle} /><button type="button" onClick={() => removeAxis(kind, axis.key)} style={{ ...buttonStyle, background: "#4a2028" }}>×</button></div>)}<button type="button" onClick={() => addAxis(kind)} style={buttonStyle}>Ajouter</button></div>)}</div></EditorSection>
      <EditorSection title="Cellules" accent="#5eead4"><div className="app-scrollbar" style={{ overflow: "auto" }}><table style={{ borderCollapse: "collapse", minWidth: "100%" }}><thead><tr><th></th>{grid.columns.map(column => <th key={column.key} style={{ padding: "7px", textAlign: "left" }}><RichText>{column.label}</RichText></th>)}</tr></thead><tbody>{grid.rows.map(row => <tr key={row.key}><th style={{ padding: "7px", textAlign: "left" }}><RichText>{row.label}</RichText></th>{grid.columns.map(column => { const cell = cellFor(row.key, column.key); return <td key={column.key} style={{ padding: "5px" }}><textarea aria-label={`${row.label} × ${column.label}`} value={cell?.value || ""} onChange={event => setCell(row.key, column.key, event.target.value)} rows={2} style={{ ...inputStyle, minWidth: "150px" }} />{cell?.value && <div style={{ color: "#aaa", fontSize: "12px", margin: "4px 0" }}><RichText>{cell.value}</RichText></div>}{cell && <button type="button" onClick={() => removeCell(row.key, column.key)} style={{ ...buttonStyle, background: "transparent", color: "#d99" }}>Vider</button>}</td>; })}</tr>)}</tbody></table></div></EditorSection>
      {(status || error) && <div style={{ color: error ? "#ff9494" : "#8ee9ac" }}>{error || status}</div>}
    </div>
  </div>;
}
