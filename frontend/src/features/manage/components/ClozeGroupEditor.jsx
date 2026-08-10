import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClozeGroup, patchClozeGroup } from "../../../api/clozeGroups";
import {
  buttonStyle,
  disabledSaveButtonStyle,
  inputStyle,
  pendingSaveButtonStyle
} from "./QuestionEditorStyles";
import { EditorSection, QuestionEditorField, TagEditor } from "./QuestionEditorPrimitives";
import AnswerPolicyControl from "./AnswerPolicyControl";
import { answerPolicyFromGroup } from "./answerPolicyControlUtils";

const marker = /\{\{cloze:([0-9a-f-]{36})::([\s\S]*?)\}\}/gi;

function randomKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = hex();
    return character === "x" ? value : ((Number.parseInt(value, 16) & 0x3) | 0x8).toString(16);
  });
}

function markerSource(key, answer) {
  return `{{cloze:${key}::${answer}}}`;
}

function visibleSource(source) {
  return String(source || "").replace(marker, (_all, _key, answer) => answer);
}

function rawOffsetForVisible(source, target) {
  let rawCursor = 0;
  let visibleCursor = 0;
  marker.lastIndex = 0;
  let match;
  while ((match = marker.exec(source))) {
    const plainLength = match.index - rawCursor;
    if (target <= visibleCursor + plainLength) return rawCursor + target - visibleCursor;
    visibleCursor += plainLength;
    const answerLength = match[2].length;
    if (target < visibleCursor + answerLength) return null;
    if (target === visibleCursor + answerLength) return match.index + match[0].length;
    visibleCursor += answerLength;
    rawCursor = match.index + match[0].length;
  }
  return rawCursor + target - visibleCursor;
}

function editorSignature(editableGroup, source) {
  return JSON.stringify({
    name: editableGroup?.name || "",
    tags: editableGroup?.tags || [],
    policy: answerPolicyFromGroup(editableGroup),
    source
  });
}

