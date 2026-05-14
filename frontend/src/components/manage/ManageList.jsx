import QuestionCard from "./QuestionCard";
import MapCard from "./MapCard";
import GroupCardItem from "./GroupCardItem";

export default function ManageList({
  filteredQuestions,
  allGroups,
  selectedQuestion,
  setSelectedQuestion,
  viewMode,
  editing,
  setEditing
}) {
  return (
    <div
      style={{
        borderRight: "1px solid #2a2a2a",
        overflow: "auto",
        background: "#141414"
      }}
    >
      {viewMode === "questions" && filteredQuestions.map((q) => {

        if (q.type_q === "map") {
          return (
            <MapCard
              key={q.id}
              q={q}
              selected={selectedQuestion?.id === q.id}
              onClick={() => { setSelectedQuestion(q); setEditing(q.data?.code); }}
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

      {viewMode === "groups" && allGroups.map((group) => (
        <GroupCardItem
          key={group.id}
          group={group}
          selected={selectedQuestion?.id === group.id}
          onClick={() => setSelectedQuestion(group)}
        />
      ))}
    </div>
  );
}