import { useEffect, useState } from "react";
import {
  EditorSection,
  QuestionEditorActions,
  QuestionEditorField,
  QuestionEditorShell,
  TagEditor
} from "./QuestionEditorPrimitives";
import { inputStyle } from "./QuestionEditorStyles";

function blankMember() {
  return { value: "", aliases: [], aliasText: "" };
}

function normalizeMember(member) {
  const aliases = Array.isArray(member?.aliases)
    ? member.aliases
    : String(member?.aliasText || "")
      .split(",")
      .map(alias => alias.trim())
      .filter(Boolean);

  return {
    value: member?.value || "",
    aliases,
    aliasText: member?.aliasText ?? aliases.join(", ")
  };
}

function normalizeDraft(draft) {
  const enumeration = draft?.data?.enumeration || {};
  const members = Array.isArray(enumeration.members) && enumeration.members.length
    ? enumeration.members.map(normalizeMember)
    : [blankMember()];

  return {
    question: "",
    answer: "",
    type_q: "enumeration",
    group_id: null,
    tags: [],
    edit_policy: "replace_progress",
    ...(draft || {}),
    data: {
      ...(draft?.data || {}),
      enumeration: {
        required_count: enumeration.required_count ?? 1,
        members
      }
    }
  };
}

function serializeDraft(draft) {
  const enumeration = draft.data.enumeration;
  const members = (enumeration.members || [])
    .map(member => ({
      value: String(member.value || "").trim(),
      aliases: String(member.aliasText ?? member.aliases?.join(", ") ?? "")
        .split(",")
        .map(alias => alias.trim())
        .filter(Boolean)
    }))
    .filter(member => member.value);

  return {
    ...draft,
    answer: "",
    group_id: null,
    data: {
      ...(draft.data || {}),
      enumeration: {
        required_count: Number(enumeration.required_count) || 1,
        members
      }
    }
  };
}

function normalizedToken(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function validationError(draft) {
  const serialized = serializeDraft(draft);
  const members = serialized.data.enumeration.members;
  const requiredCount = Number(serialized.data.enumeration.required_count);

  if (!String(serialized.question || "").trim()) return "La question est obligatoire.";
  if (!members.length) return "Ajoute au moins un membre.";
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > members.length) {
    return "Le quota doit être compris entre 1 et le nombre de membres.";
  }

  const seen = new Set();
  for (const member of members) {
    for (const value of [member.value, ...(member.aliases || [])]) {
      const token = normalizedToken(value);
      if (!token) continue;
      if (seen.has(token)) return "Un membre ou son alias est dupliqué.";
      seen.add(token);
    }
  }

  return "";
}

