import { fadeInStyle, buttonBase } from "../styles";
import QuestionRenderer from "./QuestionRenderer";

const secondaryButtonStyle = {
    background: "#2a2a2a",
    color: "#eee",
    border: "1px solid #333",
    padding: "8px 14px",
    borderRadius: "6px",
    cursor: "pointer"
};

const secondaryButton = {
    background: "#444",
    color: "white",
    border: "none",
    padding: "10px 16px",
    borderRadius: "6px",
    cursor: "pointer"
};

export default function Quiz({
    setMode,
    questions,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleAnswer,
    tagInput,
    setTagInput,
    limit,
    setLimit
}) {
    return (
        <div style={{ maxWidth: "800px", margin: "auto" }}>

            {/* 🔙 Retour */}
            <button
                onClick={() => setMode("menu")}
                style={{ ...buttonBase, ...secondaryButtonStyle }}
                onMouseEnter={(e) => e.target.style.opacity = "0.8"}
                onMouseLeave={(e) => e.target.style.opacity = "1"}
                onMouseDown={(e) => e.target.style.transform = "scale(0.95)"}
                onMouseUp={(e) => e.target.style.transform = "scale(1)"}
            >
                ⬅ Retour
            </button>

            {/* 🔽 Filtres */}
            <div
                style={{
                    marginTop: "20px",
                    marginBottom: "30px",
                    display: "flex",
                    gap: "15px",
                    alignItems: "center",
                    justifyContent: "center",
                    flexWrap: "wrap"
                }}
            >
                <div>
                    <label style={{ marginRight: "8px", color: "#aaa" }}>
                        Thème
                    </label>
                    {/* <select
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                        style={{
                            padding: "6px",
                            borderRadius: "6px",
                            background: "#1e1e1e",
                            color: "#eee",
                            border: "1px solid #333"
                        }}
                    >
                        <option value="global">Global</option>
                        <option value="géographie">Géographie</option>
                        <option value="histoire">Histoire</option>
                        <option value="littérature">Littérature</option>
                    </select> */}
                    <input
                        placeholder="Filtrer par tags (ex: region/asie)"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                    />
                </div>

                <div>
                    <label style={{ marginRight: "8px", color: "#aaa" }}>
                        Questions
                    </label>
                    <input
                        type="number"
                        value={limit}
                        onChange={(e) => setLimit(Number(e.target.value))}
                        style={{
                            width: "70px",
                            padding: "6px",
                            borderRadius: "6px",
                            background: "#1e1e1e",
                            color: "#eee",
                            border: "1px solid #333"
                        }}
                    />
                </div>
            </div>

            {/* 🔽 Aucun résultat */}
            {questions.length === 0 && (
                <div style={{ color: "#888" }}>
                    Aucune question pour aujourd’hui 🎉
                </div>
            )}

            {/* 🔽 Session terminée */}
            {currentIndex >= questions.length && questions.length > 0 && (
                <div style={{ color: "#888" }}>
                    Session terminée 🎉
                </div>
            )}

            {/* 🔽 Question */}
            {questions.length > 0 && currentIndex < questions.length && (
                <>
                    <div style={{ marginBottom: "15px", color: "#888" }}>
                        Question {currentIndex + 1} / {questions.length}
                    </div>

                    <div style={{ marginBottom: "20px", color: "#aaa" }}>
                        {questions[currentIndex].theme}
                    </div>

                    <QuestionRenderer
                        q={questions[currentIndex]}
                        currentIndex={currentIndex}
                        showAnswer={showAnswer}
                        setShowAnswer={setShowAnswer}
                        handleAnswer={handleAnswer}
                    />
                </>
            )}

        </div >
    );
}