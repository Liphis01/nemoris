import TextQuestion from "./TextQuestion";
import MapQuestion from "./MapQuestion";

export default function QuestionRenderer({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleTextAnswer,
    handleMapComplete,
}) {
    if (!q) return null;

    if (q.type_q === "map" && (!q.items || q.items.length === 0)) {
        return <div>⚠️ Map vide</div>;
    }

    // 🔥 MAP GROUP (nouveau système)
    if (q.type_q === "map" && q.items) {
        return (
            <MapQuestion
                q={q}
                items={q.items}
                media={q.media}
                onComplete={handleMapComplete}
            />
        );
    }

    // 🔹 QUESTION TEXTE
    return (
        <TextQuestion
            q={q}
            currentIndex={currentIndex}
            showAnswer={showAnswer}
            setShowAnswer={setShowAnswer}
            handleAnswer={handleTextAnswer}
        />
    );
}