export default function ClozeGroupEditor({
  group,
  availableTags = [],
  ensurePersistedGroup,
  onSave,
  registerPendingSaveHandler,
  headerAction
}) {
  const [editableGroup, setEditableGroup] = useState(group);
  const [source, setSource] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [selectedLinkKey, setSelectedLinkKey] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const selectionRef = useRef(null);
  const savedSignatureRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    setEditableGroup(group);
    setError("");
    savedSignatureRef.current = editorSignature(group, "");
    if (!group?.id) {
      setSource("");
      savedSignatureRef.current = editorSignature(group, "");
      return undefined;
    }
    getClozeGroup(group.id)
      .then((result) => {
        if (cancelled) return;
        const nextGroup = { ...group, ...result.group };
        const nextSource = result.group?.source || "";
        setEditableGroup(nextGroup);
        setSource(nextSource);
        savedSignatureRef.current = editorSignature(nextGroup, nextSource);
      })
      .catch((loadError) => !cancelled && setError(loadError.message || "Chargement impossible"));
    return () => { cancelled = true; };
  }, [group]);

  const holes = useMemo(() => {
    const found = [];
    let match;
    marker.lastIndex = 0;
    while ((match = marker.exec(source))) {
      if (!found.some((hole) => hole.key === match[1])) {
        found.push({ key: match[1], answer: match[2] });
      }
    }
    return found;
  }, [source]);

  const signature = useMemo(() => editorSignature(editableGroup, source), [editableGroup, source]);
  const dirty = signature !== savedSignatureRef.current;

  const captureSelection = useCallback((event) => {
    const start = event.target.selectionStart;
    const end = event.target.selectionEnd;
    if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
      selectionRef.current = { start, end };
    }
  }, []);

  const addHole = useCallback((linkedKey = null) => {
    const selection = selectionRef.current;
    if (!selection || selection.end <= selection.start) {
      setError("Sélectionne d’abord le passage à masquer.");
      return;
    }
    const rawStart = rawOffsetForVisible(source, selection.start);
    const rawEnd = rawOffsetForVisible(source, selection.end);
    if (rawStart === null || rawEnd === null || rawEnd <= rawStart) {
      setError("La sélection ne peut pas traverser un trou existant.");
      return;
    }
    const answer = source.slice(rawStart, rawEnd);
    if (!answer.trim() || answer.includes("{{cloze:")) {
      setError("Un trou doit contenir un passage non vide, sans autre trou.");
      return;
    }
    const existing = holes.find((hole) => hole.key === linkedKey);
    if (existing && existing.answer !== answer) {
      setError("Une occurrence liée doit reprendre exactement la même réponse.");
      return;
    }
    const key = linkedKey || randomKey();
    setSource((value) => (
      value.slice(0, rawStart) + markerSource(key, answer) + value.slice(rawEnd)
    ));
    selectionRef.current = null;
    setError("");
  }, [holes, source]);

  const removeHole = useCallback((key) => {
    const expression = new RegExp(`\\{\\{cloze:${key}::([\\s\\S]*?)\\}\\}`, "g");
    setSource((value) => value.replace(expression, "$1"));
  }, []);

  const editVisibleSource = useCallback((nextVisible) => {
    const previousVisible = visibleSource(source);
    if (!source.includes("{{cloze:")) {
      setSource(nextVisible);
      return;
    }
    let prefixLength = 0;
    while (prefixLength < previousVisible.length && prefixLength < nextVisible.length && previousVisible[prefixLength] === nextVisible[prefixLength]) {
      prefixLength += 1;
    }
    let suffixLength = 0;
    while (
      suffixLength < previousVisible.length - prefixLength
      && suffixLength < nextVisible.length - prefixLength
      && previousVisible[previousVisible.length - 1 - suffixLength] === nextVisible[nextVisible.length - 1 - suffixLength]
    ) {
      suffixLength += 1;
    }
    const rawStart = rawOffsetForVisible(source, prefixLength);
    const rawEnd = rawOffsetForVisible(source, previousVisible.length - suffixLength);
    if (rawStart === null || rawEnd === null || rawEnd < rawStart) {
      setError("Pour modifier la réponse d’un trou, retire-le puis recrée-le.");
      return;
    }
    setSource(source.slice(0, rawStart) + nextVisible.slice(prefixLength, nextVisible.length - suffixLength) + source.slice(rawEnd));
    setError("");
  }, [source]);

  const addTag = useCallback((value) => {
    const next = String(value || "").trim();
    if (!next || (editableGroup?.tags || []).includes(next)) return;
    setEditableGroup((current) => ({ ...current, tags: [...(current?.tags || []), next] }));
    setTagInput("");
  }, [editableGroup]);
  const removeTag = useCallback((tag) => {
    setEditableGroup((current) => ({ ...current, tags: (current?.tags || []).filter((value) => value !== tag) }));
  }, []);

  const save = useCallback(async () => {
    if (!String(editableGroup?.name || "").trim()) {
      setError("Donne un nom à cette note.");
      return null;
    }
    if (!source.includes("{{cloze:")) {
      setError("Ajoute au moins un trou.");
      return null;
    }
    setStatus("Enregistrement...");
    setError("");
    try {
      const target = group?.id
        ? group
        : await ensurePersistedGroup?.({ name: editableGroup.name, itemCount: holes.length });
      if (!target?.id) return null;
      const result = await patchClozeGroup(target.id, {
        name: editableGroup.name,
        tags: editableGroup.tags || [],
        answer_policy: answerPolicyFromGroup(editableGroup),
        source
      });
      setEditableGroup((current) => ({ ...current, ...result.group }));
      setSource(result.group.source || source);
      savedSignatureRef.current = JSON.stringify({
        name: result.group.name || "", tags: result.group.tags || [],
        policy: answerPolicyFromGroup(result.group), source: result.group.source || source
      });
      setStatus("Enregistré ✔");
      await onSave?.({ ...result, group: { ...target, ...result.group }, items: result.items || result.cards || [] });
      return result;
    } catch (saveError) {
      setStatus("");
      setError(saveError.message || "Enregistrement impossible");
      return null;
    }
  }, [editableGroup, ensurePersistedGroup, group, holes.length, onSave, source]);

  useEffect(() => registerPendingSaveHandler?.(() => (dirty ? save() : null)), [dirty, registerPendingSaveHandler, save]);

  return (
    <div className="app-scrollbar" style={{ overflow: "auto", padding: "18px", height: "100%" }}>
      <div style={{ alignItems: "center", display: "flex", gap: "10px", justifyContent: "space-between", marginBottom: "14px" }}>
        <div><div style={{ color: "#888" }}>Note à trous</div><strong style={{ color: "#ef9cff" }}>CLOZE</strong></div>
        <div style={{ display: "flex", gap: "8px" }}>{headerAction}<button type="button" onClick={save} disabled={!dirty} style={dirty ? pendingSaveButtonStyle : disabledSaveButtonStyle}>Enregistrer</button></div>
      </div>
      <div style={{ display: "grid", gap: "16px" }}>
        <EditorSection title="Note" accent="#ef9cff">
          <QuestionEditorField label="Nom"><input value={editableGroup?.name || ""} onChange={(event) => setEditableGroup((current) => ({ ...current, name: event.target.value }))} style={inputStyle} /></QuestionEditorField>
          <TagEditor tags={editableGroup?.tags || []} tagInput={tagInput} availableTags={availableTags} onTagInputChange={setTagInput} onAddTag={addTag} onRemoveTag={removeTag} />
          <AnswerPolicyControl policy={answerPolicyFromGroup(editableGroup)} onChange={(answer_policy) => setEditableGroup((current) => ({ ...current, data: { ...(current?.data || {}), answer_policy } }))} />
        </EditorSection>
        <EditorSection title="Texte et trous" accent="#ef9cff">
          <textarea value={visibleSource(source)} onChange={(event) => editVisibleSource(event.target.value)} onSelect={captureSelection} rows={8} style={{ ...inputStyle, fontFamily: "inherit", lineHeight: 1.55, resize: "vertical" }} />
          <div style={{ color: "#888", fontSize: "12px" }}>Sélectionne un passage, puis crée un trou. Le contexte reste éditable ; pour changer une réponse, retire puis recrée le trou.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}><button type="button" onClick={() => addHole()} style={buttonStyle}>Créer un trou</button>{holes.length > 0 && <><select value={selectedLinkKey} onChange={(event) => setSelectedLinkKey(event.target.value)} style={inputStyle}><option value="">Lier à un trou…</option>{holes.map((hole, index) => <option key={hole.key} value={hole.key}>Trou {index + 1} : {hole.answer}</option>)}</select><button type="button" onClick={() => selectedLinkKey && addHole(selectedLinkKey)} disabled={!selectedLinkKey} style={buttonStyle}>Ajouter une occurrence liée</button></>}</div>
          {holes.length > 0 && <div style={{ display: "grid", gap: "6px" }}>{holes.map((hole, index) => <div key={hole.key} style={{ alignItems: "center", background: "#211526", borderRadius: "8px", color: "#f5c6ff", display: "flex", gap: "8px", justifyContent: "space-between", padding: "8px 10px" }}><span>Trou {index + 1} — {hole.answer}</span><button type="button" onClick={() => removeHole(hole.key)} style={{ ...buttonStyle, background: "#4a2028" }}>Retirer</button></div>)}</div>}
        </EditorSection>
        {(status || error) && <div style={{ color: error ? "#ff9494" : "#8ee9ac" }}>{error || status}</div>}
      </div>
    </div>
  );
}
