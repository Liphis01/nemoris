import { fadeInStyle, buttonBase } from "../styles";

const mainButtonStyle = {
    background: "#1f1f1f",
    color: "#eee",
    border: "1px solid #333",
    padding: "15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "16px"
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

const successButton = {
    background: "#3fb950",
    color: "white",
    border: "none",
    padding: "10px 16px",
    borderRadius: "6px",
    cursor: "pointer"
};

export default function TextQuestion({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleAnswer
}) {
    return (
        <>
            
            {/* //🧠 Carte */}
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
                    {q.question}
                </div>

                {q.type_q === "image" &&
                    q.image_url && (
                        <img
                            src={q.image_url}
                            alt="question"
                            style={{
                                maxWidth: "100%",
                                borderRadius: "10px",
                                marginTop: "15px"
                            }}
                        />
                    )}

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
                            {q.answer}
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
    );
}