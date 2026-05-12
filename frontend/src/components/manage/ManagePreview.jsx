import MapEditor from "../MapEditor";

export default function ManagePreview({
  selectedQuestion,
  updateQuestion,
  updateQuestionInState
}) {

  if (!selectedQuestion) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
          fontSize: "18px"
        }}
      >
        Sélectionner une question
      </div>
    );
  }

  // 🗺️ MAP
  if (selectedQuestion.type_q === "map_group") {
    return (
      <div
        style={{
          height: "100%",
          overflow: "auto"
        }}
      >
        <MapEditor
          q={{
            type_q: "map",
            svg: selectedQuestion.svg
          }}
          embedded
          updateQuestion={updateQuestion}
          updateQuestionInState={updateQuestionInState}
        />
      </div>
    );
  }

  // 📝 QUESTION
  return (
    <div
      style={{
        padding: "30px",
        overflow: "auto"
      }}
    >
      <div
        style={{
          color: "#666",
          marginBottom: "10px"
        }}
      >
        Question #{selectedQuestion.id}
      </div>

      <h2>
        {selectedQuestion.question}
      </h2>

      <div
        style={{
          marginTop: "20px",
          color: "#bbb",
          fontSize: "18px"
        }}
      >
        {selectedQuestion.answer}
      </div>

      {selectedQuestion.media && (
        <img
          src={selectedQuestion.media}
          alt=""
          style={{
            maxWidth: "100%",
            marginTop: "25px",
            borderRadius: "10px"
          }}
        />
      )}
    </div>
  );
}