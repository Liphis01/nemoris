import { useEffect, useMemo, useRef, useState } from "react";
import { RichText } from "../../../shared/RichText";

const qualities = [[1, "Difficile"], [2, "Bien"], [3, "Facile"]];

export default function GridReview({ group, submitAnswer, onComplete, trainingMode = false }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstInput = useRef(null);
  const items = group.items;
  const itemByCoordinate = useMemo(() => new Map(items.map(item => [`${item.row_key}:${item.column_key}`, item])), [items]);
  const itemIds = items.map(item => item.question_id).join(",");

  useEffect(() => { setAnswers({}); setResult(null); setError(""); firstInput.current?.focus(); }, [group?.group_id, itemIds]);
  const payloadItems = () => Object.fromEntries(items.map(item => [item.question_id, { answer: answers[item.question_id] || "" }]));
  async function preview(event) { event?.preventDefault(); if (busy) return; setBusy(true); setError(""); try { setResult(await submitAnswer({ groupId: group.group_id, items: payloadItems(), mode: group.mode, commit: false })); } catch (requestError) { setError(requestError.message || "Vérification impossible"); } finally { setBusy(false); } }
  function retryPresentation(results) {
    const failedIds = results.filter(item => !item.correct).map(item => item.question_id);
    const correctedById = new Map(results.map(item => [item.question_id, item]));
    const grid = {
      ...group.grid,
      cells: (group.grid?.cells || []).map(cell => {
        const item = itemByCoordinate.get(`${cell.row_key}:${cell.column_key}`);
        const correction = item ? correctedById.get(item.question_id) : null;
        return correction?.correct ? { ...cell, value: correction.expected } : cell;
      })
    };
    const mode = failedIds.length > 1 ? "fill_row" : "fill_cell";
    return {
      failedIds,
      retry: { grid, mode, presentation_kind: mode === "fill_row" ? "grid_row" : "grid_cell" }
    };
  }

  async function commit(quality) {
    if (!result || busy) return;
    if (trainingMode) {
      const { failedIds, retry } = retryPresentation(result.items);
      onComplete?.(failedIds, retry);
      return;
    }
    setBusy(true); setError("");
    try {
      const saved = await submitAnswer({ groupId: group.group_id, items: payloadItems(), mode: group.mode, quality, commit: true });
      const { failedIds, retry } = retryPresentation(saved.items);
      onComplete?.(failedIds, retry);
    } catch (requestError) { setError(requestError.message || "Enregistrement impossible"); } finally { setBusy(false); }
  }
  const resultById = new Map((result?.items || []).map(item => [item.question_id, item]));

  const firstQuestionId = items[0]?.question_id;
  return <section style={{ display: "grid", gap: "18px", margin: "0 auto", maxWidth: "980px", padding: "24px" }}>
    <div style={{ color: "#5eead4", fontSize: "12px", fontWeight: 800, letterSpacing: ".08em" }}>{group?.mode === "fill_row" ? "GRILLE — LIGNE" : "GRILLE — CELLULE"}</div><h2 style={{ margin: 0 }}>{group?.name || "Grille"}</h2>
    <form onSubmit={preview}><div className="app-scrollbar" style={{ overflow: "auto" }}><table style={{ borderCollapse: "collapse", minWidth: "100%" }}><thead><tr><th></th>{(group?.grid?.columns || []).map(column => <th key={column.key} style={{ padding: "9px", textAlign: "left" }}><RichText>{column.label}</RichText></th>)}</tr></thead><tbody>{(group?.grid?.rows || []).map(row => <tr key={row.key}><th style={{ padding: "9px", textAlign: "left" }}><RichText>{row.label}</RichText></th>{(group?.grid?.columns || []).map(column => { const item = itemByCoordinate.get(`${row.key}:${column.key}`); const cell = (group.grid.cells || []).find(value => value.row_key === row.key && value.column_key === column.key); const check = item ? resultById.get(item.question_id) : null; return <td key={column.key} style={{ background: check ? (check.correct ? "#163c2a" : "#482024") : "#181b1b", border: "1px solid #354", padding: "8px" }}>{item && !result ? <input ref={item.question_id === firstQuestionId ? firstInput : undefined} value={answers[item.question_id] || ""} onChange={event => setAnswers(current => ({ ...current, [item.question_id]: event.target.value }))} aria-label={`${row.label} × ${column.label}`} style={{ background: "#111", border: "1px solid #688", borderRadius: "7px", color: "#fff", padding: "8px", width: "150px" }} /> : <RichText>{item && result ? (check?.correct ? check.expected : `→ ${check?.expected}`) : cell?.value || ""}</RichText>}</td>; })}</tr>)}</tbody></table></div>{!result && <button type="submit" disabled={busy} style={{ background: "#187064", border: 0, borderRadius: "9px", color: "#fff", cursor: "pointer", fontWeight: 800, marginTop: "14px", padding: "11px 16px" }}>Vérifier</button>}</form>
    {result && <div style={{ display: "grid", gap: "10px" }}><strong style={{ color: result.items.every(item => item.correct) ? "#9af0b2" : "#ff9e9e" }}>{result.items.every(item => item.correct) ? "Bonnes réponses" : "Correction affichée"}</strong>{result.items.some(item => item.correct) && !trainingMode ? <div style={{ display: "flex", gap: "8px" }}>{qualities.map(([quality, label]) => <button key={quality} type="button" onClick={() => commit(quality)} style={{ background: "#242424", border: "1px solid #555", borderRadius: "9px", color: "#fff", padding: "10px 14px" }}>{label}</button>)}</div> : <button type="button" onClick={() => commit(0)} style={{ background: "#242424", border: "1px solid #555", borderRadius: "9px", color: "#fff", padding: "10px 14px", width: "fit-content" }}>{trainingMode && result.items.every(item => item.correct) ? "Suivant" : "Continuer"}</button>}</div>}
    {error && <div style={{ color: "#ff9e9e" }}>{error}</div>}
  </section>;
}
