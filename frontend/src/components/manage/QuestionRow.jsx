import { cellStyle } from "./styles";

export default function QuestionRow({
  q,
  index,
  allQuestions,
  setAllQuestions,
  updateQuestion,
  deleteQuestion,
  handleUpload,
  setEditingQuestion,
  setEditingTagsQuestion
}) {

  function updateField(field, value) {
    const updated = [...allQuestions];
    updated[index][field] = value;
    setAllQuestions(updated);
  }

  return (
    <tr>
      <td
        style={{ cursor: "pointer" }}
        onClick={() => {
          if (q.type_q == "map") { setEditingQuestion(q) }
        }}
      >
        {q.id}
      </td>

      <td>
        <input
          style={cellStyle}
          value={q.question}
          onChange={(e) => updateField("question", e.target.value)}
          onBlur={() => updateQuestion(q.id, { question: q.question })}
        />
      </td>

      <td>
        <input
          style={cellStyle}
          value={q.answer || ""}
          onChange={(e) => updateField("answer", e.target.value)}
          onBlur={() => updateQuestion(q.id, { answer: q.answer })}
        />
      </td>

      <td>
        <button onClick={() => setEditingTagsQuestion(q)}>
          🏷️
        </button>
      </td>

      <td>{q.type_q}</td>

      <td>
        {q.type_q === "map" ? (
          <input
            style={cellStyle}
            value={q.media || ""}
            onChange={(e) => updateField("media", e.target.value)}
            onBlur={() => updateQuestion(q.id, { media: q.media })}
          />
        ) : (
          <input
            type="file"
            onChange={(e) => handleUpload(e, q)}
          />
        )}
      </td>

      <td>{q.next_review || "-"}</td>

      <td>
        <button onClick={() => deleteQuestion(q.id)}>
          🗑
        </button>
      </td>
    </tr>
  );
}