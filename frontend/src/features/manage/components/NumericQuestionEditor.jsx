import { useEffect, useMemo, useState } from "react";
import {
  EditorSection,
  QuestionEditorActions,
  QuestionEditorField,
  QuestionEditorShell,
  TagEditor
} from "./QuestionEditorPrimitives";
import { inputStyle } from "./QuestionEditorStyles";

function numericDraft(draft) {
  const numeric = draft?.data?.numeric || {};
  return {
    question: "",
    type_q: "numeric",
    tags: [],
    ...(draft || {}),
    data: {
      ...(draft?.data || {}),
      numeric: {
        value: numeric.value ?? "",
        unit: numeric.unit ?? "",
        display_precision: numeric.display_precision ?? 0,
        relative_tolerance: numeric.relative_tolerance ?? "0.10",
        zero_absolute_tolerance: numeric.zero_absolute_tolerance ?? ""
      }
    }
  };
}

function isZero(value) {
  const normalized = String(value || "").trim().replace(/\s/g, "").replace(",", ".");
  return normalized !== "" && Number(normalized) === 0;
}

function numericValidationError(numeric) {
  const rawValue = String(numeric.value || "").trim();
  const parsedValue = Number(rawValue.replace(/\s/g, "").replace(",", "."));
  const precision = Number(numeric.display_precision);

  if (!rawValue || !Number.isFinite(parsedValue)) return "La valeur attendue doit être un nombre fini.";
  if (!String(numeric.unit || "").trim()) return "L’unité est obligatoire.";
  if (!Number.isInteger(precision) || precision < 0 || precision > 12) return "La précision doit être entre 0 et 12.";
  if (parsedValue === 0) {
    const absolute = Number(String(numeric.zero_absolute_tolerance || "").replace(",", "."));
    return absolute > 0 ? "" : "Une tolérance absolue positive est obligatoire pour zéro.";
  }
  const relative = Number(numeric.relative_tolerance);
  return relative > 0 && relative <= 1 ? "" : "La tolérance relative doit être entre 0 et 100 %.";
}

export default function NumericQuestionEditor({
  draft,
  heading,
  meta,
  onChange,
  onSubmit,
  submitLabel = "Enregistrer",
  onCancel,
  onDelete,
  saveStatus,
  hasUnsavedChanges,
  isSubmitDisabled,
  headerAction,
  availableTags = []
}) {
  const [tagInput, setTagInput] = useState("");
  const value = numericDraft(draft);
  const numeric = value.data.numeric;
  const zero = isZero(numeric.value);
  const validationError = numericValidationError(numeric);

  useEffect(() => setTagInput(value._pendingTagInput || ""), [value._pendingTagInput]);

  const preview = useMemo(() => {
    if (!numeric.value || !numeric.unit) return "";
    return `${numeric.value} ${numeric.unit}`;
  }, [numeric.unit, numeric.value]);

  function commit(next) {
    onChange?.(numericDraft(next));
  }

  function setNumeric(field, nextValue) {
    commit({
      ...value,
      answer: "",
      data: { ...value.data, numeric: { ...numeric, [field]: nextValue } }
    });
  }

  function addTag(selectedTag) {
    const next = String(selectedTag ?? tagInput).trim();
    if (!next || (value.tags || []).includes(next)) return;
    commit({ ...value, tags: [...(value.tags || []), next], _pendingTagInput: "" });
    setTagInput("");
  }

  return (
    <QuestionEditorShell heading={heading} meta={meta} headerAction={headerAction}>
      <EditorSection title="Question" accent="#f2b56b">
        <textarea aria-label="Question" className="app-scrollbar" rows={3} value={value.question || ""} onChange={(event) => commit({ ...value, question: event.target.value })} style={{ ...inputStyle, lineHeight: 1.45, minHeight: "94px", resize: "vertical" }} />
      </EditorSection>
      <EditorSection title="Valeur attendue" accent="#f2b56b">
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "minmax(0, 1fr) minmax(120px, .45fr)" }}>
          <QuestionEditorField label="Nombre"><input aria-label="Valeur numérique" value={numeric.value} onChange={(event) => setNumeric("value", event.target.value)} placeholder="ex. 1,2e6" style={inputStyle} /></QuestionEditorField>
          <QuestionEditorField label="Unité"><input aria-label="Unité" value={numeric.unit} onChange={(event) => setNumeric("unit", event.target.value)} placeholder="km" style={inputStyle} /></QuestionEditorField>
        </div>
        <QuestionEditorField label="Décimales affichées"><input aria-label="Précision affichée" type="number" min="0" max="12" value={numeric.display_precision} onChange={(event) => setNumeric("display_precision", event.target.value)} style={inputStyle} /></QuestionEditorField>
        {zero ? <QuestionEditorField label="Tolérance absolue obligatoire"><input aria-label="Tolérance absolue" value={numeric.zero_absolute_tolerance} onChange={(event) => setNumeric("zero_absolute_tolerance", event.target.value)} placeholder="ex. 0,1" style={inputStyle} /></QuestionEditorField> : <QuestionEditorField label="Tolérance relative"><div style={{ alignItems: "center", display: "flex", gap: "8px" }}><input aria-label="Tolérance relative" type="number" min="0" max="100" step="0.1" value={Number(numeric.relative_tolerance || 0.1) * 100} onChange={(event) => setNumeric("relative_tolerance", String(Number(event.target.value) / 100))} style={inputStyle} /><span style={{ color: "#bbb" }}>%</span></div></QuestionEditorField>}
        {preview && <div style={{ background: "#211a11", borderRadius: "9px", color: "#f2d09b", padding: "10px 12px" }}>Affichage : {preview}</div>}
        {validationError && <div role="alert" style={{ color: "#ff9e9e" }}>{validationError}</div>}
      </EditorSection>
      <TagEditor tags={value.tags || []} tagInput={tagInput} availableTags={availableTags} onTagInputChange={(next) => { setTagInput(next); commit({ ...value, _pendingTagInput: next }); }} onAddTag={addTag} onRemoveTag={(tag) => commit({ ...value, tags: (value.tags || []).filter((item) => item !== tag) })} />
      <QuestionEditorActions submitLabel={submitLabel} onSubmit={() => onSubmit?.(value)} onCancel={onCancel} onDelete={onDelete} saveStatus={saveStatus} hasUnsavedChanges={hasUnsavedChanges} isSubmitDisabled={isSubmitDisabled || Boolean(validationError)} />
    </QuestionEditorShell>
  );
}
