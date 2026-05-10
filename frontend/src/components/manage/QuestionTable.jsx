import QuestionRow from "./QuestionRow";
import MapRow from "./MapRow";
import { tableStyle, theadStyle, headerRowStyle } from "./styles";

export default function QuestionTable(props) {
  const {
    filteredQuestions,
    handleSort,
    sortField,
    sortOrder,
  } = props;

  return (
    <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      <table style={tableStyle}>

        <thead style={theadStyle}>
          <tr>
            <th
              style={headerRowStyle}
              onClick={() => handleSort("id")}
            >
              ID {sortField === "id" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
            </th>

            <th
              style={headerRowStyle}
              onClick={() => handleSort("question")}
            >
              Question {sortField === "question" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
            </th>

            <th
              style={headerRowStyle}
              onClick={() => handleSort("answer")}
            >
              Réponse {sortField === "answer" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
            </th>

            <th
              style={headerRowStyle}
              onClick={() => handleSort("tags")}
            >
              Tags {sortField === "tags" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
            </th>

            <th
              style={headerRowStyle}
              onClick={() => handleSort("type_q")}
            >
              Type {sortField === "type_q" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
            </th>

            <th
              style={headerRowStyle}
              onClick={() => handleSort("media")}
            >
              Media {sortField === "media" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
            </th>

            <th
              style={headerRowStyle}
              onClick={() => handleSort("next_review")}
            >
              Review {sortField === "next_review" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
            </th>

            <th></th>
          </tr>
        </thead>

        <tbody>
          {filteredQuestions.map((q, i) => {
            if (q.type_q === "map_group") {
              return <MapRow key={q.id} q={q} {...props} />;
            }

            return <QuestionRow key={q.id} q={q} index={i} {...props} />;
          })}
        </tbody>

      </table>
    </div>
  );
}