export default function EnumerationQuestionEditor({
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
  const value = normalizeDraft(draft);
  const enumeration = value.data.enumeration;
  const isCreate = submitLabel === "Créer";
  const error = validationError(value);

  useEffect(() => {
    setTagInput(value._pendingTagInput || "");
  }, [value._pendingTagInput]);

  function commit(next) {
    onChange?.(normalizeDraft(next));
  }

  function setEnumeration(field, nextValue) {
    commit({
      ...value,
      data: {
        ...value.data,
        enumeration: {
          ...enumeration,
          [field]: nextValue
        }
      }
    });
  }

  function setMember(index, patch) {
    const members = enumeration.members.map((member, memberIndex) => (
      memberIndex === index ? { ...member, ...patch } : member
    ));

    setEnumeration("members", members);
  }

  function addTag(selectedTag) {
    const next = String(selectedTag ?? tagInput).trim();
    if (!next || (value.tags || []).includes(next)) return;
    commit({ ...value, tags: [...(value.tags || []), next], _pendingTagInput: "" });
    setTagInput("");
  }

  function submit() {
    if (error) return;
    const payload = serializeDraft(value);
    if (isCreate) delete payload.edit_policy;
    onSubmit?.(payload);
  }

  return (
    <QuestionEditorShell heading={heading} meta={meta} headerAction={headerAction}>
      <EditorSection title="Question" accent="#f3a8ef">
        <textarea
          aria-label="Question"
          className="app-scrollbar"
          rows={3}
          value={value.question || ""}
          onChange={(event) => commit({ ...value, question: event.target.value })}
          style={{ ...inputStyle, lineHeight: 1.45, minHeight: "94px", resize: "vertical" }}
        />
      </EditorSection>

      <EditorSection title="Quota" accent="#f3a8ef">
        <QuestionEditorField label="Réponses requises">
          <input
            aria-label="Quota requis"
            type="number"
            min="1"
            max={Math.max(1, enumeration.members.filter(member => String(member.value || "").trim()).length)}
            value={enumeration.required_count}
            onChange={(event) => setEnumeration("required_count", event.target.value)}
            style={inputStyle}
          />
        </QuestionEditorField>

        {!isCreate && (
          <QuestionEditorField label="Type de modification">
            <select
              aria-label="Type de modification"
              value={value.edit_policy || "replace_progress"}
              onChange={(event) => commit({ ...value, edit_policy: event.target.value })}
              style={inputStyle}
            >
              <option value="replace_progress">Changer le fait appris</option>
              <option value="preserve_progress">Corriger une faute</option>
            </select>
          </QuestionEditorField>
        )}
      </EditorSection>

      <EditorSection title="Membres" accent="#f3a8ef">
        <div style={{ display: "grid", gap: "10px" }}>
          {enumeration.members.map((member, index) => (
            <div
              key={index}
              style={{
                background: "#211625",
                border: "1px solid #4a2a52",
                borderRadius: "8px",
                display: "grid",
                gap: "8px",
                padding: "10px"
              }}
            >
              <input
                aria-label={`Membre ${index + 1}`}
                placeholder="Membre"
                value={member.value}
                onChange={(event) => setMember(index, { value: event.target.value })}
                style={inputStyle}
              />
              <input
                aria-label={`Alias ${index + 1}`}
                placeholder="Alias facultatifs, séparés par des virgules"
                value={member.aliasText ?? ""}
                onChange={(event) => setMember(index, { aliasText: event.target.value })}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setEnumeration(
                  "members",
                  enumeration.members.length === 1
                    ? enumeration.members
                    : enumeration.members.filter((_, memberIndex) => memberIndex !== index)
                )}
                style={{
                  background: "transparent",
                  border: "1px solid #56303a",
                  borderRadius: "8px",
                  color: "#f0a7b6",
                  cursor: "pointer",
                  padding: "8px 10px",
                  width: "fit-content"
                }}
              >
                Retirer
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setEnumeration("members", [...enumeration.members, blankMember()])}
          style={{
            background: "#39203f",
            border: "1px solid #69406f",
            borderRadius: "8px",
            color: "#f3a8ef",
            cursor: "pointer",
            fontWeight: 700,
            padding: "10px 12px",
            width: "fit-content"
          }}
        >
          Ajouter un membre
        </button>
        {error && <div role="alert" style={{ color: "#ff9e9e" }}>{error}</div>}
      </EditorSection>

      <TagEditor
        tags={value.tags || []}
        tagInput={tagInput}
        availableTags={availableTags}
        onTagInputChange={(next) => {
          setTagInput(next);
          commit({ ...value, _pendingTagInput: next });
        }}
        onAddTag={addTag}
        onRemoveTag={(tag) => commit({ ...value, tags: (value.tags || []).filter(item => item !== tag) })}
      />

      <QuestionEditorActions
        submitLabel={submitLabel}
        onSubmit={submit}
        onCancel={onCancel}
        onDelete={onDelete}
        saveStatus={saveStatus}
        hasUnsavedChanges={hasUnsavedChanges}
        isSubmitDisabled={isSubmitDisabled || Boolean(error)}
      />
    </QuestionEditorShell>
  );
}
