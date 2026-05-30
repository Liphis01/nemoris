import TextReviewCard from "./TextReviewCard";
import MapReview from "./MapReview";
import TimelineReview from "./TimelineReview";

export default function ReviewQuestionRenderer({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleTextAnswer,
    selectedTextQuality,
    handleMapComplete,
    handleTimelineComplete,
}) {
    if (!q) return null;

    if (q.type_q === "map" && !q.media) {
        return <div>⚠️ Map vide</div>;
    }

    // Grouped map review built from atomic map questions.
    if (q.type_q === "map" && q.media) {
        return (
            <MapReview
                key={currentIndex}
                group={q}
                reviewZones={q.items}
                onComplete={handleMapComplete}
            />
        );
    }

    if (q.type_q === "timeline") {
        return (
            <TimelineReview
                key={currentIndex}
                group={q}
                reviewItems={q.items || []}
                onComplete={handleTimelineComplete}
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
            selectedQuality={selectedTextQuality}
        />
    );
}
