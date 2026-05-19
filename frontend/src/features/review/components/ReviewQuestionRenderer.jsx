import TextReviewCard from "./TextReviewCard";
import MapReview from "./MapReview";

export default function ReviewQuestionRenderer({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleTextAnswer,
    handleMapComplete,
}) {
    if (!q) return null;

    if (q.type_q === "map" && !q.media) {
        return <div>⚠️ Map vide</div>;
    }

    // Grouped map review built from atomic map questions.
    if (q.type_q === "map" && q.media) {
        return (
            <MapReview
                group={q}
                reviewZones={q.items}
                onComplete={handleMapComplete}
            />
        );
    }

    // Text review question.
    return (
        <TextReviewCard
            q={q}
            currentIndex={currentIndex}
            showAnswer={showAnswer}
            setShowAnswer={setShowAnswer}
            handleAnswer={handleTextAnswer}
        />
    );
}
