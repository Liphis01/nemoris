import TextQuestion from "./TextQuestion";
import MapQuestion from "./MapQuestion";

export default function QuestionRenderer({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleAnswer
}) {
    if (!q) return null;

    switch (q.type_q) {
        case "map":
            return <MapQuestion q={q} />;

        case "image":
        case "text":
        default:
            return <TextQuestion
                q={q}
                currentIndex={currentIndex}
                showAnswer={showAnswer}
                setShowAnswer={setShowAnswer}
                handleAnswer={handleAnswer}
            />;
    }
}