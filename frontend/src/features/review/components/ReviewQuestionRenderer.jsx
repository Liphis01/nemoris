import TextReviewCard from "./TextReviewCard";
import ImageReview from "./ImageReview";
import MapReview from "./MapReview";
import TimelineReview from "./TimelineReview";
import {
    IMAGE_MODE_CLICK_PROMPT,
    IMAGE_MODE_TYPE_PROMPT,
    normalizeImageMode
} from "../imageModes";

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
    compactVisualLayout = false,
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
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    if (q.type_q === "image" && q.items) {
        const imageMode = normalizeImageMode(q.mode);
        const separatesResolvedItems = (
            imageMode === IMAGE_MODE_CLICK_PROMPT ||
            imageMode === IMAGE_MODE_TYPE_PROMPT
        );

        return (
            <ImageReview
                key={currentIndex}
                group={q}
                reviewItems={q.items || []}
                contextItems={q.context_items || q.items || []}
                mode={q.mode}
                onComplete={handleImageComplete}
                submitAnswer={submitImageAnswer}
                separateResolvedItems={separatesResolvedItems}
                showQualityControls={!trainingMode}
                trainingElapsedMs={trainingElapsedMs}
                trainingBestTimeMs={trainingBestTimeMs}
                fillAvailableHeight={compactVisualLayout}
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
                fillAvailableHeight={compactVisualLayout}
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
