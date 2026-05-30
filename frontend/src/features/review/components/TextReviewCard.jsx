import { fadeInStyle } from "../../../shared/styles";

const answerButtonStyle = {
    flex: 1,
    border: "1px solid transparent",
    borderRadius: "12px",
    padding: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, color 0.14s ease, opacity 0.14s ease, transform 0.14s ease",
    fontSize: "15px",
    transform: "scale(1)"
};

const answerOptions = [
    {
        value: 0,
        label: "0 · ❌ Faux",
        background: "#3a1f24",
        selectedBackground: "#6a2732",
        color: "#ff9aa5",
        selectedColor: "#ffe2e5"
    },
    {
        value: 1,
        label: "1 · 😐 Dur",
        background: "#35311f",
        selectedBackground: "#665224",
        color: "#ffd36b",
        selectedColor: "#fff1c7"
    },
    {
        value: 2,
        label: "2 · 🙂 Bon",
        background: "#1f2f3a",
        selectedBackground: "#25567d",
        color: "#8fc7ff",
        selectedColor: "#e1f0ff"
    },
    {
        value: 3,
        label: "3 · ✅ Facile",
        background: "#1d3a2b",
        selectedBackground: "#256844",
        color: "#7ee2a8",
        selectedColor: "#ddffeb"
    }
];

function getAnswerButtonStyle(option, selectedQuality) {
    const isAnswering = selectedQuality !== null;
    const isSelected = selectedQuality === option.value;

    return {
        ...answerButtonStyle,
        background: isSelected ? option.selectedBackground : option.background,
        borderColor: isSelected ? option.color : "transparent",
        boxShadow: isSelected
            ? `0 0 0 3px ${option.color}22, 0 12px 28px ${option.color}20`
            : "none",
        color: isSelected ? option.selectedColor : option.color,
        cursor: isAnswering ? "default" : "pointer",
        opacity: isAnswering && !isSelected ? 0.42 : 1,
        transform: isSelected
            ? "translateY(-2px) scale(1.035)"
            : isAnswering
                ? "scale(0.985)"
                : "scale(1)"
    };
}

export default function TextReviewCard({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleAnswer,
    selectedQuality
}) {
    const isAnswering = selectedQuality !== null;

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
                                gap: "14px",
                                flexWrap: "wrap"
                            }}
                        >

                            {answerOptions.map(option => (
                                <button
                                    key={option.value}
                                    aria-pressed={selectedQuality === option.value}
                                    disabled={isAnswering}
                                    onClick={() => handleAnswer(option.value)}
                                    style={getAnswerButtonStyle(option, selectedQuality)}
                                >
                                    {option.label}
                                </button>
                            ))}

                        </div>

                    </div>
                )}

            </div>

        </div>
    );
}
