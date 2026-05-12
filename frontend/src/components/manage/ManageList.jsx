import QuestionCard from "./QuestionCard";
import MapCard from "./MapCard";

export default function ManageList({
  filteredQuestions,
  selectedQuestion,
  setSelectedQuestion
}) {
  return (
    <div
      style={{
        borderRight: "1px solid #2a2a2a",
        overflow: "auto",
        background: "#141414"
      }}
    >
      {filteredQuestions.map((q) => {

        if (q.type_q === "map_group") {
          return (
            <MapCard
              key={q.id}
              q={q}
              selected={selectedQuestion?.id === q.id}
              onClick={() => setSelectedQuestion(q)}
            />
          );
        }

        return (
          <QuestionCard
            key={q.id}
            q={q}
            selected={selectedQuestion?.id === q.id}
            onClick={() => setSelectedQuestion(q)}
          />
        );
      })}
    </div>
  );
}