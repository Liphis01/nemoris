import { fadeInStyle, buttonBase } from "../styles";

const secondaryButtonStyle = {
    background: "#2a2a2a",
    color: "#eee",
    border: "1px solid #333",
    padding: "8px 14px",
    borderRadius: "6px",
    cursor: "pointer"
};

const successButton = {
    background: "#3fb950",
    color: "white",
    border: "none",
    padding: "10px 16px",
    borderRadius: "6px",
    cursor: "pointer"
};

const dangerButton = {
    background: "#ff4d4f",
    color: "white",
    border: "none",
    padding: "10px 16px",
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

const mainButtonStyle = {
    background: "#1f1f1f",
    color: "#eee",
    border: "1px solid #333",
    padding: "15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "16px"
};

export default function Quiz({
    setMode,
    questions,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleAnswer,
    theme,
    setTheme,
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
                    <select
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
                    </select>
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

                    {/* 🧠 Carte */}
                    <div
                        key={currentIndex}
                        style={{
                            background: "#1e1e1e",
                            padding: "30px",
                            borderRadius: "10px",
                            marginBottom: "20px",
                            ...fadeInStyle
                        }}
                    >
                        <div style={{ marginBottom: "10px", color: "#888" }}>
                            Question
                        </div>

                        <div
                            style={{
                                fontSize: "22px",
                                fontWeight: "bold"
                            }}
                        >
                            {questions[currentIndex].question}
                        </div>

                        {!showAnswer && (
                            <div style={{ marginTop: "25px" }}>
                                <button
                                    onClick={() => setShowAnswer(true)}
                                    style={{ ...buttonBase, ...mainButtonStyle }}
                                    onMouseEnter={(e) => e.target.style.opacity = "0.8"}
                                    onMouseLeave={(e) => e.target.style.opacity = "1"}
                                    onMouseDown={(e) => e.target.style.transform = "scale(0.95)"}
                                    onMouseUp={(e) => e.target.style.transform = "scale(1)"}
                                >
                                    Voir la réponse
                                </button>
                            </div>
                        )}

                        {showAnswer && (
                            <div style={{ marginTop: "25px", ...fadeInStyle }}>
                                <div style={{ color: "#888", marginBottom: "5px" }}>
                                    Réponse
                                </div>

                                <div style={{ color: "#ccc", marginBottom: "20px" }}>
                                    {questions[currentIndex].answer}
                                </div>

                                {/* 🔘 Boutons réponse */}
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "center",
                                        gap: "15px"
                                    }}
                                >
                                    <button
                                        style={dangerButton}
                                        onClick={() => handleAnswer(0)}
                                        onMouseEnter={(e) => e.target.style.opacity = "0.8"}
                                        onMouseLeave={(e) => e.target.style.opacity = "1"}
                                        onMouseDown={(e) => e.target.style.transform = "scale(0.95)"}
                                        onMouseUp={(e) => e.target.style.transform = "scale(1)"}
                                    >
                                        ❌ Faux
                                    </button>

                                    <button
                                        style={secondaryButton}
                                        onClick={() => handleAnswer(1)}
                                        onMouseEnter={(e) => e.target.style.opacity = "0.8"}
                                        onMouseLeave={(e) => e.target.style.opacity = "1"}
                                        onMouseDown={(e) => e.target.style.transform = "scale(0.95)"}
                                        onMouseUp={(e) => e.target.style.transform = "scale(1)"}
                                    >
                                        😐 Dur
                                    </button>

                                    <button
                                        style={successButton}
                                        onClick={() => handleAnswer(2)}
                                        onMouseEnter={(e) => e.target.style.opacity = "0.8"}
                                        onMouseLeave={(e) => e.target.style.opacity = "1"}
                                        onMouseDown={(e) => e.target.style.transform = "scale(0.95)"}
                                        onMouseUp={(e) => e.target.style.transform = "scale(1)"}
                                    >
                                        ✅ Facile
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

        </div >
    );
}