import { fadeInStyle } from "../../../shared/styles";

const answerButtonStyle = {
    flex: 1,
    border: "none",
    borderRadius: "12px",
    padding: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "0.12s ease",
    fontSize: "15px"
};

export default function TextReviewCard({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleAnswer
}) {

    return (
        <div
            key={currentIndex}
            style={{
                background: "#181818",
                border: "1px solid #262626",
                borderRadius: "22px",
                overflow: "hidden",
                ...fadeInStyle
            }}
        >

            {/* HEADER */}
            <div
                style={{
                    padding: "18px 24px",
                    borderBottom: "1px solid #262626",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#161616"
                }}
            >

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px"
                    }}
                >

                    <div
                        style={{
                            background: "#2b2047",
                            color: "#b69cff",
                            padding: "4px 10px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: "700"
                        }}
                    >
                        TEXT
                    </div>

                    <div
                        style={{
                            color: "#666",
                            fontSize: "13px"
                        }}
                    >
                        Question #{q.question_id ?? q.id}
                    </div>

                </div>

            </div>

            {/* CONTENT */}
            <div
                style={{
                    padding: "34px"
                }}
            >

                {/* QUESTION */}
                <div
                    style={{
                        fontSize: "34px",
                        lineHeight: 1.35,
                        fontWeight: "700",
                        color: "#f3f3f3",
                        marginBottom: q.media ? "24px" : "0"
                    }}
                >
                    {q.question}
                </div>

                {/* IMAGE */}
                {q.media && (
                    <img
                        src={q.media}
                        alt="question"
                        style={{
                            width: "100%",
                            borderRadius: "18px",
                            marginTop: "18px",
                            border: "1px solid #2a2a2a"
                        }}
                    />
                )}

                {/* SHOW ANSWER */}
                {!showAnswer && (
                    <div
                        style={{
                            marginTop: "34px"
                        }}
                    >
                        <button
                            onClick={() => setShowAnswer(true)}
                            style={{
                                background: "#232323",
                                border: "1px solid #333",
                                color: "#eee",
                                padding: "16px 22px",
                                borderRadius: "14px",
                                cursor: "pointer",
                                fontWeight: "600",
                                fontSize: "15px"
                            }}
                        >
                            Voir la réponse
                        </button>
                    </div>
                )}

                {/* ANSWER */}
                {showAnswer && (
                    <div
                        style={{
                            marginTop: "36px",
                            paddingTop: "28px",
                            borderTop: "1px solid #2a2a2a"
                        }}
                    >

                        <div
                            style={{
                                color: "#666",
                                fontSize: "12px",
                                fontWeight: "700",
                                letterSpacing: "0.08em",
                                marginBottom: "12px"
                            }}
                        >
                            ANSWER
                        </div>

                        <div
                            style={{
                                color: "#ddd",
                                fontSize: "26px",
                                lineHeight: 1.5,
                                marginBottom: "34px"
                            }}
                        >
                            {q.answer}
                        </div>

                        {/* BUTTONS */}
                        <div
                            style={{
                                display: "flex",
                                gap: "14px"
                            }}
                        >

                            <button
                                onClick={() => handleAnswer(0)}
                                style={{
                                    ...answerButtonStyle,
                                    background: "#3a1f24",
                                    color: "#ff9aa5"
                                }}
                            >
                                ❌ Faux
                            </button>

                            <button
                                onClick={() => handleAnswer(1)}
                                style={{
                                    ...answerButtonStyle,
                                    background: "#35311f",
                                    color: "#ffd36b"
                                }}
                            >
                                😐 Dur
                            </button>

                            <button
                                onClick={() => handleAnswer(2)}
                                style={{
                                    ...answerButtonStyle,
                                    background: "#1d3a2b",
                                    color: "#7ee2a8"
                                }}
                            >
                                ✅ Facile
                            </button>

                        </div>

                    </div>
                )}

            </div>

        </div>
    );
}
