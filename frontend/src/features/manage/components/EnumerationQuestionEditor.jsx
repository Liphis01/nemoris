import { useState } from "react";
import { inputStyle } from "./QuestionEditorStyles";
import { EditorSection, QuestionEditorField } from "./QuestionEditorPrimitives";

export default function EnumerationQuestionEditor({ draft, setDraft }) {
  const enumeration = draft.data?.enumeration || { members: [], required_count: 1 };
  const [text, setText] = useState(enumeration.members.map(member => member.value).join("\n"));
  const update = (membersText, quota = enumeration.required_count) => setDraft(current => ({ ...current, data: { ...(current.data || {}), enumeration: { required_count: Number(quota) || 1, members: membersText.split("\n").map(value => value.trim()).filter(Boolean).map(value => ({ value, aliases: [] })) } } }));
  return <div style={{ display: "grid", gap: "14px" }}><EditorSection title="Énumération" accent="#f3a8ef"><QuestionEditorField label="Question"><textarea value={draft.question || ""} onChange={event => setDraft(current => ({ ...current, question: event.target.value }))} rows={3} style={inputStyle} /></QuestionEditorField><QuestionEditorField label="Réponses possibles, une par ligne"><textarea value={text} onChange={event => { setText(event.target.value); update(event.target.value); }} rows={7} style={inputStyle} /></QuestionEditorField><QuestionEditorField label="Quota requis"><input type="number" min="1" value={enumeration.required_count} onChange={event => update(text, event.target.value)} style={inputStyle} /></QuestionEditorField></EditorSection></div>;
}
