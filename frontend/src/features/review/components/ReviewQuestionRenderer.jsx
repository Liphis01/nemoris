import TextReviewCard from "./TextReviewCard";
import ImageReview from "./ImageReview";
import MapReview from "./MapReview";
import TimelineReview from "./TimelineReview";

export default function ReviewQuestionRenderer({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleTextAnswer,
    currentTextQuality,
    selectedTextQuality,
    handleMapComplete,
    handleImageComplete,
    handleTimelineComplete,
    submitMapAnswer,
    submitImageAnswer,
    submitTimelineAnswer,
    trainingMode = false,
    trainingElapsedMs = null,
    trainingBestTimeMs = null,
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
                contextItems={q.context_items || q.items || []}
                mode={q.mode}
                onComplete={handleMapComplete}
                submitAnswer={submitMapAnswer}
                showQualityControls={!trainingMode}
                trainingElapsedMs={trainingElapsedMs}
                trainingBestTimeMs={trainingBestTimeMs}
            />
        );
    }

    if (q.type_q === "image" && q.items) {
        return (
            <ImageReview
                key={currentIndex}
                group={q}
                reviewItems={q.items || []}
                onComplete={handleImageComplete}
                submitAnswer={submitImageAnswer}
                showQualityControls={!trainingMode}
                trainingElapsedMs={trainingElapsedMs}
                trainingBestTimeMs={trainingBestTimeMs}
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
                submitAnswer={submitTimelineAnswer}
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
            currentQuality={currentTextQuality}
            selectedQuality={selectedTextQuality}
            showQualityButtons={!trainingMode}
        />
    );
}
